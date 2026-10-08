/**
 * Paie (lot PAIE-3D) : etat de PROVISION pour indemnites de depart a la retraite a une date d'arrete.
 *
 * Methode (alignee sur le fichier de calcul IDR VF2025, avec corrections) :
 *  - base mensuelle = brut (imposable par defaut) des 12 derniers mois civils jusqu'a l'arrete / nombre de mois pris en compte
 *    (12, ou prorata si le salarie est entre dans la fenetre : jours d'activite / (365/12)) ;
 *  - anciennete = (arrete - date d'entree) en jours / 365 ;
 *  - indemnite = somme par tranche du barème : annees dans la tranche x % par an x base mensuelle (plafond eventuel en mois).
 * Aucun taux n'est code ici : il vient du barème choisi (table paie_retraite_bareme).
 */
const XLSX = require("xlsx");
const { v4: uuidv4 } = require("uuid");
const db = require("../db");
const P = require("./paieParametres");
const ANN = require("./paieEtatsAnnuels");

const { PaieError } = P;
const num = (v) => Number(v) || 0;
const nul = (v) => (v === "" || v === null || v === undefined ? null : Number(v));
const iso = (d) => (d ? String(d).slice(0, 10) : null);
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const utc = (s) => Date.parse(`${iso(s)}T00:00:00Z`);
const joursEntre = (a, b) => Math.round((utc(b) - utc(a)) / 86400000);
const r2 = (n) => Math.round(n * 100) / 100;

function debutFenetre(arrete) {
  const d = new Date(utc(arrete));
  const m = d.getUTCFullYear() * 12 + d.getUTCMonth() - 11;
  return new Date(Date.UTC(Math.floor(m / 12), m % 12, 1)).toISOString().slice(0, 10);
}

/** Barème du modele cabinet : valeurs du fichier de calcul IDR VF2025 (a confirmer avec la convention applicable). */
const MODELE_VF2025 = {
  libelle: "Barème IDR - fichier de calcul VF2025",
  date_effet: "2025-01-01",
  tranches: [{ de_annees: 0, a_annees: 5, pourcentage_par_an: 25 }, { de_annees: 5, a_annees: 10, pourcentage_par_an: 30 }, { de_annees: 10, a_annees: 20, pourcentage_par_an: 45 }, { de_annees: 20, a_annees: null, pourcentage_par_an: 50 }],
  note: "Taux repris du fichier de calcul IDR VF2025 contrôlé par le cabinet (25 % / 30 % / 45 % / 50 % du salaire mensuel par année d'ancienneté). À confirmer avec la convention collective applicable.",
};

async function creerModeleBareme(tid, userId) {
  const existe = (await ANN.listerBaremesRetraite(tid)).find((b) => b.libelle === MODELE_VF2025.libelle);
  if (existe) return existe.id;
  return ANN.sauverBaremeRetraite(tid, userId, MODELE_VF2025);
}

function choisirBareme(baremes, arrete, id) {
  const valides = baremes.filter((b) => b.date_effet <= arrete);
  if (!valides.length) throw new PaieError("PAIE_RETRAITE_AUCUN_BAREME", 409);
  return (id && valides.find((b) => b.id === id)) || valides.find((b) => !b.convention_id) || valides[0];
}

/** Detail par tranche et indemnite (arrondie au franc) pour une anciennete en annees et une base mensuelle. */
function calculer(bareme, ans, base) {
  const tranches = bareme.tranches.map((t) => {
    const fin = t.a_annees === null ? ans : Math.min(ans, t.a_annees);
    const annees = Math.max(0, fin - t.de_annees);
    return { de_annees: t.de_annees, a_annees: t.a_annees, pourcentage_par_an: t.pourcentage_par_an, annees: r2(annees), annees_brut: annees, montant: annees * (t.pourcentage_par_an / 100) * base };
  });
  let total = tranches.reduce((s, t) => s + t.montant, 0);
  let plafonne = false;
  if (bareme.plafond_mois != null && total > bareme.plafond_mois * base) { total = bareme.plafond_mois * base; plafonne = true; }
  return { tranches: tranches.map((t) => ({ de_annees: t.de_annees, a_annees: t.a_annees, pourcentage_par_an: t.pourcentage_par_an, annees: t.annees, montant: Math.round(t.montant) })), indemnite: Math.round(total), plafonne };
}

