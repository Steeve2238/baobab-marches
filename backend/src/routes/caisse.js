const express = require("express");
const { requireAuth, requireModule, blockLectureSeule } = require("../middleware/auth");
const { t } = require("../utils/i18n");
const { exigerPackCommerce } = require("../middleware/pack");
const caisse = require("../services/venteComptoir");

const router = express.Router();
router.use(requireAuth);
// Pack Commerce (negoce) : refuse les clients au pack Marches seul.
router.use(exigerPackCommerce);
// Meme acces que le module Ventes (les vendeurs du comptoir ont le module « marches »).
router.use(requireModule("marches"));
router.use(blockLectureSeule);

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const aujourdhui = () => new Date().toISOString().slice(0, 10);

function gerer(fn) {
  return async (req, res) => {
    try {
      await fn(req, res);
    } catch (err) {
      if (err instanceof caisse.CaisseError) {
        let msg = t(req, err.code);
        if (err.details && err.details.reference) msg += ` ${err.details.reference}`;
        if (err.details && err.details.plafond) msg += ` (${err.details.plafond} %)`;
        return res.status(err.status).json({ error: msg, code: err.code });
      }
      if (err && err.code && String(err.code).startsWith("MODE_REGLEMENT")) {
        return res.status(err.status || 400).json({ error: t(req, err.code), code: err.code });
      }
      console.error(err);
      res.status(500).json({ error: t(req, "CAISSE_ERREUR") });
    }
  };
}

// GET /api/caisse/produits?q=&categorie=
router.get("/produits", gerer(async (req, res) => {
  res.json(await caisse.catalogue(req.user.tenantId, { q: req.query.q, categorie: req.query.categorie }));
}));

// POST /api/caisse/ventes : enregistre la vente (facture, encaissements, livraison, stock)
router.post("/ventes", gerer(async (req, res) => {
  const body = req.body || {};
  if (body.client_commercial_id && !UUID_RE.test(body.client_commercial_id)) {
    return res.status(400).json({ error: t(req, "CAISSE_CLIENT_INTROUVABLE") });
  }
  const r = await caisse.creerVente({ tenantId: req.user.tenantId, sub: req.user.sub, roles: req.user.roles || [] }, body);
  res.status(201).json(r);
}));

// GET /api/caisse/ventes?date=AAAA-MM-JJ
router.get("/ventes", gerer(async (req, res) => {
  const date = DATE_RE.test(String(req.query.date || "")) ? req.query.date : aujourdhui();
  res.json({ date, ventes: await caisse.ventesDuJour(req.user.tenantId, date) });
}));

// GET /api/caisse/ventes/:id : donnees d'impression (ticket / facture-recu)
router.get("/ventes/:id", gerer(async (req, res) => {
  if (!UUID_RE.test(req.params.id)) return res.status(404).json({ error: t(req, "CAISSE_VENTE_INTROUVABLE") });
  res.json(await caisse.ticketVente(req.user.tenantId, req.params.id));
}));

// GET /api/caisse/rapport?date=AAAA-MM-JJ
router.get("/rapport", gerer(async (req, res) => {
  const date = DATE_RE.test(String(req.query.date || "")) ? req.query.date : aujourdhui();
  res.json(await caisse.rapportJour(req.user.tenantId, date));
}));

module.exports = router;
