/**
 * Module Fiscalite, lot 5 : dossier annuel (CEL, taxe speciale sur les voitures particulieres).
 * Meme logique que le dossier IS : brouillon -> preparee (calcul fige) -> deposee -> payee, reouverture possible.
 * Table fiscalite_dossier_annuel (type, annee).
 */
const db = require("../db");
const { FiscaliteError } = require("./fiscaliteTva");

const TYPES = ["CEL", "VEHICULES"];
const num = (v) => Number(v || 0);
const dateIso = (d) => (d instanceof Date ? d.toISOString().slice(0, 10) : String(d).slice(0, 10));

function valider(type, annee) {
  if (!TYPES.includes(type)) throw new FiscaliteError("FISCALITE_CODE_INVALIDE");
  const a = Number(annee);
  if (!Number.isInteger(a) || a < 2000 || a > 2100) throw new FiscaliteError("FISCALITE_PERIODE_INVALIDE");
  return a;
}

function versDossier(row) {
  if (!row) return null;
  return {
    type: row.type,
    annee: row.annee,
    statut: row.statut,
    saisies: row.saisies_json || {},
    calcul: row.calcul_json || null,
    montant_du: row.montant_du === null ? null : num(row.montant_du),
    date_depot: row.date_depot ? dateIso(row.date_depot) : null,
    reference_depot: row.reference_depot,
    date_paiement: row.date_paiement ? dateIso(row.date_paiement) : null,
    date_preparation: row.date_preparation,
  };
}

async function getDossier(tenantId, type, annee) {
  const a = valider(type, annee);
  const r = await db.query(`SELECT * FROM fiscalite_dossier_annuel WHERE tenant_id = $1 AND type = $2 AND annee = $3`, [tenantId, type, a]);
  return versDossier(r.rows[0]);
}

async function listerAnnees(tenantId, type) {
  const r = await db.query(`SELECT * FROM fiscalite_dossier_annuel WHERE tenant_id = $1 AND type = $2 ORDER BY annee DESC`, [tenantId, type]);
  return r.rows.map(versDossier);
}

async function enregistrerSaisies(tenantId, type, annee, saisies) {
  const a = valider(type, annee);
  const d = await getDossier(tenantId, type, a);
  if (d && (d.statut === "DEPOSEE" || d.statut === "PAYEE")) throw new FiscaliteError("FISCALITE_DECLARATION_DEJA_DEPOSEE", 409);
  await db.query(
    `INSERT INTO fiscalite_dossier_annuel (tenant_id, type, annee, saisies_json) VALUES ($1,$2,$3,$4)
     ON CONFLICT (tenant_id, type, annee) DO UPDATE SET saisies_json = EXCLUDED.saisies_json, date_modification = now()`,
    [tenantId, type, a, JSON.stringify(saisies || {})]
  );
  return getDossier(tenantId, type, a);
}

/** `calcul` = resultat deja calcule par le service appelant (avec calcul.montant_du et calcul.saisies). */
async function preparer(tenantId, userId, type, annee, calcul) {
  const a = valider(type, annee);
  const d = await getDossier(tenantId, type, a);
  if (d && (d.statut === "DEPOSEE" || d.statut === "PAYEE")) throw new FiscaliteError("FISCALITE_DECLARATION_DEJA_DEPOSEE", 409);
  await db.query(
    `INSERT INTO fiscalite_dossier_annuel (tenant_id, type, annee, statut, saisies_json, calcul_json, montant_du, prepare_par, date_preparation)
     VALUES ($1,$2,$3,'PREPAREE',$4,$5,$6,$7, now())
     ON CONFLICT (tenant_id, type, annee) DO UPDATE SET statut = 'PREPAREE', saisies_json = EXCLUDED.saisies_json, calcul_json = EXCLUDED.calcul_json,
       montant_du = EXCLUDED.montant_du, prepare_par = EXCLUDED.prepare_par, date_preparation = now(), date_modification = now()`,
    [tenantId, type, a, JSON.stringify(calcul.saisies || {}), JSON.stringify(calcul), calcul.montant_du, userId]
  );
  return getDossier(tenantId, type, a);
}

async function changerStatut(tenantId, type, annee, corps) {
  const a = valider(type, annee);
  const d = await getDossier(tenantId, type, a);
  if (!d || !d.calcul) throw new FiscaliteError("FISCALITE_DECLARATION_INTROUVABLE", 404);
  const action = corps && corps.action;
  const estDate = (v) => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);
  if (action === "deposer") {
    if (d.statut !== "PREPAREE") throw new FiscaliteError("FISCALITE_ACTION_INVALIDE", 409);
    if (!estDate(corps.date_depot)) throw new FiscaliteError("FISCALITE_DATE_INVALIDE");
    await db.query(
      `UPDATE fiscalite_dossier_annuel SET statut = 'DEPOSEE', date_depot = $4, reference_depot = $5, date_modification = now() WHERE tenant_id = $1 AND type = $2 AND annee = $3`,
      [tenantId, type, a, corps.date_depot, String(corps.reference_depot || "").trim().slice(0, 100) || null]
    );
  } else if (action === "payer") {
    if (d.statut === "PREPAREE") throw new FiscaliteError("FISCALITE_DEPOT_AVANT_PAIEMENT", 409);
    if (!estDate(corps.date_paiement)) throw new FiscaliteError("FISCALITE_DATE_INVALIDE");
    await db.query(`UPDATE fiscalite_dossier_annuel SET statut = 'PAYEE', date_paiement = $4, date_modification = now() WHERE tenant_id = $1 AND type = $2 AND annee = $3`, [tenantId, type, a, corps.date_paiement]);
  } else if (action === "rouvrir") {
    await db.query(
      `UPDATE fiscalite_dossier_annuel SET statut = 'PREPAREE', date_depot = NULL, reference_depot = NULL, date_paiement = NULL, date_modification = now() WHERE tenant_id = $1 AND type = $2 AND annee = $3`,
      [tenantId, type, a]
    );
  } else {
    throw new FiscaliteError("FISCALITE_ACTION_INVALIDE");
  }
  return getDossier(tenantId, type, a);
}

module.exports = { TYPES, getDossier, listerAnnees, enregistrerSaisies, preparer, changerStatut };
