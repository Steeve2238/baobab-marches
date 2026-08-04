const express = require("express");
const db = require("../db");
const { requireAuth } = require("../middleware/auth");
const { t } = require("../utils/i18n");

const router = express.Router();
router.use(requireAuth);

/**
 * Recalcule le score de fiabilite d'un fournisseur (Module 15) a partir de
 * son historique d'offres pour ce tenant : proportion d'offres retenues
 * parmi toutes celles soumises. Heuristique simple documentee comme telle -
 * a affiner si un suivi de performance plus riche est ajoute au schema.
 */
async function recalculerScoreFiabilite(fournisseurId) {
  const stats = await db.query(
    `SELECT
       COUNT(*)::int AS total,
       COUNT(*) FILTER (WHERE retenue = true)::int AS retenues
     FROM offre_fournisseur
     WHERE fournisseur_id = $1`,
    [fournisseurId]
  );
  const { total, retenues } = stats.rows[0];
  const score = total > 0 ? Math.round((retenues / total) * 100 * 100) / 100 : null;

  await db.query(`UPDATE fournisseur SET score_fiabilite = $1 WHERE id = $2`, [score, fournisseurId]);
  return score;
}

// ----------------------------------------------------------------------------
// Fournisseurs (tenant-scope)
// ----------------------------------------------------------------------------

// GET /api/fournisseurs
router.get("/", async (req, res) => {
  try {
    const result = await db.query(
      `SELECT * FROM fournisseur WHERE tenant_id = $1 ORDER BY nom ASC`,
      [req.user.tenantId]
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: t(req, "FOURNISSEURS_FETCH_ERROR") });
  }
});

// POST /api/fournisseurs
router.post("/", async (req, res) => {
  const { nom, pays } = req.body;
  if (!nom) {
    return res.status(400).json({ error: t(req, "FOURNISSEUR_NOM_REQUIRED") });
  }
  try {
    const result = await db.query(
      `INSERT INTO fournisseur (tenant_id, nom, pays) VALUES ($1, $2, $3) RETURNING *`,
      [req.user.tenantId, nom, pays || null]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: t(req, "FOURNISSEUR_CREATE_ERROR") });
  }
});

// ----------------------------------------------------------------------------
// Offres fournisseurs (par dossier)
// ----------------------------------------------------------------------------

// GET /api/fournisseurs/dossiers/:dossierId/offres
router.get("/dossiers/:dossierId/offres", async (req, res) => {
  const { dossierId } = req.params;
  try {
    const dossierCheck = await db.query(
      `SELECT id FROM dossier_ao WHERE id = $1 AND tenant_id = $2`,
      [dossierId, req.user.tenantId]
    );
    if (dossierCheck.rows.length === 0) {
      return res.status(404).json({ error: t(req, "DOSSIER_NOT_FOUND") });
    }

    const result = await db.query(
      `SELECT o.*, f.nom AS fournisseur_nom, f.pays AS fournisseur_pays, f.score_fiabilite,
              inc.code AS incoterm_code
       FROM offre_fournisseur o
       JOIN fournisseur f ON f.id = o.fournisseur_id
       LEFT JOIN incoterm_scenario inc ON inc.id = o.incoterm_scenario_id
       WHERE o.dossier_ao_id = $1
       ORDER BY o.prix_exw ASC NULLS LAST`,
      [dossierId]
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: t(req, "OFFRES_FETCH_ERROR") });
  }
});

