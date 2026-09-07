const db = require("../db");

/**
 * Verifie qu'un role_porteur_id / assigne_utilisateur_id fourni (l'un ou
 * l'autre, ou les deux) appartient bien au tenant courant, pour eviter
 * qu'une tache de chronogramme (dossier d'AO ou consultation) soit affectee
 * a un role ou une personne d'un AUTRE tenant. Retourne un code d'erreur
 * i18n si invalide, null si ok. Partage entre routes/chronogramme.js
 * (dossiers d'AO) et routes/ventes.js (consultations) - meme regle, memes
 * tables role/utilisateur, pas de raison de la dupliquer.
 */
async function verifierAffectationValide(tenantId, rolePorteurId, assigneUtilisateurId) {
  if (rolePorteurId) {
    const roleCheck = await db.query(`SELECT id FROM role WHERE id = $1 AND tenant_id = $2`, [
      rolePorteurId,
      tenantId,
    ]);
    if (roleCheck.rows.length === 0) return "TACHE_ROLE_INVALID";
  }
  if (assigneUtilisateurId) {
    const userCheck = await db.query(
      `SELECT id FROM utilisateur WHERE id = $1 AND tenant_id = $2`,
      [assigneUtilisateurId, tenantId]
    );
    if (userCheck.rows.length === 0) return "TACHE_ASSIGNE_INVALID";
  }
  return null;
}

module.exports = { verifierAffectationValide };
