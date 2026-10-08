/**
 * Paie : parametres de l'entreprise (valeurs par defaut, lecture datee, construction du contexte de calcul d'un bulletin).
 * Les valeurs par defaut sont creees une seule fois par entreprise (assurerDefauts) puis restent modifiables.
 * Taux sociaux provisoires : a confirmer aupres des organismes (IPRES, CSS) et a mettre a jour avec une date d'effet.
 */
const fs = require("fs");
const path = require("path");
const { v4: uuidv4 } = require("uuid");
const db = require("../db");
const B = require("./paieBaremes");
const rhFiche = require("./rhFiche");

class PaieError extends Error {
  constructor(code, status = 400, details) {
    super(code);
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

// ------------------------------------------------------------------------------------------------ valeurs par defaut
const DATE_ORIGINE = "2000-01-01";

const COTISATIONS_DEFAUT = [
  { code: "IPRES_RG", libelle: "IPRES régime général", section: "RETRAITE", taux_salarie: 5.6, taux_patronal: 8.4, plafond_mensuel: 432000, public: "TOUS", ordre: 1 },
  { code: "IPRES_RC", libelle: "IPRES régime complémentaire (cadres)", section: "RETRAITE", taux_salarie: 2.4, taux_patronal: 3.6, plafond_mensuel: 1296000, public: "CADRES", ordre: 2 },
  { code: "CSS_PF", libelle: "Caisse de sécurité sociale - prestations familiales", section: "SOCIAL", taux_salarie: 0, taux_patronal: 7, plafond_mensuel: 63000, public: "TOUS", ordre: 3 },
  { code: "CSS_AT", libelle: "Caisse de sécurité sociale - accidents du travail", section: "SOCIAL", taux_salarie: 0, taux_patronal: 1, plafond_mensuel: 63000, public: "TOUS", ordre: 4, note: "Taux selon le risque de l'entreprise : 1 %, 3 % ou 5 %." },
  { code: "CFCE", libelle: "Contribution forfaitaire à la charge de l'employeur (CFCE)", section: "TAXE", taux_salarie: 0, taux_patronal: 3, plafond_mensuel: null, public: "TOUS", ordre: 5 },
];

const ABSENCES_DEFAUT = [
  { code: "CONGE_PAYE", libelle: "Congé payé", taux_maintien: 100, ordre: 1 },
  { code: "MALADIE", libelle: "Maladie", taux_maintien: 100, ordre: 2 },
  { code: "ACCIDENT_TRAVAIL", libelle: "Accident du travail", taux_maintien: 100, ordre: 3 },
  { code: "MATERNITE", libelle: "Congé de maternité", taux_maintien: 100, ordre: 4 },
  { code: "PERMISSION", libelle: "Permission exceptionnelle", taux_maintien: 100, ordre: 5 },
  { code: "ABSENCE_INJUSTIFIEE", libelle: "Absence injustifiée", taux_maintien: 0, ordre: 6 },
  { code: "CONGE_SANS_SOLDE", libelle: "Congé sans solde", taux_maintien: 0, ordre: 7 },
  { code: "MISE_A_PIED", libelle: "Mise à pied", taux_maintien: 0, ordre: 8 },
];

const R = (code, libelle, sens, mode, extra = {}) => ({
  code, libelle, sens, mode, section: "INDEMNITES", imposable: true, soumis_cotisations: true, exoneration_plafond: null,
  proratisable: false, montant_defaut: null, compte_cle: sens === "GAIN" ? "PRIMES" : null, ...extra,
});
const RUBRIQUES_DEFAUT = [
  R("PRIME_ASSIDUITE", "Prime d'assiduité", "GAIN", "FIXE"),
  R("PRIME_PANIER", "Prime de panier", "GAIN", "QUANTITE", { montant_defaut: 600 }),
  R("INDEMNITE_TRANSPORT", "Indemnité de transport", "GAIN", "FIXE", { exoneration_plafond: 26000, proratisable: true, montant_defaut: 26000, compte_cle: "REMBOURSEMENT_FRAIS" }),
  R("FORFAIT_HS", "Forfait heures supplémentaires", "GAIN", "FIXE", { compte_cle: "SALAIRES" }),
  R("PRIME_SUJETION", "Prime de sujétion", "GAIN", "FIXE"),
  R("PRIME_RESPONSABILITE", "Prime de responsabilité", "GAIN", "FIXE"),
  R("PRIME_RISQUE", "Prime de risque (déplacement de nuit)", "GAIN", "VARIABLE"),
  R("PRIME_INTERESSEMENT", "Prime d'intéressement", "GAIN", "VARIABLE"),
  R("PRIME_EXCEPTIONNELLE", "Prime exceptionnelle", "GAIN", "VARIABLE"),
  R("PRIME_BILAN", "Prime de bilan", "GAIN", "VARIABLE"),
  R("INDEMNITE_CONGES", "Indemnité de congés payés", "GAIN", "VARIABLE", { compte_cle: "CONGES" }),
  R("INDEMNITE_PREAVIS", "Indemnité de préavis", "GAIN", "VARIABLE", { compte_cle: "PREAVIS" }),
  R("INDEMNITE_DEPART", "Indemnité conventionnelle de départ", "GAIN", "VARIABLE", { imposable: false, soumis_cotisations: false, compte_cle: "PREAVIS" }),
  R("REMBOURSEMENT_FRAIS", "Remboursement de frais", "REMBOURSEMENT", "VARIABLE", { compte_cle: "REMBOURSEMENT_FRAIS" }),
  R("ACOMPTE", "Acompte / avance sur salaire", "RETENUE", "VARIABLE", { compte_cle: "AVANCES_PERSONNEL" }),
  R("FONDS_SOCIAL", "Fonds social", "RETENUE", "FIXE", { compte_cle: "PERSONNEL_DUES" }),
  R("AUTRE_RETENUE", "Autres retenues", "RETENUE", "VARIABLE", { compte_cle: "PERSONNEL_DUES" }),
].map((r, i) => ({ ...r, ordre: i + 1, systeme: true }));

/** Comptes de la paie (plan SYSCOHADA) : modifiables par l'entreprise selon son plan comptable. */
const COMPTES_CATALOGUE = [
  { cle: "SALAIRES", groupe: "CHARGES", defaut: "6611" },
  { cle: "PRIMES", groupe: "CHARGES", defaut: "6612" },
  { cle: "CONGES", groupe: "CHARGES", defaut: "6613" },
  { cle: "PREAVIS", groupe: "CHARGES", defaut: "6614" },
  { cle: "REMBOURSEMENT_FRAIS", groupe: "CHARGES", defaut: "6618" },
  { cle: "CHARGES_SOCIALES", groupe: "CHARGES", defaut: "6641" },
  { cle: "CFCE_CHARGE", groupe: "CHARGES", defaut: "6413" },
  { cle: "PERSONNEL_DUES", groupe: "TIERS", defaut: "422" },
  { cle: "AVANCES_PERSONNEL", groupe: "TIERS", defaut: "4212" },
  { cle: "CSS_A_PAYER", groupe: "TIERS", defaut: "4311" },
  { cle: "CSS_AT_A_PAYER", groupe: "TIERS", defaut: "4312" },
  { cle: "IPRES_A_PAYER", groupe: "TIERS", defaut: "4313" },
  { cle: "IR_A_PAYER", groupe: "TIERS", defaut: "4471" },
  { cle: "TRIMF_A_PAYER", groupe: "TIERS", defaut: "4478" },
  { cle: "CFCE_A_PAYER", groupe: "TIERS", defaut: "4472" },
];
const COMPTE_PAR_CLE = Object.fromEntries(COMPTES_CATALOGUE.map((c) => [c.cle, c]));

const REGLAGES_DEFAUT = { jours_mois: 30, heures_mensuelles: 173.33, arrondi_net: 1, mode_ir: "BAREME", base_taux_horaire: "BASE_SURSALAIRE" };

function lireConventionsReference() {
  const f = path.join(__dirname, "..", "..", "data", "paie", "conventions_2023.json");
  return JSON.parse(fs.readFileSync(f, "utf8"));
}

/** Cree, une seule fois par entreprise, les parametres par defaut (cotisations, formule IR, conventions, rubriques, absences). */
async function assurerDefauts(tenantId) {
  const deja = await db.query(`SELECT 1 FROM paie_parametres WHERE tenant_id = $1`, [tenantId]);
  if (deja.rows.length) return;
  const client = await db.pool.connect();
  try {
    await client.query("BEGIN");
    const verrou = await client.query(`INSERT INTO paie_parametres (tenant_id) VALUES ($1) ON CONFLICT DO NOTHING RETURNING tenant_id`, [tenantId]);
    if (!verrou.rows.length) { await client.query("ROLLBACK"); return; }
    for (const c of COTISATIONS_DEFAUT) {
      await client.query(
        `INSERT INTO paie_cotisation (id, tenant_id, code, libelle, section, taux_salarie, taux_patronal, plafond_mensuel, public, date_effet, ordre, note)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
        [uuidv4(), tenantId, c.code, c.libelle, c.section, c.taux_salarie, c.taux_patronal, c.plafond_mensuel, c.public, DATE_ORIGINE, c.ordre, c.note || null]
      );
    }
    await client.query(`INSERT INTO paie_ir_formule (id, tenant_id, date_effet, formule_json, note) VALUES ($1,$2,$3,$4,$5)`,
      [uuidv4(), tenantId, DATE_ORIGINE, JSON.stringify(B.FORMULE_DEFAUT), "Barème du Code général des impôts (revenu net annuel après abattement de 30 %)."]);
    for (const a of ABSENCES_DEFAUT) {
      await client.query(`INSERT INTO paie_type_absence (id, tenant_id, code, libelle, taux_maintien, ordre, systeme) VALUES ($1,$2,$3,$4,$5,$6,TRUE)`,
        [uuidv4(), tenantId, a.code, a.libelle, a.taux_maintien, a.ordre]);
    }
    for (const r of RUBRIQUES_DEFAUT) {
      await client.query(
        `INSERT INTO paie_rubrique (id, tenant_id, code, libelle, sens, mode, section, imposable, soumis_cotisations, exoneration_plafond, proratisable, montant_defaut, compte_cle, ordre, systeme)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,TRUE)`,
        [uuidv4(), tenantId, r.code, r.libelle, r.sens, r.mode, r.section, r.imposable, r.soumis_cotisations, r.exoneration_plafond, r.proratisable, r.montant_defaut, r.compte_cle, r.ordre]
      );
    }
    const ref = lireConventionsReference();
    for (const c of ref.conventions) {
      const cid = uuidv4();
      await client.query(
        `INSERT INTO paie_convention (id, tenant_id, code, libelle, anciennete_json, majorations_json, notes, ordre) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [cid, tenantId, c.code, c.libelle, JSON.stringify(c.anciennete), JSON.stringify(c.majorations), c.notes || null, c.ordre]
      );
      let i = 0;
      for (const k of c.categories) {
        i += 1;
        await client.query(
          `INSERT INTO paie_categorie (id, tenant_id, convention_id, code, libelle, classification, salaire_base, date_effet, ordre) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
          [uuidv4(), tenantId, cid, k.code, k.libelle, k.classification, k.salaire_base, ref.date_effet, i]
        );
      }
    }
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

// ------------------------------------------------------------------------------------------------ lectures
async function getReglages(tenantId) {
  await assurerDefauts(tenantId);
  const r = await db.query(`SELECT * FROM paie_parametres WHERE tenant_id = $1`, [tenantId]);
  const p = r.rows[0] || {};
  return {
    jours_mois: Number(p.jours_mois) || REGLAGES_DEFAUT.jours_mois,
    heures_mensuelles: Number(p.heures_mensuelles) || REGLAGES_DEFAUT.heures_mensuelles,
    arrondi_net: Number(p.arrondi_net) || REGLAGES_DEFAUT.arrondi_net,
    mode_ir: p.mode_ir || REGLAGES_DEFAUT.mode_ir,
    base_taux_horaire: p.base_taux_horaire || REGLAGES_DEFAUT.base_taux_horaire,
    numero_employeur_css: p.numero_employeur_css || null,
    numero_employeur_ipres: p.numero_employeur_ipres || null,
    lieu_signature: p.lieu_signature || null,
    banque_donneur: p.banque_donneur || null,
    compte_donneur: p.compte_donneur || null,
    jour_virement: p.jour_virement == null ? null : Number(p.jour_virement),
  };
}

/** Pour chaque code, la ligne dont la date d'effet est la plus recente sans depasser la date donnee. */
function derniereParCode(lignes, cle, date) {
  const m = new Map();
  for (const l of lignes) {
    if (String(l.date_effet).slice(0, 10) > date) continue;
    const prev = m.get(l[cle]);
    if (!prev || String(l.date_effet) > String(prev.date_effet)) m.set(l[cle], l);
  }
  return [...m.values()];
}

async function cotisationsEffectives(tenantId, date) {
  await assurerDefauts(tenantId);
  const r = await db.query(`SELECT * FROM paie_cotisation WHERE tenant_id = $1 ORDER BY ordre, date_effet`, [tenantId]);
  return derniereParCode(r.rows.map((x) => ({ ...x, date_effet: String(x.date_effet).slice(0, 10) })), "code", date)
    .filter((c) => c.actif)
    .sort((a, b) => a.ordre - b.ordre)
    .map((c) => ({ code: c.code, libelle: c.libelle, section: c.section, taux_salarie: Number(c.taux_salarie), taux_patronal: Number(c.taux_patronal), plafond_mensuel: c.plafond_mensuel == null ? null : Number(c.plafond_mensuel), public: c.public, date_effet: c.date_effet }));
}

async function formuleEffective(tenantId, date) {
  await assurerDefauts(tenantId);
  const r = await db.query(`SELECT date_effet, formule_json FROM paie_ir_formule WHERE tenant_id = $1 AND date_effet <= $2 ORDER BY date_effet DESC LIMIT 1`, [tenantId, date]);
  return r.rows[0] ? { ...B.FORMULE_DEFAUT, ...r.rows[0].formule_json } : B.FORMULE_DEFAUT;
}

const cacheFichiers = new Map();
function indexFichier(nom) {
  if (!cacheFichiers.has(nom)) {
    const l = B.lireFichierReference(nom);
    cacheFichiers.set(nom, l ? B.indexer(l) : null);
  }
  return cacheFichiers.get(nom);
}
const cacheTenant = new Map(); // id + date d'import -> index

const BAREMES_OFFICIELS = [
  { type: "IR_MENSUEL", annee: 2026, fichier: "bareme_ir_mensuel_2026.json.gz", libelle: "Table mensuelle de l'impôt sur le revenu (DGID) - 1 à 5 parts" },
  { type: "TRIMF_ANNUEL", annee: 2026, fichier: "bareme_trimf_annuel_2026.json.gz", libelle: "Table annuelle de la TRIMF (DGID)" },
];

/** Bareme applicable a l'annee : celui de l'entreprise (annee <= annee de paie, le plus recent) sinon le bareme officiel fourni. */
async function baremeEffectif(tenantId, type, annee) {
  const r = await db.query(
    `SELECT id, annee, libelle, date_import, nb_lignes FROM paie_bareme WHERE tenant_id = $1 AND type = $2 AND annee <= $3 ORDER BY annee DESC LIMIT 1`,
    [tenantId, type, annee]
  );
  if (r.rows[0]) {
    const cle = `${r.rows[0].id}:${new Date(r.rows[0].date_import).getTime()}`;
    if (!cacheTenant.has(cle)) {
      const l = await db.query(`SELECT lignes_json FROM paie_bareme WHERE id = $1`, [r.rows[0].id]);
      cacheTenant.set(cle, B.indexer(l.rows[0].lignes_json));
      if (cacheTenant.size > 20) cacheTenant.delete(cacheTenant.keys().next().value);
    }
    return { index: cacheTenant.get(cle), source: "ENTREPRISE", annee: r.rows[0].annee, libelle: r.rows[0].libelle };
  }
  const off = BAREMES_OFFICIELS.find((b) => b.type === type);
  return { index: indexFichier(off.fichier), source: "OFFICIEL", annee: off.annee, libelle: off.libelle };
}

async function baremes(tenantId, annee) {
  const [ir, trimf] = await Promise.all([baremeEffectif(tenantId, "IR_MENSUEL", annee), baremeEffectif(tenantId, "TRIMF_ANNUEL", annee)]);
  return { irIndex: ir.index, trimfIndex: trimf.index, sources: { ir: { source: ir.source, annee: ir.annee }, trimf: { source: trimf.source, annee: trimf.annee } } };
}

/** Grille d'une convention a une date : une ligne par categorie (la plus recente sans depasser la date). */
async function grilleA(tenantId, conventionId, date) {
  const r = await db.query(`SELECT * FROM paie_categorie WHERE tenant_id = $1 AND convention_id = $2 ORDER BY ordre, date_effet`, [tenantId, conventionId]);
  const lignes = derniereParCode(r.rows.map((x) => ({ ...x, date_effet: String(x.date_effet).slice(0, 10) })), "code", date);
  return lignes.sort((a, b) => a.ordre - b.ordre).map((x) => ({ id: x.id, code: x.code, libelle: x.libelle, classification: x.classification, salaire_base: Number(x.salaire_base), date_effet: x.date_effet, ordre: x.ordre }));
}

async function rubriquesActives(tenantId) {
  await assurerDefauts(tenantId);
  const r = await db.query(`SELECT * FROM paie_rubrique WHERE tenant_id = $1 ORDER BY ordre, libelle`, [tenantId]);
  return r.rows.map((x) => ({ ...x, exoneration_plafond: x.exoneration_plafond == null ? null : Number(x.exoneration_plafond), montant_defaut: x.montant_defaut == null ? null : Number(x.montant_defaut) }));
}

async function typesAbsence(tenantId) {
  await assurerDefauts(tenantId);
  const r = await db.query(`SELECT * FROM paie_type_absence WHERE tenant_id = $1 ORDER BY ordre, libelle`, [tenantId]);
  return r.rows.map((x) => ({ ...x, taux_maintien: Number(x.taux_maintien) }));
}

async function getComptes(tenantId) {
  await assurerDefauts(tenantId);
  const r = await db.query(`SELECT cle, compte FROM paie_compte_param WHERE tenant_id = $1`, [tenantId]);
  const enr = Object.fromEntries(r.rows.map((x) => [x.cle, x.compte]));
  return COMPTES_CATALOGUE.map((c) => ({ cle: c.cle, groupe: c.groupe, defaut: c.defaut, compte: enr[c.cle] || c.defaut, personnalise: !!enr[c.cle] && enr[c.cle] !== c.defaut }));
}

async function enregistrerComptes(tenantId, corps) {
  const c = corps || {};
  for (const cle of Object.keys(c)) if (!COMPTE_PAR_CLE[cle]) throw new PaieError("PAIE_COMPTE_INCONNU", 400, { cle });
  for (const cle of Object.keys(c)) {
    const v = String(c[cle] == null ? "" : c[cle]).replace(/[^0-9]/g, "");
    if (!v || v === COMPTE_PAR_CLE[cle].defaut) await db.query(`DELETE FROM paie_compte_param WHERE tenant_id = $1 AND cle = $2`, [tenantId, cle]);
    else if (v.length > 10) throw new PaieError("PAIE_COMPTE_INVALIDE", 400, { cle });
    else await db.query(
      `INSERT INTO paie_compte_param (tenant_id, cle, compte) VALUES ($1,$2,$3) ON CONFLICT (tenant_id, cle) DO UPDATE SET compte = EXCLUDED.compte, date_modification = now()`,
      [tenantId, cle, v]
    );
  }
  return getComptes(tenantId);
}

// ------------------------------------------------------------------------------------------------ dossier et contexte
async function chargerDossier(tenantId, employeId) {
  const r = await db.query(
    `SELECT d.*, cv.code AS convention_code, cv.libelle AS convention_libelle FROM paie_dossier d
     LEFT JOIN paie_convention cv ON cv.id = d.convention_id WHERE d.tenant_id = $1 AND d.employe_id = $2`,
    [tenantId, employeId]
  );
  return r.rows[0] || null;
}

async function elementsFixes(tenantId, employeId, debut, fin) {
  const r = await db.query(
    `SELECT id, rubrique_code, montant, quantite, date_debut, date_fin, note FROM paie_element_fixe
     WHERE tenant_id = $1 AND employe_id = $2 AND date_debut <= $4 AND (date_fin IS NULL OR date_fin >= $3) ORDER BY date_debut`,
    [tenantId, employeId, debut, fin]
  );
  return r.rows.map((x) => ({ ...x, montant: x.montant == null ? null : Number(x.montant), quantite: x.quantite == null ? null : Number(x.quantite) }));
}

function bornesPeriode(annee, mois) {
  const m = String(mois).padStart(2, "0");
  const dernier = new Date(Date.UTC(annee, mois, 0)).getUTCDate();
  return { annee, mois, debut: `${annee}-${m}-01`, fin: `${annee}-${m}-${String(dernier).padStart(2, "0")}` };
}

/**
 * Contexte complet de calcul d'un bulletin (entree de paieMoteur.calculerBulletin).
 * options.variables : { absences, heures_sup, gains, retenues } ; options.cumul ; options.reglages / dossier / elementsFixes pour un simulateur.
 */
async function construireContexte(tenantId, employeId, annee, mois, options = {}) {
  await assurerDefauts(tenantId);
  const periode = bornesPeriode(annee, mois);
  let employe, parts;
  if (employeId) {
    const emp = await db.query(
      `SELECT e.*, COALESCE(e.nom, u.nom) AS nom, COALESCE(e.prenom, u.prenom) AS prenom FROM employe e LEFT JOIN utilisateur u ON u.id = e.utilisateur_id WHERE e.tenant_id = $1 AND e.id = $2`,
      [tenantId, employeId]
    );
    employe = emp.rows[0];
    if (!employe) throw new PaieError("PAIE_EMPLOYE_INTROUVABLE", 404);
    const enfants = (await db.query(`SELECT * FROM employe_enfant WHERE tenant_id = $1 AND employe_id = $2`, [tenantId, employeId])).rows;
    parts = rhFiche.calculerParts(employe, enfants, annee);
  } else {
    // Simulation libre : salarie fictif, parts saisies.
    employe = { date_embauche: null, date_sortie: null, ...(options.employe || {}) };
    parts = { parts_ir: Number(employe.parts_ir) || 1, parts_trimf: Number(employe.parts_trimf) || 1 };
  }
  if (options.employe && employeId) {
    if (options.employe.parts_ir != null) parts = { ...parts, parts_ir: Number(options.employe.parts_ir) };
    if (options.employe.parts_trimf != null) parts = { ...parts, parts_trimf: Number(options.employe.parts_trimf) };
  }
  const dossier = options.dossier !== undefined ? options.dossier : employeId ? await chargerDossier(tenantId, employeId) : null;

  const [reglages, cotisations, formule, bar, rubs, abs] = await Promise.all([
    getReglages(tenantId), cotisationsEffectives(tenantId, periode.fin), formuleEffective(tenantId, periode.fin),
    baremes(tenantId, annee), rubriquesActives(tenantId), typesAbsence(tenantId),
  ]);
  const parametres = { ...reglages, ...(options.reglages || {}) };

  let convention = null, categorie = null;
  if (dossier && dossier.convention_id) {
    const cv = (await db.query(`SELECT * FROM paie_convention WHERE tenant_id = $1 AND id = $2`, [tenantId, dossier.convention_id])).rows[0];
    if (cv) {
      convention = { id: cv.id, code: cv.code, libelle: cv.libelle, anciennete: cv.anciennete_json || [], majorations: cv.majorations_json || [] };
      if (dossier.categorie_code) {
        const grille = await grilleA(tenantId, cv.id, periode.fin);
        categorie = grille.find((g) => g.code === dossier.categorie_code) || null;
      }
    }
  }
  const fixes = options.elementsFixes !== undefined ? options.elementsFixes : dossier && employeId ? await elementsFixes(tenantId, employeId, periode.debut, periode.fin) : [];

  return {
    periode, parametres, cotisations,
    bareme: { irIndex: bar.irIndex, trimfIndex: bar.trimfIndex, sources: bar.sources },
    formule,
    employe: { ...employe, parts_ir: parts.parts_ir, parts_trimf: parts.parts_trimf, parts },
    dossier: dossier ? { ...dossier, salaire_base_manuel: dossier.salaire_base_manuel == null ? null : Number(dossier.salaire_base_manuel), sursalaire: Number(dossier.sursalaire) || 0 } : {},
    convention, categorie,
    rubriques: Object.fromEntries(rubs.filter((r) => r.actif).map((r) => [r.code, r])),
    elementsFixes: fixes,
    variables: options.variables || {},
    absenceTypes: Object.fromEntries(abs.map((a) => [a.code, a])),
    cumul: options.cumul || null,
  };
}

module.exports = {
  PaieError, DATE_ORIGINE, COTISATIONS_DEFAUT, RUBRIQUES_DEFAUT, ABSENCES_DEFAUT, COMPTES_CATALOGUE, REGLAGES_DEFAUT, BAREMES_OFFICIELS,
  assurerDefauts, getReglages, cotisationsEffectives, formuleEffective, baremeEffectif, baremes, grilleA, derniereParCode,
  rubriquesActives, typesAbsence, getComptes, enregistrerComptes, chargerDossier, elementsFixes, bornesPeriode, construireContexte,
};
