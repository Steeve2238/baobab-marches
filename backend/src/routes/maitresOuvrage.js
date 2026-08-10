const express = require("express");
const db = require("../db");
const { requireAuth } = require("../middleware/auth");
const { t } = require("../utils/i18n");

const router = express.Router();
router.use(requireAuth);

// Donnee de reference (comme fournisseur) : ouverte a tout utilisateur
// authentifie du tenant, pas de restriction de role. Les maitres d'ouvrage
// sont referencees par dossier_ao (Module 1) et par le Module 7
// (historique des offres concurrentes + bibliotheque de clauses a risque).

// GET /api/maitres-ouvrage
router.get("/", async (req, res) => {
  try {
    const result = await db.query(
      `SELECT * FROM maitre_ouvrage WHERE tenant_id = $1 ORDER BY nom ASC`,
      [req.user.tenantId]
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: t(req, "MAITRES_OUVRAGE_FETCH_ERROR") });
  }
});

// POST /api/maitres-ouvrage
router.post("/", async (req, res) => {
  const { nom, categorie, ppm_entite_id } = req.body;
  if (!nom) {
    return res.status(400).json({ error: t(req, "MAITRE_OUVRAGE_NOM_REQUIRED") });
  }
  try {
    const result = await db.query(
      `INSERT INTO maitre_ouvrage (tenant_id, nom, categorie, ppm_entite_id)
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [req.user.tenantId, nom, categorie || null, ppm_entite_id || null]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: t(req, "MAITRE_OUVRAGE_CREATE_ERROR") });
  }
});

module.exports = router;
