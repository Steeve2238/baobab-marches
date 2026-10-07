const express = require("express");
const db = require("../db");
const { requireAuth, requireModuleAny, blockLectureSeule, exigerModuleFiscaliteActif } = require("../middleware/auth");
const { t } = require("../utils/i18n");
const tvaSvc = require("../services/fiscaliteTva");
const regimeSvc = require("../services/fiscaliteRegime");
const calendrierSvc = require("../services/fiscaliteCalendrier");
const exportsFisc = require("../services/fiscaliteExports");
const isSvc = require("../services/fiscaliteIs");
const exportsIs = require("../services/fiscaliteIsExports");
const importSvc = require("../services/fiscaliteImport");
const ccaSvc = require("../services/fiscaliteCca");
const celSvc = require("../services/fiscaliteCel");
const vehSvc = require("../services/fiscaliteVehicules");
const penalitesSvc = require("../services/fiscalitePenalites");
const conformiteSvc = require("../services/fiscaliteConformite");
const exportsLot5 = require("../services/fiscaliteLot5Exports");
const retenuesSvc = require("../services/fiscaliteRetenues");
const exportsRetenues = require("../services/fiscaliteRetenuesExports");
const comptesSvc = require("../services/fiscaliteComptes");
const retenuesComptaSvc = require("../services/fiscaliteRetenuesCompta");
const multer = require("multer");

const { FiscaliteError } = tvaSvc;

const router = express.Router();
router.use(requireAuth);
// Module vendu en option : verrouille tant que le Super Admin ne l'a pas active (migration 049).
router.use(exigerModuleFiscaliteActif);
// "fiscalite" = consultation + saisie du traitement fiscal des factures, des NINEA / COFI ;
// "fiscalite-validation" = en plus : preparer / deposer / payer une declaration, profil fiscal, suivi du calendrier.
router.use(requireModuleAny("fiscalite", "fiscalite-validation"));
router.use(blockLectureSeule);

const tenant = (req) => req.user.tenantId;

function aDroitValidation(req) {
  const p = req.user?.permissions;
  if (!p) return false;
  if (p.admin) return true;
  if ((p.modules || []).includes("fiscalite-validation")) return true;
  return !!p.validateurUniversel && (p.modules || []).includes("fiscalite");
}

function exigerValidation(req, res, next) {
  if (aDroitValidation(req)) return next();
  return res.status(403).json({ error: t(req, "FISCALITE_VALIDATION_FORBIDDEN") });
}

function gerer(fn) {
  return async (req, res) => {
    try {
      await fn(req, res);
    } catch (err) {
      if (err instanceof FiscaliteError) {
        return res.status(err.status || 400).json({ error: t(req, err.code), code: err.code, details: err.details });
      }
      console.error(err);
      res.status(500).json({ error: t(req, "FISCALITE_SERVER_ERROR") });
    }
  };
}

const entier = (v) => (v === undefined ? NaN : Number(v));

function periode(req) {
  const annee = entier(req.params.annee);
  const mois = entier(req.params.mois);
  if (!Number.isInteger(annee) || !Number.isInteger(mois) || mois < 1 || mois > 12 || annee < 2000 || annee > 2100) {
    throw new FiscaliteError("FISCALITE_PERIODE_INVALIDE");
  }
  return { annee, mois };
}

// ----------------------------------------------------------------------------
// Profil fiscal
// ----------------------------------------------------------------------------

router.get(
  "/profil",
  gerer(async (req, res) => {
    const profil = await tvaSvc.getProfil(db, tenant(req));
    const contribuable = await tvaSvc.getContribuable(tenant(req));
    res.json({ profil, contribuable });
  })
);

router.put(
  "/profil",
  exigerValidation,
  gerer(async (req, res) => {
    res.json(await tvaSvc.enregistrerProfil(tenant(req), req.body));
  })
);

// Detection du regime : COFI de l'entreprise + regime attendu d'apres le chiffre d'affaires (CGI).
router.get(
  "/regime",
  gerer(async (req, res) => {
    const annee = entier(req.query.annee);
    res.json(await regimeSvc.detecterEntreprise(tenant(req), Number.isInteger(annee) ? annee : undefined));
  })
);

