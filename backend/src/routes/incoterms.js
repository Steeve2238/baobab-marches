const express = require("express");
const db = require("../db");
const { requireAuth } = require("../middleware/auth");
const { t } = require("../utils/i18n");
const { assurerCatalogue, lireCatalogue } = require("../services/incoterms");

// Catalogue d'incoterms de l'entreprise (source unique : scenarios Logistique).
// Lecture seule, ouverte a tout utilisateur connecte : sert aux listes deroulantes
// des receptions, commandes et cotations.
const router = express.Router();
router.use(requireAuth);

router.get("/", async (req, res) => {
  try {
    await assurerCatalogue(db, req.user.tenantId);
    res.json(await lireCatalogue(db, req.user.tenantId));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: t(req, "SERVER_ERROR") });
  }
});

module.exports = router;
