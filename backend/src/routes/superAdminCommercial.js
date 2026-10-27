/**
 * Super Admin : offres commerciales, contrats clients, PDF et envoi par e-mail.
 * Monte dans routes/superAdmin.js APRES router.use(requireSuperAdmin) : toutes ces routes exigent un Super Admin.
 */
const express = require("express");
const multer = require("multer");
const { t } = require("../utils/i18n");
const svc = require("../services/offresContrats");
const pdf = require("../services/offresContratsPdf");
const { envoyerEmailAvecPieceJointe } = require("../utils/mailer");
const portail = require("../services/portail");
const pv = require("../services/portailVentes");
const { ipDe } = require("../services/rhSignature");

const router = express.Router();
const { CommercialError } = svc;

const uploadContrat = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

function gerer(fn) {
  return async (req, res) => {
    try {
      await fn(req, res);
    } catch (err) {
      if (err instanceof CommercialError || err instanceof portail.PortailError) return res.status(err.status).json({ error: t(req, err.code), code: err.code, details: err.details });
      if (err && err.code === "22P02") return res.status(400).json({ error: t(req, "OFFRE_INTROUVABLE") });
      console.error(err);
      res.status(500).json({ error: t(req, "COMMERCIAL_ERREUR_SERVEUR") });
    }
  };
}

const nomFichier = (numero, ext = "pdf") => `${numero}.${ext}`;
const adresseValide = (v) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(v || "").trim());

// --- Offres -----------------------------------------------------------------------------------------------------------------

router.get("/offres", gerer(async (req, res) => {
  res.json(await svc.listerOffres({ tenantId: req.query.client || null, statut: req.query.statut || null }));
}));

router.get("/offres/proposition", gerer(async (req, res) => {
  const modules = String(req.query.modules || "").split(",").filter(Boolean);
  res.json(await svc.proposerLignes({ tenant_id: req.query.client, formule_id: req.query.formule || null, mode: req.query.mode, modules, duree_mois: req.query.duree }));
}));

router.post("/offres", gerer(async (req, res) => {
  const { tenant_id } = req.body || {};
  if (!tenant_id) return res.status(400).json({ error: t(req, "SUPER_ADMIN_CLIENT_NOT_FOUND") });
  res.status(201).json(await svc.creerOffre(tenant_id, req.superAdmin && req.superAdmin.id, req.body));
}));

router.get("/offres/:id", gerer(async (req, res) => {
  res.json(await svc.getOffre(req.params.id));
}));

router.patch("/offres/:id", gerer(async (req, res) => {
  if (await portail.documentVerrouille("OFFRE", req.params.id)) throw new portail.PortailError("PORTAIL_DOCUMENT_VERROUILLE", 409);
  res.json(await svc.modifierOffre(req.params.id, req.body));
}));

router.get("/offres/:id/pdf", gerer(async (req, res) => {
  const offre = await svc.getOffre(req.params.id);
  const buf = await pdf.offrePdf(offre, await svc.getParametresEditeur());
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="${nomFichier(offre.numero)}"`);
  res.send(buf);
}));

router.post("/offres/:id/envoyer", gerer(async (req, res) => {
  const { destinataire, sujet, message } = req.body || {};
  if (!adresseValide(destinataire)) return res.status(400).json({ error: t(req, "COMMERCIAL_EMAIL_INVALIDE") });
  const params = await svc.getParametresEditeur();
  const offre = await svc.getOffre(req.params.id);
  const buf = await pdf.offrePdf(offre, params);
  try {
    await envoyerEmailAvecPieceJointe({
      destinataire: String(destinataire).trim(),
      sujet: String(sujet || `Offre commerciale ${offre.numero} - Baobab Marchés`).slice(0, 200),
      message: String(message || "").slice(0, 5000) || `Bonjour,\n\nVeuillez trouver ci-joint notre offre ${offre.numero}.\n\nCordialement,`,
      pieces: [{ nom: nomFichier(offre.numero), contenu: buf, type: "application/pdf" }],
      repondreA: params.email || null,
      copie: params.email || null,
    });
  } catch (e) {
    console.error(e);
    return res.status(502).json({ error: t(req, "COMMERCIAL_EMAIL_ECHEC") });
  }
  res.json(await svc.marquerEnvoyee(req.params.id, String(destinataire).trim()));
}));

router.post("/offres/:id/accepter", gerer(async (req, res) => {
  const resultat = await svc.accepterOffre(req.params.id, req.body || {});
  await portail.revoquerActifsDocument("OFFRE", req.params.id, ipDe(req));
  res.json(resultat);
}));

router.post("/offres/:id/refuser", gerer(async (req, res) => {
  const resultat = await svc.refuserOffre(req.params.id, (req.body || {}).motif);
  await portail.revoquerActifsDocument("OFFRE", req.params.id, ipDe(req));
  res.json(resultat);
}));

router.post("/offres/:id/annuler", gerer(async (req, res) => {
  const resultat = await svc.annulerOffre(req.params.id);
  await portail.revoquerActifsDocument("OFFRE", req.params.id, ipDe(req));
  res.json(resultat);
}));

// --- Contrats ---------------------------------------------------------------------------------------------------------------

router.get("/contrats", gerer(async (req, res) => {
  res.json(await svc.listerContrats({ tenantId: req.query.client || null }));
}));

router.get("/contrats/:id", gerer(async (req, res) => {
  res.json(await svc.getContrat(req.params.id));
}));

router.post("/contrats/:id/regenerer", gerer(async (req, res) => {
  if (await portail.documentVerrouille("CONTRAT", req.params.id)) throw new portail.PortailError("PORTAIL_DOCUMENT_VERROUILLE", 409);
  res.json(await svc.regenererContrat(req.params.id, req.body || {}));
}));

router.patch("/contrats/:id/notes", gerer(async (req, res) => {
  res.json(await svc.mettreNotesContrat(req.params.id, (req.body || {}).notes));
}));

router.get("/contrats/:id/pdf", gerer(async (req, res) => {
  const c = await svc.getContratComplet(req.params.id);
  const buf = await pdf.contratPdf(c, await svc.getParametresEditeur());
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="${nomFichier(c.numero)}"`);
  res.send(buf);
}));