// Lecture d'un COFI saisi (sans rien enregistrer) : utile pour l'aide a la saisie.
router.get(
  "/cofi/decoder",
  gerer(async (req, res) => {
    const { ninea, cofi } = regimeSvc.separerIdentifiant(req.query.ninea, req.query.cofi);
    res.json({ ninea, cofi, ninea_valide: ninea ? regimeSvc.neaValide(ninea) : null, decode: regimeSvc.decoderCofi(cofi) });
  })
);

// ----------------------------------------------------------------------------
// Tiers : NINEA, COFI, regime
// ----------------------------------------------------------------------------

router.get(
  "/tiers",
  gerer(async (req, res) => {
    res.json(await regimeSvc.listerTiers(tenant(req)));
  })
);

router.patch(
  "/tiers/:type/:id",
  gerer(async (req, res) => {
    const type = String(req.params.type || "").toUpperCase();
    res.json(await regimeSvc.majIdentiteTiers(tenant(req), type, req.params.id, req.body));
  })
);

router.post(
  "/tiers/deduire-regimes",
  gerer(async (req, res) => {
    res.json({ mis_a_jour: await regimeSvc.deduireRegimesDepuisCofi(tenant(req)) });
  })
);

// ----------------------------------------------------------------------------
// TVA
// ----------------------------------------------------------------------------

router.get(
  "/tva/:annee",
  gerer(async (req, res) => {
    const annee = entier(req.params.annee);
    if (!Number.isInteger(annee) || annee < 2000 || annee > 2100) throw new FiscaliteError("FISCALITE_PERIODE_INVALIDE");
    res.json(await tvaSvc.listerAnnee(tenant(req), annee));
  })
);

function saisiesDepuis(source) {
  const s = source || {};
  return {
    source_tva: s.source_tva,
    L10: s.L10,
    L15: s.L15,
    L20: s.L20,
    L30: s.L30,
    L75: s.L75,
    L95: s.L95,
    L120: s.L120,
    credit_precedent: s.credit_precedent,
  };
}

// Calcul en direct (rien n'est enregistre). Les lignes saisies a la main peuvent venir de la requete
// (?L30=..&L75=..) ou, a defaut, de la declaration deja preparee.
router.get(
  "/tva/:annee/:mois",
  gerer(async (req, res) => {
    const { annee, mois } = periode(req);
    const declaration = await tvaSvc.getDeclaration(tenant(req), annee, mois);
    const saisiesRequete = saisiesDepuis(req.query);
    const aSaisies = Object.values(saisiesRequete).some((v) => v !== undefined);
    const saisies = aSaisies ? saisiesRequete : declaration ? declaration.saisies : {};
    const calcul = await tvaSvc.calculer(tenant(req), annee, mois, saisies);
    let differe = false;
    if (declaration && declaration.statut !== "PREPAREE") {
      differe = ["110", "115", "60", "91"].some((k) => Number(declaration.lignes[k] || 0) !== Number(calcul.lignes[k] || 0));
    }
    res.json({ calcul, declaration, live_differe_de_declaration: differe });
  })
);

router.post(
  "/tva/:annee/:mois/preparer",
  exigerValidation,
  gerer(async (req, res) => {
    const { annee, mois } = periode(req);
    const decl = await tvaSvc.preparer(tenant(req), req.user.sub, annee, mois, saisiesDepuis(req.body));
    res.status(201).json(decl);
  })
);

router.post(
  "/tva/:annee/:mois/statut",
  exigerValidation,
  gerer(async (req, res) => {
    const { annee, mois } = periode(req);
    res.json(await tvaSvc.changerStatut(tenant(req), annee, mois, req.body));
  })
);

async function raisonSociale(req) {
  return (await tvaSvc.getContribuable(tenant(req))).raison_sociale;
}

