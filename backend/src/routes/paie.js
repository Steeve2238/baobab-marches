const express = require("express");
const multer = require("multer");
const { v4: uuidv4 } = require("uuid");
const db = require("../db");
const { requireAuth, requireModuleAny, blockLectureSeule, exigerModulePaieActif } = require("../middleware/auth");
const { t } = require("../utils/i18n");
const P = require("../services/paieParametres");
const B = require("../services/paieBaremes");
const M = require("../services/paieMoteur");
const G = require("../services/paieGabarit");
const PER = require("../services/paiePeriodes");
const CL = require("../services/paieCloture");
const COMPTA = require("../services/paieCompta");
const ANN = require("../services/paieEtatsAnnuels");
const PROV = require("../services/paieProvisionRetraite");
const PDFP = require("../services/paiePdf");
const { chargerEntete } = require("../services/rhCommun");

const { PaieError } = P;

/**
 * Module Paie - parametres, dossiers de paie, simulateur (lot PAIE-1).
 * "paie" = saisie (dossiers de paie, consultation) ; "paie-validation" = en plus : parametres, baremes, conventions, grilles.
 */
const router = express.Router();
router.use(requireAuth);
router.use(exigerModulePaieActif);
router.use(requireModuleAny("paie", "paie-validation"));
router.use(blockLectureSeule);

const tenant = (req) => req.user.tenantId;

function aDroitValidation(req) {
  const p = req.user?.permissions;
  if (!p) return false;
  if (p.admin) return true;
  if ((p.modules || []).includes("paie-validation")) return true;
  return !!p.validateurUniversel && (p.modules || []).includes("paie");
}
function exigerValidation(req, res, next) {
  if (aDroitValidation(req)) return next();
  return res.status(403).json({ error: t(req, "PAIE_VALIDATION_FORBIDDEN") });
}
function gerer(fn) {
  return async (req, res) => {
    try {
      await fn(req, res);
    } catch (err) {
      if (err && err.constructor && err.constructor.name === "ComptaError") return res.status(err.status || 400).json({ error: t(req, err.code), code: err.code, details: err.details });
      if (err instanceof PaieError) return res.status(err.status || 400).json({ error: t(req, err.code), code: err.code, details: err.details });
      if (err && err.code && String(err.code).startsWith("PAIE_")) return res.status(400).json({ error: t(req, err.code), code: err.code });
      // Verrous poses par les declencheurs SQL (periode figee/cloturee, archive verrouillee)
      if (err && /^PAIE_[A-Z_]+$/.test(String(err.message || ""))) return res.status(409).json({ error: t(req, err.message), code: err.message });
      console.error(err);
      res.status(500).json({ error: t(req, "PAIE_SERVER_ERROR") });
    }
  };
}
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024, files: 1 } }).single("fichier");
const televerser = (req, res, next) => upload(req, res, (err) => (err ? res.status(400).json({ error: t(req, "PAIE_FICHIER_REQUIS") }) : next()));

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const dateIso = (v) => {
  if (v == null || v === "") return null;
  const s = String(v).slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s)) ? s : undefined;
};
const entier = (v) => (v === "" || v == null ? null : Number.isFinite(Number(v)) ? Math.round(Number(v)) : NaN);
const decimal = (v) => (v === "" || v == null ? null : Number.isFinite(Number(v)) ? Number(v) : NaN);
const codeNettoye = (v) => String(v == null ? "" : v).trim().toUpperCase().replace(/[^A-Z0-9_]/g, "_").slice(0, 30);

// ============================================================================================ etat / tableau de bord
router.get("/etat", gerer(async (req, res) => {
  const tid = tenant(req);
  await P.assurerDefauts(tid);
  const [reglages, emp, bar, cot] = await Promise.all([
    P.getReglages(tid),
    db.query(
      `SELECT COUNT(*) FILTER (WHERE e.statut IS DISTINCT FROM 'SORTI') AS nb_salaries,
              COUNT(d.employe_id) FILTER (WHERE d.convention_id IS NOT NULL AND d.categorie_code IS NOT NULL AND e.statut IS DISTINCT FROM 'SORTI') AS nb_dossiers_complets,
              COUNT(*) FILTER (WHERE d.employe_id IS NULL AND e.statut IS DISTINCT FROM 'SORTI') AS nb_sans_dossier
       FROM employe e LEFT JOIN paie_dossier d ON d.employe_id = e.id WHERE e.tenant_id = $1`,
      [tid]
    ),
    P.baremes(tid, new Date().getUTCFullYear()),
    P.cotisationsEffectives(tid, new Date().toISOString().slice(0, 10)),
  ]);
  const e = emp.rows[0];
  res.json({
    droit_validation: aDroitValidation(req),
    reglages,
    nb_salaries: Number(e.nb_salaries), nb_dossiers_complets: Number(e.nb_dossiers_complets), nb_sans_dossier: Number(e.nb_sans_dossier),
    baremes: bar.sources,
    cotisations: cot,
  });
}));

// ============================================================================================ reglages generaux
router.get("/reglages", gerer(async (req, res) => {
  res.json(await P.getReglages(tenant(req)));
}));

router.put("/reglages", exigerValidation, gerer(async (req, res) => {
  const b = req.body || {};
  const cur = await P.getReglages(tenant(req));
  const v = {
    jours_mois: b.jours_mois !== undefined ? entier(b.jours_mois) : cur.jours_mois,
    heures_mensuelles: b.heures_mensuelles !== undefined ? decimal(b.heures_mensuelles) : cur.heures_mensuelles,
    arrondi_net: b.arrondi_net !== undefined ? entier(b.arrondi_net) : cur.arrondi_net,
    mode_ir: b.mode_ir !== undefined ? b.mode_ir : cur.mode_ir,
    base_taux_horaire: b.base_taux_horaire !== undefined ? b.base_taux_horaire : cur.base_taux_horaire,
    numero_employeur_css: b.numero_employeur_css !== undefined ? String(b.numero_employeur_css || "").trim().slice(0, 40) || null : cur.numero_employeur_css,
    numero_employeur_ipres: b.numero_employeur_ipres !== undefined ? String(b.numero_employeur_ipres || "").trim().slice(0, 40) || null : cur.numero_employeur_ipres,
    lieu_signature: b.lieu_signature !== undefined ? String(b.lieu_signature || "").trim().slice(0, 80) || null : cur.lieu_signature,
    banque_donneur: b.banque_donneur !== undefined ? String(b.banque_donneur || "").trim().slice(0, 150) || null : cur.banque_donneur,
    compte_donneur: b.compte_donneur !== undefined ? String(b.compte_donneur || "").trim().slice(0, 60) || null : cur.compte_donneur,
    jour_virement: b.jour_virement !== undefined ? (b.jour_virement === "" || b.jour_virement === null ? null : entier(b.jour_virement)) : cur.jour_virement,
  };
  if (!(v.jours_mois >= 28 && v.jours_mois <= 31) || !(v.heures_mensuelles > 0 && v.heures_mensuelles <= 400)
      || ![1, 5, 10, 25, 50, 100, 500, 1000].includes(v.arrondi_net)
      || (v.jour_virement != null && !(v.jour_virement >= 1 && v.jour_virement <= 31))
      || !["BAREME", "FORMULE", "CUMUL"].includes(v.mode_ir) || !["BASE", "BASE_SURSALAIRE"].includes(v.base_taux_horaire)) {
    throw new PaieError("PAIE_REGLAGES_INVALIDES", 400);
  }
  await db.query(
    `UPDATE paie_parametres SET jours_mois=$2, heures_mensuelles=$3, arrondi_net=$4, mode_ir=$5, base_taux_horaire=$6,
            numero_employeur_css=$7, numero_employeur_ipres=$8, lieu_signature=$9, banque_donneur=$11, compte_donneur=$12, jour_virement=$13, date_modification=now(), modifie_par=$10 WHERE tenant_id=$1`,
    [tenant(req), v.jours_mois, v.heures_mensuelles, v.arrondi_net, v.mode_ir, v.base_taux_horaire, v.numero_employeur_css, v.numero_employeur_ipres, v.lieu_signature, req.user.sub, v.banque_donneur, v.compte_donneur, v.jour_virement]
  );
  res.json(await P.getReglages(tenant(req)));
}));

// ============================================================================================ cotisations
router.get("/cotisations", gerer(async (req, res) => {
  const tid = tenant(req);
  await P.assurerDefauts(tid);
  const r = await db.query(`SELECT * FROM paie_cotisation WHERE tenant_id = $1 ORDER BY ordre, code, date_effet DESC`, [tid]);
  const lignes = r.rows.map((x) => ({
    ...x, date_effet: String(x.date_effet).slice(0, 10), taux_salarie: Number(x.taux_salarie), taux_patronal: Number(x.taux_patronal),
    plafond_mensuel: x.plafond_mensuel == null ? null : Number(x.plafond_mensuel),
  }));
  const aujourdhui = new Date().toISOString().slice(0, 10);
  const courantes = new Set(P.derniereParCode(lignes, "code", aujourdhui).map((x) => x.id));
  res.json(lignes.map((l) => ({ ...l, en_vigueur: courantes.has(l.id) })));
}));

router.post("/cotisations", exigerValidation, gerer(async (req, res) => {
  const b = req.body || {};
  const code = codeNettoye(b.code);
  const date = dateIso(b.date_effet);
  const ts = decimal(b.taux_salarie ?? 0), tp = decimal(b.taux_patronal ?? 0);
  const plafond = b.plafond_mensuel === "" || b.plafond_mensuel == null ? null : entier(b.plafond_mensuel);
  const libelle = String(b.libelle || "").trim().slice(0, 160);
  const pub = b.public === "CADRES" ? "CADRES" : "TOUS";
  if (!code || !libelle || !date || !(ts >= 0 && ts <= 100) || !(tp >= 0 && tp <= 100) || (plafond != null && !(plafond >= 0))) throw new PaieError("PAIE_COTISATION_INVALIDE", 400);
  const section = ["RETRAITE", "SOCIAL", "TAXE", "ASSURANCE", "AUTRE"].includes(b.section) ? b.section : "SOCIAL";
  await P.assurerDefauts(tenant(req));
  const ordreExistant = (await db.query(`SELECT ordre FROM paie_cotisation WHERE tenant_id = $1 AND code = $2 LIMIT 1`, [tenant(req), code])).rows[0];
  const ordre = ordreExistant ? ordreExistant.ordre : Number((await db.query(`SELECT COALESCE(MAX(ordre),0)+1 AS n FROM paie_cotisation WHERE tenant_id = $1`, [tenant(req)])).rows[0].n);
  const r = await db.query(
    `INSERT INTO paie_cotisation (id, tenant_id, code, libelle, section, taux_salarie, taux_patronal, plafond_mensuel, public, date_effet, ordre, actif, note)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
     ON CONFLICT (tenant_id, code, date_effet) DO UPDATE SET libelle=EXCLUDED.libelle, section=EXCLUDED.section, taux_salarie=EXCLUDED.taux_salarie,
       taux_patronal=EXCLUDED.taux_patronal, plafond_mensuel=EXCLUDED.plafond_mensuel, public=EXCLUDED.public, actif=EXCLUDED.actif, note=EXCLUDED.note, date_modification=now()
     RETURNING id`,
    [uuidv4(), tenant(req), code, libelle, section, ts, tp, plafond, pub, date, ordre, b.actif !== false, b.note ? String(b.note).slice(0, 300) : null]
  );
  res.status(201).json({ id: r.rows[0].id });
}));

