/**
 * Module Fiscalite, lot 5 : contribution economique locale (CEL) - CGI art. 320 a 343.
 *
 *  1. Contribution sur la valeur locative des locaux professionnels (art. 329 a 334) :
 *       - local loue : base = loyer facture (au moins la valeur locative reelle si elle est connue et superieure), taux 15 % ;
 *       - local mis a disposition / occupe a titre gratuit : base = valeur locative reelle, taux 15 % ;
 *       - local inscrit a l'actif : base = 7 % du prix de revient (terrain, agencements et installations compris - art. 291), taux 20 % ;
 *       - regimes particuliers : hotels agrees 50 % de la valeur locative, societes a preponderance immobiliere 40 % ;
 *       - un local de l'actif donne en location n'est impose qu'entre les mains du locataire ; la partie logement est exclue ;
 *       - locaux detenus au 1er janvier de l'annee ; cotisation prorata temporis en cas de debut d'activite en cours d'annee.
 *  2. Contribution sur la valeur ajoutee (CVA, art. 335 a 338) : valeur ajoutee de l'exercice PRECEDENT (produits - charges
 *     admises), plafonnee a 70 % du chiffre d'affaires ; taux 1 % ; minimum 0,15 % du CA (0,075 % secteurs a faible marge) ;
 *     reel simplifie : minimum seul ; non exigible l'annee de creation.
 * Echeances : declaration des locaux 31 janvier (art. 333) ; declaration de la CVA 30 avril (art. 341) ; paiement de la CVA
 * 31 juillet (art. 342) ; la contribution sur les locaux est payee a reception de l'avertissement.
 * Les donnees comptables viennent de fiscaliteDonnees (comptabilite de la plateforme, balance importee ou saisie).
 */
const db = require("../db");
const comptesSvc = require("./fiscaliteComptes");
const { v4: uuidv4 } = require("uuid");
const { FiscaliteError, getProfil } = require("./fiscaliteTva");
const donnees = require("./fiscaliteDonnees");
const dossiers = require("./fiscaliteDossierAnnuel");

const num = (v) => Number(v || 0);
const arrondi = (v) => Math.round(num(v));

const PARAMETRES_DEFAUT = {
  taux_locatif_loue: 15,
  taux_locatif_actif: 20,
  coef_valeur_locative_actif: 7,
  cva_taux: 1,
  cva_minimum_taux: 0.15,
  cva_minimum_taux_faible_marge: 0.075,
  plafond_va_pct_ca: 70,
};

const COMPTES_DEFAUT = {
  produits: [
    ["70", "CEL_VA_VENTES"],
    ["71", "CEL_VA_SUBVENTIONS"],
    ["72", "CEL_VA_PRODUCTION_IMMOBILISEE"],
    ["73", "CEL_VA_VARIATION_STOCKS_PRODUITS"],
    ["75", "CEL_VA_AUTRES_PRODUITS"],
    ["78", "CEL_VA_TRANSFERTS_CHARGES"],
  ],
  exclure_produits: ["754"], // plus-values de cession : seulement si activite habituelle
  charges: [
    ["60", "CEL_VA_ACHATS"],
    ["61", "CEL_VA_TRANSPORTS"],
    ["62", "CEL_VA_SERVICES_EXT_A"],
    ["63", "CEL_VA_SERVICES_EXT_B"],
    ["64", "CEL_VA_IMPOTS_TAXES"],
    ["65", "CEL_VA_AUTRES_CHARGES"],
  ],
  exclure_charges: ["622", "654"], // loyers (biens loues plus de 3 mois) ; moins-values de cession
  ca: ["70", "71", "75"],
  exclure_ca: ["754"],
  immeubles: ["22", "23"],
  loyers: ["622"],
};

const NATURES = ["LOUE", "ACTIF", "GRATUIT", "DISPOSITION"];
const REGIMES = { NORMAL: 1, HOTEL: 0.5, SPI: 0.4 };

function validerAnnee(annee) {
  const a = Number(annee);
  if (!Number.isInteger(a) || a < 2000 || a > 2100) throw new FiscaliteError("FISCALITE_PERIODE_INVALIDE");
  return a;
}

// ---------------------------------------------------------------------------
// Locaux
// ---------------------------------------------------------------------------