router.get(
  "/tva/:annee/:mois/export",
  gerer(async (req, res) => {
    const { annee, mois } = periode(req);
    const format = req.query.format === "xlsx" ? "xlsx" : "pdf";
    const declaration = await tvaSvc.getDeclaration(tenant(req), annee, mois);
    const gelee = declaration && declaration.statut !== "PREPAREE";
    const calcul = await tvaSvc.calculer(tenant(req), annee, mois, declaration ? declaration.saisies : saisiesDepuis(req.query));
    const buffer = format === "pdf" ? await exportsFisc.tvaPdf(calcul, gelee ? declaration : null) : exportsFisc.tvaXlsx(calcul, gelee ? declaration : null);
    res.setHeader("Content-Type", format === "pdf" ? "application/pdf" : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename="declaration_tva_${annee}_${String(mois).padStart(2, "0")}.${format}"`);
    res.send(buffer);
  })
);

// Traitement fiscal d'une facture de vente (code d'operation, precompte) ou d'achat (local / import, deductibilite).
router.patch(
  "/ventes/:id",
  gerer(async (req, res) => {
    await tvaSvc.majVente(tenant(req), req.params.id, req.body);
    res.json({ ok: true });
  })
);

router.patch(
  "/achats/:id",
  gerer(async (req, res) => {
    await tvaSvc.majAchat(tenant(req), req.params.id, req.body);
    res.json({ ok: true });
  })
);

// ----------------------------------------------------------------------------
// Impot sur les societes / impot minimum forfaitaire
// ----------------------------------------------------------------------------

function anneeParam(req) {
  const annee = entier(req.params.annee);
  if (!Number.isInteger(annee) || annee < 2000 || annee > 2100) throw new FiscaliteError("FISCALITE_PERIODE_INVALIDE");
  return annee;
}

router.get(
  "/is",
  gerer(async (req, res) => {
    res.json({ annees: await isSvc.listerAnnees(tenant(req)), deficits: await isSvc.listerDeficits(tenant(req)), parametres_defaut: isSvc.PARAMETRES_DEFAUT, types_manuels: isSvc.TYPES_MANUELS });
  })
);

router.post(
  "/is/deficits",
  exigerValidation,
  gerer(async (req, res) => {
    await isSvc.ajouterDeficit(tenant(req), req.body);
    res.status(201).json({ deficits: await isSvc.listerDeficits(tenant(req)) });
  })
);

router.delete(
  "/is/deficits/:id",
  exigerValidation,
  gerer(async (req, res) => {
    await isSvc.supprimerDeficit(tenant(req), req.params.id);
    res.json({ deficits: await isSvc.listerDeficits(tenant(req)) });
  })
);

router.delete(
  "/is/paiements/:id",
  exigerValidation,
  gerer(async (req, res) => {
    await isSvc.supprimerPaiement(tenant(req), req.params.id);
    res.json({ ok: true });
  })
);

// Calcul en direct (rien n'est enregistre). Les saisies viennent du corps (POST) ou, a defaut, du dossier enregistre.
router.get(
  "/is/:annee",
  gerer(async (req, res) => {
    const annee = anneeParam(req);
    const dossier = await isSvc.getDossier(tenant(req), annee);
    const calcul = await isSvc.calculer(tenant(req), annee);
    const gele = dossier && (dossier.statut === "DEPOSEE" || dossier.statut === "PAYEE");
    const differe = !!(gele && dossier.calcul && (Number(dossier.calcul.impot_du) !== Number(calcul.impot_du) || Number(dossier.calcul.resultat_fiscal_imposable) !== Number(calcul.resultat_fiscal_imposable)));
    res.json({ calcul, dossier, live_differe_du_depot: differe });
  })
);

router.post(
  "/is/:annee/simuler",
  gerer(async (req, res) => {
    res.json({ calcul: await isSvc.calculer(tenant(req), anneeParam(req), req.body && req.body.saisies) });
  })
);

router.put(
  "/is/:annee/saisies",
  exigerValidation,
  gerer(async (req, res) => {
    const annee = anneeParam(req);
    await isSvc.enregistrerSaisies(tenant(req), annee, req.body && req.body.saisies);
    res.json({ calcul: await isSvc.calculer(tenant(req), annee), dossier: await isSvc.getDossier(tenant(req), annee) });
  })
);

router.post(
  "/is/:annee/preparer",
  exigerValidation,
  gerer(async (req, res) => {
    res.status(201).json(await isSvc.preparer(tenant(req), req.user.sub, anneeParam(req), req.body && req.body.saisies));
  })
);

router.post(
  "/is/:annee/statut",
  exigerValidation,
  gerer(async (req, res) => {
    res.json(await isSvc.changerStatut(tenant(req), anneeParam(req), req.body));
  })
);

router.post(
  "/is/:annee/paiements",
  exigerValidation,
  gerer(async (req, res) => {
    const annee = anneeParam(req);
    await isSvc.ajouterPaiement(tenant(req), req.user.sub, annee, req.body);
    res.status(201).json({ paiements: await isSvc.listerPaiements(tenant(req), annee) });
  })
);

router.get(
  "/is/:annee/export",
  gerer(async (req, res) => {
    const annee = anneeParam(req);
    const format = req.query.format === "xlsx" ? "xlsx" : "pdf";
    const dossier = await isSvc.getDossier(tenant(req), annee);
    const gele = dossier && (dossier.statut === "DEPOSEE" || dossier.statut === "PAYEE") && dossier.calcul;
    const calcul = gele ? dossier.calcul : await isSvc.calculer(tenant(req), annee);
    const contribuable = await tvaSvc.getContribuable(tenant(req));
    const deficits = await isSvc.listerDeficits(tenant(req));
    const buffer = format === "pdf" ? await exportsIs.isPdf(calcul, contribuable, dossier, deficits) : exportsIs.isXlsx(calcul, contribuable, dossier, deficits);
    res.setHeader("Content-Type", format === "pdf" ? "application/pdf" : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename="calcul_is_${annee}.${format}"`);
    res.send(buffer);
  })
);

