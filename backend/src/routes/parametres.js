const express = require("express");
const multer = require("multer");
const db = require("../db");
const { requireAuth, requireRole } = require("../middleware/auth");
const { t } = require("../utils/i18n");

const router = express.Router();
router.use(requireAuth);

// Logo tenant, utilise sur les documents imprimables du module Ventes
// (devis/facture/BL). Pas de stockage cloud (S3 ou equivalent) configure
// sur cette plateforme (voir routes/extraction.js) : le logo est stocke
// directement en base, encode en base64, taille limitee cote applicatif
// pour ne pas alourdir la table tenant outre mesure.
const MIMETYPES_LOGO_ACCEPTES = ["image/png", "image/jpeg"];
const uploadLogo = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 2 * 1024 * 1024 }, // 2 Mo
});

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

// ----------------------------------------------------------------------------
// Parametres du module Ventes : taux de TVA systematique + logo, utilises
// automatiquement sur chaque devis/facture (voir routes/ventes.js). Reserve
// a ADMIN : ce sont des parametres globaux au tenant, pas une donnee
// operationnelle du quotidien.
// ----------------------------------------------------------------------------

// GET /api/parametres/ventes
router.get("/ventes", async (req, res) => {
  try {
    const result = await db.query(
      `SELECT taux_tva_pourcentage, logo_base64, logo_type_mime FROM tenant WHERE id = $1`,
      [req.user.tenantId]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: t(req, "VENTE_PARAMETRES_FETCH_ERROR") });
    }
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: t(req, "VENTE_PARAMETRES_FETCH_ERROR") });
  }
});

// PATCH /api/parametres/ventes - taux de TVA
router.patch("/ventes", requireRole("ADMIN"), async (req, res) => {
  const { taux_tva_pourcentage } = req.body;
  const taux = Number(taux_tva_pourcentage);
  if (!Number.isFinite(taux) || taux < 0 || taux > 100) {
    return res.status(400).json({ error: t(req, "VENTE_TAUX_TVA_INVALID") });
  }
  try {
    const result = await db.query(
      `UPDATE tenant SET taux_tva_pourcentage = $1 WHERE id = $2
       RETURNING taux_tva_pourcentage, logo_base64, logo_type_mime`,
      [taux, req.user.tenantId]
    );
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: t(req, "VENTE_PARAMETRES_UPDATE_ERROR") });
  }
});

// POST /api/parametres/ventes/logo
router.post("/ventes/logo", requireRole("ADMIN"), uploadLogo.single("logo"), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: t(req, "VENTE_LOGO_FILE_REQUIRED") });
  }
  if (!MIMETYPES_LOGO_ACCEPTES.includes(req.file.mimetype)) {
    return res.status(400).json({ error: t(req, "VENTE_LOGO_TYPE_INVALID") });
  }
  try {
    const base64 = req.file.buffer.toString("base64");
    const result = await db.query(
      `UPDATE tenant SET logo_base64 = $1, logo_type_mime = $2 WHERE id = $3
       RETURNING taux_tva_pourcentage, logo_base64, logo_type_mime`,
      [base64, req.file.mimetype, req.user.tenantId]
    );
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: t(req, "VENTE_LOGO_UPLOAD_ERROR") });
  }
});

// DELETE /api/parametres/ventes/logo
router.delete("/ventes/logo", requireRole("ADMIN"), async (req, res) => {
  try {
    const result = await db.query(
      `UPDATE tenant SET logo_base64 = NULL, logo_type_mime = NULL WHERE id = $1
       RETURNING taux_tva_pourcentage, logo_base64, logo_type_mime`,
      [req.user.tenantId]
    );
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: t(req, "VENTE_LOGO_UPLOAD_ERROR") });
  }
});

module.exports = router;
