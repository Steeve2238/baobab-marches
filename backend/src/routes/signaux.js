const express = require("express");
const db = require("../db");
const { requireAuth } = require("../middleware/auth");
const { t } = require("../utils/i18n");

const router = express.Router();
router.use(requireAuth);

// GET /api/signaux - le "Radar d'anticipation" (Module 15), non acquittes en premier
router.get("/", async (req, res) => {
  try {
    const result = await db.query(
      `SELECT s.id, s.severite, s.message, s.date_detection, s.accuse_reception,
              d.id AS dossier_id, d.intitule AS dossier_intitule, d.reference_externe,
              idef.code AS indicateur_code, idef.domaine
       FROM signal_anticipation s
       LEFT JOIN dossier_ao d ON d.id = s.dossier_ao_id
       LEFT JOIN indicateur_definition idef ON idef.id = s.indicateur_definition_id
       WHERE s.tenant_id = $1
       ORDER BY s.accuse_reception ASC,
                CASE s.severite WHEN 'CRITIQUE' THEN 0 WHEN 'ALERTE' THEN 1 ELSE 2 END,
                s.date_detection DESC`,
      [req.user.tenantId]
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: t(req, "SIGNAUX_FETCH_ERROR") });
  }
});

// PATCH /api/signaux/:id/acquitter
router.patch("/:id/acquitter", async (req, res) => {
  const { id } = req.params;
  try {
    const result = await db.query(
      `UPDATE signal_anticipation
       SET accuse_reception = true, accuse_par_utilisateur_id = $1
       WHERE id = $2 AND tenant_id = $3
       RETURNING *`,
      [req.user.sub, id, req.user.tenantId]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: t(req, "SIGNAL_NOT_FOUND") });
    }
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: t(req, "SIGNAL_ACK_ERROR") });
  }
});

module.exports = router;
