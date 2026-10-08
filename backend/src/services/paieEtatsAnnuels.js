/**
 * Paie (lot PAIE-3C) : etats trimestriels et annuels a partir des periodes CLOTUREES, et indemnite de depart a la retraite.
 */
const XLSX = require("xlsx");
const { v4: uuidv4 } = require("uuid");
const db = require("../db");
const P = require("./paieParametres");
const PER = require("./paiePeriodes");

const { PaieError } = P;
const num = (v) => Number(v) || 0;
const MOIS_FR = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];
const MOIS_EN = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/** Bornes de mois d'un etat : annuel (trimestre = 0) ou trimestre 1..4. */
function bornes(trimestre) {
  const t = Number(trimestre) || 0;
  if (t === 0) return { de: 1, a: 12 };
  if (t < 1 || t > 4) throw new PaieError("PAIE_ETAT_TRIMESTRE_INVALIDE", 400);
  return { de: (t - 1) * 3 + 1, a: t * 3 };
}

const nomDe = (id) => [id.prenom, String(id.nom || "").toUpperCase()].filter(Boolean).join(" ");

async function etat(tid, annee, trimestre = 0) {
  annee = Number(annee);
  if (!(annee >= 2000 && annee <= 2100)) throw new PaieError("PAIE_ETAT_ANNEE_INVALIDE", 400);
  const { de, a } = bornes(trimestre);
  const per = await db.query(`SELECT id, mois, statut FROM paie_periode WHERE tenant_id = $1 AND annee = $2 AND mois BETWEEN $3 AND $4 ORDER BY mois`, [tid, annee, de, a]);
  const cloturees = per.rows.filter((p) => p.statut === "CLOTUREE");
  const ids = cloturees.map((p) => p.id);
  const moisDe = new Map(per.rows.map((p) => [p.id, p.mois]));
  const r = ids.length
    ? await db.query(`SELECT periode_id, employe_id, calcul_json FROM paie_bulletin WHERE tenant_id = $1 AND periode_id = ANY($2::uuid[])`, [tid, ids])
    : { rows: [] };

  const salaries = new Map(), parMois = new Map(), sections = new Map();
  const zero = () => ({ brut: 0, imposable: 0, cotis_salarie: 0, ir: 0, trimf: 0, autres_retenues: 0, remboursements: 0, net: 0, charges_patronales: 0, cout_employeur: 0 });
  const add = (o, x) => { for (const k of Object.keys(x)) o[k] += x[k]; };
  for (const row of r.rows) {
    const b = row.calcul_json, id = b.identite, mois = moisDe.get(row.periode_id);
    const cotis = (b.retenues || []).filter((c) => c.section !== "IMPOT").reduce((s, c) => s + num(c.montant), 0);
    const v = {
      brut: num(b.totaux.brut), imposable: num(b.totaux.imposable), cotis_salarie: cotis, ir: num(b.ir.montant), trimf: num(b.trimf.montant),
      autres_retenues: (b.retenues_saisies || []).reduce((s, x) => s + num(x.montant), 0), remboursements: num(b.total_remboursements), net: num(b.net_a_payer),
      charges_patronales: num(b.total_charges_patronales), cout_employeur: num(b.cout_employeur),
    };
    if (!salaries.has(row.employe_id)) salaries.set(row.employe_id, { employe_id: row.employe_id, matricule: id.matricule, nom: nomDe(id), numero_css: id.numero_css, numero_ipres: id.numero_ipres, mois_travailles: 0, ...zero(), orgs: new Map() });
    const s = salaries.get(row.employe_id);
    s.mois_travailles += 1;
    add(s, v);
    if (!parMois.has(mois)) parMois.set(mois, { mois, nb: 0, ...zero() });
    const pm = parMois.get(mois);
    pm.nb += 1;
    add(pm, v);
    for (const c of [...(b.retenues || []), ...(b.charges_patronales || [])]) {
      if (c.section === "IMPOT") continue;
      if (!sections.has(c.section)) sections.set(c.section, new Map());
      sections.get(c.section).set(c.code, c.libelle);
    }
    for (const c of b.retenues || []) if (c.section !== "IMPOT") { const o = s.orgs.get(c.code) || { base: 0, salarie: 0, patronal: 0 }; o.salarie += num(c.montant); o.base = Math.max(o.base, 0) + 0; s.orgs.set(c.code, o); }
    for (const c of b.charges_patronales || []) { const o = s.orgs.get(c.code) || { base: 0, salarie: 0, patronal: 0 }; o.patronal += num(c.montant); s.orgs.set(c.code, o); }
    // Assiette cumulee des cotisations (base) : une fois par code et par mois
    const bases = new Map();
    for (const c of [...(b.retenues || []), ...(b.charges_patronales || [])]) if (c.section !== "IMPOT") bases.set(c.code, Math.max(bases.get(c.code) || 0, num(c.base)));
    for (const [code, base] of bases) s.orgs.get(code).base += base;
  }
  const liste = [...salaries.values()].sort((x, y) => x.nom.localeCompare(y.nom));
  const somme = (arr, k) => arr.reduce((t, x) => t + num(x[k]), 0);
  const cles = Object.keys(zero());
  const totaux = Object.fromEntries(cles.map((k) => [k, somme(liste, k)]));
  const organismes = [];
  for (const [section, codes] of sections) {
    const colonnes = [...codes.entries()].map(([code, libelle]) => ({ code, libelle }));
    const sal = liste.map((s) => ({ employe_id: s.employe_id, matricule: s.matricule, nom: s.nom, numero_css: s.numero_css, numero_ipres: s.numero_ipres,
      cotisations: Object.fromEntries(colonnes.map((c) => [c.code, s.orgs.get(c.code) || { base: 0, salarie: 0, patronal: 0 }])) }));
    const tot = Object.fromEntries(colonnes.map((c) => [c.code, { base: somme(sal.map((x) => x.cotisations[c.code]), "base"), salarie: somme(sal.map((x) => x.cotisations[c.code]), "salarie"), patronal: somme(sal.map((x) => x.cotisations[c.code]), "patronal") }]));
    organismes.push({ section, colonnes, salaries: sal, totaux: tot, total_a_payer: Object.values(tot).reduce((t, x) => t + x.salarie + x.patronal, 0) });
  }
  const synthese = organismes.map((o) => ({ code: o.section, a_payer: o.total_a_payer })).concat([{ code: "IR", a_payer: totaux.ir }, { code: "TRIMF", a_payer: totaux.trimf }]);
  const moisListe = [];
  for (let m = de; m <= a; m++) {
    const p = per.rows.find((x) => x.mois === m);
    moisListe.push({ mois: m, statut: p ? p.statut : null });
  }
  return {
    annee, trimestre: Number(trimestre) || 0, de, a, mois: moisListe, complet: moisListe.every((m) => m.statut === "CLOTUREE"),
    salaries: liste.map(({ orgs, ...x }) => x), totaux, par_mois: [...parMois.values()].sort((x, y) => x.mois - y.mois), organismes, synthese,
  };
}

