/**
 * Modes de reglement parametrables (Pack Commerce, lot 1).
 *
 * Un mode de reglement relie un moyen de paiement (especes, virement, cheque, carte,
 * Orange Money, Wave...) a la tresorerie : journal (BANQUE/CAISSE), compte de tresorerie,
 * compte d'attente et commission eventuels. Tous les reglements (ventes, comptabilite
 * clients et fournisseurs) passent par ce module : aucun compte n'est fige dans le code,
 * les valeurs ci-dessous ne sont que des propositions de depart modifiables par l'entreprise.
 */
const { v4: uuidv4 } = require("uuid");

const TYPES = ["ESPECES", "VIREMENT", "CHEQUE", "CARTE", "MOBILE_MONEY", "AUTRE"];
const SENS = ["ENCAISSEMENT", "DECAISSEMENT", "LES_DEUX"];

// Propositions de depart. Les comptes sont laisses vides : le journal choisi (ou le compte saisi
// par l'entreprise) fait foi. Le comptable parametre ensuite chaque mode.
const DEFAUTS = [
  { code: "ESPECES", libelle: "Espèces", type_mode: "ESPECES", par_defaut: true },
  { code: "VIREMENT", libelle: "Virement", type_mode: "VIREMENT" },
  { code: "CHEQUE", libelle: "Chèque", type_mode: "CHEQUE" },
  { code: "CARTE", libelle: "Carte bancaire", type_mode: "CARTE" },
  { code: "ORANGE_MONEY", libelle: "Orange Money", type_mode: "MOBILE_MONEY" },
  { code: "WAVE", libelle: "Wave", type_mode: "MOBILE_MONEY" },
];

