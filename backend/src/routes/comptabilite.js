const express = require("express");
const db = require("../db");
const { requireAuth, requireModuleAny, blockLectureSeule, exigerModuleComptabiliteActif } = require("../middleware/auth");
const { t } = require("../utils/i18n");
const compta = require("../services/comptaService");
const rapports = require("../services/comptaRapports");
const exportsCompta = require("../services/comptaExports");
const ventesCompta = require("../services/comptaVentes");
const importCompta = require("../services/comptaImport");
const multer = require("multer");

const { ComptaError, avecTransaction } = compta;

const router = express.Router();
router.use(requireAuth);
// Module vendu en option : verrouille tant que le Super Admin ne l'a pas active (migration 032).
router.use(exigerModuleComptabiliteActif);
// Acces au module : "comptabilite" (consultation + saisie) ou
// "comptabilite-validation" (en plus : validation, extourne, plan comptable,
// parametres, exercices) - voir migration 028 et ecran Roles. ADMIN a tout.
router.use(requireModuleAny("comptabilite", "comptabilite-validation"));

/**
 * Niveau "validation" : ADMIN, ou "comptabilite-validation" dans le perimetre
 * du role, ou validateur universel (DG / Directeur Financier) disposant deja
 * de "comptabilite" - meme convention que la validation des devis (voir
 * routes/ventes.js).
 */
function aDroitValidation(req) {
  const p = req.user?.permissions;
  if (!p) return false;
  if (p.admin) return true;
  if ((p.modules || []).includes("comptabilite-validation")) return true;
  return !!p.validateurUniversel && (p.modules || []).includes("comptabilite");
}

function exigerValidation(req, res, next) {
  if (aDroitValidation(req)) return next();
  return res.status(403).json({ error: t(req, "COMPTA_VALIDATION_FORBIDDEN") });
}

/** Message traduit, avec les precisions utiles (numero de ligne, montants...). */
function messageErreur(req, err) {
  let msg = t(req, err.code);
  const d = err.details || {};
  const precisions = [];
  if (d.ligne !== undefined) precisions.push(`${t(req, "COMPTA_DETAIL_LIGNE")} ${d.ligne}`);
  if (d.numero !== undefined) precisions.push(`${t(req, "COMPTA_DETAIL_COMPTE")} ${d.numero}`);
  if (d.debit !== undefined) precisions.push(`${t(req, "COMPTA_DETAIL_DEBIT")} ${d.debit} / ${t(req, "COMPTA_DETAIL_CREDIT")} ${d.credit}`);
  if (d.longueur !== undefined) precisions.push(`${d.longueur}`);
  if (d.nombre !== undefined) precisions.push(`${d.nombre}`);
  if (d.libelle !== undefined) precisions.push(`${d.libelle}`);
  if (precisions.length) msg += ` (${precisions.join(" ; ")})`;
  return msg;
}

/** Enveloppe de route : erreurs metier -> statut + message traduit ; le reste -> 500. */
function gerer(fn, cleErreurServeur = "COMPTA_SERVER_ERROR") {
  return async (req, res) => {
    try {
      await fn(req, res);
    } catch (err) {
      if (err instanceof ComptaError || err instanceof rapports.RapportError) {
        return res.status(err.status || 400).json({ error: messageErreur(req, err), code: err.code });
      }
      if (err && err.code === "23505") {
        return res.status(409).json({ error: t(req, "COMPTA_DOUBLON") });
      }
      console.error(err);
      res.status(500).json({ error: t(req, cleErreurServeur) });
    }
  };
}

const tenant = (req) => req.user.tenantId;
const userId = (req) => req.user.sub;
const vrai = (v) => v === "true" || v === "1" || v === true;

// ----------------------------------------------------------------------------
// Etat du module
// ----------------------------------------------------------------------------