function montantPositif(v, champ) {
  if (v === undefined || v === null || v === "") return 0;
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) throw new FiscaliteError("FISCALITE_MONTANT_INVALIDE", 400, { champ });
  return Math.round(n);
}
const dateOuNull = (v) => {
  if (v === undefined || v === null || v === "") return null;
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v)) throw new FiscaliteError("FISCALITE_DATE_INVALIDE");
  return v;
};

function nettoyerLocal(c) {
  const libelle = String((c && c.libelle) || "").trim().slice(0, 150);
  if (!libelle) throw new FiscaliteError("FISCALITE_LOCAL_INVALIDE");
  const nature = NATURES.includes(c.nature) ? c.nature : "LOUE";
  const regime = Object.keys(REGIMES).includes(c.regime) ? c.regime : "NORMAL";
  const part = c.part_professionnelle_pct === undefined || c.part_professionnelle_pct === "" || c.part_professionnelle_pct === null ? 100 : Number(c.part_professionnelle_pct);
  if (!Number.isFinite(part) || part < 0 || part > 100) throw new FiscaliteError("FISCALITE_LOCAL_INVALIDE");
  const debut = dateOuNull(c.date_debut);
  const fin = dateOuNull(c.date_fin);
  if (debut && fin && fin < debut) throw new FiscaliteError("FISCALITE_DATE_INVALIDE");
  return {
    libelle,
    commune: String(c.commune || "").trim().slice(0, 100) || null,
    nature,
    loyer_annuel: montantPositif(c.loyer_annuel, "loyer_annuel"),
    prix_revient: montantPositif(c.prix_revient, "prix_revient"),
    valeur_locative_reelle: montantPositif(c.valeur_locative_reelle, "valeur_locative_reelle"),
    regime,
    part_professionnelle_pct: part,
    donne_en_location: !!c.donne_en_location,
    exonere: !!c.exonere,
    motif_exoneration: String(c.motif_exoneration || "").trim().slice(0, 200) || null,
    date_debut: debut,
    date_fin: fin,
    note: String(c.note || "").trim().slice(0, 500) || null,
  };
}

const dateIso = (d) => (d ? (d instanceof Date ? d.toISOString().slice(0, 10) : String(d).slice(0, 10)) : null);
function versLocal(x) {
  return {
    id: x.id,
    libelle: x.libelle,
    commune: x.commune,
    nature: x.nature,
    loyer_annuel: num(x.loyer_annuel),
    prix_revient: num(x.prix_revient),
    valeur_locative_reelle: num(x.valeur_locative_reelle),
    regime: x.regime,
    part_professionnelle_pct: num(x.part_professionnelle_pct),
    donne_en_location: x.donne_en_location,
    exonere: x.exonere,
    motif_exoneration: x.motif_exoneration,
    date_debut: dateIso(x.date_debut),
    date_fin: dateIso(x.date_fin),
    note: x.note,
  };
}

async function listerLocaux(tenantId) {
  const r = await db.query(`SELECT * FROM fiscalite_cel_local WHERE tenant_id = $1 AND actif ORDER BY libelle`, [tenantId]);
  return r.rows.map(versLocal);
}

