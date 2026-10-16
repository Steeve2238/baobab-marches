const express = require("express");
const { requireAuth, blockLectureSeule } = require("../middleware/auth");
const { t } = require("../utils/i18n");
const { exigerPackCommerce } = require("../middleware/pack");
const svc = require("../services/avoirs");

// Avoirs et retours clients (Pack Commerce, lot 6c) - migration 077.
const router = express.Router();
router.use(requireAuth);
// Pack Commerce (negoce) : refuse les clients au pack Marches seul.
router.use(exigerPackCommerce);
router.use((req, res, next) => {
  const p = req.user?.permissions;
  if (!p) return res.status(403).json({ error: t(req, "MODULE_FORBIDDEN") });
  if (p.admin) return next();
  if ((p.modules || []).some((m) => m === "marches" || m === "comptabilite" || m === "comptabilite-validation")) return next();
  return res.status(403).json({ error: t(req, "MODULE_FORBIDDEN") });
});
router.use((req, res, next) => (req.method === "GET" ? next() : blockLectureSeule(req, res, next)));

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function gerer(fn) {
  return async (req, res) => {
    try {
      await fn(req, res);
    } catch (err) {
      if (err instanceof svc.AvoirError) {
        const d = err.details || {};
        const msg = String(t(req, err.code)).replace(/\{(\w+)\}/g, (_, k) => (d[k] !== undefined ? d[k] : `{${k}}`));
        return res.status(err.status).json({ error: msg, code: err.code });
      }
      console.error(err);
      res.status(500).json({ error: t(req, "AVOIR_ERREUR") });
    }
  };
}

router.get("/factures", gerer(async (req, res) => res.json({ factures: await svc.chercherFactures(req.user.tenantId, req.query.q) })));
router.get("/eligibilite/:factureId", gerer(async (req, res) => {
  if (!UUID_RE.test(req.params.factureId)) return res.status(404).json({ error: t(req, "AVOIR_FACTURE_INTROUVABLE") });
  res.json(await svc.eligibilite(req.user.tenantId, req.params.factureId));
}));
router.get("/", gerer(async (req, res) => res.json(await svc.lister(req.user.tenantId, { du: req.query.du, au: req.query.au, q: req.query.q, facture_id: UUID_RE.test(String(req.query.facture_id || "")) ? req.query.facture_id : undefined }))));
router.get("/:id", gerer(async (req, res) => {
  if (!UUID_RE.test(req.params.id)) return res.status(404).json({ error: t(req, "AVOIR_INTROUVABLE") });
  res.json(await svc.detail(req.user.tenantId, req.params.id));
}));
router.post("/", gerer(async (req, res) => {
  res.status(201).json(await svc.creerAvoir({ tenantId: req.user.tenantId, sub: req.user.sub }, req.body || {}));
}));

module.exports = router;