function nbMoisAuto(entree, arrete) {
  const debut = debutFenetre(arrete);
  if (entree <= debut) return 12;
  return Math.min(12, r2((joursEntre(entree, arrete) + 1) / (365 / 12)));
}

async function etat(tid, q) {
  const arrete = iso(q.date_arrete);
  if (!arrete || !DATE.test(arrete) || Number.isNaN(utc(arrete))) throw new PaieError("PAIE_PROVISION_DATE_INVALIDE", 400);
  const colonne = String(q.base || "").toUpperCase() === "BRUT" ? "brut" : "imposable";
  const bareme = choisirBareme(await ANN.listerBaremesRetraite(tid), arrete, q.bareme_id);
  const fen = debutFenetre(arrete);
  const lo = Number(fen.slice(0, 4)) * 12 + Number(fen.slice(5, 7)), hi = Number(arrete.slice(0, 4)) * 12 + Number(arrete.slice(5, 7));

  const emps = (await db.query(
    `SELECT e.id, e.matricule, e.nom, e.prenom, e.date_embauche, e.date_sortie, d.date_anciennete
       FROM employe e LEFT JOIN paie_dossier d ON d.employe_id = e.id WHERE e.tenant_id = $1 ORDER BY e.matricule NULLS LAST, e.nom`, [tid])).rows;
  const bul = (await db.query(
    `SELECT b.employe_id, p.annee, p.mois, b.${colonne} AS montant FROM paie_bulletin b JOIN paie_periode p ON p.id = b.periode_id
      WHERE b.tenant_id = $1 AND p.statut IN ('VALIDEE','CLOTUREE') AND p.annee * 12 + p.mois BETWEEN $2 AND $3`, [tid, lo, hi])).rows;
  const parEmp = new Map();
  for (const b of bul) { const o = parEmp.get(b.employe_id) || { total: 0, n: 0 }; o.total += num(b.montant); o.n += 1; parEmp.set(b.employe_id, o); }
  const saisies = (await db.query(`SELECT * FROM paie_provision_retraite_ligne WHERE tenant_id = $1 AND date_arrete = $2`, [tid, arrete])).rows;
  const saisieDe = new Map(saisies.filter((s) => s.employe_id).map((s) => [s.employe_id, s]));

  const construire = (src) => {
    const entree = src.entree;
    const alertes = [];
    const s = src.saisie;
    const bAuto = src.bulletins && src.bulletins.n ? src.bulletins : null;
    const brut12 = s && s.brut_12m != null ? num(s.brut_12m) : bAuto ? bAuto.total : null;
    const sourceBrut = s && s.brut_12m != null ? "SAISI" : bAuto ? "BULLETINS" : null;
    const moisAuto = nbMoisAuto(entree, arrete);
    const mois = s && s.nb_mois != null ? num(s.nb_mois) : moisAuto;
    if (brut12 === null) alertes.push("SANS_BRUT");
    else if (sourceBrut === "BULLETINS" && bAuto.n < Math.ceil(mois - 1e-9)) alertes.push("BULLETINS_INCOMPLETS");
    if (mois <= 0) alertes.push("MOIS_INVALIDE");
    const jours = joursEntre(entree, arrete);
    const ans = jours / 365;
    const base = brut12 !== null && mois > 0 ? brut12 / mois : null;
    const calc = base !== null ? calculer(bareme, ans, base) : null;
    const client = s && s.indemnite_client != null ? num(s.indemnite_client) : null;
    return {
      employe_id: src.employe_id || null, ligne_id: s ? s.id : null, source: src.source, matricule: src.matricule || "", nom: src.nom, date_entree: entree,
      brut_12m: brut12, brut_source: sourceBrut, nb_bulletins: bAuto ? bAuto.n : 0, nb_mois: mois, nb_mois_auto: moisAuto, nb_mois_saisi: !!(s && s.nb_mois != null),
      base_mensuelle: base === null ? null : Math.round(base), anciennete_jours: jours, anciennete_ans: r2(ans),
      tranches: calc ? calc.tranches : bareme.tranches.map((t) => ({ de_annees: t.de_annees, a_annees: t.a_annees, pourcentage_par_an: t.pourcentage_par_an, annees: r2(Math.max(0, (t.a_annees === null ? ans : Math.min(ans, t.a_annees)) - t.de_annees)), montant: null })),
      indemnite: calc ? calc.indemnite : null, plafonne: calc ? calc.plafonne : false,
      indemnite_client: client, ecart: client !== null && calc ? client - calc.indemnite : null, alertes, note: s ? s.note : null,
    };
  };

  const lignes = [];
  for (const e of emps) {
    const entree = iso(e.date_anciennete || e.date_embauche);
    if (!entree || entree > arrete || (e.date_sortie && iso(e.date_sortie) <= arrete)) continue;
    lignes.push(construire({ source: "PAIE", employe_id: e.id, matricule: e.matricule, nom: [e.prenom, String(e.nom || "").toUpperCase()].filter(Boolean).join(" "), entree, bulletins: parEmp.get(e.id), saisie: saisieDe.get(e.id) }));
  }
  for (const s of saisies.filter((x) => !x.employe_id && x.date_entree)) {
    lignes.push(construire({ source: "LIBRE", matricule: s.matricule, nom: s.nom, entree: iso(s.date_entree), bulletins: null, saisie: s }));
  }
  const somme = (k) => lignes.reduce((t, l) => t + num(l[k]), 0);
  const totaux = { brut_12m: somme("brut_12m"), indemnite: somme("indemnite"), indemnite_client: somme("indemnite_client"), nb: lignes.length };
  totaux.ecart = lignes.some((l) => l.indemnite_client !== null) ? lignes.reduce((t, l) => t + (l.ecart === null ? 0 : l.ecart), 0) : null;
  return {
    date_arrete: arrete, base: colonne === "brut" ? "BRUT" : "IMPOSABLE", fenetre: { debut: fen, fin: arrete },
    bareme: { id: bareme.id, libelle: bareme.libelle, tranches: bareme.tranches, plafond_mois: bareme.plafond_mois, note: bareme.note },
    lignes, totaux,
  };
}

