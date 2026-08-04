const MESSAGES = require("../locales/messages");

const LANGUES_SUPPORTEES = ["fr", "en"];

/**
 * Determine la langue active pour cette requete a partir de l'en-tete
 * Accept-Language envoye par le frontend (qui reflete le choix de
 * l'utilisateur, stocke cote client et synchronise avec son profil).
 * Retombe sur "fr" par defaut.
 */
function resolveLangue(req) {
  const header = (req.headers["accept-language"] || "").toLowerCase();
  return header.startsWith("en") ? "en" : "fr";
}

/**
 * Traduit une cle de message dans la langue de la requete.
 * Usage : t(req, "DOSSIER_NOT_FOUND")
 */
function t(req, key) {
  const langue = resolveLangue(req);
  return (MESSAGES[langue] && MESSAGES[langue][key]) || MESSAGES.fr[key] || key;
}

module.exports = { t, resolveLangue, LANGUES_SUPPORTEES };
