// Aides communes aux routes RH (courriers, ordres de virement) : en-tete client, fiche employe, numerotation.
const db = require("../db");

async function chargerEntete(tenantId) {
  const r = await db.query(
    `SELECT raison_sociale, adresse, telephone, email, signataire_nom, signataire_titre, rccm, ninea, site_web,
            coordonnees_bancaires, logo_base64, logo_type_mime, signature_cachet_base64, signature_cachet_type_mime
     FROM tenant WHERE id = $1`,
    [tenantId]
  );
  return r.rows[0] || {};
}

async function chargerEmploye(tenantId, id) {
  const r = await db.query(
    `SELECT e.*, COALESCE(e.nom, u.nom) AS nom, COALESCE(e.prenom, u.prenom) AS prenom
     FROM employe e LEFT JOIN utilisateur u ON u.id = e.utilisateur_id
     WHERE e.tenant_id = $1 AND e.id = $2`,
    [tenantId, id]
  );
  return r.rows[0] || null;
}

async function prochainNumero(tenantId, type, prefixe) {
  const annee = new Date().getFullYear();
  const r = await db.query(
    `INSERT INTO rh_numerotation (tenant_id, type, annee, dernier) VALUES ($1, $2, $3, 1)
     ON CONFLICT (tenant_id, type, annee) DO UPDATE SET dernier = rh_numerotation.dernier + 1
     RETURNING dernier`,
    [tenantId, type, annee]
  );
  return `${prefixe}-${annee}-${String(r.rows[0].dernier).padStart(4, "0")}`;
}

// Date ISO AAAA-MM-JJ valide, null si vide, undefined si invalide.
function dateOuNull(v) {
  if (v == null || v === "") return null;
  const s = String(v).slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s)) ? s : undefined;
}

module.exports = { chargerEntete, chargerEmploye, prochainNumero, dateOuNull };