router.post("/contrats/:id/envoyer", gerer(async (req, res) => {
  const { destinataire, sujet, message } = req.body || {};
  if (!adresseValide(destinataire)) return res.status(400).json({ error: t(req, "COMMERCIAL_EMAIL_INVALIDE") });
  const params = await svc.getParametresEditeur();
  const c = await svc.getContratComplet(req.params.id);
  const buf = await pdf.contratPdf(c, params);
  try {
    await envoyerEmailAvecPieceJointe({
      destinataire: String(destinataire).trim(),
      sujet: String(sujet || `Contrat ${c.numero} - Baobab Marchés`).slice(0, 200),
      message: String(message || "").slice(0, 5000) || `Bonjour,\n\nVeuillez trouver ci-joint le contrat ${c.numero}, déjà signé de notre côté. Merci de nous le retourner signé.\n\nCordialement,`,
      pieces: [{ nom: nomFichier(c.numero), contenu: buf, type: "application/pdf" }],
      repondreA: params.email || null,
      copie: params.email || null,
    });
  } catch (e) {
    console.error(e);
    return res.status(502).json({ error: t(req, "COMMERCIAL_EMAIL_ECHEC") });
  }
  res.json(await svc.marquerContratEnvoye(req.params.id, String(destinataire).trim()));
}));

router.post(
  "/contrats/:id/signe",
  (req, res, next) => uploadContrat.single("fichier")(req, res, (err) => {
    if (!err) return next();
    if (err.code === "LIMIT_FILE_SIZE") return res.status(400).json({ error: t(req, "COMMERCIAL_FICHIER_TROP_GROS") });
    console.error(err);
    res.status(500).json({ error: t(req, "COMMERCIAL_ERREUR_SERVEUR") });
  }),
  gerer(async (req, res) => {
    const resultat = await svc.deposerContratSigne(req.params.id, req.file, req.body || {});
    await portail.revoquerActifsDocument("CONTRAT", req.params.id, ipDe(req));
    res.json(resultat);
  })
);

router.get("/contrats/:id/signe", gerer(async (req, res) => {
  const f = await svc.getContratSigne(req.params.id);
  res.setHeader("Content-Type", f.mime);
  res.setHeader("Content-Disposition", `attachment; filename="${String(f.nom).replace(/"/g, "")}"`);
  res.send(f.buffer);
}));

// --- Portail de remise tracee (lien + code + signature electronique) ------------------------------------------------------------

async function creerPartage(type, req, res) {
  const b = req.body || {};
  const r = await portail.creerPartage({
    type,
    documentId: req.params.id,
    adminId: req.superAdmin && req.superAdmin.id,
    email: b.email,
    telephone: b.telephone,
    nom: b.nom,
    jours: b.jours,
    envoyerEmail: b.envoyer_email !== false,
    message: b.message,
    signatureRequise: b.signature_requise,
    modeReponse: b.mode_reponse,
    forcer: b.forcer === true,
    ip: ipDe(req),
  });
  res.status(201).json(r);
}

router.post("/offres/:id/partage", gerer((req, res) => creerPartage("OFFRE", req, res)));
router.post("/contrats/:id/partage", gerer((req, res) => creerPartage("CONTRAT", req, res)));
router.post("/factures/:id/partage", gerer((req, res) => creerPartage("FACTURE_ABO", req, res)));

// Contact a pre-remplir dans la carte d'envoi d'une facture d'abonnement.
router.get("/factures/:id/partage-preparation", gerer(async (req, res) => {
  const f = await pv.chargerFactureAbonnement(req.params.id);
  res.json({ numero: f.numero, statut: f.statut, contact: await pv.contactEntrepriseCliente(f.tenant_id) });
}));

router.get("/partages", gerer(async (req, res) => {
  res.json(await portail.lister({ type: req.query.type || null, documentId: req.query.document || null, tenantId: req.query.client || null, statut: req.query.statut || null }));
}));

router.get("/partages/:id", gerer(async (req, res) => {
  res.json(await portail.getPartage(req.params.id));
}));

router.post("/partages/:id/renouveler", gerer(async (req, res) => {
  const b = req.body || {};
  res.json(await portail.renouveler(req.params.id, { envoyerEmail: b.envoyer_email === true, jours: b.jours, ip: ipDe(req) }));
}));

router.post("/partages/:id/revoquer", gerer(async (req, res) => {
  res.json(await portail.revoquer(req.params.id, ipDe(req)));
}));

router.get("/partages/:id/pdf", gerer(async (req, res) => {
  const f = await portail.pdfPourEditeur(req.params.id);
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="${f.nom}"`);
  res.send(f.buffer);
}));

module.exports = router;