async function exportXlsx(tid, annee, trimestre, lang = "fr") {
  const e = await etat(tid, annee, trimestre);
  const en = lang === "en";
  const L = en
    ? { recap: "Employee summary", mois: "By month", syn: "Summary", mat: "ID", nom: "Employee", nm: "Months", brut: "Gross", imp: "Taxable", cot: "Employee contributions", ir: "Income tax", trimf: "TRIMF", aut: "Other deductions", remb: "Reimbursements", net: "Net pay", ch: "Employer contributions", cout: "Employer cost", tot: "Total", css: "Social security no.", ipres: "IPRES no.", base: "Base", sal: "Employee", pat: "Employer", a_payer: "Amount due", nb: "Payslips", org: { RETRAITE: "Pension (IPRES)", SOCIAL: "Social security (CSS)", TAXE: "Taxes (CFCE)" }, moisN: MOIS_EN, periode: trimestre ? `Q${trimestre} ${annee}` : String(annee) }
    : { recap: "Récapitulatif salariés", mois: "Par mois", syn: "Synthèse", mat: "Matricule", nom: "Salarié", nm: "Mois", brut: "Brut", imp: "Imposable", cot: "Cotisations salarié", ir: "IR", trimf: "TRIMF", aut: "Autres retenues", remb: "Remboursements", net: "Net payé", ch: "Charges patronales", cout: "Coût employeur", tot: "Total", css: "N° CSS", ipres: "N° IPRES", base: "Base", sal: "Salarié", pat: "Patronal", a_payer: "À payer", nb: "Bulletins", org: { RETRAITE: "Retraite (IPRES)", SOCIAL: "Sécurité sociale (CSS)", TAXE: "Taxes (CFCE)" }, moisN: MOIS_FR, periode: trimestre ? `T${trimestre} ${annee}` : String(annee) };
  const wb = XLSX.utils.book_new();
  const add = (nom, aoa, cols) => { const ws = XLSX.utils.aoa_to_sheet(aoa); ws["!cols"] = cols.map((w) => ({ wch: w })); XLSX.utils.book_append_sheet(wb, ws, nom.slice(0, 31)); };
  const ligne = (x, debut) => [...debut, x.brut, x.imposable, x.cotis_salarie, x.ir, x.trimf, x.autres_retenues, x.remboursements, x.net, x.charges_patronales, x.cout_employeur];
  const enteteCols = [L.brut, L.imp, L.cot, L.ir, L.trimf, L.aut, L.remb, L.net, L.ch, L.cout];
  const r = [[`${L.recap} - ${L.periode}`], [L.mat, L.nom, L.css, L.ipres, L.nm, ...enteteCols]];
  for (const s of e.salaries) r.push(ligne(s, [s.matricule, s.nom, s.numero_css, s.numero_ipres, s.mois_travailles]));
  r.push(ligne(e.totaux, [L.tot, "", "", "", ""]));
  add(L.recap, r, [12, 30, 16, 16, 7, 13, 13, 16, 12, 10, 14, 15, 14, 16, 14]);
  const m = [[`${L.mois} - ${L.periode}`], ["", L.nb, ...enteteCols]];
  for (const x of e.par_mois) m.push(ligne(x, [L.moisN[x.mois - 1], x.nb]));
  m.push(ligne(e.totaux, [L.tot, ""]));
  add(L.mois, m, [14, 9, 13, 13, 16, 12, 10, 14, 15, 14, 16, 14]);
  for (const o of e.organismes) {
    const head = [L.mat, L.nom, L.css, L.ipres];
    for (const c of o.colonnes) head.push(`${c.code} ${L.base}`, `${c.code} ${L.sal}`, `${c.code} ${L.pat}`);
    const a = [[`${L.org[o.section] || o.section} - ${L.periode}`], head];
    for (const s of o.salaries) { const row = [s.matricule, s.nom, s.numero_css, s.numero_ipres]; for (const c of o.colonnes) { const v = s.cotisations[c.code]; row.push(v.base, v.salarie, v.patronal); } a.push(row); }
    const tr = [L.tot, "", "", ""]; for (const c of o.colonnes) { const v = o.totaux[c.code]; tr.push(v.base, v.salarie, v.patronal); } a.push(tr);
    add(L.org[o.section] || o.section, a, [12, 30, 16, 16, ...o.colonnes.flatMap(() => [13, 13, 13])]);
  }
  const s = [[`${L.syn} - ${L.periode}`], ["", L.a_payer]];
  for (const x of e.synthese) s.push([x.code === "IR" ? L.ir : x.code === "TRIMF" ? "TRIMF" : L.org[x.code] || x.code, x.a_payer]);
  add(L.syn, s, [34, 16]);
  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
}

