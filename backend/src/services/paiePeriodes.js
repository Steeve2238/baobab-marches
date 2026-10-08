/**
 * Paie (lot PAIE-2) : periodes de paie, variables du mois, generation des bulletins en brouillon, controles,
 * etats mensuels et ordre de virement des salaires.
 *
 * Regles :
 *  - la paie du mois suivant ne s'ouvre pas tant que la precedente n'est pas cloturee ;
 *  - les variables et les bulletins ne se modifient que tant que la periode est OUVERTE ;
 *  - la generation est recalculable a volonte (brouillon) : elle repart du dossier de paie, des variables et des parametres.
 */
const XLSX = require("xlsx");
const { v4: uuidv4 } = require("uuid");
const db = require("../db");
const P = require("./paieParametres");
const M = require("./paieMoteur");
const { prochainNumero } = require("./rhCommun");

const { PaieError } = P;
const MOIS_FR = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];
const MOIS_EN = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const num = (v) => (v == null || v === "" ? 0 : Number(v) || 0);

// ------------------------------------------------------------------------------------------------ periodes
async function chargerPeriode(tid, id) {
  if (!/^[0-9a-f-]{36}$/i.test(String(id))) throw new PaieError("PAIE_PERIODE_INTROUVABLE", 404);
  const r = await db.query(`SELECT * FROM paie_periode WHERE tenant_id = $1 AND id = $2`, [tid, id]);
  if (!r.rows[0]) throw new PaieError("PAIE_PERIODE_INTROUVABLE", 404);
  return r.rows[0];
}
function exigerModifiable(p) {
  if (p.statut !== "OUVERTE") throw new PaieError("PAIE_PERIODE_FIGEE", 409);
}

async function lister(tid) {
  const r = await db.query(
    `SELECT p.*,
            (SELECT COUNT(*) FROM paie_bulletin b WHERE b.periode_id = p.id) AS nb_bulletins,
            (SELECT COALESCE(SUM(b.brut),0) FROM paie_bulletin b WHERE b.periode_id = p.id) AS total_brut,
            (SELECT COALESCE(SUM(b.net_a_payer),0) FROM paie_bulletin b WHERE b.periode_id = p.id) AS total_net,
            (SELECT COALESCE(SUM(b.charges_patronales),0) FROM paie_bulletin b WHERE b.periode_id = p.id) AS total_charges,
            (SELECT COUNT(DISTINCT v.employe_id) FROM paie_variable v WHERE v.periode_id = p.id) AS nb_salaries_variables
     FROM paie_periode p WHERE p.tenant_id = $1 ORDER BY p.annee DESC, p.mois DESC`,
    [tid]
  );
  return r.rows.map(vuePeriode);
}
function vuePeriode(p) {
  return {
    id: p.id, annee: p.annee, mois: p.mois, statut: p.statut, date_ouverture: p.date_ouverture, date_calcul: p.date_calcul,
    date_validation: p.date_validation, date_cloture: p.date_cloture, ordre_virement_id: p.ordre_virement_id, notes: p.notes,
    nb_bulletins: Number(p.nb_bulletins) || 0, total_brut: Number(p.total_brut) || 0, total_net: Number(p.total_net) || 0,
    total_charges: Number(p.total_charges) || 0, nb_salaries_variables: Number(p.nb_salaries_variables) || 0,
  };
}

/** Etat de la sequence : quelle periode peut etre ouverte maintenant. */
async function prochainePossible(tid) {
  const r = await db.query(`SELECT annee, mois, statut FROM paie_periode WHERE tenant_id = $1 ORDER BY annee DESC, mois DESC LIMIT 1`, [tid]);
  const der = r.rows[0];
  if (!der) return { premiere: true, annee: null, mois: null, bloque: false, derniere: null };
  const suivant = der.mois === 12 ? { annee: der.annee + 1, mois: 1 } : { annee: der.annee, mois: der.mois + 1 };
  return { premiere: false, ...suivant, bloque: der.statut !== "CLOTUREE", derniere: { annee: der.annee, mois: der.mois, statut: der.statut } };
}

async function ouvrir(tid, userId, annee, mois) {
  await P.assurerDefauts(tid);
  const prochaine = await prochainePossible(tid);
  if (prochaine.premiere) {
    if (!(annee >= 2000 && annee <= 2100) || !(mois >= 1 && mois <= 12)) throw new PaieError("PAIE_PERIODE_PREMIERE_A_CHOISIR", 400);
  } else {
    if (prochaine.bloque) throw new PaieError("PAIE_PERIODE_PRECEDENTE_NON_CLOTUREE", 409, prochaine.derniere);
    if (annee && mois && (annee !== prochaine.annee || mois !== prochaine.mois)) throw new PaieError("PAIE_PERIODE_ORDRE", 409, { annee: prochaine.annee, mois: prochaine.mois });
    annee = prochaine.annee;
    mois = prochaine.mois;
  }
  const existe = await db.query(`SELECT 1 FROM paie_periode WHERE tenant_id = $1 AND annee = $2 AND mois = $3`, [tid, annee, mois]);
  if (existe.rows.length) throw new PaieError("PAIE_PERIODE_EXISTE", 409);
  const id = uuidv4();
  await db.query(`INSERT INTO paie_periode (id, tenant_id, annee, mois, ouvert_par) VALUES ($1,$2,$3,$4,$5)`, [id, tid, annee, mois, userId || null]);
  await generer(tid, userId, id);
  return chargerPeriode(tid, id);
}

/** Annule l'ouverture : seulement la derniere periode, tant qu'elle est ouverte (variables et brouillons supprimes). */
async function annulerOuverture(tid, id) {
  const p = await chargerPeriode(tid, id);
  exigerModifiable(p);
  const apres = await db.query(`SELECT 1 FROM paie_periode WHERE tenant_id = $1 AND (annee > $2 OR (annee = $2 AND mois > $3)) LIMIT 1`, [tid, p.annee, p.mois]);
  if (apres.rows.length) throw new PaieError("PAIE_PERIODE_PAS_DERNIERE", 409);
  if (p.ordre_virement_id) await db.query(`UPDATE rh_ordre_virement SET statut = 'ANNULE', date_modification = now() WHERE id = $1 AND tenant_id = $2 AND statut = 'BROUILLON'`, [p.ordre_virement_id, tid]);
  await db.query(`DELETE FROM paie_periode WHERE id = $1 AND tenant_id = $2`, [id, tid]);
}

