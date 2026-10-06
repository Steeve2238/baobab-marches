/**
 * Financement v2 (06/10/2026) : banques, conditions par type de facilite,
 * simulateur multi-banques, choix de la banque, controle du montant recu.
 * Le calcul vit dans services/financementEngine.js, le catalogue des modeles
 * de lignes dans services/financementCatalogue.js.
 */
const express = require("express");
const db = require("../db");
const { v4: uuidv4 } = require("uuid");
const { requireAuth, requireModule, blockLectureSeule } = require("../middleware/auth");
const { t, resolveLangue } = require("../utils/i18n");
const catalogueSvc = require("../services/financementCatalogue");
const engine = require("../services/financementEngine");

const router = express.Router();
router.use(requireAuth);
router.use(requireModule("financement"));
router.use(blockLectureSeule);

const STATUTS_CONDITION = ["EN_NEGOCIATION", "ACTIVE", "ARCHIVEE"];
const BASES = ["TTC", "HT"];
const RETENUES = ["INCLUSE", "EN_PLUS", "A_CONFIRMER"];
const RECOURS = ["AVEC_RECOURS_NOTIFIE", "AVEC_RECOURS_NON_NOTIFIE", "SANS_RECOURS"];
const NATURES = ["COUT", "RETENUE"];
const MODES = ["POURCENT_FLAT", "POURCENT_ANNUEL", "POURCENT_PAR_PERIODE", "FORFAIT", "FORFAIT_PAR_PERIODE"];
const BASES_FRAIS = ["CREANCE", "AVANCE"];
const PERIODES = ["MOIS", "TRIMESTRE", "SEMESTRE", "AN"];
const PRELEVEMENTS = ["A_LA_MISE_EN_PLACE", "A_L_ECHEANCE"];

function fail(req, res, status, key, extra) {
  return res.status(status).json({ error: t(req, key), ...(extra || {}) });
}
function erreurInterne(req, res, err, key) {
  console.error(err);
  return fail(req, res, 500, key);
}
const numOuNull = (v) => {
  if (v === undefined || v === null || v === "") return null;
  const n = Number(String(v).replace(/\s/g, "").replace(",", "."));
  return Number.isNaN(n) ? null : n;
};
const dateOuNull = (v) => (v ? String(v).slice(0, 10) : null);
const txtOuNull = (v) => (v === undefined || v === null || String(v).trim() === "" ? null : String(v).trim());
const arr2 = (n) => Math.round(Number(n) * 100) / 100;

// ----------------------------------------------------------------------------
// Catalogue (modeles de lignes pre-remplis par type de facilite)
// ----------------------------------------------------------------------------
router.get("/catalogue", (req, res) => {
  res.json(catalogueSvc.catalogue());
});

// ----------------------------------------------------------------------------
// Banques
// ----------------------------------------------------------------------------
const TYPES_PARTENAIRE = ["BANQUE", "ASSURANCE", "SFD", "AUTRE"];

function lirePartenaire(body) {
  return {
    nom: txtOuNull(body.nom),
    sigle: txtOuNull(body.sigle),
    type_partenaire: TYPES_PARTENAIRE.includes(body.type_partenaire) ? body.type_partenaire : "BANQUE",
    agence: txtOuNull(body.agence),
    interlocuteur: txtOuNull(body.interlocuteur),
    email: txtOuNull(body.email),
    telephone: txtOuNull(body.telephone),
    adresse: txtOuNull(body.adresse),
    numero_compte: txtOuNull(body.numero_compte),
    notes: txtOuNull(body.notes),
    actif: body.actif === false ? false : true,
  };
}

router.get("/banques", async (req, res) => {
  try {
    const r = await db.query(
      `SELECT p.*,
              (SELECT COUNT(*)::int FROM financement_condition c WHERE c.partenaire_id = p.id AND c.statut <> 'ARCHIVEE') AS nb_conditions,
              (SELECT COUNT(*)::int FROM financement_condition c WHERE c.partenaire_id = p.id AND c.statut = 'ACTIVE') AS nb_conditions_actives,
              (SELECT COALESCE(SUM(s.cout_retenu_xof), 0) FROM financement_simulation s JOIN financement_condition c ON c.id = s.condition_retenue_id
                WHERE c.partenaire_id = p.id AND s.statut IN ('RETENUE','CONTROLEE')) AS cout_retenu_xof
       FROM partenaire_financier p WHERE p.tenant_id = $1 ORDER BY p.actif DESC, p.nom ASC`,
      [req.user.tenantId]
    );
    res.json(r.rows);
  } catch (err) {
    erreurInterne(req, res, err, "FIN_BANQUES_FETCH_ERROR");
  }
});

router.post("/banques", async (req, res) => {
  const p = lirePartenaire(req.body || {});
  if (!p.nom) return fail(req, res, 400, "FIN_BANQUE_NOM_REQUIS");
  try {
    const r = await db.query(
      `INSERT INTO partenaire_financier (id, tenant_id, nom, sigle, type_partenaire, agence, interlocuteur, email, telephone, adresse, numero_compte, notes, actif, contact_json)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,'{}') RETURNING *`,
      [uuidv4(), req.user.tenantId, p.nom, p.sigle, p.type_partenaire, p.agence, p.interlocuteur, p.email, p.telephone, p.adresse, p.numero_compte, p.notes, p.actif]
    );
    res.status(201).json(r.rows[0]);
  } catch (err) {
    erreurInterne(req, res, err, "FIN_BANQUE_SAVE_ERROR");
  }
});

