const db = require("../db");

// Score de fiabilite d'un fournisseur (Module 15) : proportion d'offres retenues
// parmi toutes celles soumises. Depuis le Lot 6 (05/10/2026) il compte les offres
// du Dossier de calcul (source unique) EN PLUS des anciennes offres du comparateur
// d'offres de dossier (conservees en lecture seule).
async function recalculerScoreFiabilite(fournisseurId) {
  if (!fournisseurId) return null;
  const r = await db.query(
    `SELECT COUNT(*)::int AS total, COUNT(*) FILTER (WHERE retenue)::int AS retenues FROM (
       SELECT retenue FROM offre_fournisseur WHERE fournisseur_id = $1
       UNION ALL
       SELECT retenue FROM calcul_offre WHERE fournisseur_id = $1
     ) x`,
    [fournisseurId]
  );
  const { total, retenues } = r.rows[0];
  const score = total > 0 ? Math.round((retenues / total) * 10000) / 100 : null;
  await db.query(`UPDATE fournisseur SET score_fiabilite = $1 WHERE id = $2`, [score, fournisseurId]);
  return score;
}

module.exports = { recalculerScoreFiabilite };