router.get(
  "/statut",
  gerer(async (req, res) => {
    const parametre = await compta.getParametre(db, tenant(req));
    const initialisee = !!(parametre && parametre.initialisee);
    let enAttente = { brouillons: 0, en_instance: 0 };
    if (initialisee) {
      const r = await db.query(
        `SELECT COUNT(*) FILTER (WHERE statut = 'BROUILLON')::int AS brouillons,
                COUNT(*) FILTER (WHERE statut = 'EN_INSTANCE')::int AS en_instance
         FROM ecriture_comptable WHERE tenant_id = $1`,
        [tenant(req)]
      );
      enAttente = r.rows[0];
    }
    res.json({
      initialisee,
      parametre,
      droits: { validation: aDroitValidation(req), ecriture: !req.user.permissions?.lectureSeule || !!req.user.permissions?.admin },
      en_attente: enAttente,
    });
  })
);

router.get(
  "/parametres",
  gerer(async (req, res) => {
    res.json(await compta.getParametre(db, tenant(req)));
  })
);

router.post(
  "/initialiser",
  exigerValidation,
  gerer(async (req, res) => {
    const body = req.body || {};
    const resultat = await avecTransaction((client) =>
      compta.initialiserComptabilite(client, tenant(req), userId(req), {
        longueur_compte: body.longueur_compte ? Number(body.longueur_compte) : undefined,
        date_debut: body.date_debut || undefined,
        date_fin: body.date_fin || undefined,
        libelle_exercice: body.libelle_exercice || undefined,
      })
    );
    res.status(201).json(resultat);
  })
);

router.patch(
  "/parametres",
  exigerValidation,
  gerer(async (req, res) => {
    res.json(await avecTransaction((client) => compta.modifierParametre(client, tenant(req), userId(req), req.body || {})));
  })
);

// ----------------------------------------------------------------------------
// Exercices
// ----------------------------------------------------------------------------

router.get(
  "/exercices",
  gerer(async (req, res) => {
    const r = await db.query(
      `SELECT x.*,
              (SELECT COUNT(*)::int FROM ecriture_comptable e WHERE e.exercice_id = x.id) AS nb_ecritures,
              (SELECT COUNT(*)::int FROM ecriture_comptable e WHERE e.exercice_id = x.id AND e.statut <> 'VALIDEE') AS nb_en_attente
       FROM exercice_comptable x WHERE x.tenant_id = $1 ORDER BY x.date_debut DESC`,
      [tenant(req)]
    );
    res.json(r.rows);
  })
);

router.post(
  "/exercices",
  exigerValidation,
  gerer(async (req, res) => {
    const ex = await avecTransaction(async (client) => {
      await compta.exigerInitialise(client, tenant(req));
      return compta.creerExercice(client, tenant(req), userId(req), req.body || {});
    });
    res.status(201).json(ex);
  })
);

router.post(
  "/exercices/:id/cloturer",
  exigerValidation,
  gerer(async (req, res) => {
    res.json(await avecTransaction((client) => compta.cloturerExercice(client, tenant(req), userId(req), req.params.id)));
  })
);

router.post(
  "/exercices/:id/rouvrir",
  exigerValidation,
  gerer(async (req, res) => {
    res.json(await avecTransaction((client) => compta.rouvrirExercice(client, tenant(req), userId(req), req.params.id)));
  })
);

// ----------------------------------------------------------------------------
// Journaux
// ----------------------------------------------------------------------------

router.get(
  "/journaux",
  gerer(async (req, res) => {
    const r = await db.query(`SELECT * FROM journal_comptable WHERE tenant_id = $1 ORDER BY code`, [tenant(req)]);
    res.json(r.rows);
  })
);

router.post(
  "/journaux",
  exigerValidation,
  gerer(async (req, res) => {
    const j = await avecTransaction(async (client) => {
      await compta.exigerInitialise(client, tenant(req));
      return compta.creerJournal(client, tenant(req), userId(req), req.body || {});
    });
    res.status(201).json(j);
  })
);

router.patch(
  "/journaux/:id",
  exigerValidation,
  gerer(async (req, res) => {
    res.json(await avecTransaction((client) => compta.modifierJournal(client, tenant(req), userId(req), req.params.id, req.body || {})));
  })
);