// ----------------------------------------------------------------------------
// Donnees importees (fiscalite utilisable sans le module Comptabilite) et comptes courants d'associes
// ----------------------------------------------------------------------------

const uploadFiscal = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024, files: 1 } }).single("fichier");
function recevoirFichier(req, res, next) {
  uploadFiscal(req, res, (err) => {
    if (err) return res.status(400).json({ error: t(req, "FISCALITE_IMPORT_FICHIER_INVALIDE") });
    if (!req.file) return res.status(400).json({ error: t(req, "FISCALITE_IMPORT_FICHIER_REQUIS") });
    next();
  });
}
const NATURES_URL = { balance: "BALANCE", "grand-livre": "GRAND_LIVRE" };

function envoyerXlsx(res, buffer, nom) {
  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.setHeader("Content-Disposition", `attachment; filename="${nom}"`);
  res.send(buffer);
}

router.get(
  "/import",
  gerer(async (req, res) => {
    res.json({ jeux: await importSvc.lister(tenant(req)) });
  })
);

router.get(
  "/import/modele/:type",
  gerer(async (req, res) => {
    if (req.params.type === "associes") return envoyerXlsx(res, importSvc.modeleAssocies(), "modele_associes_comptes_courants.xlsx");
    if (req.params.type === "balance") return envoyerXlsx(res, importSvc.modeleBalance(), "modele_balance_fiscalite.xlsx");
    throw new FiscaliteError("FISCALITE_CODE_INVALIDE");
  })
);

router.post(
  "/import/associes/apercu",
  recevoirFichier,
  gerer(async (req, res) => {
    res.json(importSvc.analyserAssocies(req.file.buffer));
  })
);

router.post(
  "/import/:type/apercu",
  recevoirFichier,
  gerer(async (req, res) => {
    const nature = NATURES_URL[req.params.type];
    if (!nature) throw new FiscaliteError("FISCALITE_CODE_INVALIDE");
    const { _analyse, ...r } = importSvc.apercu(nature, req.file.buffer, { annee: req.body.annee, date_debut: req.body.date_debut, date_fin: req.body.date_fin });
    void _analyse;
    res.json(r);
  })
);

