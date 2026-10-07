/**
 * Module Fiscalite (payant) - declaration mensuelle de TVA (formulaire DGID, lignes L5 a L120).
 *
 * Le calcul est une LECTURE : il part des factures de vente (facture_vente), des reglements clients
 * (si la TVA est exigible a l'encaissement) et des factures fournisseurs (facture_fournisseur) de la periode,
 * applique les formules du formulaire et ne modifie rien. La preparation (POST .../preparer) fige simplement
 * un instantane dans fiscalite_declaration_tva ; elle n'ecrit AUCUNE ecriture comptable et ne depose rien :
 * le depot reste un acte du comptable sur le portail de la DGID.
 *
 * Formules du formulaire (scan fourni par Steeve, aout 2022) :
 *   L25 = L10+L15+L20           L35 = L5-L25            L45 = L35-L40
 *   L50 = L40 x 10 %            L55 = L45 x 18 %        L60 = L50+L55
 *   L76 = L70+L75               L91 = L85+L90           L92 = L76+L91
 *   L105 = L70+L75+L85+L90+L100 L110 = L60-L105 (si > 0) L115 = L105-L60 (si > 0)
 * Les taux (18 % / 10 %) viennent du profil fiscal : ils changent avec les lois de finances.
 */
const db = require("../db");
const comptesSvc = require("./fiscaliteComptes");
const { v4: uuidv4 } = require("uuid");