// ----------------------------------------------------------------------------
// Plan comptable
// ----------------------------------------------------------------------------

router.get(
  "/comptes",
  gerer(async (req, res) => {
    const { q, classe, nature, actif, limit } = req.query;
    const params = [tenant(req)];
    let filtre = "";
    if (q) {
      params.push(`%${String(q).toLowerCase()}%`);
      filtre += ` AND (numero LIKE $${params.length} OR lower(libelle) LIKE $${params.length})`;
    }
    if (classe) {
      params.push(Number(classe));
      filtre += ` AND classe = $${params.length}`;
    }
    if (nature) {
      params.push(String(nature));
      filtre += ` AND nature = $${params.length}`;
    }
    if (actif === "true" || actif === "false") {
      params.push(actif === "true");
      filtre += ` AND actif = $${params.length}`;
    }
    const plafond = Math.min(Number(limit) || 2000, 5000);
    const r = await db.query(
      `SELECT c.*,
              EXISTS (SELECT 1 FROM ligne_ecriture l WHERE l.compte_id = c.id) AS utilise
       FROM compte_comptable c WHERE c.tenant_id = $1 ${filtre} ORDER BY c.numero LIMIT ${plafond}`,
      params
    );
    res.json(r.rows);
  })
);

router.get(
  "/comptes/prochain-numero",
  gerer(async (req, res) => {
    const numero = await compta.prochainNumeroCompte(db, tenant(req), req.query.parent);
    res.json({ numero });
  })
);

// Creation d'un compte : niveau "saisie" (non sensible, rien d'existant n'est modifie).
router.post(
  "/comptes",
  blockLectureSeule,
  gerer(async (req, res) => {
    const c = await avecTransaction((client) => compta.creerCompte(client, tenant(req), userId(req), req.body || {}));
    res.status(201).json(c);
  })
);

// Modification / desactivation d'un compte existant : accord du niveau "validation".
router.patch(
  "/comptes/:id",
  exigerValidation,
  gerer(async (req, res) => {
    res.json(await avecTransaction((client) => compta.modifierCompte(client, tenant(req), userId(req), req.params.id, req.body || {})));
  })
);

// ----------------------------------------------------------------------------
// Tiers
// ----------------------------------------------------------------------------

router.get(
  "/tiers",
  gerer(async (req, res) => {
    const { type, q } = req.query;
    const params = [tenant(req)];
    let filtre = "";
    if (type) {
      params.push(String(type));
      filtre += ` AND type_tiers = $${params.length}`;
    }
    if (q) {
      params.push(`%${String(q).toLowerCase()}%`);
      filtre += ` AND (lower(code) LIKE $${params.length} OR lower(nom) LIKE $${params.length})`;
    }
    const r = await db.query(`SELECT * FROM tiers_comptable WHERE tenant_id = $1 ${filtre} ORDER BY code`, params);
    res.json(r.rows);
  })
);

router.post(
  "/tiers/synchroniser",
  blockLectureSeule,
  gerer(async (req, res) => {
    const crees = await avecTransaction(async (client) => {
      await compta.exigerInitialise(client, tenant(req));
      return compta.synchroniserTiers(client, tenant(req));
    });
    res.json({ crees });
  })
);

// ----------------------------------------------------------------------------
// Ecritures
// ----------------------------------------------------------------------------