router.post(
  "/import/:type",
  exigerValidation,
  recevoirFichier,
  gerer(async (req, res) => {
    const nature = NATURES_URL[req.params.type];
    if (!nature) throw new FiscaliteError("FISCALITE_CODE_INVALIDE");
    const r = await importSvc.importer(tenant(req), req.user.sub, {
      nature,
      role: req.body.role,
      annee: req.body.annee,
      date_debut: req.body.date_debut,
      date_fin: req.body.date_fin,
      buffer: req.file.buffer,
      nomFichier: req.file.originalname,
    });
    res.status(201).json(r);
  })
);

router.delete(
  "/import/:id",
  exigerValidation,
  gerer(async (req, res) => {
    await importSvc.supprimer(tenant(req), req.params.id);
    res.json({ ok: true });
  })
);

router.get(
  "/cca/reports",
  gerer(async (req, res) => {
    res.json({ reports: await ccaSvc.listerReports(tenant(req)) });
  })
);

router.post(
  "/cca/reports",
  exigerValidation,
  gerer(async (req, res) => {
    await ccaSvc.ajouterReport(tenant(req), req.body || {});
    res.status(201).json({ reports: await ccaSvc.listerReports(tenant(req)) });
  })
);

router.delete(
  "/cca/reports/:id",
  exigerValidation,
  gerer(async (req, res) => {
    await ccaSvc.supprimerReport(tenant(req), req.params.id);
    res.json({ reports: await ccaSvc.listerReports(tenant(req)) });
  })
);

// ----------------------------------------------------------------------------
// Contribution economique locale (locaux professionnels + valeur ajoutee)
// ----------------------------------------------------------------------------

router.get(
  "/cel",
  gerer(async (req, res) => {
    res.json({
      annees: await celSvc.listerAnnees(tenant(req)),
      locaux: await celSvc.listerLocaux(tenant(req)),
      natures: celSvc.NATURES,
      regimes: Object.keys(celSvc.REGIMES),
      parametres_defaut: celSvc.PARAMETRES_DEFAUT,
    });
  })
);

router.post(
  "/cel/locaux",
  exigerValidation,
  gerer(async (req, res) => {
    await celSvc.ajouterLocal(tenant(req), req.body || {});
    res.status(201).json({ locaux: await celSvc.listerLocaux(tenant(req)) });
  })
);

router.put(
  "/cel/locaux/:id",
  exigerValidation,
  gerer(async (req, res) => {
    await celSvc.modifierLocal(tenant(req), req.params.id, req.body || {});
    res.json({ locaux: await celSvc.listerLocaux(tenant(req)) });
  })
);

router.delete(
  "/cel/locaux/:id",
  exigerValidation,
  gerer(async (req, res) => {
    await celSvc.supprimerLocal(tenant(req), req.params.id);
    res.json({ locaux: await celSvc.listerLocaux(tenant(req)) });
  })
);

router.get(
  "/cel/:annee",
  gerer(async (req, res) => {
    res.json(await celSvc.getAnnee(tenant(req), anneeParam(req)));
  })
);

router.post(
  "/cel/:annee/simuler",
  gerer(async (req, res) => {
    res.json({ calcul: await celSvc.simuler(tenant(req), anneeParam(req), req.body && req.body.saisies) });
  })
);

router.put(
  "/cel/:annee/saisies",
  exigerValidation,
  gerer(async (req, res) => {
    const annee = anneeParam(req);
    await celSvc.enregistrerSaisies(tenant(req), annee, req.body && req.body.saisies);
    res.json(await celSvc.getAnnee(tenant(req), annee));
  })
);

router.post(
  "/cel/:annee/preparer",
  exigerValidation,
  gerer(async (req, res) => {
    res.status(201).json(await celSvc.preparer(tenant(req), req.user.sub, anneeParam(req), req.body && req.body.saisies));
  })
);

router.post(
  "/cel/:annee/statut",
  exigerValidation,
  gerer(async (req, res) => {
    res.json(await celSvc.changerStatut(tenant(req), anneeParam(req), req.body || {}));
  })
);