// POST /api/fournisseurs/dossiers/:dossierId/offres
router.post("/dossiers/:dossierId/offres", async (req, res) => {
  const { dossierId } = req.params;
  const {
    fournisseur_id,
    prix_exw,
    devise,
    delai_jours,
    delai_paiement_jours,
    condition_reglement,
    pourcentage_acompte,
    incoterm_scenario_id,
  } = req.body;

  if (!fournisseur_id) {
    return res.status(400).json({ error: t(req, "FOURNISSEUR_ID_REQUIRED") });
  }

  try {
    const dossierCheck = await db.query(
      `SELECT id FROM dossier_ao WHERE id = $1 AND tenant_id = $2`,
      [dossierId, req.user.tenantId]
    );
    if (dossierCheck.rows.length === 0) {
      return res.status(404).json({ error: t(req, "DOSSIER_NOT_FOUND") });
    }

    const fournisseurCheck = await db.query(
      `SELECT id FROM fournisseur WHERE id = $1 AND tenant_id = $2`,
      [fournisseur_id, req.user.tenantId]
    );
    if (fournisseurCheck.rows.length === 0) {
      return res.status(404).json({ error: t(req, "FOURNISSEUR_NOT_FOUND") });
    }

    const inserted = await db.query(
      `INSERT INTO offre_fournisseur
         (dossier_ao_id, fournisseur_id, prix_exw, devise, delai_jours, delai_paiement_jours,
          condition_reglement, pourcentage_acompte, incoterm_scenario_id)
       VALUES ($1, $2, $3, COALESCE($4, 'XOF'), $5, $6, $7, $8, $9)
       RETURNING id`,
      [
        dossierId,
        fournisseur_id,
        prix_exw || null,
        devise || null,
        delai_jours || null,
        delai_paiement_jours || null,
        condition_reglement || null,
        pourcentage_acompte || null,
        incoterm_scenario_id || null,
      ]
    );

    await recalculerScoreFiabilite(fournisseur_id);

    // On renvoie la ligne enrichie (nom fournisseur, score, code incoterm)
    // plutot que la ligne brute, pour que le front n'ait pas besoin de
    // recharger toute la liste pour afficher ces informations.
    const result = await db.query(
      `SELECT o.*, f.nom AS fournisseur_nom, f.pays AS fournisseur_pays, f.score_fiabilite,
              inc.code AS incoterm_code
       FROM offre_fournisseur o
       JOIN fournisseur f ON f.id = o.fournisseur_id
       LEFT JOIN incoterm_scenario inc ON inc.id = o.incoterm_scenario_id
       WHERE o.id = $1`,
      [inserted.rows[0].id]
    );

    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: t(req, "OFFRE_CREATE_ERROR") });
  }
});

// PATCH /api/fournisseurs/offres/:id/retenue - retient une offre (et
// desactive automatiquement les autres offres du meme dossier, puisqu'un
// seul fournisseur est normalement retenu par besoin).
router.patch("/offres/:id/retenue", async (req, res) => {
  const { id } = req.params;
  try {
    const offreResult = await db.query(
      `SELECT o.*, d.tenant_id FROM offre_fournisseur o
       JOIN dossier_ao d ON d.id = o.dossier_ao_id
       WHERE o.id = $1 AND d.tenant_id = $2`,
      [id, req.user.tenantId]
    );
    if (offreResult.rows.length === 0) {
      return res.status(404).json({ error: t(req, "OFFRE_NOT_FOUND") });
    }
    const offre = offreResult.rows[0];

    await db.query(
      `UPDATE offre_fournisseur SET retenue = false WHERE dossier_ao_id = $1`,
      [offre.dossier_ao_id]
    );
    const result = await db.query(
      `UPDATE offre_fournisseur SET retenue = true WHERE id = $1 RETURNING *`,
      [id]
    );

    // Le score de tous les fournisseurs ayant soumissionne sur ce dossier
    // peut changer (celui retenu monte, ceux desormais non-retenus baissent).
    const fournisseursDuDossier = await db.query(
      `SELECT DISTINCT fournisseur_id FROM offre_fournisseur WHERE dossier_ao_id = $1`,
      [offre.dossier_ao_id]
    );
    for (const row of fournisseursDuDossier.rows) {
      await recalculerScoreFiabilite(row.fournisseur_id);
    }

    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: t(req, "OFFRE_RETENUE_ERROR") });
  }
});

module.exports = router;