router.get(
  "/ecritures",
  gerer(async (req, res) => {
    const { exercice_id, journal_id, statut, date_debut, date_fin, q, compte_numero } = req.query;
    const params = [tenant(req)];
    let filtre = "";
    const ajoute = (sql, valeur) => {
      params.push(valeur);
      filtre += ` ${sql.split("$#").join(`$${params.length}`)}`;
    };
    if (exercice_id) ajoute("AND e.exercice_id = $#", exercice_id);
    if (journal_id) ajoute("AND e.journal_id = $#", journal_id);
    if (statut) ajoute("AND e.statut = $#", statut);
    if (date_debut) ajoute("AND e.date_ecriture >= $#::date", date_debut);
    if (date_fin) ajoute("AND e.date_ecriture <= $#::date", date_fin);
    if (q) ajoute("AND (lower(e.libelle) LIKE $# OR lower(COALESCE(e.numero_piece, '')) LIKE $#)", `%${String(q).toLowerCase()}%`);
    if (compte_numero) {
      ajoute(
        `AND EXISTS (SELECT 1 FROM ligne_ecriture l JOIN compte_comptable c ON c.id = l.compte_id
                     WHERE l.ecriture_id = e.id AND c.numero LIKE $#)`,
        `${String(compte_numero)}%`
      );
    }
    const limite = Math.min(Math.max(Number(req.query.limit) || 50, 1), 200);
    const decalage = Math.max(Number(req.query.offset) || 0, 0);
    const total = await db.query(`SELECT COUNT(*)::int AS n FROM ecriture_comptable e WHERE e.tenant_id = $1 ${filtre}`, params);
    const r = await db.query(
      `SELECT e.*, j.code AS journal_code, x.libelle AS exercice_libelle,
              (SELECT COALESCE(SUM(l.debit), 0) FROM ligne_ecriture l WHERE l.ecriture_id = e.id) AS total_debit,
              (SELECT COALESCE(SUM(l.credit), 0) FROM ligne_ecriture l WHERE l.ecriture_id = e.id) AS total_credit,
              (SELECT COUNT(*)::int FROM ligne_ecriture l WHERE l.ecriture_id = e.id) AS nb_lignes
       FROM ecriture_comptable e
       JOIN journal_comptable j ON j.id = e.journal_id
       JOIN exercice_comptable x ON x.id = e.exercice_id
       WHERE e.tenant_id = $1 ${filtre}
       ORDER BY e.date_ecriture DESC, j.code, e.numero_ecriture DESC NULLS FIRST, e.date_creation DESC
       LIMIT ${limite} OFFSET ${decalage}`,
      params
    );
    res.json({ total: total.rows[0].n, ecritures: r.rows });
  })
);

router.get(
  "/ecritures/:id",
  gerer(async (req, res) => {
    const e = await compta.lireEcriture(db, tenant(req), req.params.id);
    if (!e) return res.status(404).json({ error: t(req, "COMPTA_ECRITURE_INTROUVABLE") });
    res.json(e);
  })
);

/**
 * Validation de plusieurs ecritures : une transaction par ecriture (une
 * ecriture refusee n'empeche pas les autres), traitees dans l'ordre
 * chronologique pour que la numerotation continue suive les dates.
 */
async function validerPlusieurs(req, ids) {
  const ordre = await db.query(
    `SELECT id FROM ecriture_comptable WHERE tenant_id = $1 AND id = ANY($2::uuid[]) ORDER BY date_ecriture, date_creation`,
    [tenant(req), ids]
  );
  const valides = [];
  const erreurs = [];
  for (const { id } of ordre.rows) {
    try {
      const e = await avecTransaction((client) => compta.validerEcriture(client, tenant(req), userId(req), id));
      valides.push({ id: e.id, numero_ecriture: e.numero_ecriture });
    } catch (err) {
      if (err instanceof ComptaError) erreurs.push({ id, code: err.code, error: messageErreur(req, err) });
      else throw err;
    }
  }
  return { valides, erreurs };
}

// Routes de validation (avant blockLectureSeule : un validateur universel en lecture seule peut valider)
router.post(
  "/ecritures/valider-lot",
  exigerValidation,
  gerer(async (req, res) => {
    const ids = Array.isArray(req.body?.ids) ? req.body.ids : [];
    if (ids.length === 0 || ids.length > 500 || ids.some((x) => !/^[0-9a-f-]{36}$/i.test(String(x)))) {
      return res.status(400).json({ error: t(req, "COMPTA_LOT_INVALIDE") });
    }
    res.json(await validerPlusieurs(req, ids));
  })
);

