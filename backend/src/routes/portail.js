/**
 * Portail public de remise des documents (offres, contrats) : acces par lien + code, consultation, telechargement, signature.
 * Aucune authentification de plateforme : l'acces repose sur le jeton du lien, l'identifiant (e-mail ou telephone) et le code d'acces.
 * Voir services/portail.js.
 */
const express = require("express");
const { t } = require("../utils/i18n");
const svc = require("../services/portail");
const { ipDe } = require("../services/rhSignature");

const router = express.Router();
const { PortailError } = svc;

router.use((req, res, next) => {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("X-Robots-Tag", "noindex, nofollow");
  next();
});

// Limiteur simple par IP sur la saisie du code (en plus du blocage par lien).
const essais = new Map();
function limiter(req, res, next) {
  const ip = ipDe(req) || "?";
  const maintenant = Date.now();
  const fenetre = 10 * 60 * 1000;
  const liste = (essais.get(ip) || []).filter((d) => maintenant - d < fenetre);
  if (liste.length >= 30) return res.status(429).json({ error: t(req, "PORTAIL_TROP_ESSAIS"), code: "PORTAIL_TROP_ESSAIS" });
  liste.push(maintenant);
  essais.set(ip, liste);
  if (essais.size > 5000) for (const [k, v] of essais) if (!v.some((d) => maintenant - d < fenetre)) essais.delete(k);
  next();
}

const ctxDe = (req) => ({ ip: ipDe(req), ua: req.headers["user-agent"] || "" });

function gerer(fn) {
  return async (req, res) => {
    try {
      await fn(req, res);
    } catch (err) {
      if (err instanceof PortailError) return res.status(err.status).json({ error: t(req, err.code), code: err.code, details: err.details });
      console.error(err);
      res.status(500).json({ error: t(req, "PORTAIL_ERREUR_SERVEUR"), code: "PORTAIL_ERREUR_SERVEUR" });
    }
  };
}

router.get("/:token", gerer(async (req, res) => {
  res.json(await svc.infoPublique(req.params.token, ctxDe(req)));
}));

router.post("/:token/acces", limiter, gerer(async (req, res) => {
  res.json(await svc.acces(req.params.token, req.body || {}, ctxDe(req)));
}));

router.get("/:token/document", gerer(async (req, res) => {
  const { ligne } = await svc.exigerSession(req.params.token, req.headers.authorization);
  res.json(await svc.consulter(ligne, ctxDe(req)));
}));

router.get("/:token/pdf", gerer(async (req, res) => {
  const { ligne } = await svc.exigerSession(req.params.token, req.headers.authorization);
  const telecharger = req.query.dl === "1";
  const f = await svc.pdfPourClient(ligne, { telecharger }, ctxDe(req));
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `${telecharger ? "attachment" : "inline"}; filename="${f.nom}"`);
  res.send(f.buffer);
}));

router.post("/:token/signer", gerer(async (req, res) => {
  const { ligne, identifiantMasque } = await svc.exigerSession(req.params.token, req.headers.authorization);
  res.status(201).json(await svc.signer(ligne, req.body || {}, identifiantMasque, ctxDe(req)));
}));

module.exports = router;