router.get("/banques/:id", async (req, res) => {
  try {
    const b = await db.query(`SELECT * FROM partenaire_financier WHERE id = $1 AND tenant_id = $2`, [req.params.id, req.user.tenantId]);
    if (!b.rows[0]) return fail(req, res, 404, "FIN_BANQUE_NOT_FOUND");
    const conditions = await db.query(
      `SELECT c.*, (SELECT COUNT(*)::int FROM financement_condition_frais f WHERE f.condition_id = c.id AND f.actif) AS nb_lignes,
              (SELECT COUNT(*)::int FROM financement_condition_frais f WHERE f.condition_id = c.id AND f.actif AND f.taux_pct IS NULL AND f.montant_fixe IS NULL) AS nb_lignes_a_renseigner
       FROM financement_condition c WHERE c.partenaire_id = $1 AND c.tenant_id = $2
       ORDER BY (c.statut = 'ARCHIVEE'), c.type_facilite, c.date_creation DESC`,
      [req.params.id, req.user.tenantId]
    );
    res.json({ ...b.rows[0], conditions: conditions.rows });
  } catch (err) {
    erreurInterne(req, res, err, "FIN_BANQUES_FETCH_ERROR");
  }
});

router.put("/banques/:id", async (req, res) => {
  const p = lirePartenaire(req.body || {});
  if (!p.nom) return fail(req, res, 400, "FIN_BANQUE_NOM_REQUIS");
  try {
    const r = await db.query(
      `UPDATE partenaire_financier SET nom=$3, sigle=$4, type_partenaire=$5, agence=$6, interlocuteur=$7, email=$8, telephone=$9,
              adresse=$10, numero_compte=$11, notes=$12, actif=$13
       WHERE id=$1 AND tenant_id=$2 RETURNING *`,
      [req.params.id, req.user.tenantId, p.nom, p.sigle, p.type_partenaire, p.agence, p.interlocuteur, p.email, p.telephone, p.adresse, p.numero_compte, p.notes, p.actif]
    );
    if (!r.rows[0]) return fail(req, res, 404, "FIN_BANQUE_NOT_FOUND");
    res.json(r.rows[0]);
  } catch (err) {
    erreurInterne(req, res, err, "FIN_BANQUE_SAVE_ERROR");
  }
});

router.delete("/banques/:id", async (req, res) => {
  try {
    const util = await db.query(
      `SELECT COUNT(*)::int AS n FROM financement_simulation s JOIN financement_condition c ON c.id = s.condition_retenue_id
       WHERE c.partenaire_id = $1 AND c.tenant_id = $2`,
      [req.params.id, req.user.tenantId]
    );
    if (util.rows[0].n > 0) return fail(req, res, 409, "FIN_BANQUE_UTILISEE");
    const r = await db.query(`DELETE FROM partenaire_financier WHERE id = $1 AND tenant_id = $2 RETURNING id`, [req.params.id, req.user.tenantId]);
    if (!r.rows[0]) return fail(req, res, 404, "FIN_BANQUE_NOT_FOUND");
    res.json({ ok: true });
  } catch (err) {
    erreurInterne(req, res, err, "FIN_BANQUE_SAVE_ERROR");
  }
});

// ----------------------------------------------------------------------------
// Conditions (une proposition de banque pour UN type de facilite)
// ----------------------------------------------------------------------------
function lireCondition(body, type) {
  const modele = catalogueSvc.TYPES[type] || {};
  const defauts = modele.defauts || {};
  const pick = (k, dflt) => (body[k] !== undefined ? body[k] : dflt);
  const taux_avance = numOuNull(pick("taux_avance_pct", defauts.taux_avance_pct ?? 100));
  const retenue = pick("retenue_incluse_avance", defauts.retenue_incluse_avance);
  const recours = pick("recours", defauts.recours);
  const taxe = numOuNull(body.taxe_taux_pct);
  return {
    libelle: txtOuNull(body.libelle) || modele.libelle_defaut || type,
    reference_proposition: txtOuNull(body.reference_proposition),
    statut: STATUTS_CONDITION.includes(body.statut) ? body.statut : "EN_NEGOCIATION",
    date_proposition: dateOuNull(body.date_proposition),
    date_effet: dateOuNull(body.date_effet),
    date_validite: dateOuNull(body.date_validite),
    date_fin: dateOuNull(body.date_fin),
    plafond_montant: numOuNull(body.plafond_montant),
    montant_min: numOuNull(body.montant_min),
    duree_min_jours: numOuNull(body.duree_min_jours),
    duree_max_jours: numOuNull(body.duree_max_jours),
    taux_avance_pct: taux_avance === null ? 100 : taux_avance,
    retenue_incluse_avance: RETENUES.includes(retenue) ? retenue : "A_CONFIRMER",
    base_creance: BASES.includes(body.base_creance) ? body.base_creance : "TTC",
    base_jours: Number(body.base_jours) === 365 ? 365 : 360,
    jours_valeur: numOuNull(body.jours_valeur) || 0,
    duree_minimale_facturee: numOuNull(body.duree_minimale_facturee),
    taxe_libelle: txtOuNull(body.taxe_libelle) || "TOB",
    taxe_taux_pct: taxe === null ? 17 : taxe,
    recours: RECOURS.includes(recours) ? recours : null,
    domiciliation_exigee: body.domiciliation_exigee !== undefined ? !!body.domiciliation_exigee : !!defauts.domiciliation_exigee,
    restreindre_debiteurs: body.restreindre_debiteurs !== undefined ? !!body.restreindre_debiteurs : !!defauts.restreindre_debiteurs,
    debiteurs_agrees_json: Array.isArray(body.debiteurs_agrees_json)
      ? body.debiteurs_agrees_json
          .filter((d) => d && txtOuNull(d.nom))
          .map((d) => ({ nom: String(d.nom).trim(), encours_autorise: numOuNull(d.encours_autorise) }))
      : [],
    justificatifs: txtOuNull(body.justificatifs),
    conditions_particulieres: txtOuNull(body.conditions_particulieres),
    notes: txtOuNull(body.notes),
  };
}