router.post(
  "/ecritures/:id/valider",
  exigerValidation,
  gerer(async (req, res) => {
    res.json(await avecTransaction((client) => compta.validerEcriture(client, tenant(req), userId(req), req.params.id)));
  })
);

router.post(
  "/ecritures/:id/extourner",
  exigerValidation,
  gerer(async (req, res) => {
    const e = await avecTransaction((client) => compta.extournerEcriture(client, tenant(req), userId(req), req.params.id, req.body || {}));
    res.status(201).json(e);
  })
);

// ----------------------------------------------------------------------------
// Ecritures en instance (generees automatiquement par les ventes)
// ----------------------------------------------------------------------------

router.get(
  "/instance",
  gerer(async (req, res) => {
    const { limit, offset, q, role, client_id } = req.query;
    res.json(await ventesCompta.listerInstance(db, tenant(req), { limit, offset, q, role, client_id }));
  })
);

router.get(
  "/instance/resume",
  gerer(async (req, res) => {
    const n = await db.query(`SELECT COUNT(*)::int AS n FROM ecriture_comptable WHERE tenant_id = $1 AND statut = 'EN_INSTANCE'`, [tenant(req)]);
    const manquantes = await ventesCompta.compterFacturesSansEcriture(db, tenant(req));
    res.json({ en_instance: n.rows[0].n, ...manquantes });
  })
);

// Valide toutes les ecritures en instance (ou une liste d'identifiants), dans l'ordre chronologique, 500 maximum par appel.
router.post(
  "/instance/valider",
  exigerValidation,
  gerer(async (req, res) => {
    let ids = Array.isArray(req.body?.ids) ? req.body.ids : null;
    if (ids && (ids.length === 0 || ids.some((x) => !/^[0-9a-f-]{36}$/i.test(String(x))))) {
      return res.status(400).json({ error: t(req, "COMPTA_LOT_INVALIDE") });
    }
    if (!ids) {
      const r = await db.query(
        `SELECT id FROM ecriture_comptable WHERE tenant_id = $1 AND statut = 'EN_INSTANCE' ORDER BY date_ecriture, date_creation LIMIT 500`,
        [tenant(req)]
      );
      ids = r.rows.map((x) => x.id);
    }
    if (ids.length === 0) return res.json({ valides: [], erreurs: [] });
    if (ids.length > 500) return res.status(400).json({ error: t(req, "COMPTA_LOT_INVALIDE") });
    res.json(await validerPlusieurs(req, ids));
  })
);

// Rattrapage : cree les ecritures en instance des factures / encaissements existants qui n'en ont pas.
router.post(
  "/instance/rattrapage",
  exigerValidation,
  gerer(async (req, res) => {
    await compta.exigerInitialise(db, tenant(req));
    const depuis = req.body?.depuis && /^\d{4}-\d{2}-\d{2}$/.test(req.body.depuis) ? req.body.depuis : undefined;
    res.json(await ventesCompta.rattraperVentes(tenant(req), userId(req), { depuis }));
  })
);

// "Changer le compte" d'une ligne (compte de vente / de tresorerie) d'une ecriture en instance.
router.patch(
  "/lignes/:ligneId/compte",
  exigerValidation,
  gerer(async (req, res) => {
    const { compte_numero, portee, retenir } = req.body || {};
    res.json(
      await avecTransaction((client) =>
        ventesCompta.changerCompteLigne(client, tenant(req), userId(req), req.params.ligneId, { compte_numero, portee, retenir: !!retenir })
      )
    );
  })
);

router.get(
  "/regles-compte-vente",
  gerer(async (req, res) => {
    res.json(await ventesCompta.listerRegles(db, tenant(req)));
  })
);

router.delete(
  "/regles-compte-vente/:id",
  exigerValidation,
  gerer(async (req, res) => {
    await avecTransaction((client) => ventesCompta.supprimerRegle(client, tenant(req), userId(req), req.params.id));
    res.json({ ok: true });
  })
);