router.get(
  "/cel/:annee/export",
  gerer(async (req, res) => {
    const annee = anneeParam(req);
    const format = req.query.format === "xlsx" ? "xlsx" : "pdf";
    const { dossier, calcul } = await celSvc.getAnnee(tenant(req), annee);
    const contribuable = await tvaSvc.getContribuable(tenant(req));
    const buffer = format === "pdf" ? await exportsLot5.celPdf(calcul, contribuable, dossier) : exportsLot5.celXlsx(calcul, contribuable, dossier);
    res.setHeader("Content-Type", format === "pdf" ? "application/pdf" : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename="cel_${annee}.${format}"`);
    res.send(buffer);
  })
);

// ----------------------------------------------------------------------------
// Taxe speciale sur les voitures particulieres des personnes morales
// ----------------------------------------------------------------------------

router.get(
  "/vehicules",
  gerer(async (req, res) => {
    res.json({
      annees: await vehSvc.listerAnnees(tenant(req)),
      vehicules: await vehSvc.listerVehicules(tenant(req)),
      suggestions_parc_auto: await vehSvc.suggestionsParcAuto(tenant(req)),
      tarifs: vehSvc.TARIFS,
      modes: vehSvc.MODES,
      exonerations: vehSvc.EXONERATIONS,
    });
  })
);

router.post(
  "/vehicules",
  exigerValidation,
  gerer(async (req, res) => {
    await vehSvc.ajouterVehicule(tenant(req), req.body || {});
    res.status(201).json({ vehicules: await vehSvc.listerVehicules(tenant(req)), suggestions_parc_auto: await vehSvc.suggestionsParcAuto(tenant(req)) });
  })
);

router.put(
  "/vehicules/:id",
  exigerValidation,
  gerer(async (req, res) => {
    await vehSvc.modifierVehicule(tenant(req), req.params.id, req.body || {});
    res.json({ vehicules: await vehSvc.listerVehicules(tenant(req)), suggestions_parc_auto: await vehSvc.suggestionsParcAuto(tenant(req)) });
  })
);

router.delete(
  "/vehicules/:id",
  exigerValidation,
  gerer(async (req, res) => {
    await vehSvc.supprimerVehicule(tenant(req), req.params.id);
    res.json({ vehicules: await vehSvc.listerVehicules(tenant(req)), suggestions_parc_auto: await vehSvc.suggestionsParcAuto(tenant(req)) });
  })
);

router.get(
  "/vehicules/annee/:annee",
  gerer(async (req, res) => {
    res.json(await vehSvc.getAnnee(tenant(req), anneeParam(req)));
  })
);

router.post(
  "/vehicules/annee/:annee/preparer",
  exigerValidation,
  gerer(async (req, res) => {
    res.status(201).json(await vehSvc.preparer(tenant(req), req.user.sub, anneeParam(req)));
  })
);

router.post(
  "/vehicules/annee/:annee/statut",
  exigerValidation,
  gerer(async (req, res) => {
    res.json(await vehSvc.changerStatut(tenant(req), anneeParam(req), req.body || {}));
  })
);

router.get(
  "/vehicules/annee/:annee/export",
  gerer(async (req, res) => {
    const annee = anneeParam(req);
    const format = req.query.format === "xlsx" ? "xlsx" : "pdf";
    const { dossier, calcul } = await vehSvc.getAnnee(tenant(req), annee);
    const contribuable = await tvaSvc.getContribuable(tenant(req));
    const buffer = format === "pdf" ? await exportsLot5.vehPdf(calcul, contribuable, dossier) : exportsLot5.vehXlsx(calcul, contribuable, dossier);
    res.setHeader("Content-Type", format === "pdf" ? "application/pdf" : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename="taxe_voitures_${annee}.${format}"`);
    res.send(buffer);
  })
);

// ----------------------------------------------------------------------------
// Controles de conformite / preparation a la facturation electronique
// ----------------------------------------------------------------------------

router.get(
  "/conformite/:annee",
  gerer(async (req, res) => {
    res.json(await conformiteSvc.analyser(tenant(req), anneeParam(req)));
  })
);

// Estimateur de penalites detaille (indicatif)
router.post(
  "/penalites/estimer",
  gerer(async (req, res) => {
    res.json(penalitesSvc.estimer(req.body || {}));
  })
);