router.delete("/cotisations/:id", exigerValidation, gerer(async (req, res) => {
  if (!UUID.test(req.params.id)) throw new PaieError("PAIE_COTISATION_INTROUVABLE", 404);
  const c = (await db.query(`SELECT code FROM paie_cotisation WHERE tenant_id = $1 AND id = $2`, [tenant(req), req.params.id])).rows[0];
  if (!c) throw new PaieError("PAIE_COTISATION_INTROUVABLE", 404);
  const n = Number((await db.query(`SELECT COUNT(*) AS n FROM paie_cotisation WHERE tenant_id = $1 AND code = $2`, [tenant(req), c.code])).rows[0].n);
  if (n <= 1) throw new PaieError("PAIE_COTISATION_DERNIERE", 409);
  await db.query(`DELETE FROM paie_cotisation WHERE tenant_id = $1 AND id = $2`, [tenant(req), req.params.id]);
  res.json({ ok: true });
}));

// ============================================================================================ formule IR
function validerFormule(f) {
  if (!f || typeof f !== "object") return null;
  const taux = Number(f.abattement_taux), plaf = Number(f.abattement_plafond);
  if (!(taux >= 0 && taux <= 100) || !(plaf >= 0)) return null;
  const tr = Array.isArray(f.tranches) ? f.tranches.map((x) => ({ de: Number(x.de), a: x.a == null || x.a === "" ? null : Number(x.a), taux: Number(x.taux) })) : [];
  if (!tr.length || tr.some((x, i) => !Number.isFinite(x.de) || !(x.taux >= 0 && x.taux <= 100) || (x.a != null && !(x.a > x.de)) || (i > 0 && x.de !== tr[i - 1].a) || (i < tr.length - 1 && x.a == null))) return null;
  if (tr[0].de !== 0) return null;
  const red = Array.isArray(f.reductions) ? f.reductions.map((x) => ({ parts: Number(x.parts), taux: Number(x.taux), minimum: Number(x.minimum), maximum: Number(x.maximum) })) : [];
  if (red.some((x) => !Number.isFinite(x.parts) || !(x.taux >= 0 && x.taux <= 100) || !(x.minimum >= 0) || !(x.maximum >= x.minimum))) return null;
  return { abattement_taux: taux, abattement_plafond: plaf, tranches: tr, reductions: red };
}

router.get("/formule-ir", gerer(async (req, res) => {
  const tid = tenant(req);
  await P.assurerDefauts(tid);
  const r = await db.query(`SELECT id, date_effet, formule_json, note FROM paie_ir_formule WHERE tenant_id = $1 ORDER BY date_effet DESC`, [tid]);
  res.json({ versions: r.rows.map((x) => ({ id: x.id, date_effet: String(x.date_effet).slice(0, 10), formule: x.formule_json, note: x.note })), defaut: B.FORMULE_DEFAUT });
}));

router.put("/formule-ir", exigerValidation, gerer(async (req, res) => {
  const date = dateIso(req.body && req.body.date_effet);
  const formule = validerFormule(req.body && req.body.formule);
  if (!date || !formule) throw new PaieError("PAIE_FORMULE_INVALIDE", 400);
  await P.assurerDefauts(tenant(req));
  await db.query(
    `INSERT INTO paie_ir_formule (id, tenant_id, date_effet, formule_json, note) VALUES ($1,$2,$3,$4,$5)
     ON CONFLICT (tenant_id, date_effet) DO UPDATE SET formule_json = EXCLUDED.formule_json, note = EXCLUDED.note, date_modification = now()`,
    [uuidv4(), tenant(req), date, JSON.stringify(formule), req.body.note ? String(req.body.note).slice(0, 300) : null]
  );
  res.json({ ok: true });
}));

router.delete("/formule-ir/:id", exigerValidation, gerer(async (req, res) => {
  if (!UUID.test(req.params.id)) throw new PaieError("PAIE_FORMULE_INVALIDE", 404);
  const n = Number((await db.query(`SELECT COUNT(*) AS n FROM paie_ir_formule WHERE tenant_id = $1`, [tenant(req)])).rows[0].n);
  if (n <= 1) throw new PaieError("PAIE_COTISATION_DERNIERE", 409);
  await db.query(`DELETE FROM paie_ir_formule WHERE tenant_id = $1 AND id = $2`, [tenant(req), req.params.id]);
  res.json({ ok: true });
}));

// ============================================================================================ baremes IR / TRIMF
router.get("/baremes", gerer(async (req, res) => {
  const tid = tenant(req);
  const r = await db.query(`SELECT id, type, annee, libelle, source, nb_lignes, date_import FROM paie_bareme WHERE tenant_id = $1 ORDER BY type, annee DESC`, [tid]);
  const officiels = P.BAREMES_OFFICIELS.map((o) => {
    const idx = B.indexer(B.lireFichierReference(o.fichier) || []);
    return { type: o.type, annee: o.annee, libelle: o.libelle, nb_lignes: idx.lignes.length, min: idx.min, max: idx.max, source: "OFFICIEL" };
  });
  const annee = new Date().getUTCFullYear();
  const effectifs = await P.baremes(tid, annee);
  res.json({ officiels, importes: r.rows, effectif: effectifs.sources, annee_courante: annee });
}));

router.post("/baremes/import", exigerValidation, televerser, gerer(async (req, res) => {
  if (!req.file) throw new PaieError("PAIE_FICHIER_REQUIS", 400);
  const type = req.body.type;
  const annee = entier(req.body.annee);
  if (!["IR_MENSUEL", "TRIMF_ANNUEL"].includes(type) || !(annee >= 2000 && annee <= 2100)) throw new PaieError("PAIE_BAREME_INVALIDE", 400);
  let lu;
  try {
    lu = B.lireBaremeExcel(req.file.buffer, req.body.feuille);
  } catch (e) {
    throw new PaieError("PAIE_BAREME_ILLISIBLE", 400);
  }
  const attendu = type === "IR_MENSUEL" ? 1000 : 5000;
  if (lu.pas !== attendu) throw new PaieError("PAIE_BAREME_PAS_INVALIDE", 400, { pas: lu.pas, attendu });
  await db.query(
    `INSERT INTO paie_bareme (id, tenant_id, type, annee, libelle, source, nb_lignes, lignes_json, importe_par)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
     ON CONFLICT (tenant_id, type, annee) DO UPDATE SET libelle=EXCLUDED.libelle, source=EXCLUDED.source, nb_lignes=EXCLUDED.nb_lignes,
       lignes_json=EXCLUDED.lignes_json, importe_par=EXCLUDED.importe_par, date_import=now()`,
    [uuidv4(), tenant(req), type, annee, String(req.body.libelle || (type === "IR_MENSUEL" ? "Table IR importée" : "Table TRIMF importée")).slice(0, 160),
     req.file.originalname.slice(0, 160), lu.lignes.length, JSON.stringify(lu.lignes), req.user.sub]
  );
  res.status(201).json({ ok: true, nb_lignes: lu.lignes.length, min: lu.min, max: lu.max, feuille: lu.feuille });
}));

router.delete("/baremes/:id", exigerValidation, gerer(async (req, res) => {
  if (!UUID.test(req.params.id)) throw new PaieError("PAIE_BAREME_INTROUVABLE", 404);
  const r = await db.query(`DELETE FROM paie_bareme WHERE tenant_id = $1 AND id = $2 RETURNING id`, [tenant(req), req.params.id]);
  if (!r.rows.length) throw new PaieError("PAIE_BAREME_INTROUVABLE", 404);
  res.json({ ok: true });
}));

/** Controle : IR mensuel et TRIMF pour un revenu donne, par la table en vigueur et par la formule du CGI. */
router.get("/baremes/controle", gerer(async (req, res) => {
  const tid = tenant(req);
  const annee = entier(req.query.annee) || new Date().getUTCFullYear();
  const imposable = decimal(req.query.imposable);
  const parts = decimal(req.query.parts) || 1;
  if (!(imposable >= 0)) throw new PaieError("PAIE_SIMULATION_INVALIDE", 400);
  const bar = await P.baremes(tid, annee);
  const formule = await P.formuleEffective(tid, `${annee}-12-31`);
  const table = B.irMensuelTable(bar.irIndex, imposable, parts, formule);
  const trimf = B.trimfMensuelParPersonne(bar.trimfIndex, imposable);
  res.json({
    imposable, parts, annee,
    ir_table: table, ir_formule: Math.round(B.irMensuelFormule(imposable, parts, formule)),
    trimf: { annuel: trimf.annuel, mensuel: Math.round(trimf.montant), source: trimf.source },
    sources: bar.sources,
  });
}));

// ============================================================================================ conventions et grilles
router.get("/conventions", gerer(async (req, res) => {
  const tid = tenant(req);
  await P.assurerDefauts(tid);
  const r = await db.query(
    `SELECT c.*, (SELECT COUNT(*) FROM paie_dossier d WHERE d.convention_id = c.id) AS nb_salaries,
            (SELECT COUNT(DISTINCT code) FROM paie_categorie k WHERE k.convention_id = c.id) AS nb_categories
     FROM paie_convention c WHERE c.tenant_id = $1 ORDER BY c.ordre, c.libelle`,
    [tid]
  );
  res.json(r.rows.map((c) => ({ id: c.id, code: c.code, libelle: c.libelle, actif: c.actif, notes: c.notes, anciennete: c.anciennete_json, majorations: c.majorations_json, nb_salaries: Number(c.nb_salaries), nb_categories: Number(c.nb_categories) })));
}));