async function sauverLigne(tid, userId, c) {
  const arrete = iso(c.date_arrete);
  if (!arrete || !DATE.test(arrete)) throw new PaieError("PAIE_PROVISION_DATE_INVALIDE", 400);
  const v = { brut: nul(c.brut_12m), mois: nul(c.nb_mois), client: nul(c.indemnite_client) };
  if ((v.brut !== null && v.brut < 0) || (v.client !== null && v.client < 0) || (v.mois !== null && (v.mois <= 0 || v.mois > 12))) throw new PaieError("PAIE_PROVISION_LIGNE_INVALIDE", 400);
  const note = c.note ? String(c.note).trim() : null;
  if (c.employe_id) {
    const e = await db.query(`SELECT id FROM employe WHERE id = $1 AND tenant_id = $2`, [c.employe_id, tid]);
    if (!e.rows[0]) throw new PaieError("PAIE_EMPLOYE_INTROUVABLE", 404);
    const r = await db.query(
      `INSERT INTO paie_provision_retraite_ligne (id, tenant_id, date_arrete, employe_id, brut_12m, nb_mois, indemnite_client, note, modifie_par)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       ON CONFLICT (tenant_id, date_arrete, employe_id) WHERE employe_id IS NOT NULL
       DO UPDATE SET brut_12m = EXCLUDED.brut_12m, nb_mois = EXCLUDED.nb_mois, indemnite_client = EXCLUDED.indemnite_client, note = EXCLUDED.note, modifie_par = EXCLUDED.modifie_par, date_modification = now() RETURNING id`,
      [uuidv4(), tid, arrete, c.employe_id, v.brut, v.mois, v.client, note, userId || null]);
    return r.rows[0].id;
  }
  const nom = String(c.nom || "").trim();
  if (!nom || !DATE.test(String(c.date_entree || ""))) throw new PaieError("PAIE_PROVISION_LIGNE_INVALIDE", 400);
  const matricule = String(c.matricule || "").trim() || null;
  if (c.id) {
    const r = await db.query(
      `UPDATE paie_provision_retraite_ligne SET matricule = $3, nom = $4, date_entree = $5, brut_12m = $6, nb_mois = $7, indemnite_client = $8, note = $9, modifie_par = $10, date_modification = now()
        WHERE id = $1 AND tenant_id = $2 AND employe_id IS NULL RETURNING id`, [c.id, tid, matricule, nom, c.date_entree, v.brut, v.mois, v.client, note, userId || null]);
    if (!r.rows[0]) throw new PaieError("PAIE_PROVISION_LIGNE_INVALIDE", 404);
    return c.id;
  }
  const id = uuidv4();
  await db.query(
    `INSERT INTO paie_provision_retraite_ligne (id, tenant_id, date_arrete, matricule, nom, date_entree, brut_12m, nb_mois, indemnite_client, note, modifie_par)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`, [id, tid, arrete, matricule, nom, c.date_entree, v.brut, v.mois, v.client, note, userId || null]);
  return id;
}