class FiscaliteError extends Error {
  constructor(code, status = 400, details = {}) {
    super(code);
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

const num = (v) => Number(v || 0);
const arrondi = (v) => Math.round(num(v));
const arrondi2 = (v) => Math.round(num(v) * 100) / 100;
const pad = (n) => String(n).padStart(2, "0");

const CODES_VENTE = ["TAXABLE", "EXONERE", "EXPORT", "SUSPENSION"];
const LIBELLE_CODE_VENTE = {
  TAXABLE: "Taxable",
  EXONERE: "Exonérée (intérieur)",
  EXPORT: "Exportation",
  SUSPENSION: "Suspension de TVA",
};

function validerPeriode(annee, mois) {
  const a = Number(annee);
  const m = Number(mois);
  if (!Number.isInteger(a) || a < 2000 || a > 2100 || !Number.isInteger(m) || m < 1 || m > 12) {
    throw new FiscaliteError("FISCALITE_PERIODE_INVALIDE");
  }
  return { annee: a, mois: m };
}

function bornesPeriode(annee, mois) {
  const debut = `${annee}-${pad(mois)}-01`;
  const dernier = new Date(Date.UTC(annee, mois, 0)).getUTCDate();
  const fin = `${annee}-${pad(mois)}-${pad(dernier)}`;
  return { debut, fin };
}

/** Date limite de depot ET de paiement : le 15 du mois suivant. */
function dateLimite(annee, mois) {
  const a = mois === 12 ? annee + 1 : annee;
  const m = mois === 12 ? 1 : mois + 1;
  return `${a}-${pad(m)}-15`;
}

const PROFIL_DEFAUT = {
  assujetti_tva: true,
  exigibilite_tva: "FACTURATION",
  prorata_deduction_pct: 100,
  regime_is: "REEL_NORMAL",
  forme_juridique: "PERSONNE_MORALE",
  cofi: null,
  ca_historique: {},
  centre_fiscal: null,
  cloture_mois: 12,
  taux_tva_normal: 18,
  taux_tva_reduit: 10,
};

async function getProfil(client, tenantId) {
  const r = await (client || db).query(`SELECT * FROM fiscalite_profil WHERE tenant_id = $1`, [tenantId]);
  const p = r.rows[0];
  if (!p) return { ...PROFIL_DEFAUT, existe: false };
  return {
    assujetti_tva: p.assujetti_tva,
    exigibilite_tva: p.exigibilite_tva,
    prorata_deduction_pct: num(p.prorata_deduction_pct),
    regime_is: p.regime_is,
    forme_juridique: p.forme_juridique,
    cofi: p.cofi,
    ca_historique: p.ca_historique_json || {},
    centre_fiscal: p.centre_fiscal,
    cloture_mois: p.cloture_mois,
    taux_tva_normal: num(p.taux_tva_normal),
    taux_tva_reduit: num(p.taux_tva_reduit),
    existe: true,
  };
}

async function enregistrerProfil(tenantId, corps) {
  const c = corps || {};
  const exig = c.exigibilite_tva === "ENCAISSEMENT" ? "ENCAISSEMENT" : "FACTURATION";
  const regime = ["REEL_NORMAL", "REEL_SIMPLIFIE", "CGU"].includes(c.regime_is) ? c.regime_is : "REEL_NORMAL";
  const forme = c.forme_juridique === "PERSONNE_PHYSIQUE" ? "PERSONNE_PHYSIQUE" : "PERSONNE_MORALE";
  const cofi = String(c.cofi || "").replace(/[\s.-]/g, "").toUpperCase() || null;
  if (cofi && !/^[0-9][A-Z][0-9]$/.test(cofi)) throw new FiscaliteError("FISCALITE_COFI_INVALIDE");
  const caHistorique = {};
  for (const [a, v] of Object.entries(c.ca_historique || {})) {
    if (v === "" || v === null || v === undefined) continue;
    const annee = Number(a);
    const valeur = Number(v);
    if (!Number.isInteger(annee) || annee < 1990 || annee > 2100 || !Number.isFinite(valeur) || valeur < 0) throw new FiscaliteError("FISCALITE_PROFIL_INVALIDE");
    caHistorique[annee] = Math.round(valeur);
  }
  const prorata = c.prorata_deduction_pct === undefined || c.prorata_deduction_pct === "" ? 100 : Number(c.prorata_deduction_pct);
  const normal = c.taux_tva_normal === undefined || c.taux_tva_normal === "" ? 18 : Number(c.taux_tva_normal);
  const reduit = c.taux_tva_reduit === undefined || c.taux_tva_reduit === "" ? 10 : Number(c.taux_tva_reduit);
  const cloture = c.cloture_mois === undefined || c.cloture_mois === "" ? 12 : Number(c.cloture_mois);
  if (!Number.isFinite(prorata) || prorata < 0 || prorata > 100) throw new FiscaliteError("FISCALITE_PROFIL_INVALIDE");
  if (!Number.isFinite(normal) || normal < 0 || normal > 100 || !Number.isFinite(reduit) || reduit < 0 || reduit > 100) {
    throw new FiscaliteError("FISCALITE_PROFIL_INVALIDE");
  }
  if (!Number.isInteger(cloture) || cloture < 1 || cloture > 12) throw new FiscaliteError("FISCALITE_PROFIL_INVALIDE");
  await db.query(
    `INSERT INTO fiscalite_profil (tenant_id, assujetti_tva, exigibilite_tva, prorata_deduction_pct, regime_is, centre_fiscal,
                                   cloture_mois, taux_tva_normal, taux_tva_reduit, forme_juridique, cofi, ca_historique_json, date_modification)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12, now())
     ON CONFLICT (tenant_id) DO UPDATE SET
       assujetti_tva = EXCLUDED.assujetti_tva, exigibilite_tva = EXCLUDED.exigibilite_tva,
       prorata_deduction_pct = EXCLUDED.prorata_deduction_pct, regime_is = EXCLUDED.regime_is,
       centre_fiscal = EXCLUDED.centre_fiscal, cloture_mois = EXCLUDED.cloture_mois,
       taux_tva_normal = EXCLUDED.taux_tva_normal, taux_tva_reduit = EXCLUDED.taux_tva_reduit,
       forme_juridique = EXCLUDED.forme_juridique, cofi = EXCLUDED.cofi, ca_historique_json = EXCLUDED.ca_historique_json,
       date_modification = now()`,
    [tenantId, c.assujetti_tva !== false, exig, prorata, regime, (c.centre_fiscal || "").trim() || null, cloture, normal, reduit, forme, cofi, JSON.stringify(caHistorique)]
  );
  return getProfil(db, tenantId);
}

/** Identite du contribuable pour l'en-tete de la declaration. */
async function getContribuable(tenantId) {
  const r = await db.query(`SELECT raison_sociale, ninea, rccm, adresse FROM tenant WHERE id = $1`, [tenantId]);
  const x = r.rows[0] || {};
  return { raison_sociale: x.raison_sociale || "", ninea: x.ninea || null, rccm: x.rccm || null, adresse: x.adresse || null };
}

// ----------------------------------------------------------------------------
// Chargement des donnees de la periode
// ----------------------------------------------------------------------------

/**
 * Ventes de la periode. Mode FACTURATION : une ligne par facture non annulee datee dans la periode.
 * Mode ENCAISSEMENT : une ligne par imputation de reglement client enregistre dans la periode.
 * Montants retenus : le TTC reellement facture (montant_net_a_payer - acomptes / soldes compris), ramene
 * en HT avec le taux de la facture.
 */
async function chargerVentes(tenantId, debut, fin, profil) {
  const base = `
    f.id, f.numero, f.mois_emission, f.date_facture, f.type_facturation, f.taux_tva_pourcentage,
    f.montant_net_a_payer, f.total_ttc, f.tva_code_operation, f.tva_precompte_montant, f.statut,
    c.id AS client_id, c.nom AS client_nom, c.ninea AS client_ninea, c.exonere_tva AS client_exonere,
    c.motif_exoneration_tva AS client_motif_exoneration,
    (SELECT e.statut FROM ecriture_comptable e
       WHERE e.tenant_id = f.tenant_id AND e.origine = 'FACTURE_VENTE' AND e.origine_id = f.id AND e.origine_role = 'FACTURE'
       LIMIT 1) AS ecriture_statut`;
  let lignes;
  if (profil.exigibilite_tva === "ENCAISSEMENT") {
    const r = await db.query(
      `SELECT ${base}, i.montant AS montant_impute, rc.date_reglement, rc.numero AS numero_reglement
       FROM reglement_client_imputation i
       JOIN reglement_client rc ON rc.id = i.reglement_id AND rc.statut = 'ENREGISTRE'
       JOIN facture_vente f ON f.id = i.facture_id
       JOIN client_commercial c ON c.id = f.client_commercial_id
       WHERE i.tenant_id = $1 AND f.statut <> 'ANNULEE' AND rc.date_reglement BETWEEN $2 AND $3
       ORDER BY rc.date_reglement, f.numero`,
      [tenantId, debut, fin]
    );
    lignes = r.rows.map((x) => ({ ...x, ttc_retenu: num(x.montant_impute), date_fait_generateur: x.date_reglement }));
  } else {
    const r = await db.query(
      `SELECT ${base}
       FROM facture_vente f
       JOIN client_commercial c ON c.id = f.client_commercial_id
       WHERE f.tenant_id = $1 AND f.statut <> 'ANNULEE' AND f.date_facture BETWEEN $2 AND $3
       ORDER BY f.date_facture, f.numero`,
      [tenantId, debut, fin]
    );
    lignes = r.rows.map((x) => ({ ...x, ttc_retenu: num(x.montant_net_a_payer) || num(x.total_ttc), date_fait_generateur: x.date_facture }));
  }
  return lignes.map((x) => {
    const taux = num(x.taux_tva_pourcentage);
    const ttc = num(x.ttc_retenu);
    const ht = taux > 0 ? arrondi2(ttc / (1 + taux / 100)) : arrondi2(ttc);
    const tva = arrondi2(ttc - ht);
    const code = x.tva_code_operation || (taux > 0 ? "TAXABLE" : "EXONERE");
    return {
      facture_id: x.id,
      numero: x.numero,
      mois_emission: x.mois_emission,
      date: String(x.date_fait_generateur).slice(0, 10),
      type_facturation: x.type_facturation,
      client_id: x.client_id,
      client_nom: x.client_nom,
      client_ninea: x.client_ninea || null,
      motif_exoneration: x.client_motif_exoneration || null,
      numero_reglement: x.numero_reglement || null,
      taux,
      ttc,
      ht,
      tva,
      code_operation: code,
      code_automatique: !x.tva_code_operation,
      precompte: num(x.tva_precompte_montant),
      ecriture_statut: x.ecriture_statut || null,
    };
  });
}

async function chargerAchats(tenantId, debut, fin) {
  const r = await db.query(
    `SELECT ff.id, ff.numero, ff.reference_fournisseur, ff.date_facture, ff.libelle, ff.montant_ht, ff.montant_tva, ff.montant_ttc,
            ff.tva_type_operation, ff.tva_deductible, ff.tva_motif_non_deductible, ff.tva_base_importation, ff.tva_montant_douane,
            t.id AS tiers_id, t.nom AS fournisseur_nom,
            COALESCE(fo.ninea, '') AS fournisseur_ninea, fo.regime_fiscal AS fournisseur_regime, fo.assujetti_tva AS fournisseur_assujetti_tva
     FROM facture_fournisseur ff
     JOIN tiers_comptable t ON t.id = ff.tiers_id
     LEFT JOIN fournisseur fo ON fo.id = t.fournisseur_id
     WHERE ff.tenant_id = $1 AND ff.statut = 'ENREGISTREE' AND ff.date_facture BETWEEN $2 AND $3
     ORDER BY ff.date_facture, ff.numero`,
    [tenantId, debut, fin]
  );
  return r.rows.map((x) => {
    const importation = x.tva_type_operation === "IMPORT";
    const base = importation && x.tva_base_importation !== null ? num(x.tva_base_importation) : num(x.montant_ht);
    const tva = importation && x.tva_montant_douane !== null ? num(x.tva_montant_douane) : num(x.montant_tva);
    return {
      facture_id: x.id,
      numero: x.numero,
      reference_fournisseur: x.reference_fournisseur,
      date: String(x.date_facture).slice(0, 10),
      libelle: x.libelle || null,
      tiers_id: x.tiers_id,
      fournisseur_nom: x.fournisseur_nom,
      fournisseur_ninea: x.fournisseur_ninea || null,
      fournisseur_regime: x.fournisseur_regime || "NON_RENSEIGNE",
      fournisseur_assujetti_tva: x.fournisseur_assujetti_tva,
      type_operation: x.tva_type_operation,
      deductible: x.tva_deductible,
      motif_non_deductible: x.tva_motif_non_deductible || null,
      base: arrondi2(base),
      tva: arrondi2(tva),
      montant_ttc: num(x.montant_ttc),
    };
  });
}

/** Mouvement net des comptes de TVA (ecritures validees) sur la periode, pour le rapprochement. */
async function mouvementsComptables(tenantId, debut, fin) {
  try {
    const p = await db.query(`SELECT compte_tva_collectee, compte_tva_recuperable FROM compta_parametre WHERE tenant_id = $1`, [tenantId]);
    if (!p.rows[0]) return null;
    // Comptes de la fiscalite parametres par l'entreprise (ecran Comptes de la fiscalite) ; a defaut, comptes du parametrage comptable.
    const perso = await db.query(`SELECT cle, prefixes FROM fiscalite_compte_param WHERE tenant_id = $1 AND cle IN ('TVA_COLLECTEE', 'TVA_RECUPERABLE')`, [tenantId]);
    const choisi = Object.fromEntries(perso.rows.map((x) => [x.cle, x.prefixes]));
    const listeCollectee = choisi.TVA_COLLECTEE || [String(p.rows[0].compte_tva_collectee || "4431").slice(0, 4)];
    const listeRecup = choisi.TVA_RECUPERABLE || [String(p.rows[0].compte_tva_recuperable || "4452").slice(0, 4)];
    const prefCollectee = listeCollectee.join(", ");
    const prefRecup = listeRecup.join(", ");
    const r = await db.query(
      `SELECT
         COALESCE(SUM(CASE WHEN cc.numero ~ $4 THEN l.credit - l.debit ELSE 0 END), 0) AS collectee,
         COALESCE(SUM(CASE WHEN cc.numero ~ $5 THEN l.debit - l.credit ELSE 0 END), 0) AS recuperable,
         COUNT(DISTINCT e.id) FILTER (WHERE cc.numero ~ $4 OR cc.numero ~ $5) AS nb_ecritures
       FROM ligne_ecriture l
       JOIN ecriture_comptable e ON e.id = l.ecriture_id AND e.statut = 'VALIDEE'
       JOIN compte_comptable cc ON cc.id = l.compte_id
       WHERE l.tenant_id = $1 AND e.date_ecriture BETWEEN $2 AND $3`,
      [tenantId, debut, fin, comptesSvc.regex(listeCollectee), comptesSvc.regex(listeRecup)]
    );
    const x = r.rows[0];
    return {
      compte_collectee: prefCollectee,
      compte_recuperable: prefRecup,
      collectee: arrondi(x.collectee),
      recuperable: arrondi(x.recuperable),
      nb_ecritures: Number(x.nb_ecritures || 0),
    };
  } catch (e) {
    return null;
  }
}

/**
 * Fiscalite SANS le module Comptabilite : mouvements de TVA relus du grand livre importe (fiscalite_import_ligne).
 * Collectee = 443x (credit - debit) ; recuperable = 4451 a 4454 (debit - credit) ; chiffre d'affaires comptable = 70x.
 * `couvre` = le grand livre actif couvre tout le mois (sinon le mois ne peut pas etre calcule de facon fiable).
 */
async function mouvementsGrandLivre(tenantId, debut, fin) {
  const j = await db.query(
    `SELECT id, annee, nom_fichier, date_debut, date_fin FROM fiscalite_import_jeu
     WHERE tenant_id = $1 AND nature = 'GRAND_LIVRE' AND actif AND date_debut <= $3 AND date_fin >= $2
     ORDER BY (date_debut <= $2 AND date_fin >= $3) DESC, annee DESC, date_creation DESC LIMIT 1`,
    [tenantId, debut, fin]
  );
  const jeu = j.rows[0];
  if (!jeu) return null;
  const jour = (d) => (d instanceof Date ? d.toISOString().slice(0, 10) : String(d).slice(0, 10));
  const couvre = jour(jeu.date_debut) <= debut && jour(jeu.date_fin) >= fin;
  const cpt = await comptesSvc.getComptes(tenantId);
  const rxCol = comptesSvc.regex(cpt.TVA_COLLECTEE);
  const rxRec = comptesSvc.regex(cpt.TVA_RECUPERABLE);
  const r = await db.query(
    `SELECT
       COALESCE(SUM(CASE WHEN compte ~ $4 THEN credit - debit ELSE 0 END), 0) AS collectee,
       COALESCE(SUM(CASE WHEN compte ~ $5 THEN debit - credit ELSE 0 END), 0) AS recuperable,
       COALESCE(SUM(CASE WHEN compte ~ $6 THEN credit - debit ELSE 0 END), 0) AS ventes,
       COUNT(*) FILTER (WHERE compte ~ $4 OR compte ~ $5) AS nb
     FROM fiscalite_import_ligne WHERE jeu_id = $1 AND date_ecriture BETWEEN $2 AND $3`,
    [jeu.id, debut, fin, rxCol, rxRec, comptesSvc.regex(cpt.TVA_VENTES)]
  );
  const x = r.rows[0];
  return {
    jeu_id: jeu.id,
    nom_fichier: jeu.nom_fichier,
    couvre,
    collectee: arrondi(x.collectee),
    recuperable: arrondi(x.recuperable),
    ventes_70: arrondi(x.ventes),
    nb_ecritures: Number(x.nb || 0),
  };
}

// ----------------------------------------------------------------------------
// Calcul
// ----------------------------------------------------------------------------

const somme = (tab, fn) => tab.reduce((s, x) => s + fn(x), 0);

/**
 * Calcule la declaration d'un mois. `saisies` : lignes saisies a la main
 * { L30, L75, L95, L120, credit_precedent } (nombres, facultatifs).
 */
async function calculer(tenantId, annee, mois, saisies = {}) {
  validerPeriode(annee, mois);
  const { debut, fin } = bornesPeriode(annee, mois);
  const profil = await getProfil(db, tenantId);
  const contribuable = await getContribuable(tenantId);
  let [ventes, achats, comptable] = await Promise.all([
    chargerVentes(tenantId, debut, fin, profil),
    chargerAchats(tenantId, debut, fin),
    mouvementsComptables(tenantId, debut, fin),
  ]);
  // Source des donnees : factures de la plateforme, ou grand livre importe (fiscalite seule).
  const sourceDemandee = ["FACTURES", "GRAND_LIVRE"].includes(saisies.source_tva) ? saisies.source_tva : "AUTO";
  let gl = null;
  let glPartiel = null;
  if (sourceDemandee === "GRAND_LIVRE" || (sourceDemandee === "AUTO" && ventes.length === 0 && achats.length === 0)) {
    const m = await mouvementsGrandLivre(tenantId, debut, fin);
    if (m && m.couvre) gl = m;
    else if (m) glPartiel = m;
  }
  const modeGl = !!gl;
  if (modeGl) {
    ventes = [];
    achats = [];
    comptable = null;
  }
  const s = {
    L10: arrondi(saisies.L10),
    L15: arrondi(saisies.L15),
    L20: arrondi(saisies.L20),
    L30: arrondi(saisies.L30),
    L75: arrondi(saisies.L75),
    L95: arrondi(saisies.L95),
    L120: arrondi(saisies.L120),
  };
  const avertissements = [];
  const avert = (code, details = {}) => avertissements.push({ code, ...details });

  // ---- Credit du mois precedent (L100) -------------------------------------
  let creditPrecedent = 0;
  let creditSource = "AUCUN";
  if (saisies.credit_precedent !== undefined && saisies.credit_precedent !== null && saisies.credit_precedent !== "") {
    creditPrecedent = arrondi(saisies.credit_precedent);
    creditSource = "SAISIE";
  } else {
    const am = mois === 1 ? annee - 1 : annee;
    const mm = mois === 1 ? 12 : mois - 1;
    const prec = await db.query(
      `SELECT credit_a_reporter FROM fiscalite_declaration_tva WHERE tenant_id = $1 AND annee = $2 AND mois = $3`,
      [tenantId, am, mm]
    );
    if (prec.rows[0]) {
      creditPrecedent = arrondi(prec.rows[0].credit_a_reporter);
      creditSource = "DECLARATION_PRECEDENTE";
    } else {
      avert("CREDIT_PRECEDENT_ABSENT", { annee: am, mois: mm });
    }
  }

  // ---- Ventes ---------------------------------------------------------------
  const taxables = ventes.filter((v) => v.code_operation === "TAXABLE");
  const exports_ = ventes.filter((v) => v.code_operation === "EXPORT");
  const exoneres = ventes.filter((v) => v.code_operation === "EXONERE");
  const suspensions = ventes.filter((v) => v.code_operation === "SUSPENSION");
  const tauxReduit = profil.taux_tva_reduit;
  const tauxNormal = profil.taux_tva_normal;
  const taxablesReduit = taxables.filter((v) => Math.abs(v.taux - tauxReduit) < 0.001);
  const taxablesAutres = taxables.filter((v) => Math.abs(v.taux - tauxReduit) >= 0.001 && Math.abs(v.taux - tauxNormal) >= 0.001);

  const L = {};
  L[10] = modeGl ? s.L10 : arrondi(somme(exports_, (v) => v.ht));
  L[15] = modeGl ? s.L15 : arrondi(somme(exoneres, (v) => v.ht));
  L[20] = modeGl ? s.L20 : arrondi(somme(suspensions, (v) => v.ht));
  L[25] = L[10] + L[15] + L[20];
  L[30] = s.L30;
  // Grand livre : la base taxable est deduite de la TVA collectee comptabilisee (taux normal).
  const baseTaxable = modeGl ? arrondi((gl.collectee * 100) / (tauxNormal || 18)) : arrondi(somme(taxables, (v) => v.ht));
  L[5] = baseTaxable + L[25] + L[30];
  L[35] = L[5] - L[25];
  L[40] = arrondi(somme(taxablesReduit, (v) => v.ht));
  L[45] = L[35] - L[40];
  L[50] = arrondi((L[40] * tauxReduit) / 100);
  L[55] = modeGl ? gl.collectee + arrondi((L[30] * tauxNormal) / 100) : arrondi((L[45] * tauxNormal) / 100);
  L[60] = L[50] + L[55];

  // ---- Precompte -------------------------------------------------------------
  const precomptes = ventes.filter((v) => v.precompte > 0);
  L[65] = arrondi(somme(precomptes, (v) => v.ht));
  L[70] = arrondi(somme(precomptes, (v) => v.precompte));
  L[75] = s.L75;
  L[76] = L[70] + L[75];

  // ---- Achats ----------------------------------------------------------------
  const prorata = profil.prorata_deduction_pct / 100;
  const importsDeductibles = achats.filter((a) => a.type_operation === "IMPORT");
  const locauxDeductibles = achats.filter((a) => a.type_operation === "LOCAL");
  L[80] = arrondi(somme(importsDeductibles, (a) => a.base));
  const tvaImport = somme(importsDeductibles.filter((a) => a.deductible), (a) => a.tva);
  const tvaLocale = somme(locauxDeductibles.filter((a) => a.deductible), (a) => a.tva);
  L[85] = arrondi(tvaImport * prorata);
  L[90] = modeGl ? gl.recuperable : arrondi(tvaLocale * prorata);
  L[91] = L[85] + L[90];
  L[92] = L[76] + L[91];
  L[93] = Math.max(0, L[60] - L[92]);
  L[95] = s.L95;
  L[100] = creditPrecedent;
  L[105] = L[70] + L[75] + L[85] + L[90] + L[100];
  L[110] = Math.max(0, L[60] - L[105]);
  L[115] = Math.max(0, L[105] - L[60]);
  L[120] = s.L120;

  // ---- Controles ---------------------------------------------------------------
  if (!profil.assujetti_tva) avert("NON_ASSUJETTI");
  if (!profil.existe) avert("PROFIL_NON_RENSEIGNE");
  if (taxablesAutres.length > 0) {
    avert("TAUX_INHABITUEL", { nombre: taxablesAutres.length, taux: [...new Set(taxablesAutres.map((v) => v.taux))] });
  }
  const horsTaxeAvecTva = ventes.filter((v) => v.code_operation !== "TAXABLE" && v.tva > 0.5);
  if (horsTaxeAvecTva.length > 0) {
    avert("TVA_SUR_OPERATION_EXONEREE", { nombre: horsTaxeAvecTva.length, montant: arrondi(somme(horsTaxeAvecTva, (v) => v.tva)) });
  }
  const ventesNonValidees = ventes.filter((v) => v.ecriture_statut !== "VALIDEE");
  if (ventesNonValidees.length > 0) {
    avert("VENTES_NON_VALIDEES", {
      nombre: ventesNonValidees.length,
      tva: arrondi(somme(ventesNonValidees, (v) => v.tva)),
      sans_ecriture: ventesNonValidees.filter((v) => !v.ecriture_statut).length,
    });
  }
  const sansNineaClient = [...exoneres, ...exports_, ...suspensions, ...precomptes].filter((v) => !v.client_ninea);
  if (sansNineaClient.length > 0) avert("NINEA_CLIENT_MANQUANT", { nombre: new Set(sansNineaClient.map((v) => v.client_id)).size });
  const achatsAvecTva = achats.filter((a) => a.deductible && a.tva > 0);
  const sansNineaFournisseur = achatsAvecTva.filter((a) => !a.fournisseur_ninea);
  if (sansNineaFournisseur.length > 0) {
    avert("NINEA_FOURNISSEUR_MANQUANT", {
      nombre: new Set(sansNineaFournisseur.map((a) => a.tiers_id)).size,
      tva: arrondi(somme(sansNineaFournisseur, (a) => a.tva)),
    });
  }
  const achatsFournisseurNonAssujetti = achatsAvecTva.filter((a) => a.fournisseur_regime === "CGU" || a.fournisseur_assujetti_tva === false);
  if (achatsFournisseurNonAssujetti.length > 0) {
    avert("TVA_FOURNISSEUR_NON_ASSUJETTI", {
      nombre: achatsFournisseurNonAssujetti.length,
      tva: arrondi(somme(achatsFournisseurNonAssujetti, (a) => a.tva)),
      fournisseurs: [...new Set(achatsFournisseurNonAssujetti.map((a) => a.fournisseur_nom))].slice(0, 5),
    });
  }
  if (ventes.length === 0 && achats.length === 0 && !modeGl) avert("PERIODE_SANS_ACTIVITE");
  if (modeGl) {
    avert("SOURCE_GRAND_LIVRE", { fichier: gl.nom_fichier || "" });
    avert("GL_BASE_DEDUITE", { montant: baseTaxable });
    if (gl.nb_ecritures === 0) avert("GL_AUCUN_MOUVEMENT_TVA");
    if (gl.recuperable > 0) avert("GL_IMPORTATIONS_NON_DISTINGUEES");
    const horsBase = gl.ventes_70 - (baseTaxable + L[25]);
    if (horsBase > 1000) avert("GL_CA_NON_TAXE_A_REPARTIR", { montant: horsBase, ca: gl.ventes_70 });
  } else if (glPartiel && sourceDemandee !== "FACTURES" && ventes.length === 0 && achats.length === 0) {
    avert("GL_PERIODE_PARTIELLE");
  }
  if (profil.prorata_deduction_pct < 100 && !modeGl) avert("PRORATA_APPLIQUE", { pourcentage: profil.prorata_deduction_pct });
  const arrondiBrut = arrondi(somme(taxables, (v) => v.tva)) - L[60];
  if (!modeGl && Math.abs(arrondiBrut) > 1 && taxablesAutres.length === 0) avert("ECART_ARRONDI_TVA", { montant: arrondiBrut });

  // ---- Rapprochement avec la balance (ecritures validees) -----------------------
  const rapprochement = comptable
    ? {
        tva_collectee: { declaree: L[60], comptabilite: comptable.collectee, ecart: L[60] - comptable.collectee, compte: comptable.compte_collectee },
        tva_deductible: { declaree: L[91], comptabilite: comptable.recuperable, ecart: L[91] - comptable.recuperable, compte: comptable.compte_recuperable },
        nb_ecritures: comptable.nb_ecritures,
      }
    : null;
  if (rapprochement && (Math.abs(rapprochement.tva_collectee.ecart) > 1 || Math.abs(rapprochement.tva_deductible.ecart) > 1)) {
    avert("ECART_COMPTABILITE", {
      collectee: rapprochement.tva_collectee.ecart,
      deductible: rapprochement.tva_deductible.ecart,
    });
  }

  // ---- Annexes ------------------------------------------------------------------
  const exonerationsAnnexe = [...exports_, ...exoneres, ...suspensions].map((v) => ({
    code: v.code_operation,
    code_libelle: LIBELLE_CODE_VENTE[v.code_operation],
    numero: v.numero,
    date: v.date,
    client_nom: v.client_nom,
    client_ninea: v.client_ninea,
    motif: v.motif_exoneration,
    base: v.ht,
  }));
  const precompteAnnexe = precomptes.map((v) => ({
    numero: v.numero,
    date: v.date,
    client_nom: v.client_nom,
    client_ninea: v.client_ninea,
    base: v.ht,
    tva_facturee: v.tva,
    precompte: v.precompte,
  }));
  const parFournisseur = new Map();
  for (const a of achats.filter((x) => x.type_operation === "LOCAL")) {
    const cle = a.tiers_id;
    if (!parFournisseur.has(cle)) {
      parFournisseur.set(cle, { fournisseur_nom: a.fournisseur_nom, ninea: a.fournisseur_ninea, nombre: 0, base: 0, tva: 0, tva_deductible: 0, tva_non_deductible: 0 });
    }
    const g = parFournisseur.get(cle);
    g.nombre += 1;
    g.base += a.base;
    g.tva += a.tva;
    if (a.deductible) g.tva_deductible += arrondi2(a.tva * prorata);
    else g.tva_non_deductible += a.tva;
  }
  const achatsLocauxAnnexe = Array.from(parFournisseur.values())
    .map((g) => ({ ...g, base: arrondi(g.base), tva: arrondi(g.tva), tva_deductible: arrondi(g.tva_deductible), tva_non_deductible: arrondi(g.tva_non_deductible) }))
    .sort((a, b) => a.fournisseur_nom.localeCompare(b.fournisseur_nom));
  const importationsAnnexe = achats
    .filter((a) => a.type_operation === "IMPORT")
    .map((a) => ({
      numero: a.numero,
      reference_fournisseur: a.reference_fournisseur,
      date: a.date,
      fournisseur_nom: a.fournisseur_nom,
      base: a.base,
      tva: a.tva,
      deductible: a.deductible,
    }));

  return {
    periode: { annee, mois, debut, fin, date_limite: dateLimite(annee, mois) },
    contribuable,
    profil,
    lignes: L,
    saisies: { ...s, credit_precedent: creditPrecedent, credit_source: creditSource, source_tva: sourceDemandee },
    source: modeGl ? "GRAND_LIVRE" : "FACTURES",
    grand_livre: modeGl ? gl : null,
    grand_livre_disponible: !!(gl || glPartiel),
    avertissements,
    rapprochement,
    ventes,
    achats,
    annexes: {
      exonerations: exonerationsAnnexe,
      precompte: precompteAnnexe,
      achats_locaux: achatsLocauxAnnexe,
      importations: importationsAnnexe,
    },
    totaux: {
      nombre_ventes: ventes.length,
      nombre_achats: achats.length,
      tva_collectee_documents: arrondi(somme(taxables, (v) => v.tva)),
      tva_deductible_brute: arrondi(tvaImport + tvaLocale),
      tva_non_deductible: arrondi(somme(achats.filter((a) => !a.deductible), (a) => a.tva)),
    },
  };
}

// ----------------------------------------------------------------------------
// Declarations enregistrees
// ----------------------------------------------------------------------------

function ligneDeclaration(r) {
  return {
    id: r.id,
    annee: r.annee,
    mois: r.mois,
    statut: r.statut,
    lignes: r.lignes_json,
    saisies: r.saisies_json,
    avertissements: r.avertissements_json,
    solde_a_payer: num(r.solde_a_payer),
    credit_a_reporter: num(r.credit_a_reporter),
    date_depot: r.date_depot ? String(r.date_depot).slice(0, 10) : null,
    reference_depot: r.reference_depot,
    date_paiement: r.date_paiement ? String(r.date_paiement).slice(0, 10) : null,
    notes: r.notes,
    date_preparation: r.date_preparation,
    date_limite: dateLimite(r.annee, r.mois),
  };
}

async function listerAnnee(tenantId, annee) {
  const r = await db.query(`SELECT * FROM fiscalite_declaration_tva WHERE tenant_id = $1 AND annee = $2 ORDER BY mois`, [tenantId, annee]);
  const parMois = new Map(r.rows.map((x) => [x.mois, ligneDeclaration(x)]));
  const out = [];
  for (let m = 1; m <= 12; m++) {
    out.push({ annee, mois: m, date_limite: dateLimite(annee, m), declaration: parMois.get(m) || null });
  }
  return out;
}

async function getDeclaration(tenantId, annee, mois) {
  const r = await db.query(`SELECT * FROM fiscalite_declaration_tva WHERE tenant_id = $1 AND annee = $2 AND mois = $3`, [tenantId, annee, mois]);
  return r.rows[0] ? ligneDeclaration(r.rows[0]) : null;
}

/** Le credit du mois precedent n'est conserve que s'il a ete saisi : sinon il est relu de la declaration precedente. */
function saisiesAConserver(s) {
  const { L10, L15, L20, L30, L75, L95, L120, source_tva } = s;
  const out = { L10, L15, L20, L30, L75, L95, L120, source_tva };
  if (s.credit_source === "SAISIE") out.credit_precedent = s.credit_precedent;
  return out;
}

/** Calcule, puis fige l'instantane. Refuse d'ecraser une declaration deja deposee. */
async function preparer(tenantId, userId, annee, mois, saisies = {}) {
  validerPeriode(annee, mois);
  const existante = await getDeclaration(tenantId, annee, mois);
  if (existante && existante.statut !== "PREPAREE") throw new FiscaliteError("FISCALITE_DECLARATION_DEJA_DEPOSEE", 409);
  const calcul = await calculer(tenantId, annee, mois, saisies);
  const L = calcul.lignes;
  await db.query(
    `INSERT INTO fiscalite_declaration_tva (id, tenant_id, annee, mois, statut, lignes_json, saisies_json, avertissements_json,
                                            solde_a_payer, credit_a_reporter, prepare_par, date_preparation)
     VALUES ($10, $1,$2,$3,'PREPAREE',$4,$5,$6,$7,$8,$9, now())
     ON CONFLICT (tenant_id, annee, mois) DO UPDATE SET
       lignes_json = EXCLUDED.lignes_json, saisies_json = EXCLUDED.saisies_json, avertissements_json = EXCLUDED.avertissements_json,
       solde_a_payer = EXCLUDED.solde_a_payer, credit_a_reporter = EXCLUDED.credit_a_reporter,
       prepare_par = EXCLUDED.prepare_par, date_preparation = now()`,
    [tenantId, annee, mois, JSON.stringify(L), JSON.stringify(saisiesAConserver(calcul.saisies)), JSON.stringify(calcul.avertissements), L[110], L[115], userId, uuidv4()]
  );
  return getDeclaration(tenantId, annee, mois);
}

async function changerStatut(tenantId, annee, mois, corps) {
  validerPeriode(annee, mois);
  const d = await getDeclaration(tenantId, annee, mois);
  if (!d) throw new FiscaliteError("FISCALITE_DECLARATION_INTROUVABLE", 404);
  const action = corps && corps.action;
  const estDate = (v) => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);
  if (action === "deposer") {
    if (!estDate(corps.date_depot)) throw new FiscaliteError("FISCALITE_DATE_INVALIDE");
    await db.query(
      `UPDATE fiscalite_declaration_tva SET statut = 'DEPOSEE', date_depot = $4, reference_depot = $5, notes = COALESCE($6, notes)
       WHERE tenant_id = $1 AND annee = $2 AND mois = $3`,
      [tenantId, annee, mois, corps.date_depot, (corps.reference_depot || "").trim() || null, (corps.notes || "").trim() || null]
    );
  } else if (action === "payer") {
    if (d.statut === "PREPAREE") throw new FiscaliteError("FISCALITE_DEPOT_AVANT_PAIEMENT", 409);
    if (!estDate(corps.date_paiement)) throw new FiscaliteError("FISCALITE_DATE_INVALIDE");
    await db.query(
      `UPDATE fiscalite_declaration_tva SET statut = 'PAYEE', date_paiement = $4 WHERE tenant_id = $1 AND annee = $2 AND mois = $3`,
      [tenantId, annee, mois, corps.date_paiement]
    );
  } else if (action === "rouvrir") {
    await db.query(
      `UPDATE fiscalite_declaration_tva SET statut = 'PREPAREE', date_depot = NULL, reference_depot = NULL, date_paiement = NULL
       WHERE tenant_id = $1 AND annee = $2 AND mois = $3`,
      [tenantId, annee, mois]
    );
  } else {
    throw new FiscaliteError("FISCALITE_ACTION_INVALIDE");
  }
  return getDeclaration(tenantId, annee, mois);
}

// ----------------------------------------------------------------------------
// Traitement fiscal des factures (ventes / achats)
// ----------------------------------------------------------------------------

async function majVente(tenantId, factureId, corps) {
  const c = corps || {};
  const sets = [];
  const params = [tenantId, factureId];
  if (Object.prototype.hasOwnProperty.call(c, "code_operation")) {
    const code = c.code_operation === null || c.code_operation === "" || c.code_operation === "AUTO" ? null : c.code_operation;
    if (code !== null && !CODES_VENTE.includes(code)) throw new FiscaliteError("FISCALITE_CODE_INVALIDE");
    params.push(code);
    sets.push(`tva_code_operation = $${params.length}`);
  }
  if (Object.prototype.hasOwnProperty.call(c, "precompte")) {
    const p = Number(c.precompte || 0);
    if (!Number.isFinite(p) || p < 0) throw new FiscaliteError("FISCALITE_MONTANT_INVALIDE");
    params.push(arrondi2(p));
    sets.push(`tva_precompte_montant = $${params.length}`);
  }
  if (sets.length === 0) throw new FiscaliteError("FISCALITE_RIEN_A_MODIFIER");
  const r = await db.query(`UPDATE facture_vente SET ${sets.join(", ")} WHERE tenant_id = $1 AND id = $2 RETURNING id`, params);
  if (r.rows.length === 0) throw new FiscaliteError("FISCALITE_FACTURE_INTROUVABLE", 404);
}

async function majAchat(tenantId, factureId, corps) {
  const c = corps || {};
  const sets = [];
  const params = [tenantId, factureId];
  const ajouter = (col, val) => {
    params.push(val);
    sets.push(`${col} = $${params.length}`);
  };
  if (Object.prototype.hasOwnProperty.call(c, "type_operation")) {
    if (!["LOCAL", "IMPORT"].includes(c.type_operation)) throw new FiscaliteError("FISCALITE_CODE_INVALIDE");
    ajouter("tva_type_operation", c.type_operation);
  }
  if (Object.prototype.hasOwnProperty.call(c, "deductible")) {
    ajouter("tva_deductible", c.deductible !== false);
    if (c.deductible === false) ajouter("tva_motif_non_deductible", (c.motif || "").trim() || null);
    else ajouter("tva_motif_non_deductible", null);
  }
  for (const [champ, col] of [["base_importation", "tva_base_importation"], ["montant_douane", "tva_montant_douane"]]) {
    if (Object.prototype.hasOwnProperty.call(c, champ)) {
      if (c[champ] === null || c[champ] === "") ajouter(col, null);
      else {
        const v = Number(c[champ]);
        if (!Number.isFinite(v) || v < 0) throw new FiscaliteError("FISCALITE_MONTANT_INVALIDE");
        ajouter(col, arrondi2(v));
      }
    }
  }
  if (sets.length === 0) throw new FiscaliteError("FISCALITE_RIEN_A_MODIFIER");
  const r = await db.query(`UPDATE facture_fournisseur SET ${sets.join(", ")} WHERE tenant_id = $1 AND id = $2 RETURNING id`, params);
  if (r.rows.length === 0) throw new FiscaliteError("FISCALITE_FACTURE_INTROUVABLE", 404);
}

module.exports = {
  FiscaliteError,
  CODES_VENTE,
  LIBELLE_CODE_VENTE,
  bornesPeriode,
  dateLimite,
  getProfil,
  enregistrerProfil,
  getContribuable,
  calculer,
  listerAnnee,
  getDeclaration,
  preparer,
  changerStatut,
  majVente,
  majAchat,
};