function lireFrais(liste) {
  return (Array.isArray(liste) ? liste : [])
    .filter((l) => l && txtOuNull(l.libelle))
    .map((l, i) => ({
      ordre: i,
      code: txtOuNull(l.code) || `LIGNE_${i + 1}`,
      libelle: String(l.libelle).trim(),
      nature: NATURES.includes(l.nature) ? l.nature : "COUT",
      mode_calcul: MODES.includes(l.mode_calcul) ? l.mode_calcul : "POURCENT_FLAT",
      base: BASES_FRAIS.includes(l.base) ? l.base : "CREANCE",
      taux_pct: numOuNull(l.taux_pct),
      montant_fixe: numOuNull(l.montant_fixe),
      periode: PERIODES.includes(l.periode) ? l.periode : null,
      periode_entamee: l.periode_entamee === false ? false : true,
      minimum: numOuNull(l.minimum),
      maximum: numOuNull(l.maximum),
      prelevement: PRELEVEMENTS.includes(l.prelevement) ? l.prelevement : "A_LA_MISE_EN_PLACE",
      soumis_taxe: l.soumis_taxe === false ? false : true,
      actif: l.actif === false ? false : true,
      observation: txtOuNull(l.observation),
    }));
}

async function insererFrais(client, conditionId, frais) {
  for (const f of frais) {
    await client.query(
      `INSERT INTO financement_condition_frais (id, condition_id, ordre, code, libelle, nature, mode_calcul, base, taux_pct, montant_fixe,
              periode, periode_entamee, minimum, maximum, prelevement, soumis_taxe, actif, observation)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)`,
      [uuidv4(), conditionId, f.ordre, f.code, f.libelle, f.nature, f.mode_calcul, f.base, f.taux_pct, f.montant_fixe,
        f.periode, f.periode_entamee, f.minimum, f.maximum, f.prelevement, f.soumis_taxe, f.actif, f.observation]
    );
  }
}

async function chargerCondition(tenantId, id) {
  const c = await db.query(
    `SELECT c.*, p.nom AS partenaire_nom, p.sigle AS partenaire_sigle FROM financement_condition c
     JOIN partenaire_financier p ON p.id = c.partenaire_id WHERE c.id = $1 AND c.tenant_id = $2`,
    [id, tenantId]
  );
  if (!c.rows[0]) return null;
  const f = await db.query(`SELECT * FROM financement_condition_frais WHERE condition_id = $1 ORDER BY ordre ASC, libelle ASC`, [id]);
  return { ...c.rows[0], frais: f.rows };
}

const COLONNES_CONDITION = [
  "libelle", "reference_proposition", "statut", "date_proposition", "date_effet", "date_validite", "date_fin", "plafond_montant",
  "montant_min", "duree_min_jours", "duree_max_jours", "taux_avance_pct", "retenue_incluse_avance", "base_creance", "base_jours",
  "jours_valeur", "duree_minimale_facturee", "taxe_libelle", "taxe_taux_pct", "recours", "domiciliation_exigee", "restreindre_debiteurs",
  "debiteurs_agrees_json", "justificatifs", "conditions_particulieres", "notes",
];
const valeursCondition = (c) => COLONNES_CONDITION.map((k) => (k === "debiteurs_agrees_json" ? JSON.stringify(c[k]) : c[k]));

router.get("/conditions", async (req, res) => {
  try {
    const params = [req.user.tenantId];
    let where = "c.tenant_id = $1";
    if (req.query.type) {
      params.push(req.query.type);
      where += ` AND c.type_facilite = $${params.length}`;
    }
    if (req.query.partenaire_id) {
      params.push(req.query.partenaire_id);
      where += ` AND c.partenaire_id = $${params.length}`;
    }
    if (req.query.statut) {
      params.push(req.query.statut);
      where += ` AND c.statut = $${params.length}`;
    } else if (!req.query.avec_archivees) {
      where += ` AND c.statut <> 'ARCHIVEE'`;
    }
    const r = await db.query(
      `SELECT c.*, p.nom AS partenaire_nom, p.sigle AS partenaire_sigle,
              (SELECT COUNT(*)::int FROM financement_condition_frais f WHERE f.condition_id = c.id AND f.actif) AS nb_lignes,
              (SELECT COUNT(*)::int FROM financement_condition_frais f WHERE f.condition_id = c.id AND f.actif AND f.taux_pct IS NULL AND f.montant_fixe IS NULL) AS nb_lignes_a_renseigner
       FROM financement_condition c JOIN partenaire_financier p ON p.id = c.partenaire_id
       WHERE ${where} ORDER BY c.type_facilite, p.nom, c.date_creation DESC`,
      params
    );
    res.json(r.rows);
  } catch (err) {
    erreurInterne(req, res, err, "FIN_CONDITIONS_FETCH_ERROR");
  }
});