function validerAnciennete(a) {
  if (!Array.isArray(a)) return null;
  const out = a.map((x) => ({ annees: Math.round(Number(x.annees)), taux: Number(x.taux) }));
  if (out.some((x) => !(x.annees >= 0 && x.annees <= 60) || !(x.taux >= 0 && x.taux <= 100))) return null;
  return out.sort((x, y) => x.annees - y.annees);
}
function validerMajorations(a) {
  if (!Array.isArray(a)) return null;
  const out = a.map((x) => ({ code: codeNettoye(x.code), libelle: String(x.libelle || "").trim().slice(0, 120), taux: Number(x.taux) }));
  if (out.some((x) => !x.code || !(x.taux >= 0 && x.taux <= 300)) || new Set(out.map((x) => x.code)).size !== out.length) return null;
  return out.map((x) => ({ ...x, libelle: x.libelle || x.code }));
}

router.post("/conventions", exigerValidation, gerer(async (req, res) => {
  const b = req.body || {};
  const code = codeNettoye(b.code), libelle = String(b.libelle || "").trim().slice(0, 120);
  const anc = b.anciennete === undefined ? [] : validerAnciennete(b.anciennete);
  const maj = b.majorations === undefined ? [{ code: "HS_15", libelle: "Heures supplémentaires majorées de 15 %", taux: 15 }, { code: "HS_40", libelle: "Heures supplémentaires majorées de 40 %", taux: 40 }] : validerMajorations(b.majorations);
  if (!code || !libelle || !anc || !maj) throw new PaieError("PAIE_CONVENTION_INVALIDE", 400);
  await P.assurerDefauts(tenant(req));
  const ordre = Number((await db.query(`SELECT COALESCE(MAX(ordre),0)+1 AS n FROM paie_convention WHERE tenant_id = $1`, [tenant(req)])).rows[0].n);
  try {
    const r = await db.query(
      `INSERT INTO paie_convention (id, tenant_id, code, libelle, anciennete_json, majorations_json, notes, ordre) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
      [uuidv4(), tenant(req), code, libelle, JSON.stringify(anc), JSON.stringify(maj), b.notes ? String(b.notes).slice(0, 600) : null, ordre]
    );
    res.status(201).json({ id: r.rows[0].id });
  } catch (e) {
    if (e.code === "23505") throw new PaieError("PAIE_CONVENTION_EXISTE", 409);
    throw e;
  }
}));

router.patch("/conventions/:id", exigerValidation, gerer(async (req, res) => {
  const id = req.params.id;
  if (!UUID.test(id)) throw new PaieError("PAIE_CONVENTION_INTROUVABLE", 404);
  const cur = (await db.query(`SELECT * FROM paie_convention WHERE tenant_id = $1 AND id = $2`, [tenant(req), id])).rows[0];
  if (!cur) throw new PaieError("PAIE_CONVENTION_INTROUVABLE", 404);
  const b = req.body || {};
  const libelle = b.libelle !== undefined ? String(b.libelle || "").trim().slice(0, 120) : cur.libelle;
  const anc = b.anciennete !== undefined ? validerAnciennete(b.anciennete) : cur.anciennete_json;
  const maj = b.majorations !== undefined ? validerMajorations(b.majorations) : cur.majorations_json;
  if (!libelle || !anc || !maj) throw new PaieError("PAIE_CONVENTION_INVALIDE", 400);
  await db.query(
    `UPDATE paie_convention SET libelle=$3, anciennete_json=$4, majorations_json=$5, notes=$6, actif=$7, date_modification=now() WHERE tenant_id=$1 AND id=$2`,
    [tenant(req), id, libelle, JSON.stringify(anc), JSON.stringify(maj), b.notes !== undefined ? (b.notes ? String(b.notes).slice(0, 600) : null) : cur.notes, b.actif !== undefined ? !!b.actif : cur.actif]
  );
  res.json({ ok: true });
}));

router.delete("/conventions/:id", exigerValidation, gerer(async (req, res) => {
  if (!UUID.test(req.params.id)) throw new PaieError("PAIE_CONVENTION_INTROUVABLE", 404);
  const n = Number((await db.query(`SELECT COUNT(*) AS n FROM paie_dossier WHERE tenant_id = $1 AND convention_id = $2`, [tenant(req), req.params.id])).rows[0].n);
  if (n > 0) throw new PaieError("PAIE_CONVENTION_UTILISEE", 409);
  const r = await db.query(`DELETE FROM paie_convention WHERE tenant_id = $1 AND id = $2 RETURNING id`, [tenant(req), req.params.id]);
  if (!r.rows.length) throw new PaieError("PAIE_CONVENTION_INTROUVABLE", 404);
  res.json({ ok: true });
}));

router.get("/conventions/:id/grille", gerer(async (req, res) => {
  if (!UUID.test(req.params.id)) throw new PaieError("PAIE_CONVENTION_INTROUVABLE", 404);
  const cv = (await db.query(`SELECT id FROM paie_convention WHERE tenant_id = $1 AND id = $2`, [tenant(req), req.params.id])).rows[0];
  if (!cv) throw new PaieError("PAIE_CONVENTION_INTROUVABLE", 404);
  const date = dateIso(req.query.date) || new Date().toISOString().slice(0, 10);
  const grille = await P.grilleA(tenant(req), req.params.id, date);
  const dates = (await db.query(`SELECT DISTINCT date_effet FROM paie_categorie WHERE convention_id = $1 ORDER BY date_effet DESC`, [req.params.id])).rows.map((x) => String(x.date_effet).slice(0, 10));
  res.json({ date, dates, grille });
}));

router.post("/conventions/:id/categories", exigerValidation, gerer(async (req, res) => {
  const id = req.params.id;
  if (!UUID.test(id)) throw new PaieError("PAIE_CONVENTION_INTROUVABLE", 404);
  const cv = (await db.query(`SELECT id FROM paie_convention WHERE tenant_id = $1 AND id = $2`, [tenant(req), id])).rows[0];
  if (!cv) throw new PaieError("PAIE_CONVENTION_INTROUVABLE", 404);
  const b = req.body || {};
  const code = String(b.code || "").trim().slice(0, 20), libelle = String(b.libelle || "").trim().slice(0, 120);
  const sal = entier(b.salaire_base), date = dateIso(b.date_effet);
  if (!code || !libelle || !["OUVRIER", "EMPLOYE", "AGENT_MAITRISE", "CADRE"].includes(b.classification) || !(sal >= 0) || !date) throw new PaieError("PAIE_CATEGORIE_INVALIDE", 400);
  const ordreExistant = (await db.query(`SELECT ordre FROM paie_categorie WHERE convention_id = $1 AND code = $2 LIMIT 1`, [id, code])).rows[0];
  const ordre = ordreExistant ? ordreExistant.ordre : Number((await db.query(`SELECT COALESCE(MAX(ordre),0)+1 AS n FROM paie_categorie WHERE convention_id = $1`, [id])).rows[0].n);
  await db.query(
    `INSERT INTO paie_categorie (id, tenant_id, convention_id, code, libelle, classification, salaire_base, date_effet, ordre) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
     ON CONFLICT (convention_id, code, date_effet) DO UPDATE SET libelle=EXCLUDED.libelle, classification=EXCLUDED.classification, salaire_base=EXCLUDED.salaire_base, date_modification=now()`,
    [uuidv4(), tenant(req), id, code, libelle, b.classification, sal, date, ordre]
  );
  res.status(201).json({ ok: true });
}));

router.delete("/categories/:id", exigerValidation, gerer(async (req, res) => {
  if (!UUID.test(req.params.id)) throw new PaieError("PAIE_CATEGORIE_INTROUVABLE", 404);
  const k = (await db.query(`SELECT convention_id, code FROM paie_categorie WHERE tenant_id = $1 AND id = $2`, [tenant(req), req.params.id])).rows[0];
  if (!k) throw new PaieError("PAIE_CATEGORIE_INTROUVABLE", 404);
  const n = Number((await db.query(`SELECT COUNT(*) AS n FROM paie_categorie WHERE convention_id = $1 AND code = $2`, [k.convention_id, k.code])).rows[0].n);
  if (n <= 1) {
    const u = Number((await db.query(`SELECT COUNT(*) AS n FROM paie_dossier WHERE tenant_id = $1 AND convention_id = $2 AND categorie_code = $3`, [tenant(req), k.convention_id, k.code])).rows[0].n);
    if (u > 0) throw new PaieError("PAIE_CATEGORIE_UTILISEE", 409);
  }
  await db.query(`DELETE FROM paie_categorie WHERE tenant_id = $1 AND id = $2`, [tenant(req), req.params.id]);
  res.json({ ok: true });
}));

/**
 * Revalorisation de la grille : cree, a la date d'effet, une nouvelle ligne par categorie (l'historique est conserve, les
 * paies deja calculees avant cette date ne changent pas). Corps : { date_effet, taux (%), classifications?[], arrondi? }.
 */
router.post("/conventions/:id/revalorisation", exigerValidation, gerer(async (req, res) => {
  const id = req.params.id;
  if (!UUID.test(id)) throw new PaieError("PAIE_CONVENTION_INTROUVABLE", 404);
  const cv = (await db.query(`SELECT id FROM paie_convention WHERE tenant_id = $1 AND id = $2`, [tenant(req), id])).rows[0];
  if (!cv) throw new PaieError("PAIE_CONVENTION_INTROUVABLE", 404);
  const b = req.body || {};
  const date = dateIso(b.date_effet), taux = decimal(b.taux), arrondi = entier(b.arrondi) || 1;
  const filtre = Array.isArray(b.classifications) && b.classifications.length ? b.classifications : null;
  if (!date || !(taux > -50 && taux < 100) || ![1, 5, 10, 100, 1000].includes(arrondi)) throw new PaieError("PAIE_REVALORISATION_INVALIDE", 400);
  const grille = await P.grilleA(tenant(req), id, date);
  let n = 0;
  for (const k of grille) {
    if (filtre && !filtre.includes(k.classification)) continue;
    const nouveau = Math.round((k.salaire_base * (1 + taux / 100)) / arrondi) * arrondi;
    await db.query(
      `INSERT INTO paie_categorie (id, tenant_id, convention_id, code, libelle, classification, salaire_base, date_effet, ordre) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       ON CONFLICT (convention_id, code, date_effet) DO UPDATE SET salaire_base = EXCLUDED.salaire_base, date_modification = now()`,
      [uuidv4(), tenant(req), id, k.code, k.libelle, k.classification, nouveau, date, k.ordre]
    );
    n += 1;
  }
  res.json({ ok: true, nb_categories: n });
}));

router.get("/conventions/:id/gabarit", gerer(async (req, res) => {
  if (!UUID.test(req.params.id)) throw new PaieError("PAIE_CONVENTION_INTROUVABLE", 404);
  const cv = (await db.query(`SELECT * FROM paie_convention WHERE tenant_id = $1 AND id = $2`, [tenant(req), req.params.id])).rows[0];
  if (!cv) throw new PaieError("PAIE_CONVENTION_INTROUVABLE", 404);
  const grille = await P.grilleA(tenant(req), cv.id, dateIso(req.query.date) || new Date().toISOString().slice(0, 10));
  const buf = G.genererGabarit({ anciennete: cv.anciennete_json, majorations: cv.majorations_json }, grille);
  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.setHeader("Content-Disposition", `attachment; filename="convention_${cv.code}.xlsx"`);
  res.send(buf);
}));

/** Import d'une grille : cree/met a jour les categories a la date d'effet donnee ; anciennete et majorations si les feuilles existent. */
router.post("/conventions/:id/import", exigerValidation, televerser, gerer(async (req, res) => {
  const id = req.params.id;
  if (!UUID.test(id)) throw new PaieError("PAIE_CONVENTION_INTROUVABLE", 404);
  const cv = (await db.query(`SELECT id FROM paie_convention WHERE tenant_id = $1 AND id = $2`, [tenant(req), id])).rows[0];
  if (!cv) throw new PaieError("PAIE_CONVENTION_INTROUVABLE", 404);
  if (!req.file) throw new PaieError("PAIE_FICHIER_REQUIS", 400);
  const date = dateIso(req.body.date_effet);
  if (!date) throw new PaieError("PAIE_CATEGORIE_INVALIDE", 400);
  let lu;
  try { lu = G.lireGabarit(req.file.buffer); } catch (e) { throw new PaieError("PAIE_GABARIT_ILLISIBLE", 400); }
  if (!lu.categories.length) throw new PaieError("PAIE_GABARIT_ILLISIBLE", 400, { erreurs: lu.erreurs });
  const existants = new Map((await db.query(`SELECT code, MIN(ordre) AS ordre FROM paie_categorie WHERE convention_id = $1 GROUP BY code`, [id])).rows.map((x) => [x.code, x.ordre]));
  let ordreMax = Number((await db.query(`SELECT COALESCE(MAX(ordre),0) AS n FROM paie_categorie WHERE convention_id = $1`, [id])).rows[0].n);
  const client = await db.pool.connect();
  try {
    await client.query("BEGIN");
    for (const k of lu.categories) {
      const ordre = existants.has(k.code) ? existants.get(k.code) : ++ordreMax;
      await client.query(
        `INSERT INTO paie_categorie (id, tenant_id, convention_id, code, libelle, classification, salaire_base, date_effet, ordre) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
         ON CONFLICT (convention_id, code, date_effet) DO UPDATE SET libelle=EXCLUDED.libelle, classification=EXCLUDED.classification, salaire_base=EXCLUDED.salaire_base, date_modification=now()`,
        [uuidv4(), tenant(req), id, k.code, k.libelle, k.classification, k.salaire_base, date, ordre]
      );
    }
    if (lu.anciennete) await client.query(`UPDATE paie_convention SET anciennete_json = $3, date_modification = now() WHERE tenant_id = $1 AND id = $2`, [tenant(req), id, JSON.stringify(validerAnciennete(lu.anciennete) || [])]);
    if (lu.majorations && validerMajorations(lu.majorations)) await client.query(`UPDATE paie_convention SET majorations_json = $3, date_modification = now() WHERE tenant_id = $1 AND id = $2`, [tenant(req), id, JSON.stringify(lu.majorations)]);
    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    client.release();
  }
  res.status(201).json({ ok: true, nb_categories: lu.categories.length, anciennete: !!lu.anciennete, majorations: !!lu.majorations, erreurs: lu.erreurs });
}));

// ============================================================================================ rubriques
router.get("/rubriques", gerer(async (req, res) => {
  res.json(await P.rubriquesActives(tenant(req)));
}));

function lireRubrique(b, cur) {
  const v = {
    libelle: b.libelle !== undefined ? String(b.libelle || "").trim().slice(0, 120) : cur.libelle,
    sens: b.sens !== undefined ? b.sens : cur.sens,
    mode: b.mode !== undefined ? b.mode : cur.mode,
    section: b.section !== undefined ? b.section : cur.section,
    imposable: b.imposable !== undefined ? !!b.imposable : cur.imposable,
    soumis_cotisations: b.soumis_cotisations !== undefined ? !!b.soumis_cotisations : cur.soumis_cotisations,
    exoneration_plafond: b.exoneration_plafond !== undefined ? (b.exoneration_plafond === "" || b.exoneration_plafond == null ? null : entier(b.exoneration_plafond)) : cur.exoneration_plafond,
    proratisable: b.proratisable !== undefined ? !!b.proratisable : cur.proratisable,
    montant_defaut: b.montant_defaut !== undefined ? (b.montant_defaut === "" || b.montant_defaut == null ? null : entier(b.montant_defaut)) : cur.montant_defaut,
    compte_cle: b.compte_cle !== undefined ? (b.compte_cle ? String(b.compte_cle) : null) : cur.compte_cle,
    actif: b.actif !== undefined ? !!b.actif : cur.actif,
  };
  const comptes = P.COMPTES_CATALOGUE.map((c) => c.cle);
  if (!v.libelle || !["GAIN", "RETENUE", "REMBOURSEMENT"].includes(v.sens) || !["FIXE", "VARIABLE", "QUANTITE"].includes(v.mode)
      || !["SALAIRE", "INDEMNITES"].includes(v.section) || (v.exoneration_plafond != null && !(v.exoneration_plafond >= 0))
      || (v.montant_defaut != null && !(v.montant_defaut >= 0)) || (v.compte_cle && !comptes.includes(v.compte_cle))) return null;
  if (v.sens !== "GAIN") { v.imposable = false; v.soumis_cotisations = false; v.exoneration_plafond = null; v.proratisable = false; v.section = "INDEMNITES"; }
  return v;
}

router.post("/rubriques", exigerValidation, gerer(async (req, res) => {
  const b = req.body || {};
  const code = codeNettoye(b.code);
  const v = lireRubrique(b, { libelle: "", sens: "GAIN", mode: "VARIABLE", section: "INDEMNITES", imposable: true, soumis_cotisations: true, exoneration_plafond: null, proratisable: false, montant_defaut: null, compte_cle: "PRIMES", actif: true });
  if (!code || !v) throw new PaieError("PAIE_RUBRIQUE_INVALIDE", 400);
  await P.assurerDefauts(tenant(req));
  const ordre = Number((await db.query(`SELECT COALESCE(MAX(ordre),0)+1 AS n FROM paie_rubrique WHERE tenant_id = $1`, [tenant(req)])).rows[0].n);
  try {
    const r = await db.query(
      `INSERT INTO paie_rubrique (id, tenant_id, code, libelle, sens, mode, section, imposable, soumis_cotisations, exoneration_plafond, proratisable, montant_defaut, compte_cle, ordre, actif)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING id`,
      [uuidv4(), tenant(req), code, v.libelle, v.sens, v.mode, v.section, v.imposable, v.soumis_cotisations, v.exoneration_plafond, v.proratisable, v.montant_defaut, v.compte_cle, ordre, v.actif]
    );
    res.status(201).json({ id: r.rows[0].id });
  } catch (e) {
    if (e.code === "23505") throw new PaieError("PAIE_RUBRIQUE_EXISTE", 409);
    throw e;
  }
}));

router.patch("/rubriques/:id", exigerValidation, gerer(async (req, res) => {
  if (!UUID.test(req.params.id)) throw new PaieError("PAIE_RUBRIQUE_INTROUVABLE", 404);
  const cur = (await db.query(`SELECT * FROM paie_rubrique WHERE tenant_id = $1 AND id = $2`, [tenant(req), req.params.id])).rows[0];
  if (!cur) throw new PaieError("PAIE_RUBRIQUE_INTROUVABLE", 404);
  const v = lireRubrique(req.body || {}, { ...cur, exoneration_plafond: cur.exoneration_plafond == null ? null : Number(cur.exoneration_plafond), montant_defaut: cur.montant_defaut == null ? null : Number(cur.montant_defaut) });
  if (!v) throw new PaieError("PAIE_RUBRIQUE_INVALIDE", 400);
  await db.query(
    `UPDATE paie_rubrique SET libelle=$3, sens=$4, mode=$5, section=$6, imposable=$7, soumis_cotisations=$8, exoneration_plafond=$9, proratisable=$10,
            montant_defaut=$11, compte_cle=$12, actif=$13, date_modification=now() WHERE tenant_id=$1 AND id=$2`,
    [tenant(req), req.params.id, v.libelle, v.sens, v.mode, v.section, v.imposable, v.soumis_cotisations, v.exoneration_plafond, v.proratisable, v.montant_defaut, v.compte_cle, v.actif]
  );
  res.json({ ok: true });
}));

router.delete("/rubriques/:id", exigerValidation, gerer(async (req, res) => {
  if (!UUID.test(req.params.id)) throw new PaieError("PAIE_RUBRIQUE_INTROUVABLE", 404);
  const cur = (await db.query(`SELECT code, systeme FROM paie_rubrique WHERE tenant_id = $1 AND id = $2`, [tenant(req), req.params.id])).rows[0];
  if (!cur) throw new PaieError("PAIE_RUBRIQUE_INTROUVABLE", 404);
  if (cur.systeme) throw new PaieError("PAIE_RUBRIQUE_SYSTEME", 409);
  const u = Number((await db.query(`SELECT COUNT(*) AS n FROM paie_element_fixe WHERE tenant_id = $1 AND rubrique_code = $2`, [tenant(req), cur.code])).rows[0].n);
  if (u > 0) throw new PaieError("PAIE_RUBRIQUE_UTILISEE", 409);
  await db.query(`DELETE FROM paie_rubrique WHERE tenant_id = $1 AND id = $2`, [tenant(req), req.params.id]);
  res.json({ ok: true });
}));

// ============================================================================================ types d'absence
router.get("/types-absence", gerer(async (req, res) => {
  res.json(await P.typesAbsence(tenant(req)));
}));

router.post("/types-absence", exigerValidation, gerer(async (req, res) => {
  const b = req.body || {};
  const code = codeNettoye(b.code), libelle = String(b.libelle || "").trim().slice(0, 120), taux = decimal(b.taux_maintien);
  if (!code || !libelle || !(taux >= 0 && taux <= 100)) throw new PaieError("PAIE_ABSENCE_INVALIDE", 400);
  await P.assurerDefauts(tenant(req));
  const ordre = Number((await db.query(`SELECT COALESCE(MAX(ordre),0)+1 AS n FROM paie_type_absence WHERE tenant_id = $1`, [tenant(req)])).rows[0].n);
  try {
    const r = await db.query(`INSERT INTO paie_type_absence (id, tenant_id, code, libelle, taux_maintien, ordre) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`, [uuidv4(), tenant(req), code, libelle, taux, ordre]);
    res.status(201).json({ id: r.rows[0].id });
  } catch (e) {
    if (e.code === "23505") throw new PaieError("PAIE_ABSENCE_EXISTE", 409);
    throw e;
  }
}));

router.patch("/types-absence/:id", exigerValidation, gerer(async (req, res) => {
  if (!UUID.test(req.params.id)) throw new PaieError("PAIE_ABSENCE_INTROUVABLE", 404);
  const cur = (await db.query(`SELECT * FROM paie_type_absence WHERE tenant_id = $1 AND id = $2`, [tenant(req), req.params.id])).rows[0];
  if (!cur) throw new PaieError("PAIE_ABSENCE_INTROUVABLE", 404);
  const b = req.body || {};
  const libelle = b.libelle !== undefined ? String(b.libelle || "").trim().slice(0, 120) : cur.libelle;
  const taux = b.taux_maintien !== undefined ? decimal(b.taux_maintien) : Number(cur.taux_maintien);
  if (!libelle || !(taux >= 0 && taux <= 100)) throw new PaieError("PAIE_ABSENCE_INVALIDE", 400);
  await db.query(`UPDATE paie_type_absence SET libelle=$3, taux_maintien=$4, actif=$5 WHERE tenant_id=$1 AND id=$2`, [tenant(req), req.params.id, libelle, taux, b.actif !== undefined ? !!b.actif : cur.actif]);
  res.json({ ok: true });
}));

router.delete("/types-absence/:id", exigerValidation, gerer(async (req, res) => {
  if (!UUID.test(req.params.id)) throw new PaieError("PAIE_ABSENCE_INTROUVABLE", 404);
  const cur = (await db.query(`SELECT systeme FROM paie_type_absence WHERE tenant_id = $1 AND id = $2`, [tenant(req), req.params.id])).rows[0];
  if (!cur) throw new PaieError("PAIE_ABSENCE_INTROUVABLE", 404);
  if (cur.systeme) throw new PaieError("PAIE_RUBRIQUE_SYSTEME", 409);
  await db.query(`DELETE FROM paie_type_absence WHERE tenant_id = $1 AND id = $2`, [tenant(req), req.params.id]);
  res.json({ ok: true });
}));

// ============================================================================================ comptes
router.get("/comptes", gerer(async (req, res) => {
  res.json(await P.getComptes(tenant(req)));
}));
router.put("/comptes", exigerValidation, gerer(async (req, res) => {
  res.json(await P.enregistrerComptes(tenant(req), req.body));
}));

// ============================================================================================ dossiers de paie
router.get("/dossiers", gerer(async (req, res) => {
  const tid = tenant(req);
  await P.assurerDefauts(tid);
  const r = await db.query(
    `SELECT e.id, e.matricule, COALESCE(e.nom, u.nom) AS nom, COALESCE(e.prenom, u.prenom) AS prenom, e.statut, e.date_embauche, e.date_sortie, e.poste,
            d.convention_id, cv.libelle AS convention_libelle, d.categorie_code, d.sursalaire, d.salaire_base_manuel, d.actif_paie, d.regime_rc,
            d.employe_id IS NOT NULL AS a_dossier
     FROM employe e LEFT JOIN utilisateur u ON u.id = e.utilisateur_id
     LEFT JOIN paie_dossier d ON d.employe_id = e.id LEFT JOIN paie_convention cv ON cv.id = d.convention_id
     WHERE e.tenant_id = $1 ORDER BY COALESCE(e.nom, u.nom), COALESCE(e.prenom, u.prenom)`,
    [tid]
  );
  const date = new Date().toISOString().slice(0, 10);
  const grilles = new Map();
  const out = [];
  for (const x of r.rows) {
    let salaire = null, libelleCat = null, classification = null;
    if (x.convention_id && x.categorie_code) {
      if (!grilles.has(x.convention_id)) grilles.set(x.convention_id, await P.grilleA(tid, x.convention_id, date));
      const k = grilles.get(x.convention_id).find((g) => g.code === x.categorie_code);
      if (k) { libelleCat = k.libelle; classification = k.classification; salaire = x.salaire_base_manuel != null ? Number(x.salaire_base_manuel) : k.salaire_base; }
    } else if (x.salaire_base_manuel != null) salaire = Number(x.salaire_base_manuel);
    out.push({
      id: x.id, matricule: x.matricule, nom: x.nom, prenom: x.prenom, statut: x.statut, poste: x.poste, date_embauche: x.date_embauche,
      a_dossier: x.a_dossier, complet: !!(x.convention_id && x.categorie_code) || x.salaire_base_manuel != null, actif_paie: x.a_dossier ? x.actif_paie : null,
      convention_id: x.convention_id, convention_libelle: x.convention_libelle, categorie_code: x.categorie_code, categorie_libelle: libelleCat, classification,
      sursalaire: x.sursalaire == null ? null : Number(x.sursalaire), salaire_base: salaire,
    });
  }
  res.json(out);
}));

router.get("/dossiers/:employeId", gerer(async (req, res) => {
  const tid = tenant(req);
  if (!UUID.test(req.params.employeId)) throw new PaieError("PAIE_EMPLOYE_INTROUVABLE", 404);
  await P.assurerDefauts(tid);
  const e = (await db.query(
    `SELECT e.id, e.matricule, COALESCE(e.nom, u.nom) AS nom, COALESCE(e.prenom, u.prenom) AS prenom, e.date_embauche, e.date_sortie, e.statut, e.poste,
            e.convention_collective, e.categorie, e.classification, e.situation_familiale
     FROM employe e LEFT JOIN utilisateur u ON u.id = e.utilisateur_id WHERE e.tenant_id = $1 AND e.id = $2`, [tid, req.params.employeId])).rows[0];
  if (!e) throw new PaieError("PAIE_EMPLOYE_INTROUVABLE", 404);
  const dossier = await P.chargerDossier(tid, e.id);
  const aujourdhui = new Date();
  const elements = (await db.query(`SELECT id, rubrique_code, montant, quantite, date_debut, date_fin, note FROM paie_element_fixe WHERE tenant_id = $1 AND employe_id = $2 ORDER BY date_debut DESC, rubrique_code`, [tid, e.id])).rows
    .map((x) => ({ ...x, montant: x.montant == null ? null : Number(x.montant), quantite: x.quantite == null ? null : Number(x.quantite) }));
  const enfants = (await db.query(`SELECT * FROM employe_enfant WHERE tenant_id = $1 AND employe_id = $2`, [tid, e.id])).rows;
  const parts = require("../services/rhFiche").calculerParts((await db.query(`SELECT * FROM employe WHERE id = $1`, [e.id])).rows[0], enfants, aujourdhui.getUTCFullYear());
  const convs = (await db.query(`SELECT id, code, libelle FROM paie_convention WHERE tenant_id = $1 AND actif ORDER BY ordre, libelle`, [tid])).rows;
  const grilles = {};
  for (const c of convs) grilles[c.id] = await P.grilleA(tid, c.id, aujourdhui.toISOString().slice(0, 10));
  res.json({
    employe: e, parts,
    dossier: dossier ? { convention_id: dossier.convention_id, categorie_code: dossier.categorie_code, salaire_base_manuel: dossier.salaire_base_manuel == null ? null : Number(dossier.salaire_base_manuel), sursalaire: Number(dossier.sursalaire) || 0, regime_rc: dossier.regime_rc, date_anciennete: dossier.date_anciennete, actif_paie: dossier.actif_paie, notes: dossier.notes } : null,
    elements, conventions: convs, grilles,
  });
}));

const CHAMPS_HISTO_PAIE = { convention_id: "paie.convention", categorie_code: "paie.categorie", salaire_base_manuel: "paie.salaire_base_manuel", sursalaire: "paie.sursalaire", regime_rc: "paie.regime_rc", date_anciennete: "paie.date_anciennete", actif_paie: "paie.actif" };

router.put("/dossiers/:employeId", gerer(async (req, res) => {
  const tid = tenant(req);
  if (!UUID.test(req.params.employeId)) throw new PaieError("PAIE_EMPLOYE_INTROUVABLE", 404);
  const emp = (await db.query(`SELECT id FROM employe WHERE tenant_id = $1 AND id = $2`, [tid, req.params.employeId])).rows[0];
  if (!emp) throw new PaieError("PAIE_EMPLOYE_INTROUVABLE", 404);
  await P.assurerDefauts(tid);
  const b = req.body || {};
  const conventionId = b.convention_id || null;
  const categorie = b.categorie_code ? String(b.categorie_code).slice(0, 20) : null;
  const manuel = b.salaire_base_manuel === "" || b.salaire_base_manuel == null ? null : entier(b.salaire_base_manuel);
  const sursalaire = entier(b.sursalaire ?? 0);
  const dateAnc = dateIso(b.date_anciennete);
  const rc = b.regime_rc === "" || b.regime_rc == null ? null : !!b.regime_rc;
  if ((conventionId && !UUID.test(conventionId)) || (manuel != null && !(manuel >= 0)) || !(sursalaire >= 0) || dateAnc === undefined) throw new PaieError("PAIE_DOSSIER_INVALIDE", 400);
  let cat = null, cv = null;
  if (conventionId) {
    cv = (await db.query(`SELECT id, libelle FROM paie_convention WHERE tenant_id = $1 AND id = $2`, [tid, conventionId])).rows[0];
    if (!cv) throw new PaieError("PAIE_CONVENTION_INTROUVABLE", 404);
    if (categorie) {
      cat = (await P.grilleA(tid, conventionId, new Date().toISOString().slice(0, 10))).find((g) => g.code === categorie);
      if (!cat) {
        const ex = (await db.query(`SELECT code, libelle, classification FROM paie_categorie WHERE convention_id = $1 AND code = $2 LIMIT 1`, [conventionId, categorie])).rows[0];
        if (!ex) throw new PaieError("PAIE_CATEGORIE_INTROUVABLE", 404);
        cat = ex;
      }
    }
  }
  const avant = (await P.chargerDossier(tid, emp.id)) || {};
  const nouveau = { convention_id: conventionId, categorie_code: conventionId ? categorie : null, salaire_base_manuel: manuel, sursalaire, regime_rc: rc, date_anciennete: dateAnc, actif_paie: b.actif_paie === undefined ? (avant.actif_paie !== false) : !!b.actif_paie };
  await db.query(
    `INSERT INTO paie_dossier (employe_id, tenant_id, convention_id, categorie_code, salaire_base_manuel, sursalaire, regime_rc, date_anciennete, actif_paie, notes, modifie_par)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
     ON CONFLICT (employe_id) DO UPDATE SET convention_id=EXCLUDED.convention_id, categorie_code=EXCLUDED.categorie_code, salaire_base_manuel=EXCLUDED.salaire_base_manuel,
       sursalaire=EXCLUDED.sursalaire, regime_rc=EXCLUDED.regime_rc, date_anciennete=EXCLUDED.date_anciennete, actif_paie=EXCLUDED.actif_paie, notes=EXCLUDED.notes,
       date_modification=now(), modifie_par=EXCLUDED.modifie_par`,
    [emp.id, tid, nouveau.convention_id, nouveau.categorie_code, nouveau.salaire_base_manuel, nouveau.sursalaire, nouveau.regime_rc, nouveau.date_anciennete, nouveau.actif_paie,
     b.notes ? String(b.notes).slice(0, 600) : null, req.user.sub]
  );
  // Historique des changements de remuneration / situation de paie (meme journal que la fiche employe)
  for (const [k, champ] of Object.entries(CHAMPS_HISTO_PAIE)) {
    const a = avant[k] == null ? null : String(avant[k]).slice(0, 10 + (k === "date_anciennete" ? 0 : 40));
    const n = nouveau[k] == null ? null : String(nouveau[k]).slice(0, 10 + (k === "date_anciennete" ? 0 : 40));
    if ((a || null) !== (n || null) && !(Object.keys(avant).length === 0 && n == null)) {
      await db.query(`INSERT INTO employe_historique (id, tenant_id, employe_id, champ, ancienne_valeur, nouvelle_valeur, modifie_par) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [uuidv4(), tid, emp.id, champ, a, n, req.user.sub]);
    }
  }
  // La fiche RH reste coherente avec le dossier de paie : convention, categorie, classification (sens unique paie -> fiche).
  if (cv) {
    await db.query(
      `UPDATE employe SET convention_collective = $3, categorie = COALESCE($4, categorie), classification = COALESCE($5, classification) WHERE tenant_id = $1 AND id = $2`,
      [tid, emp.id, cv.libelle, cat ? cat.libelle : null, cat ? cat.classification : null]
    );
  }
  res.json({ ok: true });
}));