// ----------------------------------------------------------------------------
// Retenues a la source (lot 4) : prestataires, loyers, non-residents, revenus de capitaux mobiliers
// ----------------------------------------------------------------------------

const moisParam = (req) => entier(req.params.mois);
const MIME_XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

router.get(
  "/retenues/resume/:annee",
  gerer(async (req, res) => {
    res.json(await retenuesSvc.resumeAnnee(tenant(req), anneeParam(req)));
  })
);

router.get(
  "/retenues/modele",
  gerer(async (req, res) => {
    envoyerXlsx(res, retenuesSvc.modeleImport(), "modele_retenues_a_la_source.xlsx");
  })
);

router.post(
  "/retenues/import/apercu",
  recevoirFichier,
  gerer(async (req, res) => {
    res.json(await retenuesSvc.apercuImport(req.file.buffer));
  })
);

router.post(
  "/retenues/import",
  exigerValidation,
  recevoirFichier,
  gerer(async (req, res) => {
    res.status(201).json(await retenuesSvc.importer(tenant(req), req.user.sub, req.file.buffer));
  })
);

router.post(
  "/retenues/propositions-cca/:annee",
  exigerValidation,
  gerer(async (req, res) => {
    res.json(await retenuesSvc.rechercherPropositionsCca(tenant(req), req.user.sub, anneeParam(req)));
  })
);

router.get(
  "/retenues/trimestre/:annee/:trimestre",
  gerer(async (req, res) => {
    res.json(await retenuesSvc.etatTrimestriel(tenant(req), anneeParam(req), entier(req.params.trimestre)));
  })
);

router.get(
  "/retenues/trimestre/:annee/:trimestre/export",
  gerer(async (req, res) => {
    const annee = anneeParam(req);
    const trimestre = entier(req.params.trimestre);
    const format = req.query.format === "xlsx" ? "xlsx" : "pdf";
    const etat = await retenuesSvc.etatTrimestriel(tenant(req), annee, trimestre);
    const contribuable = await tvaSvc.getContribuable(tenant(req));
    const buffer = format === "pdf" ? await exportsRetenues.trimestrielPdf(etat, contribuable) : exportsRetenues.trimestrielXlsx(etat, contribuable);
    res.setHeader("Content-Type", format === "pdf" ? "application/pdf" : MIME_XLSX);
    res.setHeader("Content-Disposition", `attachment; filename="etat_trimestriel_retenues_${annee}_T${trimestre}.${format}"`);
    res.send(buffer);
  })
);

router.get(
  "/retenues/periode/:annee/:mois",
  gerer(async (req, res) => {
    res.json(await retenuesSvc.getPeriode(tenant(req), anneeParam(req), moisParam(req)));
  })
);

router.post(
  "/retenues/periode/:annee/:mois/propositions",
  exigerValidation,
  gerer(async (req, res) => {
    res.json(await retenuesSvc.rechercherPropositionsPlateforme(tenant(req), req.user.sub, anneeParam(req), moisParam(req)));
  })
);

router.post(
  "/retenues/periode/:annee/:mois/propositions-compta",
  exigerValidation,
  gerer(async (req, res) => {
    res.json(await retenuesComptaSvc.analyserMois(tenant(req), req.user.sub, anneeParam(req), moisParam(req)));
  })
);

router.post(
  "/retenues/periode/:annee/:mois/confirmer-coherentes",
  exigerValidation,
  gerer(async (req, res) => {
    res.json(await retenuesComptaSvc.confirmerCoherentes(tenant(req), anneeParam(req), moisParam(req)));
  })
);

// Comptes comptables lus par les calculs de la fiscalite (retenues, TVA, IS, CEL), parametrables selon le plan comptable.
router.get(
  "/comptes",
  gerer(async (req, res) => {
    res.json({ comptes: await comptesSvc.getDetail(tenant(req)) });
  })
);

router.put(
  "/comptes",
  exigerValidation,
  gerer(async (req, res) => {
    res.json({ comptes: await comptesSvc.enregistrer(tenant(req), req.body || {}) });
  })
);

