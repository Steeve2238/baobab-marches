/**
 * Envoi trace des factures et devis d'une entreprise a ses clients (lien + code d'acces + signature facultative ou demandee).
 * Cloisonne par entreprise : chaque route filtre sur req.user.tenantId et sur l'origine TENANT (voir services/portail.js, verifierPortee).
 */
const express = require("express");
const { requireAuth, requireModule, blockLectureSeule } = require("../middleware/auth");
const { t } = require("../utils/i18n");
const portail = require("../services/portail");
const pv = require("../services/portailVentes");
const { ipDe } = require("../services/rhSignature");

const router = express.Router();
router.use(requireAuth);
// Envois de factures, devis, BL, avoirs (module marches) et bons de commande fournisseur (module marches ou fournisseurs).
router.use((req, res, next) => {
  const p = req.user && req.user.permissions;
  if (p && (p.admin || (p.modules || []).some((m) => m === "marches" || m === "fournisseurs"))) return next();
  return requireModule("marches")(req, res, next);
});
router.use(blockLectureSeule);

function gerer(fn) {
  return async (req, res) => {
    try {
      await fn(req, res);
    } catch (err) {
      if (err instanceof portail.PortailError || err instanceof pv.VenteDocError) return res.status(err.status).json({ error: t(req, err.code), code: err.code, details: err.details });
      if (err && err.code === "22P02") return res.status(404).json({ error: t(req, "PORTAIL_INTROUVABLE") });
      console.error(err);
      res.status(500).json({ error: t(req, "PORTAIL_ERREUR_SERVEUR") });
    }
  };
}

const portee = (req) => ({ origine: "TENANT", tenantId: req.user.tenantId });
const TYPES = { factures: "FACTURE", devis: "DEVIS", "bons-livraison": "BON_LIVRAISON", avoirs: "AVOIR", commandes: "COMMANDE_FOURNISSEUR" };

// Pre-remplissage du formulaire d'envoi : contact du client, signature demandee par defaut, partage deja en cours.
router.get("/preparation/:genre(factures|devis|bons-livraison|avoirs|commandes)/:id", gerer(async (req, res) => {
  const type = TYPES[req.params.genre];
  if (!type) throw new portail.PortailError("PORTAIL_TYPE_INVALIDE", 400);
  const c = await pv.chargerDocumentVente(type, req.params.id, req.user.tenantId);
  res.json({ type_document: type, numero: c.numero, statut: c.document.statut, contact: c.contact, signature_par_defaut: ["DEVIS", "BON_LIVRAISON", "COMMANDE_FOURNISSEUR"].includes(type) });
}));

router.post("/:genre(factures|devis|bons-livraison|avoirs|commandes)/:id", gerer(async (req, res) => {
  const type = TYPES[req.params.genre];
  if (!type) throw new portail.PortailError("PORTAIL_TYPE_INVALIDE", 400);
  const b = req.body || {};
  const r = await portail.creerPartage({
    type,
    documentId: req.params.id,
    adminId: req.user.sub,
    tenantId: req.user.tenantId,
    creeParEmail: await pv.utilisateurEmail(req.user.sub),
    email: b.email,
    telephone: b.telephone,
    nom: b.nom,
    jours: b.jours,
    signatureRequise: b.signature_requise,
    modeReponse: b.mode_reponse,
    forcer: b.forcer === true,
    envoyerEmail: b.envoyer_email !== false,
    message: b.message,
    ip: ipDe(req),
  });
  res.status(201).json(r);
}));

router.get("/", gerer(async (req, res) => {
  res.json(await portail.lister({ type: req.query.type || null, documentId: req.query.document || null, statut: req.query.statut || null, portee: portee(req) }));
}));

router.get("/:id", gerer(async (req, res) => {
  res.json(await portail.getPartage(req.params.id, portee(req)));
}));

router.post("/:id/renouveler", gerer(async (req, res) => {
  const b = req.body || {};
  res.json(await portail.renouveler(req.params.id, { envoyerEmail: b.envoyer_email === true, jours: b.jours, ip: ipDe(req), portee: portee(req) }));
}));

router.post("/:id/revoquer", gerer(async (req, res) => {
  res.json(await portail.revoquer(req.params.id, ipDe(req), portee(req)));
}));

router.get("/:id/pdf", gerer(async (req, res) => {
  const f = await portail.pdfPourEditeur(req.params.id, portee(req));
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="${f.nom}"`);
  res.send(f.buffer);
}));

module.exports = router;