router.post("/dossiers/:employeId/elements", gerer(async (req, res) => {
  const tid = tenant(req);
  if (!UUID.test(req.params.employeId)) throw new PaieError("PAIE_EMPLOYE_INTROUVABLE", 404);
  const emp = (await db.query(`SELECT id FROM employe WHERE tenant_id = $1 AND id = $2`, [tid, req.params.employeId])).rows[0];
  if (!emp) throw new PaieError("PAIE_EMPLOYE_INTROUVABLE", 404);
  const b = req.body || {};
  const code = codeNettoye(b.rubrique_code);
  const rub = (await db.query(`SELECT code FROM paie_rubrique WHERE tenant_id = $1 AND code = $2 AND actif`, [tid, code])).rows[0];
  const montant = b.montant === "" || b.montant == null ? null : entier(b.montant);
  const quantite = b.quantite === "" || b.quantite == null ? null : decimal(b.quantite);
  const debut = dateIso(b.date_debut) || new Date().toISOString().slice(0, 10), fin = dateIso(b.date_fin);
  if (!rub || (montant == null && quantite == null) || (montant != null && !(montant >= 0)) || (quantite != null && !(quantite >= 0)) || fin === undefined || (fin && fin < debut)) throw new PaieError("PAIE_ELEMENT_INVALIDE", 400);
  const r = await db.query(
    `INSERT INTO paie_element_fixe (id, tenant_id, employe_id, rubrique_code, montant, quantite, date_debut, date_fin, note) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
    [uuidv4(), tid, emp.id, code, montant, quantite, debut, fin, b.note ? String(b.note).slice(0, 300) : null]
  );
  await db.query(`INSERT INTO employe_historique (id, tenant_id, employe_id, champ, ancienne_valeur, nouvelle_valeur, modifie_par) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [uuidv4(), tid, emp.id, `paie.element.${code}`, null, `${montant != null ? montant : ""}${quantite != null ? " x " + quantite : ""} (${debut})`, req.user.sub]);
  res.status(201).json({ id: r.rows[0].id });
}));