// ------------------------------------------------------------------------------------------------ salaries concernes
/** Salaries a payer sur la periode (embauches/sorties au prorata) avec l'etat de leur dossier de paie. */
async function employesConcernes(tid, p) {
  const b = P.bornesPeriode(p.annee, p.mois);
  const r = await db.query(
    `SELECT e.id, e.matricule, COALESCE(e.nom, u.nom) AS nom, COALESCE(e.prenom, u.prenom) AS prenom, e.poste, e.date_embauche, e.date_sortie,
            e.statut, e.mode_paiement, e.banque, e.numero_compte, e.mobile_money_numero, e.numero_css, e.numero_ipres,
            d.employe_id IS NOT NULL AS a_dossier, d.convention_id, d.categorie_code, d.salaire_base_manuel, d.actif_paie, d.date_modification AS dossier_modifie,
            cv.libelle AS convention_libelle
     FROM employe e
     LEFT JOIN utilisateur u ON u.id = e.utilisateur_id
     LEFT JOIN paie_dossier d ON d.employe_id = e.id AND d.tenant_id = e.tenant_id
     LEFT JOIN paie_convention cv ON cv.id = d.convention_id
     WHERE e.tenant_id = $1
       AND (e.date_embauche IS NULL OR e.date_embauche <= $3::date)
       AND (e.date_sortie IS NULL OR e.date_sortie >= $2::date)
       AND NOT (e.statut = 'SORTI' AND (e.date_sortie IS NULL OR e.date_sortie < $2::date))
     ORDER BY COALESCE(e.nom, u.nom), COALESCE(e.prenom, u.prenom)`,
    [tid, b.debut, b.fin]
  );
  return r.rows.map((e) => ({
    ...e,
    dossier_complet: !!(e.a_dossier && ((e.convention_id && e.categorie_code) || e.salaire_base_manuel != null)),
    exclu: e.a_dossier && e.actif_paie === false,
  }));
}

// ------------------------------------------------------------------------------------------------ variables
async function referentiels(tid) {
  await P.assurerDefauts(tid);
  const [rub, abs, conv] = await Promise.all([
    P.rubriquesActives(tid), P.typesAbsence(tid),
    db.query(`SELECT code, libelle, majorations_json FROM paie_convention WHERE tenant_id = $1 AND actif ORDER BY ordre, code`, [tid]),
  ]);
  const hs = new Map();
  for (const c of conv.rows) for (const m of c.majorations_json || []) if (!hs.has(m.code)) hs.set(m.code, { code: m.code, libelle: m.libelle, taux: Number(m.taux) });
  return {
    rubriques: rub.filter((r) => r.actif),
    absences: abs.filter((a) => a.actif !== false),
    hs: [...hs.values()],
  };
}

function normaliserVariable(type, brut, ref) {
  const code = String(brut.code == null ? "" : brut.code).trim().toUpperCase();
  const quantite = brut.quantite === "" || brut.quantite == null ? null : Number(brut.quantite);
  const montant = brut.montant === "" || brut.montant == null ? null : Math.round(Number(brut.montant));
  const note = brut.note ? String(brut.note).trim().slice(0, 200) : null;
  const invalide = (raison) => new PaieError("PAIE_VARIABLE_INVALIDE", 400, { type, code, raison });
  if (!code) throw invalide("CODE");
  if ((quantite != null && !Number.isFinite(quantite)) || (montant != null && !Number.isFinite(montant))) throw invalide("NOMBRE");
  if (type === "HS") {
    if (!(quantite > 0) || quantite > 300) throw invalide("QUANTITE");
    if (!ref.hs.some((h) => h.code === code)) throw invalide("CODE_INCONNU");
    return { type, code, quantite, montant: null, note };
  }
  if (type === "ABSENCE") {
    if (!(quantite > 0) || quantite > 31) throw invalide("QUANTITE");
    if (!ref.absences.some((a) => a.code === code)) throw invalide("CODE_INCONNU");
    return { type, code, quantite, montant: null, note };
  }
  const rub = ref.rubriques.find((r) => r.code === code);
  if (!rub) throw invalide("CODE_INCONNU");
  if (type === "RETENUE") {
    if (rub.sens !== "RETENUE") throw invalide("SENS");
    if (!(montant > 0)) throw invalide("MONTANT");
    return { type, code, quantite: null, montant, note };
  }
  if (rub.sens === "RETENUE") throw invalide("SENS");
  if (rub.mode === "QUANTITE") {
    if (!(quantite > 0)) throw invalide("QUANTITE");
    if (montant != null && montant < 0) throw invalide("MONTANT");
    return { type, code, quantite, montant, note };
  }
  if (!(montant > 0)) throw invalide("MONTANT");
  return { type, code, quantite: null, montant, note };
}

/** Variables sous la forme attendue par le moteur, par salarie. */
async function variablesParEmploye(tid, periodeId) {
  const r = await db.query(`SELECT * FROM paie_variable WHERE tenant_id = $1 AND periode_id = $2 ORDER BY type, code`, [tid, periodeId]);
  const map = new Map();
  for (const v of r.rows) {
    if (!map.has(v.employe_id)) map.set(v.employe_id, { absences: [], heures_sup: [], gains: [], retenues: [] });
    const o = map.get(v.employe_id);
    if (v.type === "ABSENCE") o.absences.push({ type: v.code, jours: Number(v.quantite) });
    else if (v.type === "HS") o.heures_sup.push({ code: v.code, heures: Number(v.quantite) });
    else if (v.type === "GAIN") o.gains.push({ rubrique_code: v.code, montant: v.montant == null ? null : Number(v.montant), quantite: v.quantite == null ? null : Number(v.quantite) });
    else o.retenues.push({ rubrique_code: v.code, montant: Number(v.montant) });
  }
  return map;
}

/** Lignes saisies d'un salarie (pour l'editeur) : meme forme que le simulateur. */
async function variablesEmploye(tid, periodeId, employeId) {
  const r = await db.query(`SELECT * FROM paie_variable WHERE tenant_id = $1 AND periode_id = $2 AND employe_id = $3 ORDER BY type, code`, [tid, periodeId, employeId]);
  const sortie = { hs: [], absences: [], gains: [], retenues: [] };
  for (const v of r.rows) {
    const base = { id: v.id, note: v.note, origine: v.origine };
    if (v.type === "HS") sortie.hs.push({ ...base, code: v.code, heures: Number(v.quantite) });
    else if (v.type === "ABSENCE") sortie.absences.push({ ...base, type: v.code, jours: Number(v.quantite) });
    else if (v.type === "GAIN") sortie.gains.push({ ...base, rubrique_code: v.code, quantite: v.quantite == null ? null : Number(v.quantite), montant: v.montant == null ? null : Number(v.montant) });
    else sortie.retenues.push({ ...base, rubrique_code: v.code, montant: Number(v.montant) });
  }
  return sortie;
}