// ------------------------------------------------------------------------------------------------ indemnite de depart a la retraite
function validerTranches(tr) {
  if (!Array.isArray(tr) || tr.length === 0) throw new PaieError("PAIE_RETRAITE_TRANCHES_INVALIDES", 400);
  const sortie = tr.map((x) => ({ de_annees: num(x.de_annees), a_annees: x.a_annees === null || x.a_annees === "" || x.a_annees === undefined ? null : num(x.a_annees), pourcentage_par_an: num(x.pourcentage_par_an) }));
  let prec = 0;
  sortie.sort((p, q) => p.de_annees - q.de_annees);
  for (const x of sortie) {
    if (x.de_annees < 0 || x.pourcentage_par_an < 0 || x.pourcentage_par_an > 1000 || (x.a_annees !== null && x.a_annees <= x.de_annees) || x.de_annees < prec) throw new PaieError("PAIE_RETRAITE_TRANCHES_INVALIDES", 400);
    prec = x.a_annees === null ? Infinity : x.a_annees;
  }
  return sortie;
}

async function listerBaremesRetraite(tid) {
  const r = await db.query(
    `SELECT b.*, cv.libelle AS convention_libelle FROM paie_retraite_bareme b LEFT JOIN paie_convention cv ON cv.id = b.convention_id WHERE b.tenant_id = $1 ORDER BY b.date_effet DESC, b.libelle`,
    [tid]
  );
  return r.rows.map((x) => ({ id: x.id, convention_id: x.convention_id, convention_libelle: x.convention_libelle, libelle: x.libelle, date_effet: String(x.date_effet).slice(0, 10), tranches: x.tranches_json, plafond_mois: x.plafond_mois == null ? null : Number(x.plafond_mois), note: x.note }));
}

