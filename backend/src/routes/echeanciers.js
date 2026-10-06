const express = require("express");
const { requireAuth } = require("../middleware/auth");
const svc = require("../services/echeancier");

const router = express.Router();
router.use(requireAuth);

// GET /api/echeanciers/modeles?sens=CLIENT|FOURNISSEUR : modeles proposes a la saisie.
router.get("/modeles", (req, res) => {
  const sens = String(req.query.sens || "").toUpperCase();
  res.json({
    evenements: svc.EVENEMENTS,
    modeles: sens === "CLIENT" || sens === "FOURNISSEUR" ? svc.MODELES[sens] : svc.MODELES,
  });
});

module.exports = router;