router.patch("/elements/:id", gerer(async (req, res) => {
  const tid = tenant(req);
  if (!UUID.test(req.params.id)) throw new PaieError("PAIE_ELEMENT_INTROUVABLE", 404);
  const cur = (await db.query(`SELECT * FROM paie_element_fixe WHERE tenant_id = $1 AND id = $2`, [tid, req.params.id])).rows[0];
  if (!cur) throw new PaieError("PAIE_ELEMENT_INTROUVABLE", 404);
  const b = req.body || {};
  const montant = b.montant !== undefined ? (b.montant === "" || b.montant == null ? null : entier(b.montant)) : cur.montant == null ? null : Number(cur.montant);
  const quantite = b.quantite !== undefined ? (b.quantite === "" || b.quantite == null ? null : decimal(b.quantite)) : cur.quantite == null ? null : Number(cur.quantite);
  const fin = b.date_fin !== undefined ? dateIso(b.date_fin) : cur.date_fin;
  if ((montant == null && quantite == null) || Number.isNaN(montant) || Number.isNaN(quantite) || fin === undefined || (fin && String(fin).slice(0, 10) < String(cur.date_debut).slice(0, 10))) throw new PaieError("PAIE_ELEMENT_INVALIDE", 400);
  await db.query(`UPDATE paie_element_fixe SET montant=$3, quantite=$4, date_fin=$5, note=$6 WHERE tenant_id=$1 AND id=$2`,
    [tid, req.params.id, montant, quantite, fin || null, b.note !== undefined ? (b.note ? String(b.note).slice(0, 300) : null) : cur.note]);
  await db.query(`INSERT INTO employe_historique (id, tenant_id, employe_id, champ, ancienne_valeur, nouvelle_valeur, modifie_par) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [uuidv4(), tid, cur.employe_id, `paie.element.${cur.rubrique_code}`, `${cur.montant ?? ""}${cur.quantite != null ? " x " + cur.quantite : ""}`, `${montant ?? ""}${quantite != null ? " x " + quantite : ""}${fin ? " jusqu'au " + String(fin).slice(0, 10) : ""}`, req.user.sub]);
  res.json({ ok: true });
}));

router.delete("/elements/:id", gerer(async (req, res) => {
  if (!UUID.test(req.params.id)) throw new PaieError("PAIE_ELEMENT_INTROUVABLE", 404);
  const cur = (await db.query(`SELECT employe_id, rubrique_code FROM paie_element_fixe WHERE tenant_id = $1 AND id = $2`, [tenant(req), req.params.id])).rows[0];
  if (!cur) throw new PaieError("PAIE_ELEMENT_INTROUVABLE", 404);
  await db.query(`DELETE FROM paie_element_fixe WHERE tenant_id = $1 AND id = $2`, [tenant(req), req.params.id]);
  await db.query(`INSERT INTO employe_historique (id, tenant_id, employe_id, champ, ancienne_valeur, nouvelle_valeur, modifie_par) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [uuidv4(), tenant(req), cur.employe_id, `paie.element.${cur.rubrique_code}`, "supprimé", null, req.user.sub]);
  res.json({ ok: true });
}));