async function sauverBaremeRetraite(tid, userId, corps) {
  const c = corps || {};
  const libelle = String(c.libelle || "").trim();
  if (!libelle) throw new PaieError("PAIE_RETRAITE_LIBELLE_REQUIS", 400);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(c.date_effet || ""))) throw new PaieError("PAIE_RETRAITE_DATE_INVALIDE", 400);
  const tranches = validerTranches(c.tranches);
  const plafond = c.plafond_mois === "" || c.plafond_mois == null ? null : num(c.plafond_mois);
  if (plafond !== null && (plafond <= 0 || plafond > 120)) throw new PaieError("PAIE_RETRAITE_TRANCHES_INVALIDES", 400);
  const convention = c.convention_id || null;
  if (c.id) {
    const r = await db.query(
      `UPDATE paie_retraite_bareme SET convention_id = $3, libelle = $4, date_effet = $5, tranches_json = $6, plafond_mois = $7, note = $8 WHERE id = $1 AND tenant_id = $2 RETURNING id`,
      [c.id, tid, convention, libelle, c.date_effet, JSON.stringify(tranches), plafond, (c.note || "").trim() || null]
    );
    if (!r.rows[0]) throw new PaieError("PAIE_RETRAITE_BAREME_INTROUVABLE", 404);
    return c.id;
  }
  const id = uuidv4();
  await db.query(
    `INSERT INTO paie_retraite_bareme (id, tenant_id, convention_id, libelle, date_effet, tranches_json, plafond_mois, note, cree_par) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [id, tid, convention, libelle, c.date_effet, JSON.stringify(tranches), plafond, (c.note || "").trim() || null, userId || null]
  );
  return id;
}

async function supprimerBaremeRetraite(tid, id) {
  await db.query(`DELETE FROM paie_retraite_bareme WHERE id = $1 AND tenant_id = $2`, [id, tid]);
}

/** Annees d'anciennete (decimales : annees completes + mois / 12) entre deux dates ISO. */
function anneesEntre(debut, fin) {
  const d = new Date(`${String(debut).slice(0, 10)}T00:00:00Z`), f = new Date(`${String(fin).slice(0, 10)}T00:00:00Z`);
  let mois = (f.getUTCFullYear() - d.getUTCFullYear()) * 12 + (f.getUTCMonth() - d.getUTCMonth());
  if (f.getUTCDate() < d.getUTCDate()) mois -= 1;
  return Math.max(0, mois) / 12;
}

function appliquerBareme(bareme, anciennete, reference) {
  const detail = [];
  let total = 0;
  for (const t of bareme.tranches) {
    const fin = t.a_annees === null ? anciennete : Math.min(anciennete, t.a_annees);
    const annees = Math.max(0, fin - t.de_annees);
    if (annees <= 0) continue;
    const montant = annees * (t.pourcentage_par_an / 100) * reference;
    detail.push({ de_annees: t.de_annees, a_annees: t.a_annees, annees: Math.round(annees * 100) / 100, pourcentage_par_an: t.pourcentage_par_an, montant: Math.round(montant) });
    total += montant;
  }
  let plafonne = false;
  if (bareme.plafond_mois != null && total > bareme.plafond_mois * reference) { total = bareme.plafond_mois * reference; plafonne = true; }
  return { detail, montant: Math.round(total), plafonne };
}

async function calculerRetraite(tid, corps) {
  const c = corps || {};
  if (!/^[0-9a-f-]{36}$/i.test(String(c.employe_id || ""))) throw new PaieError("PAIE_EMPLOYE_INTROUVABLE", 404);
  const e = (await db.query(`SELECT e.id, e.matricule, e.nom, e.prenom, e.date_embauche, d.date_anciennete, d.convention_id FROM employe e LEFT JOIN paie_dossier d ON d.employe_id = e.id WHERE e.tenant_id = $1 AND e.id = $2`, [tid, c.employe_id])).rows[0];
  if (!e) throw new PaieError("PAIE_EMPLOYE_INTROUVABLE", 404);
  const dateDepart = /^\d{4}-\d{2}-\d{2}$/.test(String(c.date_depart || "")) ? c.date_depart : null;
  if (!dateDepart) throw new PaieError("PAIE_RETRAITE_DATE_INVALIDE", 400);
  const debut = e.date_anciennete || e.date_embauche;
  if (!debut) throw new PaieError("PAIE_RETRAITE_ANCIENNETE_INCONNUE", 409);
  const anciennete = anneesEntre(debut, dateDepart);
  const baremes = (await listerBaremesRetraite(tid)).filter((b) => b.date_effet <= dateDepart);
  if (!baremes.length) throw new PaieError("PAIE_RETRAITE_AUCUN_BAREME", 409);
  let bareme = c.bareme_id ? baremes.find((b) => b.id === c.bareme_id) : null;
  if (!bareme) bareme = baremes.find((b) => b.convention_id && b.convention_id === e.convention_id) || baremes.find((b) => !b.convention_id) || baremes[0];
  // Salaire mensuel de reference : saisi, sinon moyenne du brut des 12 derniers bulletins (clotures en priorite).
  let reference = c.salaire_reference === "" || c.salaire_reference == null ? null : num(c.salaire_reference);
  let source = "SAISI";
  if (reference === null) {
    const r = await db.query(
      `SELECT b.brut FROM paie_bulletin b JOIN paie_periode p ON p.id = b.periode_id WHERE b.tenant_id = $1 AND b.employe_id = $2 AND p.statut IN ('CLOTUREE','VALIDEE') ORDER BY p.annee DESC, p.mois DESC LIMIT 12`,
      [tid, e.id]
    );
    if (!r.rows.length) throw new PaieError("PAIE_RETRAITE_REFERENCE_REQUISE", 409);
    reference = Math.round(r.rows.reduce((s, x) => s + num(x.brut), 0) / r.rows.length);
    source = `MOYENNE_${r.rows.length}_MOIS`;
  }
  const calc = appliquerBareme(bareme, anciennete, reference);
  return {
    employe: { id: e.id, matricule: e.matricule, nom: [e.prenom, e.nom].filter(Boolean).join(" ") },
    date_depart: dateDepart, anciennete_depuis: String(debut).slice(0, 10), anciennete_annees: Math.round(anciennete * 100) / 100,
    salaire_reference: reference, source_reference: source, bareme: { id: bareme.id, libelle: bareme.libelle, plafond_mois: bareme.plafond_mois },
    ...calc,
  };
}

/** Verse l'indemnite calculee dans les variables du mois (rubrique INDEMNITE_DEPART) de la periode ouverte. */
async function appliquerRetraite(tid, userId, periodeId, employeId, montant) {
  const m = Math.round(num(montant));
  if (!(m > 0)) throw new PaieError("PAIE_RETRAITE_MONTANT_INVALIDE", 400);
  const p = await PER.chargerPeriode(tid, periodeId);
  const v = await PER.variablesEmploye(tid, periodeId, employeId);
  const gains = v.gains.filter((g) => g.rubrique_code !== "INDEMNITE_DEPART").map((g) => ({ rubrique_code: g.rubrique_code, quantite: g.quantite, montant: g.montant, note: g.note }));
  gains.push({ rubrique_code: "INDEMNITE_DEPART", montant: m, note: "Indemnité de départ à la retraite (calculateur)" });
  return PER.remplacerVariablesEmploye(tid, userId, p.id, employeId, {
    hs: v.hs.map((h) => ({ code: h.code, heures: h.heures, note: h.note })), absences: v.absences.map((a) => ({ type: a.type, jours: a.jours, note: a.note })),
    gains, retenues: v.retenues.map((x) => ({ rubrique_code: x.rubrique_code, montant: x.montant, note: x.note })),
  });
}

module.exports = { etat, exportXlsx, listerBaremesRetraite, sauverBaremeRetraite, supprimerBaremeRetraite, calculerRetraite, appliquerRetraite, anneesEntre, appliquerBareme };