// Saisie (brouillons) : bloquee en lecture seule
router.post(
  "/ecritures",
  blockLectureSeule,
  gerer(async (req, res) => {
    const e = await avecTransaction((client) => compta.creerBrouillon(client, tenant(req), userId(req), req.body || {}));
    res.status(201).json(e);
  })
);

router.put(
  "/ecritures/:id",
  blockLectureSeule,
  gerer(async (req, res) => {
    res.json(await avecTransaction((client) => compta.modifierBrouillon(client, tenant(req), userId(req), req.params.id, req.body || {})));
  })
);

router.delete(
  "/ecritures/:id",
  blockLectureSeule,
  gerer(async (req, res) => {
    await avecTransaction((client) => compta.supprimerBrouillon(client, tenant(req), userId(req), req.params.id));
    res.json({ ok: true });
  })
);

// ----------------------------------------------------------------------------
// Etats : grand livre et balance generale (JSON + exports Excel / PDF)
// ----------------------------------------------------------------------------

function optionsRapport(req) {
  const q = req.query;
  return {
    exercice_id: q.exercice_id || undefined,
    date_debut: q.date_debut || undefined,
    date_fin: q.date_fin || undefined,
    compte_de: q.compte_de || undefined,
    compte_a: q.compte_a || undefined,
    inclure_instance: vrai(q.inclure_instance),
  };
}

async function raisonSociale(req) {
  const r = await db.query(`SELECT raison_sociale FROM tenant WHERE id = $1`, [tenant(req)]);
  return r.rows[0]?.raison_sociale || "";
}

function nomFichier(base, data, ext) {
  const lib = String(data.exercice.libelle || "").replace(/[^A-Za-z0-9_-]+/g, "_");
  return `${base}_${lib}.${ext}`;
}

function envoyerFichier(res, buffer, nom, format) {
  res.setHeader(
    "Content-Type",
    format === "pdf" ? "application/pdf" : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
  );
  res.setHeader("Content-Disposition", `attachment; filename="${nom}"`);
  res.send(buffer);
}

router.get(
  "/grand-livre",
  gerer(async (req, res) => {
    res.json(await rapports.grandLivre(db, tenant(req), optionsRapport(req)));
  })
);

router.get(
  "/grand-livre/export",
  gerer(async (req, res) => {
    const format = req.query.format === "pdf" ? "pdf" : "xlsx";
    const data = await rapports.grandLivre(db, tenant(req), optionsRapport(req));
    const entreprise = await raisonSociale(req);
    const buffer = format === "pdf" ? await exportsCompta.grandLivrePdf(data, entreprise) : exportsCompta.grandLivreXlsx(data);
    envoyerFichier(res, buffer, nomFichier("grand_livre", data, format), format);
  })
);

router.get(
  "/balance",
  gerer(async (req, res) => {
    res.json(await rapports.balanceGenerale(db, tenant(req), optionsRapport(req)));
  })
);

router.get(
  "/balance/export",
  gerer(async (req, res) => {
    const format = req.query.format === "pdf" ? "pdf" : "xlsx";
    const data = await rapports.balanceGenerale(db, tenant(req), optionsRapport(req));
    const entreprise = await raisonSociale(req);
    const buffer = format === "pdf" ? await exportsCompta.balancePdf(data, entreprise) : exportsCompta.balanceXlsx(data, entreprise);
    envoyerFichier(res, buffer, nomFichier("balance", data, format), format);
  })
);

// ----------------------------------------------------------------------------
// Import Sage (grand livre, balance) - niveau validation
// ----------------------------------------------------------------------------

const uploadImport = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024, files: 3 } }).fields([
  { name: "fichier", maxCount: 1 },
  { name: "tiers_clients", maxCount: 1 },
  { name: "tiers_fournisseurs", maxCount: 1 },
]);

function recevoirImport(req, res, next) {
  uploadImport(req, res, (err) => {
    if (err) return res.status(400).json({ error: t(req, "COMPTA_IMPORT_FICHIER_INVALIDE") });
    next();
  });
}