// ============================================================================================ simulateur
/**
 * Simulation d'un bulletin, sans rien enregistrer. Deux modes :
 *  - avec employe_id : dossier de paie et elements fixes du salarie (surcharges possibles) ;
 *  - libre : convention + categorie (ou salaire de base), sursalaire, parts, anciennete saisis.
 * Corps : { employe_id?, annee, mois, convention_id?, categorie_code?, salaire_base?, sursalaire?, regime_rc?, parts_ir?, parts_trimf?,
 *           annees_anciennete?, elements:[{rubrique_code, montant, quantite}], variables:{absences, heures_sup, gains, retenues}, mode_ir?, arrondi_net? }
 */
router.post("/simulation", gerer(async (req, res) => {
  const tid = tenant(req);
  const b = req.body || {};
  const annee = entier(b.annee) || new Date().getUTCFullYear();
  const mois = entier(b.mois) || new Date().getUTCMonth() + 1;
  if (!(annee >= 2000 && annee <= 2100) || !(mois >= 1 && mois <= 12)) throw new PaieError("PAIE_SIMULATION_INVALIDE", 400);
  const v = b.variables || {};
  const variables = {
    absences: Array.isArray(v.absences) ? v.absences.map((a) => ({ type: String(a.type), jours: decimal(a.jours) || 0 })) : [],
    heures_sup: Array.isArray(v.heures_sup) ? v.heures_sup.map((h) => ({ code: String(h.code), heures: decimal(h.heures) || 0 })) : [],
    gains: Array.isArray(v.gains) ? v.gains.map((g) => ({ rubrique_code: codeNettoye(g.rubrique_code), montant: g.montant === "" || g.montant == null ? null : decimal(g.montant), quantite: g.quantite === "" || g.quantite == null ? null : decimal(g.quantite) })) : [],
    retenues: Array.isArray(v.retenues) ? v.retenues.map((g) => ({ rubrique_code: codeNettoye(g.rubrique_code), montant: decimal(g.montant) || 0 })) : [],
  };
  const reglages = {};
  if (b.mode_ir && ["BAREME", "FORMULE"].includes(b.mode_ir)) reglages.mode_ir = b.mode_ir;
  if (b.arrondi_net !== undefined && [1, 5, 10, 25, 50, 100, 500, 1000].includes(entier(b.arrondi_net))) reglages.arrondi_net = entier(b.arrondi_net);
  const options = { variables, reglages };
  const surcharge = {};
  if (b.parts_ir !== undefined && b.parts_ir !== "" && b.parts_ir !== null) surcharge.parts_ir = decimal(b.parts_ir);
  if (b.parts_trimf !== undefined && b.parts_trimf !== "" && b.parts_trimf !== null) surcharge.parts_trimf = decimal(b.parts_trimf);
  let employeId = null;
  if (b.employe_id) {
    if (!UUID.test(b.employe_id)) throw new PaieError("PAIE_EMPLOYE_INTROUVABLE", 404);
    employeId = b.employe_id;
    options.employe = surcharge;
  }
  if (Array.isArray(b.elements)) options.elementsFixes = b.elements.map((e) => ({ rubrique_code: codeNettoye(e.rubrique_code), montant: e.montant === "" || e.montant == null ? null : decimal(e.montant), quantite: e.quantite === "" || e.quantite == null ? null : decimal(e.quantite) }));
  const surDossier = b.convention_id !== undefined || b.categorie_code !== undefined || b.salaire_base !== undefined || b.sursalaire !== undefined || b.regime_rc !== undefined || b.annees_anciennete !== undefined;
  if (!employeId || surDossier) {
    const base = employeId ? (await P.chargerDossier(tid, employeId)) || {} : {};
    const cid = b.convention_id !== undefined ? b.convention_id || null : base.convention_id || null;
    if (cid && !UUID.test(cid)) throw new PaieError("PAIE_CONVENTION_INTROUVABLE", 404);
    let dateAnc = base.date_anciennete || null;
    if (b.annees_anciennete !== undefined && b.annees_anciennete !== "" && b.annees_anciennete !== null) {
      const an = Math.max(0, Math.round(decimal(b.annees_anciennete) || 0));
      dateAnc = `${annee - an}-01-01`;
    }
    options.dossier = {
      convention_id: cid,
      categorie_code: b.categorie_code !== undefined ? b.categorie_code || null : base.categorie_code || null,
      salaire_base_manuel: b.salaire_base !== undefined ? (b.salaire_base === "" || b.salaire_base == null ? null : entier(b.salaire_base)) : base.salaire_base_manuel ?? null,
      sursalaire: b.sursalaire !== undefined ? entier(b.sursalaire) || 0 : Number(base.sursalaire) || 0,
      regime_rc: b.regime_rc !== undefined ? (b.regime_rc === "" || b.regime_rc == null ? null : !!b.regime_rc) : base.regime_rc ?? null,
      date_anciennete: dateAnc,
    };
    if (!employeId) {
      options.employe = { ...surcharge, parts_ir: surcharge.parts_ir || 1, parts_trimf: surcharge.parts_trimf || 1 };
      options.elementsFixes = options.elementsFixes || [];
    }
  }
  const ctx = await P.construireContexte(tid, employeId, annee, mois, options);
  const bulletin = M.calculerBulletin(ctx);
  res.json({ bulletin, sources_baremes: ctx.bareme.sources, reglages: ctx.parametres, convention: ctx.convention ? { code: ctx.convention.code, libelle: ctx.convention.libelle, majorations: ctx.convention.majorations } : null });
}));

