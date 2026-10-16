const express = require("express");
const { requireAuth, blockLectureSeule } = require("../middleware/auth");
const { t } = require("../utils/i18n");
const { exigerPackCommerce } = require("../middleware/pack");
const svc = require("../services/depenses");

// Depenses et resultat mensuel (Pack Commerce, lot 5) - migration 075.
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
const peutParametrer = (req) => {
  const p = req.user.permissions;
  return !!(p.admin || (p.modules || []).includes("comptabilite-validation") || (p.modules || []).includes("comptabilite"));
};

function gerer(fn) {
  return async (req, res) => {
    try {
      await fn(req, res);
    } catch (err) {
      if (err instanceof svc.DepenseError) return res.status(err.status).json({ error: t(req, err.code), code: err.code });
      console.error(err);
      res.status(500).json({ error: t(req, "DEPENSE_ERREUR") });
    }
  };
}

router.get("/categories", gerer(async (req, res) => {
  res.json({ categories: await svc.listerCategories(req.user.tenantId, { actives: req.query.actives === "1" }) });
}));
router.post("/categories", gerer(async (req, res) => {
  if (!peutParametrer(req)) return res.status(403).json({ error: t(req, "MODULE_FORBIDDEN") });
  res.status(201).json(await svc.creerCategorie(req.user.tenantId, req.body || {}));
}));
router.put("/categories/:id", gerer(async (req, res) => {
  if (!peutParametrer(req)) return res.status(403).json({ error: t(req, "MODULE_FORBIDDEN") });
  if (!UUID_RE.test(req.params.id)) return res.status(404).json({ error: t(req, "DEPENSE_CATEGORIE_INTROUVABLE") });
  res.json(await svc.modifierCategorie(req.user.tenantId, req.params.id, req.body || {}));
}));
router.delete("/categories/:id", gerer(async (req, res) => {
  if (!peutParametrer(req)) return res.status(403).json({ error: t(req, "MODULE_FORBIDDEN") });
  if (!UUID_RE.test(req.params.id)) return res.status(404).json({ error: t(req, "DEPENSE_CATEGORIE_INTROUVABLE") });
  res.json(await svc.supprimerCategorie(req.user.tenantId, req.params.id));
}));

router.get("/resultat", gerer(async (req, res) => res.json(await svc.resultatMensuel(req.user.tenantId, req.query.mois))));
router.get("/marges", gerer(async (req, res) => res.json(await svc.marges(req.user.tenantId, req.query.du, req.query.au))));

router.get("/", gerer(async (req, res) => res.json(await svc.listerDepenses(req.user.tenantId, { du: req.query.du, au: req.query.au, categorie_id: req.query.categorie_id }))));
router.post("/", gerer(async (req, res) => {
  const d = await svc.creerDepense({ tenantId: req.user.tenantId, sub: req.user.sub }, req.body || {});
  res.status(201).json(d);
}));
router.post("/:id/annuler", gerer(async (req, res) => {
  if (!UUID_RE.test(req.params.id)) return res.status(404).json({ error: t(req, "DEPENSE_INTROUVABLE") });
  res.json(await svc.annulerDepense({ tenantId: req.user.tenantId, sub: req.user.sub }, req.params.id));
}));

module.exports = router;