router.post("/conditions", async (req, res) => {
  const body = req.body || {};
  const type = body.type_facilite;
  if (!catalogueSvc.TYPES[type]) return fail(req, res, 400, "FIN_TYPE_INVALIDE");
  if (!body.partenaire_id) return fail(req, res, 400, "FIN_BANQUE_REQUISE");
  const client = await db.pool.connect();
  try {
    const b = await client.query(`SELECT id FROM partenaire_financier WHERE id = $1 AND tenant_id = $2`, [body.partenaire_id, req.user.tenantId]);
    if (!b.rows[0]) {
      client.release();
      return fail(req, res, 404, "FIN_BANQUE_NOT_FOUND");
    }
    const c = lireCondition(body, type);
    // Lignes : celles envoyees, sinon le modele pre-rempli du type de facilite.
    let frais = lireFrais(body.frais);
    if (!frais.length) frais = lireFrais(catalogueSvc.modele(type).lignes);
    const id = uuidv4();
    await client.query("BEGIN");
    await client.query(
      `INSERT INTO financement_condition (id, tenant_id, partenaire_id, type_facilite, ${COLONNES_CONDITION.join(", ")}, cree_par)
       VALUES ($1,$2,$3,$4, ${COLONNES_CONDITION.map((_, i) => `$${i + 5}`).join(", ")}, $${COLONNES_CONDITION.length + 5})`,
      [id, req.user.tenantId, body.partenaire_id, type, ...valeursCondition(c), req.user.sub]
    );
    await insererFrais(client, id, frais);
    await client.query("COMMIT");
    client.release();
    res.status(201).json(await chargerCondition(req.user.tenantId, id));
  } catch (err) {
    try { await client.query("ROLLBACK"); } catch (e) { /* deja ferme */ }
    client.release();
    erreurInterne(req, res, err, "FIN_CONDITION_SAVE_ERROR");
  }
});

router.get("/conditions/:id", async (req, res) => {
  try {
    const c = await chargerCondition(req.user.tenantId, req.params.id);
    if (!c) return fail(req, res, 404, "FIN_CONDITION_NOT_FOUND");
    res.json({ ...c, modele: catalogueSvc.modele(c.type_facilite) });
  } catch (err) {
    erreurInterne(req, res, err, "FIN_CONDITIONS_FETCH_ERROR");
  }
});

router.put("/conditions/:id", async (req, res) => {
  const body = req.body || {};
  const client = await db.pool.connect();
  try {
    const ex = await client.query(`SELECT id, type_facilite FROM financement_condition WHERE id = $1 AND tenant_id = $2`, [req.params.id, req.user.tenantId]);
    if (!ex.rows[0]) {
      client.release();
      return fail(req, res, 404, "FIN_CONDITION_NOT_FOUND");
    }
    const c = lireCondition(body, ex.rows[0].type_facilite);
    await client.query("BEGIN");
    await client.query(
      `UPDATE financement_condition SET ${COLONNES_CONDITION.map((k, i) => `${k} = $${i + 3}`).join(", ")}, date_maj = now() WHERE id = $1 AND tenant_id = $2`,
      [req.params.id, req.user.tenantId, ...valeursCondition(c)]
    );
    if (Array.isArray(body.frais)) {
      await client.query(`DELETE FROM financement_condition_frais WHERE condition_id = $1`, [req.params.id]);
      await insererFrais(client, req.params.id, lireFrais(body.frais));
    }
    await client.query("COMMIT");
    client.release();
    const complet = await chargerCondition(req.user.tenantId, req.params.id);
    res.json({ ...complet, modele: catalogueSvc.modele(complet.type_facilite) });
  } catch (err) {
    try { await client.query("ROLLBACK"); } catch (e) { /* deja ferme */ }
    client.release();
    erreurInterne(req, res, err, "FIN_CONDITION_SAVE_ERROR");
  }
});

// Duplique une condition (utile pour une nouvelle proposition de la meme banque).
router.post("/conditions/:id/dupliquer", async (req, res) => {
  const client = await db.pool.connect();
  try {
    const src = await chargerCondition(req.user.tenantId, req.params.id);
    if (!src) {
      client.release();
      return fail(req, res, 404, "FIN_CONDITION_NOT_FOUND");
    }
    const id = uuidv4();
    const c = lireCondition({ ...src, libelle: `${src.libelle} (copie)`, statut: "EN_NEGOCIATION", reference_proposition: null }, src.type_facilite);
    await client.query("BEGIN");
    await client.query(
      `INSERT INTO financement_condition (id, tenant_id, partenaire_id, type_facilite, ${COLONNES_CONDITION.join(", ")}, cree_par)
       VALUES ($1,$2,$3,$4, ${COLONNES_CONDITION.map((_, i) => `$${i + 5}`).join(", ")}, $${COLONNES_CONDITION.length + 5})`,
      [id, req.user.tenantId, src.partenaire_id, src.type_facilite, ...valeursCondition(c), req.user.sub]
    );
    await insererFrais(client, id, lireFrais(src.frais));
    await client.query("COMMIT");
    client.release();
    res.status(201).json(await chargerCondition(req.user.tenantId, id));
  } catch (err) {
    try { await client.query("ROLLBACK"); } catch (e) { /* deja ferme */ }
    client.release();
    erreurInterne(req, res, err, "FIN_CONDITION_SAVE_ERROR");
  }
});

router.delete("/conditions/:id", async (req, res) => {
  try {
    const util = await db.query(
      `SELECT COUNT(*)::int AS n FROM financement_simulation WHERE condition_retenue_id = $1 AND tenant_id = $2`,
      [req.params.id, req.user.tenantId]
    );
    if (util.rows[0].n > 0) return fail(req, res, 409, "FIN_CONDITION_UTILISEE");
    const r = await db.query(`DELETE FROM financement_condition WHERE id = $1 AND tenant_id = $2 RETURNING id`, [req.params.id, req.user.tenantId]);
    if (!r.rows[0]) return fail(req, res, 404, "FIN_CONDITION_NOT_FOUND");
    res.json({ ok: true });
  } catch (err) {
    erreurInterne(req, res, err, "FIN_CONDITION_SAVE_ERROR");
  }
});