class ModeError extends Error {
  constructor(code, status = 400, details = {}) {
    super(code);
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

const texteOuNull = (v, max = 60) => {
  const s = String(v ?? "").trim().slice(0, max);
  return s || null;
};

/** Cree les modes de depart pour une entreprise qui n'en a encore aucun. */
async function assurerDefauts(queryable, tenantId) {
  const n = await queryable.query(`SELECT COUNT(*)::int AS n FROM mode_reglement WHERE tenant_id = $1`, [tenantId]);
  if (n.rows[0].n > 0) return false;
  let ordre = 0;
  for (const d of DEFAUTS) {
    ordre += 10;
    await queryable.query(
      `INSERT INTO mode_reglement (id, tenant_id, code, libelle, type_mode, par_defaut, ordre)
       VALUES ($1, $2, $3, $4, $5, $6, $7) ON CONFLICT (tenant_id, code) DO NOTHING`,
      [uuidv4(), tenantId, d.code, d.libelle, d.type_mode, !!d.par_defaut, ordre]
    );
  }
  return true;
}

async function lister(queryable, tenantId, { actifs = false, sens = null } = {}) {
  await assurerDefauts(queryable, tenantId);
  const params = [tenantId];
  let filtre = "";
  if (actifs) filtre += " AND m.actif = true";
  if (sens === "ENCAISSEMENT" || sens === "DECAISSEMENT") {
    params.push(sens);
    filtre += ` AND m.sens IN ($${params.length}, 'LES_DEUX')`;
  }
  const r = await queryable.query(
    `SELECT m.*, j.code AS journal_code, j.libelle AS journal_libelle
     FROM mode_reglement m LEFT JOIN journal_comptable j ON j.id = m.journal_id
     WHERE m.tenant_id = $1 ${filtre} ORDER BY m.ordre, m.libelle`,
    params
  );
  return r.rows;
}

async function lire(queryable, tenantId, id) {
  const r = await queryable.query(`SELECT * FROM mode_reglement WHERE id = $1 AND tenant_id = $2`, [id, tenantId]);
  return r.rows[0] || null;
}

async function nettoyer(queryable, tenantId, data, existant = null) {
  const out = {};
  const get = (k, def) => (data[k] !== undefined ? data[k] : existant ? existant[k] : def);
  out.libelle = texteOuNull(get("libelle"), 80);
  if (!out.libelle) throw new ModeError("MODE_REGLEMENT_LIBELLE_REQUIS");
  out.type_mode = String(get("type_mode", "AUTRE"));
  if (!TYPES.includes(out.type_mode)) throw new ModeError("MODE_REGLEMENT_TYPE_INVALIDE");
  out.sens = String(get("sens", "LES_DEUX"));
  if (!SENS.includes(out.sens)) throw new ModeError("MODE_REGLEMENT_SENS_INVALIDE");
  out.compte_tresorerie = texteOuNull(get("compte_tresorerie"), 20);
  out.compte_attente = texteOuNull(get("compte_attente"), 20);
  out.compte_commission = texteOuNull(get("compte_commission"), 20);
  const pct = Number(get("commission_pct", 0)) || 0;
  if (pct < 0 || pct > 100) throw new ModeError("MODE_REGLEMENT_COMMISSION_INVALIDE");
  out.commission_pct = pct;
  out.actif = get("actif", true) !== false;
  out.ordre = Number.isFinite(Number(get("ordre", 0))) ? Math.trunc(Number(get("ordre", 0))) : 0;
  const jid = get("journal_id", null) || null;
  if (jid) {
    const j = await queryable.query(
      `SELECT id FROM journal_comptable WHERE id = $1 AND tenant_id = $2 AND type_journal IN ('BANQUE', 'CAISSE')`,
      [jid, tenantId]
    );
    if (!j.rows[0]) throw new ModeError("COMPTA_REGLEMENT_JOURNAL_INVALIDE");
  }
  out.journal_id = jid;
  if (out.commission_pct > 0 && !out.compte_commission) throw new ModeError("MODE_REGLEMENT_COMPTE_COMMISSION_REQUIS");
  return out;
}

async function creer(queryable, tenantId, data) {
  await assurerDefauts(queryable, tenantId);
  const code = texteOuNull(data.code, 30)?.toUpperCase().replace(/[^A-Z0-9_]+/g, "_");
  if (!code) throw new ModeError("MODE_REGLEMENT_CODE_REQUIS");
  const d = await nettoyer(queryable, tenantId, data);
  const dup = await queryable.query(`SELECT 1 FROM mode_reglement WHERE tenant_id = $1 AND code = $2`, [tenantId, code]);
  if (dup.rows[0]) throw new ModeError("MODE_REGLEMENT_CODE_EXISTANT", 409);
  const r = await queryable.query(
    `INSERT INTO mode_reglement (id, tenant_id, code, libelle, type_mode, journal_id, compte_tresorerie, compte_attente,
                                 commission_pct, compte_commission, sens, actif, ordre)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *`,
    [uuidv4(), tenantId, code, d.libelle, d.type_mode, d.journal_id, d.compte_tresorerie, d.compte_attente,
     d.commission_pct, d.compte_commission, d.sens, d.actif, d.ordre]
  );
  return r.rows[0];
}

async function modifier(queryable, tenantId, id, data) {
  const ex = await lire(queryable, tenantId, id);
  if (!ex) throw new ModeError("MODE_REGLEMENT_INTROUVABLE", 404);
  const d = await nettoyer(queryable, tenantId, data, ex);
  const r = await queryable.query(
    `UPDATE mode_reglement SET libelle=$3, type_mode=$4, journal_id=$5, compte_tresorerie=$6, compte_attente=$7,
            commission_pct=$8, compte_commission=$9, sens=$10, actif=$11, ordre=$12
     WHERE id=$1 AND tenant_id=$2 RETURNING *`,
    [id, tenantId, d.libelle, d.type_mode, d.journal_id, d.compte_tresorerie, d.compte_attente,
     d.commission_pct, d.compte_commission, d.sens, d.actif, d.ordre]
  );
  return r.rows[0];
}

/** Mode utilise quelque part ? Alors on le desactive au lieu de le supprimer. */
async function supprimer(queryable, tenantId, id) {
  const ex = await lire(queryable, tenantId, id);
  if (!ex) throw new ModeError("MODE_REGLEMENT_INTROUVABLE", 404);
  const u = await queryable.query(
    `SELECT (SELECT COUNT(*) FROM reglement_client WHERE mode_reglement_id = $1)
          + (SELECT COUNT(*) FROM reglement_fournisseur WHERE mode_reglement_id = $1)
          + (SELECT COUNT(*) FROM facture_vente WHERE mode_reglement_id = $1) AS n`,
    [id]
  );
  if (Number(u.rows[0].n) > 0) {
    await queryable.query(`UPDATE mode_reglement SET actif = false WHERE id = $1 AND tenant_id = $2`, [id, tenantId]);
    return { desactive: true };
  }
  await queryable.query(`DELETE FROM mode_reglement WHERE id = $1 AND tenant_id = $2`, [id, tenantId]);
  return { supprime: true };
}

/** Retrouve un mode a partir de l'ancien texte libre (compatibilite). */
async function depuisTexteLegacy(queryable, tenantId, texte) {
  const s = String(texte || "").toLowerCase();
  if (!s.trim()) return null;
  let type = null;
  if (/esp|cash|caisse|liquide/.test(s)) type = "ESPECES";
  else if (/orange|wave|mobile|momo|free money/.test(s)) type = "MOBILE_MONEY";
  else if (/ch[eè]que|chq/.test(s)) type = "CHEQUE";
  else if (/carte|cb\b/.test(s)) type = "CARTE";
  else if (/vir|banque|transfer/.test(s)) type = "VIREMENT";
  if (!type) return null;
  await assurerDefauts(queryable, tenantId);
  const r = await queryable.query(
    `SELECT * FROM mode_reglement WHERE tenant_id = $1 AND type_mode = $2 AND actif = true ORDER BY par_defaut DESC, ordre LIMIT 1`,
    [tenantId, type]
  );
  return r.rows[0] || null;
}

/** Journal de tresorerie : celui du mode, sinon le premier actif du bon type (caisse pour les especes). */
async function journalPourMode(queryable, tenantId, mode, journalIdExplicite) {
  if (journalIdExplicite) {
    const j = await queryable.query(
      `SELECT * FROM journal_comptable WHERE id = $1 AND tenant_id = $2 AND actif = true AND type_journal IN ('BANQUE', 'CAISSE')`,
      [journalIdExplicite, tenantId]
    );
    if (j.rows[0]) return j.rows[0];
    throw new ModeError("COMPTA_REGLEMENT_JOURNAL_INVALIDE");
  }
  if (mode && mode.journal_id) {
    const j = await queryable.query(`SELECT * FROM journal_comptable WHERE id = $1 AND tenant_id = $2 AND actif = true`, [mode.journal_id, tenantId]);
    if (j.rows[0]) return j.rows[0];
  }
  const prefere = mode && mode.type_mode === "ESPECES" ? ["CAISSE", "BANQUE"] : ["BANQUE", "CAISSE"];
  for (const type of prefere) {
    const j = await queryable.query(
      `SELECT * FROM journal_comptable WHERE tenant_id = $1 AND actif = true AND type_journal = $2 ORDER BY code LIMIT 1`,
      [tenantId, type]
    );
    if (j.rows[0]) return j.rows[0];
  }
  return null;
}

/**
 * Resolution complete d'un mode pour un reglement : mode, journal, compte debite/credite cote
 * tresorerie (compte d'attente > compte du mode > compte du journal) et commission.
 * `sens` : "ENCAISSEMENT" ou "DECAISSEMENT" (verifie que le mode l'autorise).
 */
async function resoudre(queryable, tenantId, modeId, { sens, journalId = null, texteLegacy = null } = {}) {
  let mode = null;
  if (modeId) {
    mode = await lire(queryable, tenantId, modeId);
    if (!mode || !mode.actif) throw new ModeError("MODE_REGLEMENT_INTROUVABLE", 404);
  } else if (texteLegacy) {
    mode = await depuisTexteLegacy(queryable, tenantId, texteLegacy);
  }
  if (mode && sens && mode.sens !== "LES_DEUX" && mode.sens !== sens) throw new ModeError("MODE_REGLEMENT_SENS_INTERDIT");
  const journal = await journalPourMode(queryable, tenantId, mode, journalId);
  let compteTreso = (mode && (mode.compte_attente || mode.compte_tresorerie)) || null;
  // Proposition de depart pour la monnaie electronique (Orange Money, Wave...) : premier compte 552 du plan,
  // tant que l'entreprise n'a pas parametre son propre compte.
  if (!compteTreso && mode && mode.type_mode === "MOBILE_MONEY") {
    const c = await queryable.query(`SELECT numero FROM compte_comptable WHERE tenant_id = $1 AND numero LIKE '552%' ORDER BY numero LIMIT 1`, [tenantId]);
    compteTreso = c.rows[0] ? c.rows[0].numero : null;
  }
  if (!compteTreso) compteTreso = (journal && journal.compte_tresorerie) || null;
  return {
    mode,
    journal,
    compteTresorerie: compteTreso,
    commissionPct: mode ? Number(mode.commission_pct) || 0 : 0,
    compteCommission: mode ? mode.compte_commission : null,
    libelle: mode ? mode.libelle : null,
  };
}

/** Commission en centimes pour un montant en centimes (arrondi au centime le plus proche). */
function commissionCentimes(montantC, pct) {
  if (!pct || pct <= 0) return 0;
  return Math.round((montantC * pct) / 100);
}

module.exports = {
  TYPES, SENS, DEFAUTS, ModeError,
  assurerDefauts, lister, lire, creer, modifier, supprimer,
  depuisTexteLegacy, journalPourMode, resoudre, commissionCentimes,
};