// ============================================================================================ periodes de paie (PAIE-2)
// Ouverture sequentielle : le mois suivant ne s'ouvre qu'une fois le precedent cloture (cloture : lot PAIE-3).
router.get("/periodes", gerer(async (req, res) => {
  const tid = tenant(req);
  res.json({ periodes: await PER.lister(tid), prochaine: await PER.prochainePossible(tid), droit_validation: aDroitValidation(req) });
}));

router.get("/referentiels-variables", gerer(async (req, res) => {
  res.json(await PER.referentiels(tenant(req)));
}));

router.post("/periodes", gerer(async (req, res) => {
  const b = req.body || {};
  const p = await PER.ouvrir(tenant(req), req.user.sub, entier(b.annee) || null, entier(b.mois) || null);
  res.status(201).json(PER.vuePeriode(p));
}));

router.get("/periodes/:id", gerer(async (req, res) => {
  const tid = tenant(req);
  const p = await PER.rafraichirSiObsolete(tid, req.user.sub, await PER.chargerPeriode(tid, req.params.id));
  const [controles, bulletins] = await Promise.all([PER.controles(tid, p), PER.bulletins(tid, p.id)]);
  const t = bulletins.reduce((o, b) => ({ brut: o.brut + b.brut, net: o.net + b.net_a_payer, charges: o.charges + b.charges_patronales, ir: o.ir + b.ir, trimf: o.trimf + b.trimf }), { brut: 0, net: 0, charges: 0, ir: 0, trimf: 0 });
  const ordre = p.statut === "OUVERTE" ? null : await CL.etatOrdreVirement(tid, p);
  res.json({ periode: { ...PER.vuePeriode({ ...p, nb_bulletins: bulletins.length, total_brut: t.brut, total_net: t.net, total_charges: t.charges }), motif_reouverture: p.motif_reouverture, empreinte_archive: p.empreinte_archive, nb_fichiers_archive: Number(p.nb_fichiers_archive) || 0 }, controles, bulletins, totaux: t, ordre_virement: ordre, droit_validation: aDroitValidation(req) });
}));

router.delete("/periodes/:id", exigerValidation, gerer(async (req, res) => {
  await PER.annulerOuverture(tenant(req), req.params.id);
  res.json({ ok: true });
}));

router.post("/periodes/:id/generer", gerer(async (req, res) => {
  const tid = tenant(req);
  const r = await PER.generer(tid, req.user.sub, req.params.id);
  const p = await PER.chargerPeriode(tid, req.params.id);
  res.json({ ...r, controles: await PER.controles(tid, p) });
}));

/** Salaries concernes par la periode, avec le resume de leurs variables et de leur bulletin. */
router.get("/periodes/:id/employes", gerer(async (req, res) => {
  const tid = tenant(req);
  const p = await PER.rafraichirSiObsolete(tid, req.user.sub, await PER.chargerPeriode(tid, req.params.id));
  const [emps, vars, buls] = await Promise.all([
    PER.employesConcernes(tid, p),
    db.query(`SELECT employe_id, type, COUNT(*) AS n FROM paie_variable WHERE tenant_id = $1 AND periode_id = $2 GROUP BY employe_id, type`, [tid, p.id]),
    PER.bulletins(tid, p.id),
  ]);
  const compte = new Map();
  for (const v of vars.rows) { if (!compte.has(v.employe_id)) compte.set(v.employe_id, { HS: 0, ABSENCE: 0, GAIN: 0, RETENUE: 0 }); compte.get(v.employe_id)[v.type] = Number(v.n); }
  const parEmp = new Map(buls.map((b) => [b.employe_id, b]));
  res.json({
    periode: PER.vuePeriode(p),
    employes: emps.map((e) => {
      const b = parEmp.get(e.id);
      const c = compte.get(e.id) || { HS: 0, ABSENCE: 0, GAIN: 0, RETENUE: 0 };
      return {
        id: e.id, matricule: e.matricule, nom: e.nom, prenom: e.prenom, poste: e.poste, dossier_complet: e.dossier_complet, exclu: e.exclu,
        convention_libelle: e.convention_libelle, variables: c, nb_variables: c.HS + c.ABSENCE + c.GAIN + c.RETENUE,
        brut: b ? b.brut : null, net_a_payer: b ? b.net_a_payer : null,
        avertissements: b ? b.avertissements.filter((a) => a.niveau !== "INFO").length : 0,
      };
    }),
  });
}));

router.get("/periodes/:id/variables/:employeId", gerer(async (req, res) => {
  const tid = tenant(req);
  const p = await PER.chargerPeriode(tid, req.params.id);
  if (!UUID.test(req.params.employeId)) throw new PaieError("PAIE_EMPLOYE_INTROUVABLE", 404);
  const emp = (await PER.employesConcernes(tid, p)).find((e) => e.id === req.params.employeId);
  if (!emp) throw new PaieError("PAIE_EMPLOYE_HORS_PERIODE", 404);
  let bulletin = null;
  try { bulletin = await PER.bulletin(tid, p.id, emp.id); } catch (e) { if (!(e instanceof PaieError)) throw e; }
  const conv = emp.convention_id ? (await db.query(`SELECT majorations_json FROM paie_convention WHERE tenant_id = $1 AND id = $2`, [tid, emp.convention_id])).rows[0] : null;
  res.json({
    periode: PER.vuePeriode(p),
    employe: { id: emp.id, matricule: emp.matricule, nom: emp.nom, prenom: emp.prenom, poste: emp.poste, dossier_complet: emp.dossier_complet, exclu: emp.exclu, convention_libelle: emp.convention_libelle },
    majorations: conv ? conv.majorations_json || [] : [],
    variables: await PER.variablesEmploye(tid, p.id, emp.id),
    bulletin,
  });
}));

router.put("/periodes/:id/variables/:employeId", gerer(async (req, res) => {
  const tid = tenant(req);
  if (!UUID.test(req.params.employeId)) throw new PaieError("PAIE_EMPLOYE_INTROUVABLE", 404);
  await PER.remplacerVariablesEmploye(tid, req.user.sub, req.params.id, req.params.employeId, req.body || {});
  let bulletin = null;
  try { bulletin = await PER.bulletin(tid, req.params.id, req.params.employeId); } catch (e) { if (!(e instanceof PaieError)) throw e; }
  res.json({ ok: true, variables: await PER.variablesEmploye(tid, req.params.id, req.params.employeId), bulletin });
}));