// ----------------------------------------------------------------------------
// Simulations
// ----------------------------------------------------------------------------
function messageEntree(err) {
  if (err && err.message === "MONTANT_INVALIDE") return "FIN_MONTANT_INVALIDE";
  if (err && err.message === "DUREE_INVALIDE") return "FIN_DUREE_INVALIDE";
  return null;
}

/** Complete l'entree depuis une facture de vente (montants TTC/HT, echeance, client). */
async function entreeDepuisBody(tenantId, body) {
  const brut = { ...body };
  if (body.facture_vente_id) {
    const f = await db.query(
      `SELECT f.total_ht, f.total_ttc, f.montant_net_a_payer, f.date_echeance, c.nom AS client_nom
       FROM facture_vente f JOIN client_commercial c ON c.id = f.client_commercial_id WHERE f.id = $1 AND f.tenant_id = $2`,
      [body.facture_vente_id, tenantId]
    );
    if (f.rows[0]) {
      const fv = f.rows[0];
      if (!brut.montant) brut.montant = Number(fv.montant_net_a_payer) || Number(fv.total_ttc);
      if (!brut.montant_ht) brut.montant_ht = Number(fv.total_ht);
      if (!brut.date_echeance && !brut.duree_jours) brut.date_echeance = fv.date_echeance;
      if (!brut.debiteur) brut.debiteur = fv.client_nom;
    }
  }
  if (brut.date_echeance && !brut.date_prise) brut.date_prise = new Date().toISOString().slice(0, 10);
  return engine.normaliserEntree(brut);
}

async function elementsPourType(tenantId, type, filtres) {
  const params = [tenantId, type];
  let where = `c.tenant_id = $1 AND c.type_facilite = $2 AND c.statut <> 'ARCHIVEE' AND p.actif`;
  if (Array.isArray(filtres.condition_ids) && filtres.condition_ids.length) {
    params.push(filtres.condition_ids);
    where += ` AND c.id = ANY($${params.length}::uuid[])`;
  }
  const conds = await db.query(
    `SELECT c.*, p.nom AS partenaire_nom FROM financement_condition c JOIN partenaire_financier p ON p.id = c.partenaire_id WHERE ${where}`,
    params
  );
  if (!conds.rows.length) return [];
  const ids = conds.rows.map((c) => c.id);
  const frais = await db.query(`SELECT * FROM financement_condition_frais WHERE condition_id = ANY($1::uuid[]) ORDER BY ordre ASC`, [ids]);
  return conds.rows.map((c) => ({ condition: c, frais: frais.rows.filter((f) => f.condition_id === c.id) }));
}

async function calculerComparatif(req, res) {
  const body = req.body || {};
  const type = body.type_facilite;
  if (!catalogueSvc.TYPES[type]) {
    fail(req, res, 400, "FIN_TYPE_INVALIDE");
    return null;
  }
  let entree;
  try {
    entree = await entreeDepuisBody(req.user.tenantId, body);
  } catch (err) {
    const key = messageEntree(err);
    if (key) {
      fail(req, res, 400, key);
      return null;
    }
    throw err;
  }
  const elements = await elementsPourType(req.user.tenantId, type, body);
  if (!elements.length) {
    fail(req, res, 404, "FIN_AUCUNE_CONDITION");
    return null;
  }
  const resultat = engine.comparer(elements, { ...entree }, resolveLangue(req));
  return { type, entree: resultat.entree, resultat };
}

// Simulation sans enregistrement (le simulateur de la page Financement).
router.post("/simulations/calculer", async (req, res) => {
  try {
    const out = await calculerComparatif(req, res);
    if (!out) return;
    res.json({ type_facilite: out.type, ...out.resultat });
  } catch (err) {
    erreurInterne(req, res, err, "FIN_SIMULATION_ERROR");
  }
});

async function simulationComplete(tenantId, id) {
  const s = await db.query(
    `SELECT s.*, p.nom AS partenaire_retenu_nom, fv.numero AS facture_numero,
            COALESCE(d.intitule, cons.objet) AS dossier_libelle
     FROM financement_simulation s
     LEFT JOIN financement_condition c ON c.id = s.condition_retenue_id
     LEFT JOIN partenaire_financier p ON p.id = c.partenaire_id
     LEFT JOIN facture_vente fv ON fv.id = s.facture_vente_id
     LEFT JOIN dossier_ao d ON d.id = s.dossier_ao_id
     LEFT JOIN consultation cons ON cons.id = s.consultation_id
     WHERE s.id = $1 AND s.tenant_id = $2`,
    [id, tenantId]
  );
  if (!s.rows[0]) return null;
  const controles = await db.query(`SELECT * FROM financement_controle WHERE simulation_id = $1 ORDER BY date_creation DESC`, [id]);
  return { ...s.rows[0], controles: controles.rows };
}