/** Remplace toutes les variables d'un salarie pour la periode, puis recalcule son bulletin. */
async function remplacerVariablesEmploye(tid, userId, periodeId, employeId, corps) {
  const p = await chargerPeriode(tid, periodeId);
  exigerModifiable(p);
  const emp = (await employesConcernes(tid, p)).find((e) => e.id === employeId);
  if (!emp) throw new PaieError("PAIE_EMPLOYE_HORS_PERIODE", 404);
  const ref = await referentiels(tid);
  const lignes = [];
  const vus = new Set();
  const ajouter = (l) => {
    const cle = `${l.type}|${l.code}`;
    if (vus.has(cle)) throw new PaieError("PAIE_VARIABLE_DOUBLON", 400, { type: l.type, code: l.code });
    vus.add(cle);
    lignes.push(l);
  };
  for (const h of corps.hs || []) ajouter(normaliserVariable("HS", { code: h.code, quantite: h.heures, note: h.note }, ref));
  for (const a of corps.absences || []) ajouter(normaliserVariable("ABSENCE", { code: a.type, quantite: a.jours, note: a.note }, ref));
  for (const g of corps.gains || []) ajouter(normaliserVariable("GAIN", { code: g.rubrique_code, quantite: g.quantite, montant: g.montant, note: g.note }, ref));
  for (const g of corps.retenues || []) ajouter(normaliserVariable("RETENUE", { code: g.rubrique_code, montant: g.montant, note: g.note }, ref));
  const client = await db.pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(`DELETE FROM paie_variable WHERE tenant_id = $1 AND periode_id = $2 AND employe_id = $3`, [tid, periodeId, employeId]);
    for (const l of lignes) {
      await client.query(
        `INSERT INTO paie_variable (id, tenant_id, periode_id, employe_id, type, code, quantite, montant, note, origine, saisi_par) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
        [uuidv4(), tid, periodeId, employeId, l.type, l.code, l.quantite, l.montant, l.note, corps.origine || "SAISIE", userId || null]
      );
    }
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
  return generer(tid, userId, periodeId, employeId);
}

/** Ajoute / met a jour des lignes (import Excel, copie, demandes RH) sans toucher aux autres lignes du salarie. */
async function fusionnerVariables(tid, userId, periode, lignesParEmploye, origine, { ecraser = true } = {}) {
  exigerModifiable(periode);
  const client = await db.pool.connect();
  let nb = 0;
  try {
    await client.query("BEGIN");
    for (const [employeId, lignes] of lignesParEmploye) {
      for (const l of lignes) {
        const sql = ecraser
          ? `INSERT INTO paie_variable (id, tenant_id, periode_id, employe_id, type, code, quantite, montant, note, origine, saisi_par) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
             ON CONFLICT (periode_id, employe_id, type, code) DO UPDATE SET quantite = EXCLUDED.quantite, montant = EXCLUDED.montant, note = EXCLUDED.note, origine = EXCLUDED.origine, saisi_par = EXCLUDED.saisi_par, date_modification = now()`
          : `INSERT INTO paie_variable (id, tenant_id, periode_id, employe_id, type, code, quantite, montant, note, origine, saisi_par) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
             ON CONFLICT (periode_id, employe_id, type, code) DO NOTHING`;
        const r = await client.query(sql, [uuidv4(), tid, periode.id, employeId, l.type, l.code, l.quantite, l.montant, l.note, origine, userId || null]);
        nb += r.rowCount;
      }
    }
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
  await generer(tid, userId, periode.id);
  return nb;
}

/** Copie les variables recurrentes (primes, retenues) du mois precedent. Heures sup et absences ne sont jamais copiees. */
async function copierMoisPrecedent(tid, userId, periodeId, { types = ["GAIN", "RETENUE"] } = {}) {
  const p = await chargerPeriode(tid, periodeId);
  exigerModifiable(p);
  const prec = await db.query(
    `SELECT id FROM paie_periode WHERE tenant_id = $1 AND (annee < $2 OR (annee = $2 AND mois < $3)) ORDER BY annee DESC, mois DESC LIMIT 1`,
    [tid, p.annee, p.mois]
  );
  if (!prec.rows[0]) throw new PaieError("PAIE_PAS_DE_MOIS_PRECEDENT", 404);
  const tp = types.filter((x) => ["GAIN", "RETENUE", "HS", "ABSENCE"].includes(x));
  const r = await db.query(`SELECT * FROM paie_variable WHERE tenant_id = $1 AND periode_id = $2 AND type = ANY($3)`, [tid, prec.rows[0].id, tp]);
  const concernes = new Set((await employesConcernes(tid, p)).map((e) => e.id));
  const ref = await referentiels(tid);
  const parEmp = new Map();
  let ignorees = 0;
  for (const v of r.rows) {
    if (!concernes.has(v.employe_id)) { ignorees += 1; continue; }
    let l;
    try { l = normaliserVariable(v.type, { code: v.code, quantite: v.quantite, montant: v.montant, note: v.note }, ref); } catch (e) { ignorees += 1; continue; }
    if (!parEmp.has(v.employe_id)) parEmp.set(v.employe_id, []);
    parEmp.get(v.employe_id).push(l);
  }
  const nb = await fusionnerVariables(tid, userId, p, parEmp, "COPIE", { ecraser: false });
  return { copiees: nb, ignorees };
}

/** Propose / applique les conges et heures supplementaires approuves dans les demandes RH. */
async function demandesRh(tid, p) {
  const b = P.bornesPeriode(p.annee, p.mois);
  const r = await db.query(
    `SELECT d.id, d.employe_id, d.type_demande, d.details FROM demande_rh d
     WHERE d.tenant_id = $1 AND d.statut = 'APPROUVEE' AND d.type_demande IN ('CONGE', 'HEURES_SUP')`,
    [tid]
  );
  const MAP = { CONGE_ANNUEL: "CONGE_PAYE", PERMISSION_FAMILIALE: "PERMISSION", SANS_SOLDE: "CONGE_SANS_SOLDE" };
  const ms = (s) => Date.parse(`${String(s).slice(0, 10)}T00:00:00Z`);
  const conges = [], heures = [], ignorees = [];
  for (const d of r.rows) {
    const x = d.details || {};
    if (d.type_demande === "CONGE") {
      const debut = String(x.date_debut || "").slice(0, 10), fin = String(x.date_fin || "").slice(0, 10);
      if (!debut || !fin) continue;
      const a = debut > b.debut ? debut : b.debut, z = fin < b.fin ? fin : b.fin;
      if (z < a) continue;
      const type = MAP[x.type_absence];
      if (!type) { ignorees.push({ demande_id: d.id, employe_id: d.employe_id, raison: "TYPE_ABSENCE", valeur: x.type_absence }); continue; }
      const jours = (ms(z) - ms(a)) / 86400000 + 1;
      const total = (ms(fin) - ms(debut)) / 86400000 + 1;
      const nb = Math.round(((Number(x.nb_jours) || total) * jours / total) * 2) / 2;
      if (nb > 0) conges.push({ demande_id: d.id, employe_id: d.employe_id, type, jours: nb, debut: a, fin: z });
    } else {
      const jour = String(x.date || "").slice(0, 10);
      if (jour >= b.debut && jour <= b.fin && Number(x.nb_heures) > 0) heures.push({ demande_id: d.id, employe_id: d.employe_id, heures: Number(x.nb_heures), date: jour });
    }
  }
  return { conges, heures, ignorees };
}
async function appliquerDemandesRh(tid, userId, periodeId, { codeHs = "HS_15" } = {}) {
  const p = await chargerPeriode(tid, periodeId);
  exigerModifiable(p);
  const concernes = new Set((await employesConcernes(tid, p)).map((e) => e.id));
  const dem = await demandesRh(tid, p);
  const par = new Map();
  const cumul = new Map();
  const mettre = (emp, type, code, quantite) => {
    const k = `${emp}|${type}|${code}`;
    cumul.set(k, { emp, type, code, quantite: (cumul.get(k)?.quantite || 0) + quantite });
  };
  for (const c of dem.conges) if (concernes.has(c.employe_id)) mettre(c.employe_id, "ABSENCE", c.type, c.jours);
  for (const h of dem.heures) if (concernes.has(h.employe_id)) mettre(h.employe_id, "HS", codeHs, h.heures);
  for (const { emp, type, code, quantite } of cumul.values()) {
    if (!par.has(emp)) par.set(emp, []);
    par.get(emp).push({ type, code, quantite, montant: null, note: "Demandes RH approuvées" });
  }
  const nb = await fusionnerVariables(tid, userId, p, par, "DEMANDE_RH", { ecraser: true });
  return { appliquees: nb, ignorees: dem.ignorees.length };
}

// ------------------------------------------------------------------------------------------------ gabarit / import Excel
const TYPES_ALIAS = {
  HS: "HS", "HEURES SUP": "HS", "HEURES SUPPLEMENTAIRES": "HS", "HEURES SUPPLÉMENTAIRES": "HS", OVERTIME: "HS",
  ABSENCE: "ABSENCE", ABSENCES: "ABSENCE",
  GAIN: "GAIN", PRIME: "GAIN", INDEMNITE: "GAIN", "INDEMNITÉ": "GAIN", "PRIME / INDEMNITE": "GAIN", "PRIME / INDEMNITÉ": "GAIN", BONUS: "GAIN",
  RETENUE: "RETENUE", RETENUES: "RETENUE", DEDUCTION: "RETENUE",
};

async function genererGabarit(tid, p) {
  const ref = await referentiels(tid);
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet([
    ["Matricule", "Type (HS / ABSENCE / PRIME / RETENUE)", "Code", "Heures, jours ou quantité", "Montant", "Note"],
    ["EMP-0001", "HS", "HS_15", 8, "", "Exemple : 8 heures à 15 %"],
    ["EMP-0001", "ABSENCE", "CONGE_PAYE", 2, "", "Exemple : 2 jours de congé payé"],
    ["EMP-0002", "PRIME", "PRIME_EXCEPTIONNELLE", "", 50000, "Exemple : prime de 50 000 F"],
  ]);
  ws["!cols"] = [{ wch: 14 }, { wch: 36 }, { wch: 26 }, { wch: 26 }, { wch: 14 }, { wch: 40 }];
  XLSX.utils.book_append_sheet(wb, ws, "Variables");
  const codes = [["Type", "Code", "Libellé", "Remarque"]];
  for (const h of ref.hs) codes.push(["HS", h.code, h.libelle, `Majoration ${h.taux} %`]);
  for (const a of ref.absences) codes.push(["ABSENCE", a.code, a.libelle, `Maintien du salaire ${a.taux_maintien} %`]);
  for (const r of ref.rubriques) codes.push([r.sens === "RETENUE" ? "RETENUE" : "PRIME", r.code, r.libelle, r.mode === "QUANTITE" ? "Quantité × montant unitaire" : r.mode === "VARIABLE" ? "Montant saisi chaque mois" : "Montant fixe"]);
  const wc = XLSX.utils.aoa_to_sheet(codes);
  wc["!cols"] = [{ wch: 12 }, { wch: 28 }, { wch: 46 }, { wch: 36 }];
  XLSX.utils.book_append_sheet(wb, wc, "Codes");
  const emps = await employesConcernes(tid, p);
  const we = XLSX.utils.aoa_to_sheet([["Matricule", "Nom", "Prénom"], ...emps.map((e) => [e.matricule || "", e.nom || "", e.prenom || ""])]);
  we["!cols"] = [{ wch: 14 }, { wch: 24 }, { wch: 24 }];
  XLSX.utils.book_append_sheet(wb, we, "Salariés");
  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
}

async function importerExcel(tid, userId, periodeId, buffer) {
  const p = await chargerPeriode(tid, periodeId);
  exigerModifiable(p);
  const wb = XLSX.read(buffer, { type: "buffer" });
  const nomFeuille = wb.SheetNames.find((n) => /variable/i.test(n)) || wb.SheetNames[0];
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[nomFeuille], { header: 1, raw: true, defval: null });
  const concernes = await employesConcernes(tid, p);
  const parMatricule = new Map(concernes.filter((e) => e.matricule).map((e) => [String(e.matricule).trim().toUpperCase(), e.id]));
  const ref = await referentiels(tid);
  const par = new Map();
  const erreurs = [];
  const vus = new Set();
  let lues = 0;
  rows.forEach((r, i) => {
    if (r.every((c) => c == null || c === "")) return;
    const mat = r[0] == null ? "" : String(r[0]).trim().toUpperCase();
    if (i === 0 && /matricule|employee|id/i.test(mat)) return;
    lues += 1;
    const type = TYPES_ALIAS[String(r[1] == null ? "" : r[1]).trim().toUpperCase()];
    const emp = parMatricule.get(mat);
    if (!emp) { erreurs.push({ ligne: i + 1, raison: "SALARIE_INCONNU", valeur: mat }); return; }
    if (!type) { erreurs.push({ ligne: i + 1, raison: "TYPE", valeur: String(r[1] || "") }); return; }
    try {
      const l = normaliserVariable(type, { code: r[2], quantite: r[3], montant: r[4], note: r[5] }, ref);
      const cle = `${emp}|${l.type}|${l.code}`;
      if (vus.has(cle)) { erreurs.push({ ligne: i + 1, raison: "DOUBLON", valeur: l.code }); return; }
      vus.add(cle);
      if (!par.has(emp)) par.set(emp, []);
      par.get(emp).push(l);
    } catch (e) {
      if (e instanceof PaieError) erreurs.push({ ligne: i + 1, raison: (e.details && e.details.raison) || e.code, valeur: e.details && e.details.code });
      else throw e;
    }
  });
  const nb = par.size ? await fusionnerVariables(tid, userId, p, par, "IMPORT", { ecraser: true }) : 0;
  return { lignes_lues: lues, lignes_importees: nb, erreurs };
}

// ------------------------------------------------------------------------------------------------ generation
async function cumulIr(tid, employeId, annee, mois) {
  const r = await db.query(
    `SELECT COALESCE(SUM(b.imposable),0) AS imp, COUNT(*) AS n, COALESCE(SUM(b.ir),0) AS ir
     FROM paie_bulletin b JOIN paie_periode p ON p.id = b.periode_id
     WHERE b.tenant_id = $1 AND b.employe_id = $2 AND p.annee = $3 AND p.mois < $4`,
    [tid, employeId, annee, mois]
  );
  const x = r.rows[0];
  return { brutCumule: Number(x.imp), moisTravailles: Number(x.n), irDejaPaye: Number(x.ir) };
}

function identiteBulletin(e, ctx, bul) {
  return {
    employe_id: e.id, matricule: e.matricule, nom: e.nom, prenom: e.prenom, poste: e.poste, date_embauche: e.date_embauche, date_sortie: e.date_sortie,
    numero_css: e.numero_css, numero_ipres: e.numero_ipres, mode_paiement: e.mode_paiement || "VIREMENT", banque: e.banque, numero_compte: e.numero_compte,
    mobile_money_numero: e.mobile_money_numero, convention: ctx.convention ? ctx.convention.libelle : null, convention_code: ctx.convention ? ctx.convention.code : null,
    categorie: bul.categorie ? bul.categorie.libelle : null, classification: bul.categorie ? bul.categorie.classification : null,
    parts_ir: ctx.employe.parts_ir, parts_trimf: ctx.employe.parts_trimf,
  };
}

/** Recalcule les bulletins brouillon de la periode (tous les salaries, ou un seul). */
async function generer(tid, userId, periodeId, seulEmployeId = null) {
  const p = await chargerPeriode(tid, periodeId);
  exigerModifiable(p);
  const reglages = await P.getReglages(tid);
  const concernes = await employesConcernes(tid, p);
  const vars = await variablesParEmploye(tid, p.id);
  const cibles = seulEmployeId ? concernes.filter((e) => e.id === seulEmployeId) : concernes;
  let nb = 0;
  for (const e of cibles) {
    if (!e.dossier_complet || e.exclu) {
      await db.query(`DELETE FROM paie_bulletin WHERE periode_id = $1 AND employe_id = $2`, [p.id, e.id]);
      continue;
    }
    const cumul = reglages.mode_ir === "CUMUL" ? await cumulIr(tid, e.id, p.annee, p.mois) : null;
    const ctx = await P.construireContexte(tid, e.id, p.annee, p.mois, { variables: vars.get(e.id) || {}, cumul });
    const bul = M.calculerBulletin(ctx);
    bul.identite = identiteBulletin(e, ctx, bul);
    await db.query(
      `INSERT INTO paie_bulletin (id, tenant_id, periode_id, employe_id, matricule, nom, prenom, brut, imposable, base_cotisable, total_retenues, ir, trimf, net_a_payer, charges_patronales, calcul_json, avertissements_json, date_calcul)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17, now())
       ON CONFLICT (periode_id, employe_id) DO UPDATE SET matricule=EXCLUDED.matricule, nom=EXCLUDED.nom, prenom=EXCLUDED.prenom, brut=EXCLUDED.brut, imposable=EXCLUDED.imposable,
         base_cotisable=EXCLUDED.base_cotisable, total_retenues=EXCLUDED.total_retenues, ir=EXCLUDED.ir, trimf=EXCLUDED.trimf, net_a_payer=EXCLUDED.net_a_payer,
         charges_patronales=EXCLUDED.charges_patronales, calcul_json=EXCLUDED.calcul_json, avertissements_json=EXCLUDED.avertissements_json, date_calcul=now()`,
      [uuidv4(), tid, p.id, e.id, e.matricule, e.nom, e.prenom, bul.totaux.brut, bul.totaux.imposable, bul.totaux.base_cotisable, bul.total_retenues, bul.ir.montant, bul.trimf.montant,
        bul.net_a_payer, bul.total_charges_patronales, JSON.stringify(bul), JSON.stringify(bul.avertissements)]
    );
    nb += 1;
  }
  if (!seulEmployeId) {
    // Bulletins de salaries qui ne sont plus concernes (sortie, dossier supprime...).
    const ids = concernes.map((e) => e.id);
    await db.query(`DELETE FROM paie_bulletin WHERE periode_id = $1 AND NOT (employe_id = ANY($2::uuid[]))`, [p.id, ids]);
  }
  await db.query(`UPDATE paie_periode SET date_calcul = now(), calcule_par = $2 WHERE id = $1`, [p.id, userId || null]);
  return { bulletins: nb, salaries_concernes: concernes.length };
}

/** Regeneration automatique si le dossier de paie d'un salarie a change ou si un bulletin manque (periode ouverte seulement). */
async function rafraichirSiObsolete(tid, userId, p) {
  if (p.statut !== "OUVERTE") return p;
  const concernes = await employesConcernes(tid, p);
  const bul = await db.query(`SELECT employe_id, date_calcul FROM paie_bulletin WHERE periode_id = $1`, [p.id]);
  const parEmp = new Map(bul.rows.map((b) => [b.employe_id, b.date_calcul]));
  const obsolete = concernes.some((e) => {
    const calcule = parEmp.get(e.id);
    if (e.dossier_complet && !e.exclu) return !calcule || (e.dossier_modifie && new Date(e.dossier_modifie) > new Date(calcule));
    return !!calcule;
  }) || bul.rows.some((b) => !concernes.some((e) => e.id === b.employe_id));
  if (obsolete) {
    await generer(tid, userId, p.id);
    return chargerPeriode(tid, p.id);
  }
  return p;
}

async function bulletins(tid, periodeId) {
  const r = await db.query(
    `SELECT id, employe_id, statut, matricule, nom, prenom, brut, imposable, base_cotisable, total_retenues, ir, trimf, net_a_payer, charges_patronales, avertissements_json, date_calcul
     FROM paie_bulletin WHERE tenant_id = $1 AND periode_id = $2 ORDER BY nom, prenom`,
    [tid, periodeId]
  );
  return r.rows.map((b) => ({ ...b, brut: Number(b.brut), imposable: Number(b.imposable), base_cotisable: Number(b.base_cotisable), total_retenues: Number(b.total_retenues), ir: Number(b.ir), trimf: Number(b.trimf), net_a_payer: Number(b.net_a_payer), charges_patronales: Number(b.charges_patronales), avertissements: b.avertissements_json || [] }));
}
async function bulletin(tid, periodeId, employeId) {
  const r = await db.query(`SELECT * FROM paie_bulletin WHERE tenant_id = $1 AND periode_id = $2 AND employe_id = $3`, [tid, periodeId, employeId]);
  if (!r.rows[0]) throw new PaieError("PAIE_BULLETIN_INTROUVABLE", 404);
  return { id: r.rows[0].id, statut: r.rows[0].statut, date_calcul: r.rows[0].date_calcul, ...r.rows[0].calcul_json };
}

// ------------------------------------------------------------------------------------------------ controles
async function controles(tid, p) {
  const concernes = await employesConcernes(tid, p);
  const bul = await bulletins(tid, p.id);
  const parEmp = new Map(bul.map((b) => [b.employe_id, b]));
  const prec = await db.query(
    `SELECT b.employe_id, b.net_a_payer FROM paie_bulletin b JOIN paie_periode q ON q.id = b.periode_id
     WHERE b.tenant_id = $1 AND (q.annee < $2 OR (q.annee = $2 AND q.mois < $3)) AND q.id = (
       SELECT id FROM paie_periode WHERE tenant_id = $1 AND (annee < $2 OR (annee = $2 AND mois < $3)) ORDER BY annee DESC, mois DESC LIMIT 1)`,
    [tid, p.annee, p.mois]
  );
  const netPrec = new Map(prec.rows.map((x) => [x.employe_id, Number(x.net_a_payer)]));
  const variablesMod = await db.query(`SELECT MAX(date_modification) AS d FROM paie_variable WHERE periode_id = $1`, [p.id]);
  const items = [];
  const nomDe = (e) => [e.prenom, String(e.nom || "").toUpperCase()].filter(Boolean).join(" ");
  const b = P.bornesPeriode(p.annee, p.mois);
  for (const e of concernes) {
    const base = { employe_id: e.id, nom: nomDe(e), matricule: e.matricule };
    if (e.exclu) { items.push({ ...base, niveau: "INFO", code: "EXCLU_DE_LA_PAIE" }); continue; }
    if (!e.dossier_complet) { items.push({ ...base, niveau: "BLOQUANT", code: "DOSSIER_INCOMPLET" }); continue; }
    const x = parEmp.get(e.id);
    if (!x) { items.push({ ...base, niveau: "BLOQUANT", code: "BULLETIN_ABSENT" }); continue; }
    for (const a of x.avertissements) {
      if (a.code === "MOIS_INCOMPLET") continue;
      items.push({ ...base, niveau: a.niveau, code: a.code, valeur: a.valeur });
    }
    if ((e.mode_paiement || "VIREMENT") === "VIREMENT" && !e.numero_compte) items.push({ ...base, niveau: "ATTENTION", code: "COMPTE_BANCAIRE_MANQUANT" });
    if (!e.numero_css) items.push({ ...base, niveau: "ATTENTION", code: "NUMERO_CSS_MANQUANT" });
    if (!e.numero_ipres) items.push({ ...base, niveau: "ATTENTION", code: "NUMERO_IPRES_MANQUANT" });
    const np = netPrec.get(e.id);
    if (np > 0 && x.net_a_payer > 0 && Math.abs(x.net_a_payer - np) / np > 0.25) items.push({ ...base, niveau: "ATTENTION", code: "VARIATION_NET", valeur: `${np} → ${x.net_a_payer}` });
    if (np == null && netPrec.size > 0) items.push({ ...base, niveau: "INFO", code: "NOUVEAU_SALARIE" });
    if (e.date_sortie && String(e.date_sortie).slice(0, 10) <= b.fin) items.push({ ...base, niveau: "INFO", code: "SORTIE_DANS_LE_MOIS", valeur: String(e.date_sortie).slice(0, 10) });
    if (e.dossier_modifie && x.date_calcul && new Date(e.dossier_modifie) > new Date(x.date_calcul)) items.push({ ...base, niveau: "ATTENTION", code: "A_RECALCULER" });
  }
  if (p.date_calcul && variablesMod.rows[0].d && new Date(variablesMod.rows[0].d) > new Date(p.date_calcul)) items.push({ niveau: "ATTENTION", code: "A_RECALCULER" });
  const nbVar = Number((await db.query(`SELECT COUNT(*) AS n FROM paie_variable WHERE periode_id = $1`, [p.id])).rows[0].n);
  if (nbVar === 0) items.push({ niveau: "INFO", code: "AUCUNE_VARIABLE" });
  const ordre = { BLOQUANT: 0, ATTENTION: 1, INFO: 2 };
  items.sort((a, c) => ordre[a.niveau] - ordre[c.niveau]);
  const compte = (n) => items.filter((i) => i.niveau === n).length;
  return { items, bloquants: compte("BLOQUANT"), attentions: compte("ATTENTION"), infos: compte("INFO"), nb_salaries: concernes.length, nb_bulletins: bul.length };
}

// ------------------------------------------------------------------------------------------------ etats mensuels
async function etats(tid, p) {
  const r = await db.query(`SELECT employe_id, calcul_json FROM paie_bulletin WHERE tenant_id = $1 AND periode_id = $2 ORDER BY nom, prenom`, [tid, p.id]);
  const lignes = r.rows.map((x) => x.calcul_json);
  const somme = (arr, f) => arr.reduce((s, x) => s + num(f(x)), 0);
  const montantCode = (liste, code) => { const m = (liste || []).find((c) => c.code === code); return m ? num(m.montant) : 0; };
  const baseCode = (liste, code) => { const m = (liste || []).find((c) => c.code === code); return m ? num(m.base) : 0; };
  const nomDe = (b) => [b.identite.prenom, String(b.identite.nom || "").toUpperCase()].filter(Boolean).join(" ");

  const journal = lignes.map((b) => {
    const cotis = (b.retenues || []).filter((c) => c.section !== "IMPOT").reduce((s, c) => s + num(c.montant), 0);
    return {
      employe_id: b.identite.employe_id, matricule: b.identite.matricule, nom: nomDe(b), brut: b.totaux.brut, imposable: b.totaux.imposable,
      cotisations_salarie: cotis, ir: b.ir.montant, trimf: b.trimf.montant,
      autres_retenues: (b.retenues_saisies || []).reduce((s, x) => s + num(x.montant), 0), remboursements: b.total_remboursements, net_a_payer: b.net_a_payer,
      charges_patronales: b.total_charges_patronales, cout_employeur: b.cout_employeur,
    };
  });
  const totauxJournal = ["brut", "imposable", "cotisations_salarie", "ir", "trimf", "autres_retenues", "remboursements", "net_a_payer", "charges_patronales", "cout_employeur"]
    .reduce((o, k) => ({ ...o, [k]: somme(journal, (x) => x[k]) }), {});

  // Organismes : IPRES (section RETRAITE), CSS (SOCIAL), CFCE et autres taxes (TAXE)
  const codesParSection = new Map();
  for (const b of lignes) {
    for (const c of [...(b.retenues || []), ...(b.charges_patronales || [])]) {
      if (c.section === "IMPOT") continue;
      if (!codesParSection.has(c.section)) codesParSection.set(c.section, new Map());
      codesParSection.get(c.section).set(c.code, c.libelle);
    }
  }
  const organismes = [];
  for (const [section, codes] of codesParSection) {
    const cols = [...codes.entries()].map(([code, libelle]) => ({ code, libelle }));
    const salaries = lignes.map((b) => {
      const o = { employe_id: b.identite.employe_id, matricule: b.identite.matricule, nom: nomDe(b), numero_css: b.identite.numero_css, numero_ipres: b.identite.numero_ipres, cotisations: {} };
      for (const c of cols) {
        const base = Math.max(baseCode(b.retenues, c.code), baseCode(b.charges_patronales, c.code));
        o.cotisations[c.code] = { base, salarie: montantCode(b.retenues, c.code), patronal: montantCode(b.charges_patronales, c.code) };
      }
      return o;
    });
    const totaux = {};
    for (const c of cols) totaux[c.code] = { base: somme(salaries, (s) => s.cotisations[c.code].base), salarie: somme(salaries, (s) => s.cotisations[c.code].salarie), patronal: somme(salaries, (s) => s.cotisations[c.code].patronal) };
    organismes.push({ section, colonnes: cols, salaries, totaux, total_a_payer: Object.values(totaux).reduce((s, t) => s + t.salarie + t.patronal, 0) });
  }
  const impots = lignes.map((b) => ({ employe_id: b.identite.employe_id, matricule: b.identite.matricule, nom: nomDe(b), imposable: b.totaux.imposable, parts_ir: b.ir.parts, ir: b.ir.montant, parts_trimf: b.trimf.parts, trimf: b.trimf.montant }));
  const synthese = [];
  for (const o of organismes) synthese.push({ code: o.section, a_payer: o.total_a_payer });
  synthese.push({ code: "IR", a_payer: somme(impots, (x) => x.ir) }, { code: "TRIMF", a_payer: somme(impots, (x) => x.trimf) });
  return { periode: { annee: p.annee, mois: p.mois, statut: p.statut }, journal, totaux_journal: totauxJournal, organismes, impots, totaux_impots: { imposable: somme(impots, (x) => x.imposable), ir: somme(impots, (x) => x.ir), trimf: somme(impots, (x) => x.trimf) }, synthese };
}

async function exportEtatsXlsx(tid, p, lang = "fr") {
  const e = await etats(tid, p);
  const en = lang === "en";
  const L = en
    ? { journal: "Payroll journal", impots: "Income tax and TRIMF", syn: "Summary", mat: "ID", nom: "Employee", brut: "Gross", imp: "Taxable", cot: "Employee contributions", ir: "Income tax", trimf: "TRIMF", aut: "Other deductions", remb: "Reimbursements", net: "Net pay", ch: "Employer contributions", cout: "Employer cost", tot: "Total", base: "Base", sal: "Employee", pat: "Employer", parts: "Shares", css: "Social security no.", ipres: "IPRES no.", organisme: { RETRAITE: "Pension (IPRES)", SOCIAL: "Social security (CSS)", TAXE: "Taxes (CFCE)" }, a_payer: "Amount due", mois: MOIS_EN }
    : { journal: "Journal de paie", impots: "IR et TRIMF", syn: "Synthèse", mat: "Matricule", nom: "Salarié", brut: "Brut", imp: "Imposable", cot: "Cotisations salarié", ir: "IR", trimf: "TRIMF", aut: "Autres retenues", remb: "Remboursements", net: "Net à payer", ch: "Charges patronales", cout: "Coût employeur", tot: "Total", base: "Base", sal: "Salarié", pat: "Patronal", parts: "Parts", css: "N° CSS", ipres: "N° IPRES", organisme: { RETRAITE: "Retraite (IPRES)", SOCIAL: "Sécurité sociale (CSS)", TAXE: "Taxes (CFCE)" }, a_payer: "À payer", mois: MOIS_FR };
  const wb = XLSX.utils.book_new();
  const titre = `${L.mois[p.mois - 1]} ${p.annee}`;
  const add = (nom, aoa, cols) => { const ws = XLSX.utils.aoa_to_sheet(aoa); ws["!cols"] = cols.map((w) => ({ wch: w })); XLSX.utils.book_append_sheet(wb, ws, nom.slice(0, 31)); };
  const j = [[titre], [L.mat, L.nom, L.brut, L.imp, L.cot, L.ir, L.trimf, L.aut, L.remb, L.net, L.ch, L.cout]];
  for (const x of e.journal) j.push([x.matricule, x.nom, x.brut, x.imposable, x.cotisations_salarie, x.ir, x.trimf, x.autres_retenues, x.remboursements, x.net_a_payer, x.charges_patronales, x.cout_employeur]);
  const t = e.totaux_journal;
  j.push([L.tot, "", t.brut, t.imposable, t.cotisations_salarie, t.ir, t.trimf, t.autres_retenues, t.remboursements, t.net_a_payer, t.charges_patronales, t.cout_employeur]);
  add(L.journal, j, [12, 30, 13, 13, 16, 12, 10, 14, 15, 14, 16, 14]);
  for (const o of e.organismes) {
    const head = [L.mat, L.nom, L.css, L.ipres];
    for (const c of o.colonnes) head.push(`${c.code} ${L.base}`, `${c.code} ${L.sal}`, `${c.code} ${L.pat}`);
    const a = [[`${L.organisme[o.section] || o.section} - ${titre}`], head];
    for (const s of o.salaries) { const row = [s.matricule, s.nom, s.numero_css, s.numero_ipres]; for (const c of o.colonnes) { const v = s.cotisations[c.code]; row.push(v.base, v.salarie, v.patronal); } a.push(row); }
    const tr = [L.tot, "", "", ""]; for (const c of o.colonnes) { const v = o.totaux[c.code]; tr.push(v.base, v.salarie, v.patronal); } a.push(tr);
    add(L.organisme[o.section] || o.section, a, [12, 30, 16, 16, ...o.colonnes.flatMap(() => [13, 13, 13])]);
  }
  const i = [[`${L.impots} - ${titre}`], [L.mat, L.nom, L.imp, `${L.parts} IR`, L.ir, `${L.parts} TRIMF`, L.trimf]];
  for (const x of e.impots) i.push([x.matricule, x.nom, x.imposable, x.parts_ir, x.ir, x.parts_trimf, x.trimf]);
  i.push([L.tot, "", e.totaux_impots.imposable, "", e.totaux_impots.ir, "", e.totaux_impots.trimf]);
  add(L.impots, i, [12, 30, 14, 10, 12, 12, 10]);
  const s = [[`${L.syn} - ${titre}`], ["", L.a_payer]];
  for (const x of e.synthese) s.push([L.organisme[x.code] || x.code, x.a_payer]);
  add(L.syn, s, [34, 16]);
  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
}

// ------------------------------------------------------------------------------------------------ ordre de virement des salaires
/** Lignes theoriques de l'ordre de virement d'une periode (salaries payes par virement, net > 0). */
async function lignesOrdreVirement(tid, p) {
  const r = await db.query(`SELECT employe_id, calcul_json FROM paie_bulletin WHERE tenant_id = $1 AND periode_id = $2 ORDER BY nom, prenom`, [tid, p.id]);
  const lignes = [], exclus = [];
  const libelleMois = `${MOIS_FR[p.mois - 1]} ${p.annee}`;
  for (const x of r.rows) {
    const b = x.calcul_json, id = b.identite;
    const nom = [id.prenom, String(id.nom || "").toUpperCase()].filter(Boolean).join(" ");
    if (b.net_a_payer <= 0) { exclus.push({ employe_id: x.employe_id, nom, raison: "NET_NUL" }); continue; }
    if (id.mode_paiement && id.mode_paiement !== "VIREMENT") { exclus.push({ employe_id: x.employe_id, nom, raison: "MODE_PAIEMENT", valeur: id.mode_paiement }); continue; }
    lignes.push({ employe_id: x.employe_id, nom, matricule: id.matricule || null, banque: id.banque || "", numero_compte: id.numero_compte || "", montant: Math.round(b.net_a_payer), motif: `Salaire ${libelleMois}` });
  }
  return { lignes, exclus, nb_bulletins: r.rows.length, libelleMois };
}

async function genererOrdreVirement(tid, userId, periodeId, corps = {}) {
  const p = await chargerPeriode(tid, periodeId);
  if (p.statut === "CLOTUREE") throw new PaieError("PAIE_PERIODE_CLOTUREE", 409);
  const reglages = await P.getReglages(tid);
  const calc = await lignesOrdreVirement(tid, p);
  if (!calc.nb_bulletins) throw new PaieError("PAIE_AUCUN_BULLETIN", 409);
  const { lignes, exclus, libelleMois } = calc;
  const total = lignes.reduce((s, l) => s + l.montant, 0);
  const jour = reglages.jour_virement ? Math.min(Number(reglages.jour_virement), new Date(Date.UTC(p.annee, p.mois, 0)).getUTCDate()) : new Date(Date.UTC(p.annee, p.mois, 0)).getUTCDate();
  const dateExec = (corps.date_execution && /^\d{4}-\d{2}-\d{2}$/.test(corps.date_execution)) ? corps.date_execution : `${p.annee}-${String(p.mois).padStart(2, "0")}-${String(jour).padStart(2, "0")}`;
  const banque = corps.banque_donneur !== undefined ? corps.banque_donneur : reglages.banque_donneur;
  const compte = corps.compte_donneur !== undefined ? corps.compte_donneur : reglages.compte_donneur;
  const periodeTxt = `${p.annee}-${String(p.mois).padStart(2, "0")}`;
  let id = null;
  if (p.ordre_virement_id) {
    const ex = await db.query(`SELECT id, statut FROM rh_ordre_virement WHERE id = $1 AND tenant_id = $2`, [p.ordre_virement_id, tid]);
    if (ex.rows[0] && ex.rows[0].statut === "BROUILLON") id = ex.rows[0].id;
    else if (ex.rows[0] && ex.rows[0].statut !== "ANNULE") throw new PaieError("PAIE_OV_DEJA_VALIDE", 409);
  }
  if (id) {
    await db.query(
      `UPDATE rh_ordre_virement SET lignes_json = $1, total = $2, date_execution = $3, banque_donneur = COALESCE($4, banque_donneur), compte_donneur = COALESCE($5, compte_donneur), date_modification = now() WHERE id = $6 AND tenant_id = $7`,
      [JSON.stringify(lignes), total, dateExec, banque || null, compte || null, id, tid]
    );
  } else {
    id = uuidv4();
    const numero = await prochainNumero(tid, "ORDRE_VIREMENT", "OV");
    await db.query(
      `INSERT INTO rh_ordre_virement (id, tenant_id, numero, libelle, type_paiement, periode, date_execution, banque_donneur, compte_donneur, lignes_json, total, source, cree_par)
       VALUES ($1,$2,$3,$4,'SALAIRE',$5,$6,$7,$8,$9,$10,'PAIE',$11)`,
      [id, tid, numero, `Salaires ${libelleMois}`, periodeTxt, dateExec, banque || null, compte || null, JSON.stringify(lignes), total, userId || null]
    );
    await db.query(`UPDATE paie_periode SET ordre_virement_id = $1 WHERE id = $2`, [id, p.id]);
  }
  const ov = (await db.query(`SELECT id, numero, statut, total, date_execution FROM rh_ordre_virement WHERE id = $1`, [id])).rows[0];
  return { ordre: { ...ov, total: Number(ov.total), nb_lignes: lignes.length }, exclus };
}

module.exports = {
  MOIS_FR, chargerPeriode, lister, vuePeriode, prochainePossible, ouvrir, annulerOuverture, employesConcernes, referentiels,
  variablesEmploye, remplacerVariablesEmploye, copierMoisPrecedent, demandesRh, appliquerDemandesRh, genererGabarit, importerExcel,
  generer, rafraichirSiObsolete, bulletins, bulletin, controles, etats, exportEtatsXlsx, genererOrdreVirement, lignesOrdreVirement,
};