router.get("/periodes/:id/variables-gabarit", gerer(async (req, res) => {
  const tid = tenant(req);
  const p = await PER.chargerPeriode(tid, req.params.id);
  const buf = await PER.genererGabarit(tid, p);
  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.setHeader("Content-Disposition", `attachment; filename="variables_paie_${p.annee}-${String(p.mois).padStart(2, "0")}.xlsx"`);
  res.send(buf);
}));

router.post("/periodes/:id/variables-import", televerser, gerer(async (req, res) => {
  if (!req.file) throw new PaieError("PAIE_FICHIER_REQUIS", 400);
  let r;
  try { r = await PER.importerExcel(tenant(req), req.user.sub, req.params.id, req.file.buffer); }
  catch (e) { if (e instanceof PaieError) throw e; throw new PaieError("PAIE_FICHIER_ILLISIBLE", 400); }
  res.json(r);
}));

router.post("/periodes/:id/variables-copie", gerer(async (req, res) => {
  const t = Array.isArray(req.body && req.body.types) && req.body.types.length ? req.body.types : ["GAIN", "RETENUE"];
  res.json(await PER.copierMoisPrecedent(tenant(req), req.user.sub, req.params.id, { types: t }));
}));

router.get("/periodes/:id/demandes-rh", gerer(async (req, res) => {
  const tid = tenant(req);
  res.json(await PER.demandesRh(tid, await PER.chargerPeriode(tid, req.params.id)));
}));
router.post("/periodes/:id/demandes-rh", gerer(async (req, res) => {
  res.json(await PER.appliquerDemandesRh(tenant(req), req.user.sub, req.params.id, { codeHs: codeNettoye((req.body && req.body.code_hs) || "HS_15") }));
}));

router.get("/periodes/:id/bulletins/:employeId", gerer(async (req, res) => {
  if (!UUID.test(req.params.employeId)) throw new PaieError("PAIE_BULLETIN_INTROUVABLE", 404);
  res.json(await PER.bulletin(tenant(req), req.params.id, req.params.employeId));
}));

router.get("/periodes/:id/controles", gerer(async (req, res) => {
  const tid = tenant(req);
  res.json(await PER.controles(tid, await PER.chargerPeriode(tid, req.params.id)));
}));

router.get("/periodes/:id/etats", gerer(async (req, res) => {
  const tid = tenant(req);
  res.json(await PER.etats(tid, await PER.rafraichirSiObsolete(tid, req.user.sub, await PER.chargerPeriode(tid, req.params.id))));
}));
router.get("/periodes/:id/etats.xlsx", gerer(async (req, res) => {
  const tid = tenant(req);
  const p = await PER.chargerPeriode(tid, req.params.id);
  const buf = await PER.exportEtatsXlsx(tid, p, req.query.lang === "en" ? "en" : "fr");
  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.setHeader("Content-Disposition", `attachment; filename="etats_paie_${p.annee}-${String(p.mois).padStart(2, "0")}.xlsx"`);
  res.send(buf);
}));

router.post("/periodes/:id/ordre-virement", gerer(async (req, res) => {
  const b = req.body || {};
  res.json(await PER.genererOrdreVirement(tenant(req), req.user.sub, req.params.id, {
    date_execution: b.date_execution, banque_donneur: b.banque_donneur, compte_donneur: b.compte_donneur,
  }));
}));

// ---- validation, reouverture, cloture, archives (PAIE-3A)
router.post("/periodes/:id/valider", exigerValidation, gerer(async (req, res) => {
  const p = await CL.valider(tenant(req), req.user.sub, req.params.id);
  res.json(PER.vuePeriode(p));
}));
router.post("/periodes/:id/rouvrir", exigerValidation, gerer(async (req, res) => {
  const p = await CL.rouvrir(tenant(req), req.user.sub, req.params.id, (req.body || {}).motif);
  res.json(PER.vuePeriode(p));
}));
router.post("/periodes/:id/cloturer", exigerValidation, gerer(async (req, res) => {
  const r = await CL.cloturer(tenant(req), req.user.sub, req.params.id, { lieu: (req.body || {}).lieu });
  res.json({ periode: PER.vuePeriode(r.periode), nb_fichiers: r.nb_fichiers, empreinte: r.empreinte, comptabilite: r.comptabilite });
}));
router.get("/periodes/:id/comptabilite", gerer(async (req, res) => {
  const tid = tenant(req);
  res.json(await COMPTA.apercu(tid, await PER.chargerPeriode(tid, req.params.id)));
}));
router.post("/periodes/:id/comptabiliser", exigerValidation, gerer(async (req, res) => {
  const r = await COMPTA.genererEcriture(tenant(req), req.user.sub, req.params.id);
  res.status(201).json({ numero_piece: r.ecriture.numero_piece, statut: r.ecriture.statut, nb_lignes: r.nb_lignes, total: r.total });
}));
router.get("/archives", gerer(async (req, res) => {
  res.json({ archives: await CL.listerArchives(tenant(req)) });
}));
router.get("/periodes/:id/archive", gerer(async (req, res) => {
  res.json(await CL.listerArchive(tenant(req), req.params.id));
}));
router.get("/periodes/:id/archive/verification", gerer(async (req, res) => {
  res.json(await CL.verifierArchive(tenant(req), req.params.id));
}));
router.get("/periodes/:id/archive.zip", gerer(async (req, res) => {
  const z = await CL.zipArchive(tenant(req), req.params.id);
  res.setHeader("Content-Type", "application/zip");
  res.setHeader("Content-Disposition", `attachment; filename="${z.nom}"`);
  res.send(z.contenu);
}));
router.get("/periodes/:id/archive/fichiers/:fid", gerer(async (req, res) => {
  const f = await CL.fichierArchive(tenant(req), req.params.id, req.params.fid);
  res.setHeader("Content-Type", f.mime);
  res.setHeader("Content-Disposition", `${req.query.telecharger === "1" ? "attachment" : "inline"}; filename="${f.nom_fichier}"`);
  res.send(f.contenu);
}));

// ---- etats trimestriels / annuels et indemnite de depart a la retraite (PAIE-3C)
router.get("/etats-periodiques/:annee", gerer(async (req, res) => {
  res.json(await ANN.etat(tenant(req), req.params.annee, req.query.trimestre));
}));
router.get("/etats-periodiques/:annee/export.xlsx", gerer(async (req, res) => {
  const buf = await ANN.exportXlsx(tenant(req), req.params.annee, req.query.trimestre, req.query.lang === "en" ? "en" : "fr");
  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.setHeader("Content-Disposition", `attachment; filename="etat_paie_${req.params.annee}${Number(req.query.trimestre) ? `_T${Number(req.query.trimestre)}` : ""}.xlsx"`);
  res.send(buf);
}));
router.get("/etats-periodiques/:annee/export.pdf", gerer(async (req, res) => {
  const tid = tenant(req);
  const e = await ANN.etat(tid, req.params.annee, req.query.trimestre);
  const buf = await PDFP.etatPeriodiquePdf(e, await chargerEntete(tid), { reference: `PAIE-${e.annee}${e.trimestre ? `-T${e.trimestre}` : ""}` });
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `inline; filename="etat_paie_${e.annee}${e.trimestre ? `_T${e.trimestre}` : ""}.pdf"`);
  res.send(buf);
}));


// ---- provision pour retraite a une date d'arrete (PAIE-3D)
router.get("/retraite/provision", gerer(async (req, res) => { res.json({ ...(await PROV.etat(tenant(req), req.query)), droit_validation: aDroitValidation(req) }); }));
router.put("/retraite/provision/ligne", exigerValidation, gerer(async (req, res) => { res.json({ id: await PROV.sauverLigne(tenant(req), req.user.sub, req.body) }); }));
router.delete("/retraite/provision/ligne/:id", exigerValidation, gerer(async (req, res) => { await PROV.supprimerLigne(tenant(req), req.params.id); res.json({ ok: true }); }));
router.post("/retraite/baremes/modele", exigerValidation, gerer(async (req, res) => { res.status(201).json({ id: await PROV.creerModeleBareme(tenant(req), req.user.sub) }); }));
router.get("/retraite/provision/export.xlsx", gerer(async (req, res) => {
  const tid = tenant(req);
  const e = await PROV.etat(tid, req.query);
  const buf = PROV.exportXlsx(e, await chargerEntete(tid), { preparePar: req.query.prepare_par, lang: req.query.lang === "en" ? "en" : "fr" });
  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.setHeader("Content-Disposition", `attachment; filename="provision_retraite_${e.date_arrete}.xlsx"`);
  res.send(buf);
}));
router.get("/retraite/provision/export.pdf", gerer(async (req, res) => {
  const tid = tenant(req);
  const e = await PROV.etat(tid, req.query);
  const buf = await PDFP.provisionRetraitePdf(e, await chargerEntete(tid), { preparePar: req.query.prepare_par, reference: `PROVISION-RETRAITE-${e.date_arrete}` });
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `inline; filename="provision_retraite_${e.date_arrete}.pdf"`);
  res.send(buf);
}));

router.get("/retraite/baremes", gerer(async (req, res) => {
  res.json({ baremes: await ANN.listerBaremesRetraite(tenant(req)), droit_validation: aDroitValidation(req) });
}));
router.put("/retraite/baremes", exigerValidation, gerer(async (req, res) => {
  const id = await ANN.sauverBaremeRetraite(tenant(req), req.user.sub, req.body);
  res.json({ id, baremes: await ANN.listerBaremesRetraite(tenant(req)) });
}));
router.delete("/retraite/baremes/:id", exigerValidation, gerer(async (req, res) => {
  if (!UUID.test(req.params.id)) throw new PaieError("PAIE_RETRAITE_BAREME_INTROUVABLE", 404);
  await ANN.supprimerBaremeRetraite(tenant(req), req.params.id);
  res.json({ ok: true });
}));
router.post("/retraite/calcul", gerer(async (req, res) => {
  res.json(await ANN.calculerRetraite(tenant(req), req.body));
}));
router.post("/retraite/appliquer", exigerValidation, gerer(async (req, res) => {
  const b = req.body || {};
  if (!UUID.test(String(b.employe_id)) || !UUID.test(String(b.periode_id))) throw new PaieError("PAIE_EMPLOYE_INTROUVABLE", 404);
  res.json(await ANN.appliquerRetraite(tenant(req), req.user.sub, b.periode_id, b.employe_id, b.montant));
}));

module.exports = router;