// Simulation enregistree (historique + base du choix de banque).
router.post("/simulations", async (req, res) => {
  try {
    const out = await calculerComparatif(req, res);
    if (!out) return;
    const b = req.body || {};
    const e = out.entree;
    const id = uuidv4();
    await db.query(
      `INSERT INTO financement_simulation (id, tenant_id, libelle, type_facilite, montant, montant_ht, date_prise, date_echeance, duree_jours, debiteur,
              facture_vente_id, dossier_ao_id, consultation_id, resultats_json, commentaire_json, cree_par)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
      [id, req.user.tenantId, txtOuNull(b.libelle), out.type, e.montant, e.montant_ht, e.date_prise, e.date_echeance, e.duree_jours, e.debiteur,
        b.facture_vente_id || null, b.dossier_ao_id || null, b.consultation_id || null,
        JSON.stringify({ releves: out.resultat.releves, classement: out.resultat.classement }), JSON.stringify(out.resultat.commentaire), req.user.sub]
    );
    res.status(201).json(await simulationComplete(req.user.tenantId, id));
  } catch (err) {
    erreurInterne(req, res, err, "FIN_SIMULATION_ERROR");
  }
});

router.get("/simulations", async (req, res) => {
  try {
    const params = [req.user.tenantId];
    let where = "s.tenant_id = $1";
    for (const [k, col] of [["dossier_ao_id", "s.dossier_ao_id"], ["consultation_id", "s.consultation_id"], ["facture_vente_id", "s.facture_vente_id"], ["statut", "s.statut"], ["type_facilite", "s.type_facilite"]]) {
      if (req.query[k]) {
        params.push(req.query[k]);
        where += ` AND ${col} = $${params.length}`;
      }
    }
    const r = await db.query(
      `SELECT s.id, s.libelle, s.type_facilite, s.montant, s.duree_jours, s.debiteur, s.statut, s.cout_retenu_xof, s.date_creation, s.date_retenue,
              s.dossier_ao_id, s.consultation_id, s.facture_vente_id, s.condition_retenue_id,
              p.nom AS partenaire_retenu_nom, fv.numero AS facture_numero, COALESCE(d.intitule, cons.objet) AS dossier_libelle,
              jsonb_array_length(COALESCE(s.resultats_json->'releves', '[]'::jsonb)) AS nb_banques,
              (SELECT COUNT(*)::int FROM financement_controle fc WHERE fc.simulation_id = s.id) AS nb_controles
       FROM financement_simulation s
       LEFT JOIN financement_condition c ON c.id = s.condition_retenue_id
       LEFT JOIN partenaire_financier p ON p.id = c.partenaire_id
       LEFT JOIN facture_vente fv ON fv.id = s.facture_vente_id
       LEFT JOIN dossier_ao d ON d.id = s.dossier_ao_id
       LEFT JOIN consultation cons ON cons.id = s.consultation_id
       WHERE ${where} ORDER BY s.date_creation DESC LIMIT 200`,
      params
    );
    res.json(r.rows);
  } catch (err) {
    erreurInterne(req, res, err, "FIN_SIMULATIONS_FETCH_ERROR");
  }
});

router.get("/simulations/:id", async (req, res) => {
  try {
    const s = await simulationComplete(req.user.tenantId, req.params.id);
    if (!s) return fail(req, res, 404, "FIN_SIMULATION_NOT_FOUND");
    res.json(s);
  } catch (err) {
    erreurInterne(req, res, err, "FIN_SIMULATIONS_FETCH_ERROR");
  }
});

router.delete("/simulations/:id", async (req, res) => {
  try {
    const s = await db.query(`SELECT statut FROM financement_simulation WHERE id = $1 AND tenant_id = $2`, [req.params.id, req.user.tenantId]);
    if (!s.rows[0]) return fail(req, res, 404, "FIN_SIMULATION_NOT_FOUND");
    if (s.rows[0].statut !== "SIMULEE") return fail(req, res, 409, "FIN_SIMULATION_RETENUE_SUPPRESSION");
    await db.query(`DELETE FROM financement_simulation WHERE id = $1 AND tenant_id = $2`, [req.params.id, req.user.tenantId]);
    res.json({ ok: true });
  } catch (err) {
    erreurInterne(req, res, err, "FIN_SIMULATION_ERROR");
  }
});

// Choisir une banque : fige son releve (il ne bougera plus si la banque modifie
// ses conditions) et alimente le tableau des marges via cout_retenu_xof.
router.post("/simulations/:id/retenir", async (req, res) => {
  try {
    const s = await db.query(`SELECT * FROM financement_simulation WHERE id = $1 AND tenant_id = $2`, [req.params.id, req.user.tenantId]);
    if (!s.rows[0]) return fail(req, res, 404, "FIN_SIMULATION_NOT_FOUND");
    const conditionId = req.body && req.body.condition_id;
    const releves = (s.rows[0].resultats_json && s.rows[0].resultats_json.releves) || [];
    const releve = releves.find((r) => r.condition_id === conditionId);
    if (!releve) return fail(req, res, 404, "FIN_CONDITION_NOT_FOUND");
    if (!releve.eligible) return fail(req, res, 409, "FIN_CONDITION_NON_ELIGIBLE", { bloquants: releve.bloquants });
    const cond = await chargerCondition(req.user.tenantId, conditionId);
    const snapshot = cond ? { condition: cond, frais: cond.frais } : {};
    const b = req.body || {};
    await db.query(
      `UPDATE financement_simulation SET statut = CASE WHEN statut = 'CONTROLEE' THEN statut ELSE 'RETENUE' END, condition_retenue_id = $3,
              releve_retenu_json = $4, cout_retenu_xof = $5, date_retenue = now(),
              dossier_ao_id = COALESCE($6, dossier_ao_id), consultation_id = COALESCE($7, consultation_id), facture_vente_id = COALESCE($8, facture_vente_id)
       WHERE id = $1 AND tenant_id = $2`,
      [req.params.id, req.user.tenantId, cond ? conditionId : null, JSON.stringify({ releve, ...snapshot }), arr2(releve.totaux.cout_ttc),
        b.dossier_ao_id || null, b.consultation_id || null, b.facture_vente_id || null]
    );
    res.json(await simulationComplete(req.user.tenantId, req.params.id));
  } catch (err) {
    erreurInterne(req, res, err, "FIN_SIMULATION_ERROR");
  }
});

router.post("/simulations/:id/annuler-choix", async (req, res) => {
  try {
    const r = await db.query(
      `UPDATE financement_simulation SET statut = 'SIMULEE', condition_retenue_id = NULL, releve_retenu_json = NULL, cout_retenu_xof = NULL, date_retenue = NULL
       WHERE id = $1 AND tenant_id = $2 AND NOT EXISTS (SELECT 1 FROM financement_controle fc WHERE fc.simulation_id = $1) RETURNING id`,
      [req.params.id, req.user.tenantId]
    );
    if (!r.rows[0]) return fail(req, res, 409, "FIN_ANNULER_CHOIX_IMPOSSIBLE");
    res.json(await simulationComplete(req.user.tenantId, req.params.id));
  } catch (err) {
    erreurInterne(req, res, err, "FIN_SIMULATION_ERROR");
  }
});

// Lier (ou delier) la simulation a un dossier d'appel d'offres, une consultation ou une facture.
router.post("/simulations/:id/lier", async (req, res) => {
  const b = req.body || {};
  try {
    const r = await db.query(
      `UPDATE financement_simulation SET dossier_ao_id = $3, consultation_id = $4, facture_vente_id = $5
       WHERE id = $1 AND tenant_id = $2 RETURNING id`,
      [req.params.id, req.user.tenantId, b.dossier_ao_id || null, b.consultation_id || null, b.facture_vente_id || null]
    );
    if (!r.rows[0]) return fail(req, res, 404, "FIN_SIMULATION_NOT_FOUND");
    res.json(await simulationComplete(req.user.tenantId, req.params.id));
  } catch (err) {
    erreurInterne(req, res, err, "FIN_SIMULATION_ERROR");
  }
});

// ----------------------------------------------------------------------------
// Controle du montant recu
// ----------------------------------------------------------------------------
function lireLignesBanque(liste) {
  return (Array.isArray(liste) ? liste : [])
    .map((l) => ({ libelle: txtOuNull(l && l.libelle), montant: numOuNull(l && l.montant) }))
    .filter((l) => l.libelle && l.montant !== null);
}

async function enregistrerControle(req, simulationId, conditionId, snapshot, body) {
  const recu = numOuNull(body.montant_recu);
  if (recu === null) throw new Error("RECU_INVALIDE");
  const sim = (await db.query(`SELECT * FROM financement_simulation WHERE id = $1 AND tenant_id = $2`, [simulationId, req.user.tenantId])).rows[0];
  const entree = engine.normaliserEntree({
    montant: sim.montant, montant_ht: sim.montant_ht, date_prise: sim.date_prise, date_echeance: sim.date_echeance, duree_jours: sim.duree_jours, debiteur: sim.debiteur,
  });
  const lignesBanque = lireLignesBanque(body.lignes_banque);
  const analyse = engine.analyserVersement({
    condition: snapshot.condition,
    frais: snapshot.frais,
    entree,
    montant_recu: recu,
    date_prise_reelle: dateOuNull(body.date_prise_reelle),
    date_echeance_reelle: dateOuNull(body.date_echeance_reelle),
    lignes_banque: lignesBanque,
    lang: resolveLangue(req),
  });
  const id = uuidv4();
  await db.query(
    `INSERT INTO financement_controle (id, tenant_id, simulation_id, condition_id, partenaire_nom, montant_recu, date_versement, date_prise_reelle,
            date_echeance_reelle, lignes_banque_json, resultat_json, notes, cree_par)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
    [id, req.user.tenantId, simulationId, conditionId, snapshot.condition.partenaire_nom || null, recu, dateOuNull(body.date_versement),
      dateOuNull(body.date_prise_reelle), dateOuNull(body.date_echeance_reelle), JSON.stringify(lignesBanque), JSON.stringify(analyse), txtOuNull(body.notes), req.user.sub]
  );
  await db.query(`UPDATE financement_simulation SET statut = 'CONTROLEE' WHERE id = $1 AND tenant_id = $2`, [simulationId, req.user.tenantId]);
  return { id, analyse };
}

router.post("/simulations/:id/controles", async (req, res) => {
  try {
    const s = await db.query(`SELECT * FROM financement_simulation WHERE id = $1 AND tenant_id = $2`, [req.params.id, req.user.tenantId]);
    if (!s.rows[0]) return fail(req, res, 404, "FIN_SIMULATION_NOT_FOUND");
    const conditionId = (req.body && req.body.condition_id) || s.rows[0].condition_retenue_id;
    if (!conditionId) return fail(req, res, 400, "FIN_CONTROLE_BANQUE_REQUISE");
    let snapshot = null;
    const retenu = s.rows[0].releve_retenu_json;
    if (retenu && retenu.condition && retenu.condition.id === conditionId) snapshot = { condition: retenu.condition, frais: retenu.frais };
    if (!snapshot) {
      const cond = await chargerCondition(req.user.tenantId, conditionId);
      if (!cond) return fail(req, res, 404, "FIN_CONDITION_NOT_FOUND");
      snapshot = { condition: cond, frais: cond.frais };
    }
    const out = await enregistrerControle(req, req.params.id, conditionId, snapshot, req.body || {});
    res.status(201).json({ id: out.id, ...out.analyse });
  } catch (err) {
    if (err.message === "RECU_INVALIDE") return fail(req, res, 400, "FIN_RECU_REQUIS");
    erreurInterne(req, res, err, "FIN_CONTROLE_ERROR");
  }
});

// Controle direct : la banque a deja verse l'argent, on saisit la facilite
// (banque + conditions), le montant demande et le montant recu.
router.post("/controle-direct", async (req, res) => {
  const b = req.body || {};
  try {
    if (!b.condition_id) return fail(req, res, 400, "FIN_CONTROLE_BANQUE_REQUISE");
    const cond = await chargerCondition(req.user.tenantId, b.condition_id);
    if (!cond) return fail(req, res, 404, "FIN_CONDITION_NOT_FOUND");
    let entree;
    try {
      entree = await entreeDepuisBody(req.user.tenantId, b);
    } catch (err) {
      const key = messageEntree(err);
      if (key) return fail(req, res, 400, key);
      throw err;
    }
    if (numOuNull(b.montant_recu) === null) return fail(req, res, 400, "FIN_RECU_REQUIS");
    const snapshot = { condition: cond, frais: cond.frais };
    const releve = engine.calculerReleve(cond, cond.frais, entree, { lang: resolveLangue(req) });
    const id = uuidv4();
    await db.query(
      `INSERT INTO financement_simulation (id, tenant_id, libelle, type_facilite, montant, montant_ht, date_prise, date_echeance, duree_jours, debiteur,
              facture_vente_id, dossier_ao_id, consultation_id, resultats_json, commentaire_json, statut, condition_retenue_id, releve_retenu_json,
              cout_retenu_xof, date_retenue, cree_par)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,'{}','RETENUE',$15,$16,$17,now(),$18)`,
      [id, req.user.tenantId, txtOuNull(b.libelle), cond.type_facilite, entree.montant, entree.montant_ht, entree.date_prise, entree.date_echeance, entree.duree_jours, entree.debiteur,
        b.facture_vente_id || null, b.dossier_ao_id || null, b.consultation_id || null, JSON.stringify({ releves: [releve], classement: {} }),
        cond.id, JSON.stringify({ releve, ...snapshot }), arr2(releve.totaux.cout_ttc), req.user.sub]
    );
    const out = await enregistrerControle(req, id, cond.id, snapshot, b);
    res.status(201).json({ simulation_id: id, id: out.id, ...out.analyse });
  } catch (err) {
    erreurInterne(req, res, err, "FIN_CONTROLE_ERROR");
  }
});

router.delete("/controles/:id", async (req, res) => {
  try {
    const r = await db.query(`DELETE FROM financement_controle WHERE id = $1 AND tenant_id = $2 RETURNING simulation_id`, [req.params.id, req.user.tenantId]);
    if (!r.rows[0]) return fail(req, res, 404, "FIN_SIMULATION_NOT_FOUND");
    await db.query(
      `UPDATE financement_simulation SET statut = 'RETENUE' WHERE id = $1 AND tenant_id = $2 AND statut = 'CONTROLEE'
         AND NOT EXISTS (SELECT 1 FROM financement_controle WHERE simulation_id = $1)`,
      [r.rows[0].simulation_id, req.user.tenantId]
    );
    res.json({ ok: true });
  } catch (err) {
    erreurInterne(req, res, err, "FIN_CONTROLE_ERROR");
  }
});

// ----------------------------------------------------------------------------
// Tableau de bord : couts bancaires retenus (alimente les marges)
// ----------------------------------------------------------------------------
router.get("/synthese", async (req, res) => {
  try {
    const parBanque = await db.query(
      `SELECT p.id AS partenaire_id, p.nom AS partenaire_nom, COUNT(*)::int AS nb, COALESCE(SUM(s.cout_retenu_xof),0) AS cout_xof,
              COALESCE(SUM(s.montant),0) AS montant_xof
       FROM financement_simulation s JOIN financement_condition c ON c.id = s.condition_retenue_id JOIN partenaire_financier p ON p.id = c.partenaire_id
       WHERE s.tenant_id = $1 AND s.statut IN ('RETENUE','CONTROLEE') GROUP BY p.id, p.nom ORDER BY cout_xof DESC`,
      [req.user.tenantId]
    );
    const parType = await db.query(
      `SELECT s.type_facilite, COUNT(*)::int AS nb, COALESCE(SUM(s.cout_retenu_xof),0) AS cout_xof
       FROM financement_simulation s WHERE s.tenant_id = $1 AND s.statut IN ('RETENUE','CONTROLEE') GROUP BY s.type_facilite ORDER BY cout_xof DESC`,
      [req.user.tenantId]
    );
    const total = parBanque.rows.reduce((s, r) => s + Number(r.cout_xof), 0);
    res.json({ total_cout_xof: arr2(total), par_banque: parBanque.rows, par_type: parType.rows });
  } catch (err) {
    erreurInterne(req, res, err, "FIN_SIMULATIONS_FETCH_ERROR");
  }
});

// Couts bancaires retenus pour un dossier d'appel d'offres ou une consultation.
router.get("/dossiers/:type/:id", async (req, res) => {
  const col = req.params.type === "ao" ? "dossier_ao_id" : req.params.type === "consultation" ? "consultation_id" : null;
  if (!col) return fail(req, res, 400, "FIN_TYPE_INVALIDE");
  try {
    const r = await db.query(
      `SELECT s.id, s.libelle, s.type_facilite, s.montant, s.duree_jours, s.statut, s.cout_retenu_xof, s.date_retenue, s.date_creation,
              s.releve_retenu_json->'releve'->'totaux' AS totaux, p.nom AS partenaire_retenu_nom
       FROM financement_simulation s
       LEFT JOIN financement_condition c ON c.id = s.condition_retenue_id
       LEFT JOIN partenaire_financier p ON p.id = c.partenaire_id
       WHERE s.tenant_id = $1 AND s.${col} = $2 ORDER BY s.date_creation DESC`,
      [req.user.tenantId, req.params.id]
    );
    const retenues = r.rows.filter((s) => s.statut !== "SIMULEE");
    res.json({ simulations: r.rows, cout_retenu_total_xof: arr2(retenues.reduce((s, x) => s + Number(x.cout_retenu_xof || 0), 0)) });
  } catch (err) {
    erreurInterne(req, res, err, "FIN_SIMULATIONS_FETCH_ERROR");
  }
});

module.exports = router;