async function ajouterLocal(tenantId, corps) {
  const l = nettoyerLocal(corps || {});
  const id = uuidv4();
  await db.query(
    `INSERT INTO fiscalite_cel_local (id, tenant_id, libelle, commune, nature, loyer_annuel, prix_revient, valeur_locative_reelle, regime, part_professionnelle_pct,
                                      donne_en_location, exonere, motif_exoneration, date_debut, date_fin, note)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
    [id, tenantId, l.libelle, l.commune, l.nature, l.loyer_annuel, l.prix_revient, l.valeur_locative_reelle, l.regime, l.part_professionnelle_pct, l.donne_en_location, l.exonere, l.motif_exoneration, l.date_debut, l.date_fin, l.note]
  );
  return { id, ...l };
}

async function modifierLocal(tenantId, id, corps) {
  const l = nettoyerLocal(corps || {});
  const r = await db.query(
    `UPDATE fiscalite_cel_local SET libelle=$3, commune=$4, nature=$5, loyer_annuel=$6, prix_revient=$7, valeur_locative_reelle=$8, regime=$9, part_professionnelle_pct=$10,
            donne_en_location=$11, exonere=$12, motif_exoneration=$13, date_debut=$14, date_fin=$15, note=$16, date_modification = now()
     WHERE tenant_id = $1 AND id = $2 AND actif`,
    [tenantId, id, l.libelle, l.commune, l.nature, l.loyer_annuel, l.prix_revient, l.valeur_locative_reelle, l.regime, l.part_professionnelle_pct, l.donne_en_location, l.exonere, l.motif_exoneration, l.date_debut, l.date_fin, l.note]
  );
  if (r.rowCount === 0) throw new FiscaliteError("FISCALITE_LOCAL_INTROUVABLE", 404);
  return { id, ...l };
}

async function supprimerLocal(tenantId, id) {
  const r = await db.query(`UPDATE fiscalite_cel_local SET actif = FALSE, date_modification = now() WHERE tenant_id = $1 AND id = $2 AND actif`, [tenantId, id]);
  if (r.rowCount === 0) throw new FiscaliteError("FISCALITE_LOCAL_INTROUVABLE", 404);
}

/**
 * Moteur pur de la contribution sur la valeur locative pour l'annee d'imposition `annee`.
 * @returns {{lignes: object[], total: number, base_totale: number}}
 */
function moteurLocaux(locaux, annee, p = PARAMETRES_DEFAUT) {
  const debutAnnee = `${annee}-01-01`;
  const finAnnee = `${annee}-12-31`;
  const joursAnnee = Math.round((Date.UTC(annee, 11, 31) - Date.UTC(annee, 0, 1)) / 86400000) + 1;
  const lignes = locaux.map((l) => {
    const base = { id: l.id, libelle: l.libelle, commune: l.commune, nature: l.nature, regime: l.regime };
    if (l.date_fin && l.date_fin < debutAnnee) return { ...base, imposable: false, motif: "HORS_PERIODE", base_brute: 0, base: 0, taux: 0, prorata: 0, contribution: 0 };
    if (l.date_debut && l.date_debut > finAnnee) return { ...base, imposable: false, motif: "HORS_PERIODE", base_brute: 0, base: 0, taux: 0, prorata: 0, contribution: 0 };
    if (l.exonere) return { ...base, imposable: false, motif: "EXONERE", base_brute: 0, base: 0, taux: 0, prorata: 0, contribution: 0 };
    if (l.nature === "ACTIF" && l.donne_en_location) return { ...base, imposable: false, motif: "DONNE_EN_LOCATION", base_brute: 0, base: 0, taux: 0, prorata: 0, contribution: 0 };
    let baseBrute;
    let taux;
    if (l.nature === "ACTIF") {
      baseBrute = (l.prix_revient * p.coef_valeur_locative_actif) / 100;
      taux = p.taux_locatif_actif;
    } else if (l.nature === "LOUE") {
      baseBrute = Math.max(l.loyer_annuel, l.valeur_locative_reelle || 0);
      taux = p.taux_locatif_loue;
    } else {
      baseBrute = l.valeur_locative_reelle;
      taux = p.taux_locatif_loue;
    }
    const baseAjustee = (baseBrute * (l.part_professionnelle_pct / 100)) * (REGIMES[l.regime] || 1);
    // Debut d'activite en cours d'annee : cotisation prorata temporis (art. 332-2).
    let prorata = 1;
    if (l.date_debut && l.date_debut > debutAnnee) {
      const jours = Math.round((Date.UTC(annee, 11, 31) - Date.parse(`${l.date_debut}T00:00:00Z`)) / 86400000) + 1;
      prorata = Math.max(0, Math.min(1, jours / joursAnnee));
    }
    return {
      ...base,
      imposable: true,
      motif: null,
      base_brute: arrondi(baseBrute),
      part_professionnelle_pct: l.part_professionnelle_pct,
      base: arrondi(baseAjustee),
      taux,
      prorata: Math.round(prorata * 10000) / 10000,
      contribution: arrondi((baseAjustee * taux * prorata) / 100),
    };
  });
  return {
    lignes,
    total: lignes.reduce((t, x) => t + x.contribution, 0),
    base_totale: lignes.reduce((t, x) => t + x.base, 0),
  };
}

// ---------------------------------------------------------------------------
// CVA
// ---------------------------------------------------------------------------

const correspond = (numero, prefixes, exclusions = []) => prefixes.some((p) => numero.startsWith(p)) && !exclusions.some((e) => numero.startsWith(e));

/** Somme des soldes (debit - credit) des comptes retenus. */
function sommeComptes(comptes, prefixes, exclusions = []) {
  return comptes.filter((c) => correspond(c.numero, prefixes, exclusions)).reduce((t, c) => t + c.net, 0);
}

/**
 * Moteur pur de la CVA (art. 335 a 338).
 * @param {object} e { comptes, parametres, regime_simplifie, faible_marge, cree_en_annee, va_manuel, ca_manuel, va_ajustement }
 */
function moteurCva(e) {
  const p = e.parametres || PARAMETRES_DEFAUT;
  const comptes = e.comptes || [];
  const aDesComptes = comptes.length > 0;
  const detailProduits = [];
  const detailCharges = [];
  for (const [prefixe, cle] of COMPTES_DEFAUT.produits) {
    const montant = -sommeComptes(comptes, [prefixe], COMPTES_DEFAUT.exclure_produits);
    detailProduits.push({ prefixe, cle, montant: arrondi(montant) });
  }
  for (const [prefixe, cle] of COMPTES_DEFAUT.charges) {
    const montant = sommeComptes(comptes, [prefixe], [...(e.comptes_loyers || ["622"]), "654"]); // loyers parametrables ; moins-values de cession
    detailCharges.push({ prefixe, cle, montant: arrondi(montant) });
  }
  const produits = detailProduits.reduce((t, x) => t + x.montant, 0);
  const charges = detailCharges.reduce((t, x) => t + x.montant, 0);
  const caCompta = arrondi(-sommeComptes(comptes, COMPTES_DEFAUT.ca, COMPTES_DEFAUT.exclure_ca));
  const ca = e.ca_manuel !== null && e.ca_manuel !== undefined ? arrondi(e.ca_manuel) : caCompta;
  const vaCompta = produits - charges + arrondi(e.va_ajustement);
  const vaBrute = e.va_manuel !== null && e.va_manuel !== undefined ? arrondi(e.va_manuel) : vaCompta;
  const plafondVa = arrondi((ca * p.plafond_va_pct_ca) / 100);
  const vaRetenue = Math.max(0, Math.min(vaBrute, plafondVa));
  const cvaCalculee = arrondi((vaRetenue * p.cva_taux) / 100);
  const tauxMinimum = e.faible_marge ? p.cva_minimum_taux_faible_marge : p.cva_minimum_taux;
  const minimum = arrondi((ca * tauxMinimum) / 100);
  let cva;
  let base;
  if (e.cree_en_annee) {
    cva = 0;
    base = "EXONEREE_CREATION";
  } else if (e.regime_simplifie) {
    cva = minimum;
    base = "MINIMUM_SIMPLIFIE";
  } else if (cvaCalculee >= minimum) {
    cva = cvaCalculee;
    base = "CALCULEE";
  } else {
    cva = minimum;
    base = "MINIMUM";
  }
  return {
    a_des_comptes: aDesComptes,
    produits: { detail: detailProduits, total: produits },
    charges: { detail: detailCharges, total: charges },
    va_comptable: vaCompta,
    va_brute: vaBrute,
    va_manuelle: e.va_manuel !== null && e.va_manuel !== undefined,
    chiffre_affaires: ca,
    plafond_va: plafondVa,
    plafonnee: vaBrute > plafondVa,
    va_retenue: vaRetenue,
    taux: p.cva_taux,
    cva_calculee: cvaCalculee,
    taux_minimum: tauxMinimum,
    minimum,
    cva,
    base,
  };
}

// ---------------------------------------------------------------------------
// Saisies et calcul
// ---------------------------------------------------------------------------

function nombreOuNull(v, champ) {
  if (v === undefined || v === null || v === "") return null;
  const n = Number(v);
  if (!Number.isFinite(n)) throw new FiscaliteError("FISCALITE_MONTANT_INVALIDE", 400, { champ });
  return Math.round(n);
}

function nettoyerSaisies(brut) {
  const s = brut || {};
  const sortie = {
    source_donnees: ["AUTO", "COMPTABILITE", "IMPORT"].includes(s.source_donnees) ? s.source_donnees : "AUTO",
    utiliser_saisie: !!s.utiliser_saisie,
    regime_cva: ["AUTO", "NORMAL", "SIMPLIFIE"].includes(s.regime_cva) ? s.regime_cva : "AUTO",
    faible_marge: !!s.faible_marge,
    cree_en_annee: !!s.cree_en_annee,
    hors_champ: !!s.hors_champ,
    ca_manuel: nombreOuNull(s.ca_manuel, "ca_manuel"),
    va_manuel: nombreOuNull(s.va_manuel, "va_manuel"),
    va_ajustement: nombreOuNull(s.va_ajustement, "va_ajustement") || 0,
    parametres: {},
  };
  for (const k of Object.keys(PARAMETRES_DEFAUT)) {
    const v = s.parametres && s.parametres[k];
    if (v === undefined || v === null || v === "") continue;
    const n = Number(v);
    if (!Number.isFinite(n) || n < 0 || n > 1000) throw new FiscaliteError("FISCALITE_PARAMETRE_INVALIDE", 400, { parametre: k });
    sortie.parametres[k] = n;
  }
  return sortie;
}

/**
 * Calcul de la CEL de l'annee d'imposition `annee` : contribution sur les locaux (au 1er janvier) et CVA sur la valeur
 * ajoutee de l'exercice `annee - 1`.
 */
async function calculer(tenantId, annee, saisiesBrutes) {
  const a = validerAnnee(annee);
  const dossier = await dossiers.getDossier(tenantId, "CEL", a);
  const saisies = nettoyerSaisies(saisiesBrutes !== undefined && saisiesBrutes !== null ? saisiesBrutes : dossier ? dossier.saisies : {});
  const parametres = { ...PARAMETRES_DEFAUT, ...saisies.parametres };
  const profil = await getProfil(db, tenantId);
  const avertissements = [];
  const avert = (code, details = {}) => avertissements.push({ code, ...details });

  // --- Locaux -------------------------------------------------------------------------------------
  const locaux = await listerLocaux(tenantId);
  const moteurL = moteurLocaux(locaux, a, parametres);

  // --- Donnees comptables de l'exercice precedent ----------------------------------------------------
  const data = await donnees.charger(tenantId, a - 1, { source: saisies.utiliser_saisie ? "MANUEL" : saisies.source_donnees });
  for (const x of data.avertissements) avert(x.code, x);
  if (data.source === "IMPORT") avert("CEL_SOURCE_IMPORT", { annee: a - 1 });
  if (!data.exercice && data.comptes.length === 0 && saisies.va_manuel === null) avert("CEL_EXERCICE_PRECEDENT_ABSENT", { annee: a - 1 });
  if (data.nb_instance > 0) avert("ECRITURES_EN_INSTANCE", { nombre: data.nb_instance });

  // --- Suggestions (jamais retenues automatiquement) -----------------------------------------------------
  const cpt = await comptesSvc.getComptes(tenantId); // comptes parametres par l'entreprise (ecran Comptes de la fiscalite)
  const immeublesCompta = Math.max(0, arrondi(donnees.sommeNet(data.comptes, cpt.CEL_IMMEUBLES)));
  const loyersCompta = Math.max(0, arrondi(donnees.sommeNet(data.comptes, cpt.CEL_LOYERS)));
  const suggestions = {
    immeubles_actif: { prix_revient: immeublesCompta, valeur_locative: arrondi((immeublesCompta * parametres.coef_valeur_locative_actif) / 100), contribution: arrondi((immeublesCompta * parametres.coef_valeur_locative_actif * parametres.taux_locatif_actif) / 10000) },
    loyers_compta: loyersCompta,
    loyers_saisis: locaux.filter((l) => l.nature === "LOUE" && !l.exonere).reduce((t, l) => t + l.loyer_annuel, 0),
  };
  if (immeublesCompta > 0 && !locaux.some((l) => l.nature === "ACTIF")) avert("CEL_IMMEUBLES_ACTIF_A_SAISIR", { montant: immeublesCompta });
  if (loyersCompta > 0 && !locaux.some((l) => l.nature === "LOUE")) avert("CEL_LOYERS_A_SAISIR", { montant: loyersCompta });
  if (loyersCompta > 0 && suggestions.loyers_saisis > 0 && Math.abs(loyersCompta - suggestions.loyers_saisis) > loyersCompta * 0.1) {
    avert("CEL_LOYERS_ECART", { compta: loyersCompta, saisis: suggestions.loyers_saisis });
  }
  if (locaux.length === 0) avert("CEL_AUCUN_LOCAL");

  // --- Regime / champ d'application ------------------------------------------------------------------
  let regimeSimplifie = saisies.regime_cva === "SIMPLIFIE" || (saisies.regime_cva === "AUTO" && profil.regime_is === "REEL_SIMPLIFIE");
  const cgu = saisies.regime_cva === "AUTO" && profil.regime_is === "CGU";
  const horsChamp = saisies.hors_champ || cgu;
  if (cgu) avert("CEL_REGIME_CGU");
  if (!profil.existe) avert("PROFIL_NON_RENSEIGNE");

  const cvaMoteur = moteurCva({
    comptes_loyers: cpt.CEL_LOYERS,
    comptes: data.comptes,
    parametres,
    regime_simplifie: regimeSimplifie,
    faible_marge: saisies.faible_marge,
    cree_en_annee: saisies.cree_en_annee,
    va_manuel: saisies.va_manuel,
    ca_manuel: saisies.ca_manuel,
    va_ajustement: saisies.va_ajustement,
  });
  if (!cvaMoteur.a_des_comptes && saisies.va_manuel === null && !saisies.cree_en_annee) avert("CEL_VA_A_SAISIR");
  if (cvaMoteur.plafonnee) avert("CEL_VA_PLAFONNEE", { va: cvaMoteur.va_brute, plafond: cvaMoteur.plafond_va });
  if (cvaMoteur.va_brute < 0) avert("CEL_VA_NEGATIVE");
  if (cvaMoteur.base === "MINIMUM" && !saisies.cree_en_annee) avert("CEL_CVA_MINIMUM", { montant: cvaMoteur.minimum });
  if (cvaMoteur.base === "MINIMUM_SIMPLIFIE") avert("CEL_CVA_SIMPLIFIE");
  if (cvaMoteur.base === "EXONEREE_CREATION") avert("CEL_CVA_CREATION");
  if (cvaMoteur.a_des_comptes) avert("CEL_LOYERS_ET_AJUSTEMENTS");
  avert("CEL_REGIMES_SPECIAUX");

  const locauxDu = horsChamp ? 0 : moteurL.total;
  const cvaDu = horsChamp ? 0 : cvaMoteur.cva;
  if (horsChamp) avert("CEL_HORS_CHAMP");

  const total = locauxDu + cvaDu;
  return {
    annee: a,
    exercice_reference: data.exercice,
    source: data.source,
    donnees: { source: data.source, sources_disponibles: data.sources_disponibles, import: data.import },
    saisies: { ...saisies, parametres: saisies.parametres },
    parametres,
    locaux: { lignes: moteurL.lignes, total: locauxDu, base_totale: moteurL.base_totale },
    cva: cvaMoteur,
    suggestions,
    total_cel: total,
    montant_du: total,
    echeances: { declaration_locaux: `${a}-01-31`, declaration_cva: `${a}-04-30`, paiement_cva: `${a}-07-31` },
    regime_simplifie: regimeSimplifie,
    hors_champ: horsChamp,
    avertissements,
  };
}

async function listerAnnees(tenantId) {
  const r = await dossiers.listerAnnees(tenantId, "CEL");
  return r.map((d) => ({ annee: d.annee, statut: d.statut, montant_du: d.montant_du, date_depot: d.date_depot, date_paiement: d.date_paiement }));
}

async function getAnnee(tenantId, annee) {
  const a = validerAnnee(annee);
  const dossier = await dossiers.getDossier(tenantId, "CEL", a);
  const gele = !!dossier && (dossier.statut === "DEPOSEE" || dossier.statut === "PAYEE");
  const calcul = gele && dossier.calcul ? dossier.calcul : await calculer(tenantId, a);
  const live = gele ? await calculer(tenantId, a, dossier.saisies) : null;
  return {
    dossier,
    calcul,
    locaux: await listerLocaux(tenantId),
    live_differe_du_depot: !!(live && live.montant_du !== calcul.montant_du),
  };
}

async function simuler(tenantId, annee, saisies) {
  return calculer(tenantId, validerAnnee(annee), saisies || {});
}

async function enregistrerSaisies(tenantId, annee, saisies) {
  return dossiers.enregistrerSaisies(tenantId, "CEL", validerAnnee(annee), nettoyerSaisies(saisies));
}

async function preparer(tenantId, userId, annee, saisies) {
  const a = validerAnnee(annee);
  const calcul = await calculer(tenantId, a, saisies);
  return dossiers.preparer(tenantId, userId, "CEL", a, calcul);
}

const changerStatut = (tenantId, annee, corps) => dossiers.changerStatut(tenantId, "CEL", validerAnnee(annee), corps);

module.exports = {
  PARAMETRES_DEFAUT,
  COMPTES_DEFAUT,
  NATURES,
  REGIMES,
  moteurLocaux,
  moteurCva,
  nettoyerSaisies,
  listerLocaux,
  ajouterLocal,
  modifierLocal,
  supprimerLocal,
  calculer,
  listerAnnees,
  getAnnee,
  simuler,
  enregistrerSaisies,
  preparer,
  changerStatut,
};
