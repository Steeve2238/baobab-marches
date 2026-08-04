const express = require("express");
const db = require("../db");
const { requireAuth } = require("../middleware/auth");
const { t } = require("../utils/i18n");

const router = express.Router();
router.use(requireAuth);

// GET /api/parametres/entete
router.get("/entete", async (req, res) => {
  try {
    const result = await db.query(
      `SELECT raison_sociale, adresse, telephone, email, signataire_nom, signataire_titre
       FROM tenant WHERE id = $1`,
      [req.user.tenantId]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: t(req, "ENTETE_NOT_FOUND") });
    }
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: t(req, "ENTETE_FETCH_ERROR") });
  }
});

// PATCH /api/parametres/entete
router.patch("/entete", async (req, res) => {
  const { raison_sociale, adresse, telephone, email, signataire_nom, signataire_titre } = req.body;
  try {
    const result = await db.query(
      `UPDATE tenant
       SET raison_sociale = COALESCE($1, raison_sociale),
           adresse = $2,
           telephone = $3,
           email = $4,
           signataire_nom = $5,
           signataire_titre = $6
       WHERE id = $7
       RETURNING raison_sociale, adresse, telephone, email, signataire_nom, signataire_titre`,
      [
        raison_sociale || null,
        adresse || null,
        telephone || null,
        email || null,
        signataire_nom || null,
        signataire_titre || null,
        req.user.tenantId,
      ]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: t(req, "ENTETE_NOT_FOUND") });
    }
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: t(req, "ENTETE_UPDATE_ERROR") });
  }
});

module.exports = router;
