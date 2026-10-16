const express = require("express");
const db = require("../db");
const { requireAuth, blockLectureSeule } = require("../middleware/auth");
const { t } = require("../utils/i18n");
const modes = require("../services/modesReglement");

const router = express.Router();
router.use(requireAuth);

// Lecture : tout utilisateur de l'entreprise (les ecrans de vente, de caisse et de compta
// proposent la meme liste). Ecriture : administrateur ou responsable comptable.
function peutParametrer(req) {
  const p = req.user?.permissions;
  if (!p) return false;
  return !!p.admin || (p.modules || []).includes("comptabilite-validation");
}

function gerer(fn) {
  return async (req, res) => {
    try {
      await fn(req, res);
    } catch (err) {
      if (err instanceof modes.ModeError) return res.status(err.status).json({ error: t(req, err.code) });
      console.error(err);
      res.status(500).json({ error: t(req, "MODE_REGLEMENT_ERREUR") });
    }
  };
}

router.get("/", gerer(async (req, res) => {
  const actifs = req.query.actifs === "1" || req.query.actifs === "true";
  const sens = req.query.sens === "ENCAISSEMENT" || req.query.sens === "DECAISSEMENT" ? req.query.sens : null;
  const liste = await modes.lister(db, req.user.tenantId, { actifs, sens });
  res.json({ modes: liste, peut_parametrer: peutParametrer(req), types: modes.TYPES, sens: modes.SENS });
}));

router.use(blockLectureSeule);
router.use((req, res, next) => {
  if (peutParametrer(req)) return next();
  return res.status(403).json({ error: t(req, "MODE_REGLEMENT_PARAM_FORBIDDEN") });
});

router.post("/", gerer(async (req, res) => {
  res.status(201).json(await modes.creer(db, req.user.tenantId, req.body || {}));
}));

router.put("/:id", gerer(async (req, res) => {
  res.json(await modes.modifier(db, req.user.tenantId, req.params.id, req.body || {}));
}));

router.delete("/:id", gerer(async (req, res) => {
  res.json(await modes.supprimer(db, req.user.tenantId, req.params.id));
}));

module.exports = router;