const OPTIONS_IMPORT = ["creer_comptes", "creer_journaux", "creer_exercices", "statut", "colonnes", "date_ecriture", "journal_code", "libelle"];
const optionsImport = (req) => Object.fromEntries(OPTIONS_IMPORT.filter((k) => req.body?.[k] !== undefined).map((k) => [k, req.body[k]]));
const fichierImport = (req, nom) => req.files?.[nom]?.[0]?.buffer || null;

router.get(
  "/import/modele/:type",
  exigerValidation,
  gerer(async (req, res) => {
    const grandLivre = req.params.type === "grand-livre";
    const buffer = grandLivre ? importCompta.modeleGrandLivre() : importCompta.modeleBalance();
    envoyerFichier(res, buffer, grandLivre ? "modele_import_grand_livre.xlsx" : "modele_import_balance.xlsx", "xlsx");
  })
);

router.get(
  "/import/lots",
  exigerValidation,
  gerer(async (req, res) => {
    res.json(await importCompta.listerLots(db, tenant(req)));
  })
);

router.post(
  "/import/:type/apercu",
  exigerValidation,
  blockLectureSeule,
  recevoirImport,
  gerer(async (req, res) => {
    const buffer = fichierImport(req, "fichier");
    if (!buffer) return res.status(400).json({ error: t(req, "COMPTA_IMPORT_FICHIER_REQUIS") });
    const params = { buffer, nomFichier: req.files.fichier[0].originalname, options: optionsImport(req) };
    let r;
    if (req.params.type === "grand-livre") r = await importCompta.apercuGrandLivre(tenant(req), userId(req), params);
    else if (req.params.type === "balance")
      r = await importCompta.apercuBalance(tenant(req), userId(req), {
        ...params,
        tiersClients: fichierImport(req, "tiers_clients"),
        tiersFournisseurs: fichierImport(req, "tiers_fournisseurs"),
      });
    else return res.status(404).json({ error: t(req, "COMPTA_IMPORT_FICHIER_INVALIDE") });
    res.json(r.rapport);
  })
);

router.post(
  "/import/:type",
  exigerValidation,
  blockLectureSeule,
  recevoirImport,
  gerer(async (req, res) => {
    const buffer = fichierImport(req, "fichier");
    if (!buffer) return res.status(400).json({ error: t(req, "COMPTA_IMPORT_FICHIER_REQUIS") });
    const params = { buffer, nomFichier: req.files.fichier[0].originalname, options: optionsImport(req) };
    let r;
    if (req.params.type === "grand-livre") r = await importCompta.executerGrandLivre(tenant(req), userId(req), params);
    else if (req.params.type === "balance")
      r = await importCompta.executerBalance(tenant(req), userId(req), {
        ...params,
        tiersClients: fichierImport(req, "tiers_clients"),
        tiersFournisseurs: fichierImport(req, "tiers_fournisseurs"),
      });
    else return res.status(404).json({ error: t(req, "COMPTA_IMPORT_FICHIER_INVALIDE") });
    // Rapport avec erreurs (ok = false) : rien n'a ete importe
    res.status(r.rapport.ok ? 201 : 200).json(r.rapport);
  })
);

router.post(
  "/import/lots/:id/annuler",
  exigerValidation,
  blockLectureSeule,
  gerer(async (req, res) => {
    res.json(await avecTransaction((client) => importCompta.annulerLot(client, tenant(req), userId(req), req.params.id)));
  })
);

// ----------------------------------------------------------------------------
// Journal d'audit (niveau validation)
// ----------------------------------------------------------------------------

router.get(
  "/audit",
  exigerValidation,
  gerer(async (req, res) => {
    const limite = Math.min(Math.max(Number(req.query.limit) || 100, 1), 500);
    const r = await db.query(
      `SELECT a.*, u.prenom, u.nom FROM compta_audit a
       LEFT JOIN utilisateur u ON u.id = a.utilisateur_id
       WHERE a.tenant_id = $1 ORDER BY a.date_action DESC LIMIT ${limite}`,
      [tenant(req)]
    );
    res.json(r.rows);
  })
);

module.exports = router;
