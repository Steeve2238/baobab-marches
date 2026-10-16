const express = require("express");
const multer = require("multer");
const db = require("../db");
const { requireAuth, blockLectureSeule } = require("../middleware/auth");
const { t } = require("../utils/i18n");
const imp = require("../services/importDonnees");

// Import Excel de reprise (Pack Commerce, lot 7) : produits + stock d'ouverture, clients, fournisseurs.
const router = express.Router();
router.use(requireAuth);

// Droits par type : meme perimetre que les ecrans concernes (produits : marches/dossiers ; clients : marches ; fournisseurs : fournisseurs).
const MODULES = { produits: ["marches", "dossiers", "fournisseurs"], clients: ["marches"], fournisseurs: ["fournisseurs"] };
function exigerType(req, res, next) {
  const type = req.params.type;
  if (!MODULES[type]) return res.status(404).json({ error: t(req, "IMPORT_TYPE_INVALIDE") });
  const p = req.user?.permissions;
  if (!p) return res.status(403).json({ error: t(req, "MODULE_FORBIDDEN") });
  if (p.admin || (p.modules || []).some((m) => MODULES[type].includes(m))) return next();
  return res.status(403).json({ error: t(req, "MODULE_FORBIDDEN") });
}

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 8 * 1024 * 1024, files: 1 } }).single("fichier");
function recevoir(req, res, next) {
  upload(req, res, (err) => (err ? res.status(400).json({ error: t(req, "IMPORT_FICHIER_INVALIDE") }) : next()));
}

function gerer(fn) {
  return async (req, res) => {
    try {
      await fn(req, res);
    } catch (err) {
      if (err instanceof imp.ImportError) return res.status(err.status).json({ error: t(req, err.code), code: err.code });
      console.error(err);
      res.status(500).json({ error: t(req, "IMPORT_ERREUR") });
    }
  };
}

const params = (req) => ({
  tenantId: req.user.tenantId,
  userId: req.user.sub,
  buffer: req.file.buffer,
  nomFichier: req.file.originalname,
  options: req.body || {},
});

router.get("/historique", gerer(async (req, res) => {
  const p = req.user.permissions;
  if (!p || !(p.admin || (p.modules || []).some((m) => ["marches", "dossiers", "fournisseurs"].includes(m)))) return res.status(403).json({ error: t(req, "MODULE_FORBIDDEN") });
  res.json({ lots: await imp.historique(req.user.tenantId) });
}));

router.get("/modele/:type", exigerType, gerer(async (req, res) => {
  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.setHeader("Content-Disposition", `attachment; filename="modele_import_${req.params.type}.xlsx"`);
  res.send(imp.modele(req.params.type));
}));

router.post("/:type/apercu", exigerType, blockLectureSeule, recevoir, gerer(async (req, res) => {
  if (!req.file) return res.status(400).json({ error: t(req, "IMPORT_FICHIER_REQUIS") });
  res.json(await imp.apercu(req.params.type, params(req)));
}));

router.post("/:type", exigerType, blockLectureSeule, recevoir, gerer(async (req, res) => {
  if (!req.file) return res.status(400).json({ error: t(req, "IMPORT_FICHIER_REQUIS") });
  const r = await imp.executer(req.params.type, params(req));
  res.status(r.importe ? 201 : 200).json(r);
}));

module.exports = router;
