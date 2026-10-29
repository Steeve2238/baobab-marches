const { t } = require("../utils/i18n");

/**
 * Pack de licence (lot 8) : les fonctions « Commerce » (caisse, avoirs, depenses et resultat) sont reservees aux
 * packs Negoce et Complet. Un client au pack Marches ou Modules seuls (profil_activite = MARCHES | MODULES) recoit un refus, meme si son menu
 * ne les propose deja pas. Le profil est lu par requireAuth (permissions.profilActivite).
 */
function exigerPackCommerce(req, res, next) {
  const profil = req.user?.permissions?.profilActivite || "LES_DEUX";
  if (profil === "MARCHES" || profil === "MODULES") return res.status(403).json({ error: t(req, "PACK_COMMERCE_REQUIS"), code: "PACK_COMMERCE_REQUIS" });
  return next();
}

module.exports = { exigerPackCommerce };