router.get(
  "/retenues/parametres",
  gerer(async (req, res) => {
    res.json(await retenuesSvc.getParametres(tenant(req)));
  })
);

router.put(
  "/retenues/parametres",
  exigerValidation,
  gerer(async (req, res) => {
    res.json(await retenuesSvc.enregistrerParametres(tenant(req), req.body || {}));
  })
);

router.post(
  "/retenues/periode/:annee/:mois/preparer",
  exigerValidation,
  gerer(async (req, res) => {
    res.json(await retenuesSvc.preparer(tenant(req), req.user.sub, anneeParam(req), moisParam(req)));
  })
);

router.post(
  "/retenues/periode/:annee/:mois/statut",
  exigerValidation,
  gerer(async (req, res) => {
    res.json(await retenuesSvc.changerStatut(tenant(req), anneeParam(req), moisParam(req), req.body || {}));
  })
);

router.get(
  "/retenues/periode/:annee/:mois/rapprochement",
  gerer(async (req, res) => {
    res.json(await retenuesSvc.rapprochement(tenant(req), anneeParam(req), moisParam(req)));
  })
);

router.get(
  "/retenues/periode/:annee/:mois/export",
  gerer(async (req, res) => {
    const annee = anneeParam(req);
    const mois = moisParam(req);
    const format = req.query.format === "xlsx" ? "xlsx" : "pdf";
    const vue = await retenuesSvc.getPeriode(tenant(req), annee, mois);
    const contribuable = await tvaSvc.getContribuable(tenant(req));
    const buffer = format === "pdf" ? await exportsRetenues.mensuelPdf(vue, contribuable) : exportsRetenues.mensuelXlsx(vue, contribuable);
    res.setHeader("Content-Type", format === "pdf" ? "application/pdf" : MIME_XLSX);
    res.setHeader("Content-Disposition", `attachment; filename="retenues_${annee}_${String(mois).padStart(2, "0")}.${format}"`);
    res.send(buffer);
  })
);

router.post(
  "/retenues/operations",
  exigerValidation,
  gerer(async (req, res) => {
    res.status(201).json({ operation: await retenuesSvc.creer(tenant(req), req.user.sub, req.body || {}) });
  })
);

router.put(
  "/retenues/operations/:id",
  exigerValidation,
  gerer(async (req, res) => {
    res.json({ operation: await retenuesSvc.modifier(tenant(req), req.params.id, req.body || {}) });
  })
);

router.delete(
  "/retenues/operations/:id",
  exigerValidation,
  gerer(async (req, res) => {
    await retenuesSvc.supprimer(tenant(req), req.params.id);
    res.json({ ok: true });
  })
);

// ----------------------------------------------------------------------------
// Calendrier fiscal
// ----------------------------------------------------------------------------

router.get(
  "/calendrier/:annee",
  gerer(async (req, res) => {
    const annee = entier(req.params.annee);
    if (!Number.isInteger(annee) || annee < 2000 || annee > 2100) throw new FiscaliteError("FISCALITE_PERIODE_INVALIDE");
    res.json(await calendrierSvc.lister(tenant(req), annee));
  })
);

router.get(
  "/synthese",
  gerer(async (req, res) => {
    const annee = entier(req.query.annee);
    res.json(await calendrierSvc.synthese(tenant(req), Number.isInteger(annee) ? annee : new Date().getFullYear()));
  })
);

router.put(
  "/calendrier/suivi/:cle",
  exigerValidation,
  gerer(async (req, res) => {
    await calendrierSvc.majSuivi(tenant(req), req.user.sub, req.params.cle, req.body);
    res.json({ ok: true });
  })
);

// Estimateur de penalites (indicatif) : ?montant=..&jours=..&type=TVA|AUTRE&deposee=1
router.get(
  "/penalites",
  gerer(async (req, res) => {
    res.json(
      calendrierSvc.estimerPenalites({
        montant: Number(req.query.montant),
        jours_retard: Number(req.query.jours),
        type: req.query.type === "AUTRE" ? "AUTRE" : "TVA",
        declaration_deposee: req.query.deposee === "1",
      })
    );
  })
);

module.exports = router;