async function supprimerLigne(tid, id) {
  await db.query(`DELETE FROM paie_provision_retraite_ligne WHERE id = $1 AND tenant_id = $2`, [id, tid]);
}

// ---------------------------------------------------------------------------------------------------------------------
// Excel : memes colonnes que le fichier de calcul, avec FORMULES (tranches, base, indemnite, ecart) pour pouvoir auditer.
// ---------------------------------------------------------------------------------------------------------------------
const col = (i) => { let s = ""; i += 1; while (i > 0) { const m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); } return s; };
const serial = (s) => Math.round(utc(s) / 86400000) + 25569;

function exportXlsx(e, entete, { preparePar, lang }) {
  const en = lang === "en";
  const L = en
    ? { client: "Client", arrete: "Cut-off date", prepare: "Prepared by", date: "Date", base: "Base", bareme: "Scale", titre: "RETIREMENT PROVISION CALCULATION", mle: "Employee no.", entree: "Hire date", nom: "Employee",
        brut: e.base === "BRUT" ? "Gross pay, last 12 months" : "Taxable gross pay, last 12 months", mois: "Months used", mensuel: "Monthly base", arreteCol: "Cut-off", jours: "Service (days)", ans: "Service (years)", tranche: "Band", indemnite: "Recalculated severance",
        cli: "Severance computed by client", ecart: "Difference", total: "TOTAL", de: "From (years)", a: "To (years)", pct: "% per year", imposable: "Taxable gross", brutNom: "Gross", plafond: "Cap (months)" }
    : { client: "Client", arrete: "Arrêté", prepare: "Préparé par", date: "Date", base: "Base", bareme: "Barème", titre: "CALCUL DE PROVISION POUR RETRAITE", mle: "N° Mle", entree: "Date d'entrée", nom: "Nom du salarié",
        brut: e.base === "BRUT" ? "Brut 12 derniers mois" : "Brut imposable 12 derniers mois", mois: "Mois pris en compte", mensuel: "Base mensuelle", arreteCol: "Arrêté", jours: "Ancienneté en jours", ans: "Ancienneté en années", tranche: "Tranche", indemnite: "Indemnité retraite recalculée",
        cli: "Indemnité calculée par le client", ecart: "Écart", total: "TOTAL", de: "De (années)", a: "À (années)", pct: "% par année", imposable: "Brut imposable", brutNom: "Brut", plafond: "Plafond (mois)" };
  const ws = {};
  const set = (a, v, o = {}) => { ws[a] = { t: typeof v === "number" ? "n" : "s", v, ...o }; };
  const fc = (f, v, z) => ({ t: typeof v === "number" ? "n" : "s", f, v, z });
  const setD = (a, s) => { ws[a] = { t: "n", v: serial(s), z: "dd/mm/yyyy" }; };
  set("A1", L.client); set("B1", entete.raison_sociale || "");
  set("A2", L.arrete); setD("B2", e.date_arrete);
  set("A3", L.prepare); set("B3", preparePar || "");
  set("A4", L.date); setD("B4", new Date().toISOString().slice(0, 10));
  set("A5", L.base); set("B5", e.base === "BRUT" ? L.brutNom : L.imposable);
  set("A6", L.bareme); set("B6", e.bareme.libelle);
  set("A8", L.titre);
  // parametres du bareme (lignes 10..)
  const tr = e.bareme.tranches;
  const n = tr.length;
  set("A10", L.tranche); set("B10", L.de); set("C10", L.a); set("D10", L.pct);
  tr.forEach((t, i) => { const r = 11 + i; set(`A${r}`, `${L.tranche} ${i + 1}`); set(`B${r}`, t.de_annees, { z: "0.##" }); if (t.a_annees !== null) set(`C${r}`, t.a_annees, { z: "0.##" }); set(`D${r}`, t.pourcentage_par_an, { z: "0.##" }); });
  let rp = 11 + n;
  const cellPlafond = e.bareme.plafond_mois != null ? `$B$${rp}` : null;
  if (cellPlafond) { set(`A${rp}`, L.plafond); set(`B${rp}`, e.bareme.plafond_mois); rp += 1; }
  const h = rp + 1; // ligne d'en-tete du tableau
  const entetes = [L.mle, L.entree, L.nom, L.brut, L.mois, L.mensuel, L.arreteCol, L.jours, L.ans, ...tr.map((_, i) => `${L.tranche} ${i + 1}`), L.indemnite, L.cli, L.ecart];
  entetes.forEach((x, i) => set(`${col(i)}${h}`, x));
  const cT = (i) => col(9 + i); // colonnes tranches
  const cInd = col(9 + n), cCli = col(10 + n), cEcart = col(11 + n);
  let r = h + 1;
  const r0 = r;
  for (const l of e.lignes) {
    set(`A${r}`, l.matricule || ""); setD(`B${r}`, l.date_entree); set(`C${r}`, l.nom);
    if (l.brut_12m !== null) set(`D${r}`, l.brut_12m, { z: "#,##0" });
    set(`E${r}`, l.nb_mois, { z: "0.##" });
    const base = l.base_mensuelle;
    ws[`F${r}`] = fc(`IFERROR(IF(D${r}="","",D${r}/E${r}),"")`, l.brut_12m !== null && l.nb_mois > 0 ? l.brut_12m / l.nb_mois : "", "#,##0");
    ws[`G${r}`] = { t: "n", v: serial(e.date_arrete), z: "dd/mm/yyyy" };
    ws[`H${r}`] = { t: "n", f: `G${r}-B${r}`, v: l.anciennete_jours, z: "0" };
    ws[`I${r}`] = { t: "n", f: `H${r}/365`, v: l.anciennete_jours / 365, z: "0.00" };
    tr.forEach((t, i) => {
      const bas = `$B$${11 + i}`, haut = `$C$${11 + i}`;
      ws[`${cT(i)}${r}`] = { t: "n", f: t.a_annees === null ? `MAX(0,$I${r}-${bas})` : `MAX(0,MIN($I${r},${haut})-${bas})`, v: l.tranches[i].annees_brut != null ? l.tranches[i].annees_brut : Math.max(0, (t.a_annees === null ? l.anciennete_jours / 365 : Math.min(l.anciennete_jours / 365, t.a_annees)) - t.de_annees), z: "0.00" };
    });
    const somme = tr.map((_, i) => `${cT(i)}${r}*$D$${11 + i}/100`).join("+");
    const brutInd = `$F${r}*(${somme})`;
    ws[`${cInd}${r}`] = fc(`IFERROR(IF(F${r}="","",${cellPlafond ? `MIN(${brutInd},${cellPlafond}*$F${r})` : brutInd}),"")`, l.indemnite === null ? "" : l.indemnite, "#,##0");
    if (l.indemnite_client !== null) set(`${cCli}${r}`, l.indemnite_client, { z: "#,##0" });
    ws[`${cEcart}${r}`] = fc(`IFERROR(IF(OR(${cCli}${r}="",${cInd}${r}=""),"",${cCli}${r}-${cInd}${r}),"")`, l.ecart === null ? "" : l.ecart, "#,##0");
    r += 1;
  }
  const rt = r + 1;
  set(`C${rt}`, L.total);
  for (const [c, v] of [["D", e.totaux.brut_12m], [cInd, e.totaux.indemnite], [cCli, e.totaux.indemnite_client]]) ws[`${c}${rt}`] = { t: "n", f: `SUM(${c}${r0}:${c}${Math.max(r0, r - 1)})`, v, z: "#,##0" };
  ws[`${cEcart}${rt}`] = { t: "n", f: `SUM(${cEcart}${r0}:${cEcart}${Math.max(r0, r - 1)})`, v: e.totaux.ecart === null ? 0 : e.totaux.ecart, z: "#,##0" };
  ws["!ref"] = `A1:${col(11 + n)}${rt}`;
  ws["!cols"] = [{ wch: 11 }, { wch: 13 }, { wch: 30 }, { wch: 18 }, { wch: 10 }, { wch: 14 }, { wch: 12 }, { wch: 12 }, { wch: 12 }, ...tr.map(() => ({ wch: 11 })), { wch: 18 }, { wch: 18 }, { wch: 14 }];

  const note = en
    ? ["Method", `Monthly base = ${e.base === "BRUT" ? "gross" : "taxable gross"} pay of the 12 calendar months ending at the cut-off date / months used (12, or pro rata when hired inside the window).`, "Service = (cut-off date - hire date) in days / 365.", "Severance = sum over bands of years in band x % per year x monthly base (cap in months if any).", "Rates come from the scale chosen above, which must be checked against the applicable collective agreement."]
    : ["Méthode", `Base mensuelle = ${e.base === "BRUT" ? "brut" : "brut imposable"} des 12 mois civils jusqu'à l'arrêté / mois pris en compte (12, ou prorata si le salarié est entré dans la fenêtre).`, "Ancienneté = (arrêté - date d'entrée) en jours / 365.", "Indemnité = somme par tranche des années dans la tranche x % par année x base mensuelle (plafond en mois le cas échéant).", "Les taux viennent du barème choisi ci-dessus, à confirmer avec la convention collective applicable."];
  const wn = XLSX.utils.aoa_to_sheet(note.map((x) => [x]));
  wn["!cols"] = [{ wch: 130 }];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, (en ? "Retirement" : "Calcul retraite").slice(0, 31));
  XLSX.utils.book_append_sheet(wb, wn, en ? "Method" : "Méthode");
  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
}

module.exports = { etat, sauverLigne, supprimerLigne, exportXlsx, creerModeleBareme, calculer, nbMoisAuto, MODELE_VF2025 };
