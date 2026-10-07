/**
 * Module Fiscalite (payant) - lot 3 : impot sur les societes (IS) et impot minimum forfaitaire (IMF).
 *
 * Comme pour la TVA, le calcul est une LECTURE : il part de la balance (ecritures VALIDEES des classes 6 a 8 de
 * l'exercice comptable), applique les retraitements extra-comptables et renvoie la chaine complete
 *
 *   resultat comptable -> reintegrations -> deductions -> resultat fiscal avant deficits
 *     -> imputation des deficits (art. 16) -> base imposable (arrondie au millier inferieur, art. 36)
 *     -> IS 30 % / IMF 0,5 % du CA (art. 38-40) -> credits d'impot (art. 37) -> acomptes verses -> solde.
 *
 * La preparation fige un instantane (fiscalite_is_dossier), elle n'ecrit AUCUNE ecriture comptable et ne depose rien.
 *
 * Regles retenues (CGI 2025 fourni) :
 *  - IS : 30 % du benefice imposable, fraction inferieure a 1 000 F negligee (art. 36).
 *  - IMF : 0,5 % du chiffre d'affaires HT de l'exercice (= annee precedant celle de l'imposition), plafonne a 5 000 000 F
 *    (art. 40, LFI 2019). Le CGI fourni ne prevoit pas de plancher : le parametre `imf_plancher` vaut 0 (le calculateur
 *    Excel de reference utilisait 500 000 F - a confirmer). Impot du = max(IS, IMF) (art. 38).
 *  - Deficits : ordinaires reportables jusqu'au 3e exercice suivant ; amortissements regulierement comptabilises en periode
 *    deficitaire = reputes differes, report illimite, imputes apres les deficits ordinaires (art. 10 et 16).
 *  - Acomptes : chacun = 1/3 de l'impot du sur le dernier exercice, arrondi a la centaine inferieure ; le 1er acompte ne peut
 *    etre inferieur a l'IMF (art. 214-215). Echeances : 15 fevrier, 30 avril, solde au 15 juin.
 * Tous les taux et plafonds sont des PARAMETRES modifiables par exercice (onglet Parametres) : la loi de finances peut les changer.
 */
const db = require("../db");
const comptesSvc = require("./fiscaliteComptes");
const { v4: uuidv4 } = require("uuid");
const { FiscaliteError } = require("./fiscaliteTva");
const donnees = require("./fiscaliteDonnees");
const ccaSvc = require("./fiscaliteCca");

const num = (v) => Number(v || 0);
const arrondi = (v) => Math.round(num(v));
const pad = (n) => String(n).padStart(2, "0");

const PARAMETRES_DEFAUT = {
  taux_is: 30,
  imf_taux: 0.5,
  imf_plafond: 5000000,
  imf_plancher: 0,
  dons_plafond_pct_ca: 0.5,
  report_deficit_exercices: 3,
};
const BORNES_PARAMETRES = {
  taux_is: [0, 100],
  imf_taux: [0, 100],
  imf_plafond: [0, 1e12],
  imf_plancher: [0, 1e12],
  dons_plafond_pct_ca: [0, 100],
  report_deficit_exercices: [0, 20],
};

function validerAnnee(annee) {
  const a = Number(annee);
  if (!Number.isInteger(a) || a < 2000 || a > 2100) throw new FiscaliteError("FISCALITE_PERIODE_INVALIDE");
  return a;
}

/**
 * Lignes de retraitement proposees par la plateforme a partir de la balance.
 *   mode AUTO       : le montant calcule est retenu (modifiable) ;
 *   mode SUGGESTION : le montant comptabilise est seulement signale, rien n'est retenu tant que l'utilisateur ne le decide pas.
 */
const REGLES_AUTO = [
  {
    code: "IS_COMPTABILISE",
    sens: "REINTEGRATION",
    mode: "AUTO",
    reference: "Art. 9-7",
    comptes: ["89"],
    cote: "debit",
  },
  {
    code: "AMENDES_PENALITES",
    sens: "REINTEGRATION",
    mode: "AUTO",
    reference: "Art. 9-9",
    comptes: ["647"],
    cote: "debit",
  },
  {
    code: "DONS_EXCEDENT",
    sens: "REINTEGRATION",
    mode: "AUTO",
    reference: "Art. 9-3",
    comptes: ["6582", "6583"],
    cote: "debit",
    // Seuls les dons aux organismes reconnus d'utilite publique sont deductibles, dans la limite de 0,5 % du CA.
    retenu: (comptabilise, ctx) => Math.max(0, comptabilise - arrondi((ctx.ca * ctx.parametres.dons_plafond_pct_ca) / 100)),
  },
  {
    code: "PROVISIONS_A_VERIFIER",
    sens: "REINTEGRATION",
    mode: "SUGGESTION",
    reference: "Art. 11",
    comptes: ["691", "697"],
    cote: "debit",
  },
  {
    code: "REPRISES_PROVISIONS_TAXEES",
    sens: "DEDUCTION",
    mode: "SUGGESTION",
    reference: "Art. 11",
    comptes: ["791", "797"],
    cote: "credit",
  },
];

/** Types proposes pour une ligne saisie a la main (le libelle reste libre). */
const TYPES_MANUELS = {
  REINTEGRATION: [
    { code: "TAXE_VOITURES_PM", reference: "Art. 9-7 / art. 550" },
    { code: "AMORT_NON_ADMIS", reference: "Art. 10" },
    { code: "INTERETS_EXCEDENTAIRES", reference: "Art. 9-2" },
    { code: "REMUNERATIONS_EXCESSIVES", reference: "Art. 15" },
    { code: "ALLOCATIONS_FORFAITAIRES", reference: "Art. 9-8" },
    { code: "PROVISIONS_NON_DEDUCTIBLES", reference: "Art. 11" },
    { code: "AUTRE_REINTEGRATION", reference: "Art. 8 à 11" },
  ],
  DEDUCTION: [
    { code: "PRODUITS_PARTICIPATION", reference: "Art. 21 à 25" },
    { code: "PLUS_VALUES_REINVESTIES", reference: "Art. 19" },
    { code: "AUTRE_DEDUCTION", reference: "Art. 12 à 14" },
  ],
};
/** Retraitements calcules par le module « comptes courants d'associes » (fiscaliteCca.js). */
const CODES_CCA = ["CCA_CAPITAL_NON_LIBERE", "CCA_TAUX_EXCEDENTAIRE", "CCA_PERSONNES_PHYSIQUES", "CCA_PERSONNES_MORALES", "CCA_REPORT_DEDUCTION"];
const SENS_CCA = { CCA_REPORT_DEDUCTION: "DEDUCTION" };
const CODES_MANUELS = {
  REINTEGRATION: TYPES_MANUELS.REINTEGRATION.map((x) => x.code),
  DEDUCTION: TYPES_MANUELS.DEDUCTION.map((x) => x.code),
};

function nettoyerParametres(brut) {
  const p = { ...PARAMETRES_DEFAUT };
  for (const [k, v] of Object.entries(brut || {})) {
    if (!(k in PARAMETRES_DEFAUT) || v === "" || v === null || v === undefined) continue;
    const n = Number(v);
    const [min, max] = BORNES_PARAMETRES[k];
    if (!Number.isFinite(n) || n < min || n > max) throw new FiscaliteError("FISCALITE_PARAMETRE_INVALIDE", 400, { parametre: k });
    p[k] = n;
  }
  return p;
}

/** Valide et normalise les saisies d'un dossier (ce qui est conserve en base). */
function nettoyerSaisies(brut) {
  const s = brut || {};
  const montant = (v, champ) => {
    if (v === "" || v === null || v === undefined) return null;
    const n = Number(v);
    if (!Number.isFinite(n)) throw new FiscaliteError("FISCALITE_MONTANT_INVALIDE", 400, { champ });
    return arrondi(n);
  };
  const positif = (v, champ) => {
    const n = montant(v, champ);
    if (n !== null && n < 0) throw new FiscaliteError("FISCALITE_MONTANT_INVALIDE", 400, { champ });
    return n;
  };
  const sortie = {
    utiliser_saisie: !!s.utiliser_saisie,
    resultat_comptable_manuel: montant(s.resultat_comptable_manuel, "resultat_comptable_manuel"),
    ca_manuel: positif(s.ca_manuel, "ca_manuel"),
    amortissements_manuel: positif(s.amortissements_manuel, "amortissements_manuel"),
    imf_exonere: !!s.imf_exonere,
    imf_motif: String(s.imf_motif || "").trim().slice(0, 300) || null,
    is_precedent: positif(s.is_precedent, "is_precedent"),
    parametres: {},
    credits_impot: [],
    retraitements: [],
    ajustements: {},
    source_donnees: ["COMPTABILITE", "IMPORT"].includes(s.source_donnees) ? s.source_donnees : "AUTO",
    cca: ccaSvc.nettoyerCca(s.cca),
  };
  const params = nettoyerParametres(s.parametres);
  for (const k of Object.keys(PARAMETRES_DEFAUT)) if (params[k] !== PARAMETRES_DEFAUT[k]) sortie.parametres[k] = params[k];
  for (const c of Array.isArray(s.credits_impot) ? s.credits_impot : []) {
    const m = positif(c && c.montant, "credits_impot");
    if (!m) continue;
    sortie.credits_impot.push({ libelle: String((c && c.libelle) || "").trim().slice(0, 200) || "Crédit d'impôt (art. 37)", montant: m });
  }
  for (const r of Array.isArray(s.retraitements) ? s.retraitements : []) {
    if (!r || !["REINTEGRATION", "DEDUCTION"].includes(r.sens)) throw new FiscaliteError("FISCALITE_CODE_INVALIDE");
    const m = positif(r.montant, "retraitements");
    if (!m) continue;
    const code = CODES_MANUELS[r.sens].includes(r.code) ? r.code : r.sens === "REINTEGRATION" ? "AUTRE_REINTEGRATION" : "AUTRE_DEDUCTION";
    sortie.retraitements.push({
      id: typeof r.id === "string" && r.id ? r.id.slice(0, 40) : uuidv4(),
      sens: r.sens,
      code,
      libelle: String(r.libelle || "").trim().slice(0, 200) || null,
      montant: m,
      note: String(r.note || "").trim().slice(0, 300) || null,
    });
  }
  for (const [code, a] of Object.entries(s.ajustements || {})) {
    if ((!REGLES_AUTO.some((x) => x.code === code) && !CODES_CCA.includes(code)) || !a) continue;
    const m = positif(a.montant, "ajustements");
    if (m === null) continue;
    sortie.ajustements[code] = { montant: m, note: String(a.note || "").trim().slice(0, 300) || null };
  }
  return sortie;
}

// ----------------------------------------------------------------------------
// Lecture de la balance
// ----------------------------------------------------------------------------

const dateIso = (d) => (d instanceof Date ? d.toISOString().slice(0, 10) : String(d).slice(0, 10));

function sommeNet(comptes, prefixes) {
  return comptes.filter((c) => prefixes.some((p) => c.numero.startsWith(p))).reduce((t, c) => t + c.net, 0);
}

// ----------------------------------------------------------------------------
// Dossiers, deficits, paiements
// ----------------------------------------------------------------------------

function versDossier(row) {
  if (!row) return null;
  return {
    annee: row.annee,
    statut: row.statut,
    exercice_id: row.exercice_id,
    saisies: row.saisies_json || {},
    calcul: row.calcul_json || null,
    impot_du: row.impot_du === null ? null : num(row.impot_du),
    solde_a_payer: row.solde_a_payer === null ? null : num(row.solde_a_payer),
    date_depot: row.date_depot ? dateIso(row.date_depot) : null,
    reference_depot: row.reference_depot,
    date_paiement: row.date_paiement ? dateIso(row.date_paiement) : null,
    date_preparation: row.date_preparation,
  };
}

async function getDossier(tenantId, annee) {
  const r = await db.query(`SELECT * FROM fiscalite_is_dossier WHERE tenant_id = $1 AND annee = $2`, [tenantId, annee]);
  return versDossier(r.rows[0]);
}

async function listerDeficits(tenantId) {
  const r = await db.query(`SELECT * FROM fiscalite_is_deficit WHERE tenant_id = $1 ORDER BY annee_origine, type`, [tenantId]);
  const filed = await db.query(
    `SELECT annee, calcul_json FROM fiscalite_is_dossier WHERE tenant_id = $1 AND statut IN ('DEPOSEE', 'PAYEE') ORDER BY annee`,
    [tenantId]
  );
  return r.rows.map((d) => {
    const imputations = [];
    for (const f of filed.rows) {
      for (const i of (f.calcul_json && f.calcul_json.imputations) || []) {
        if (i.deficit_id === d.id) imputations.push({ annee: f.annee, montant: num(i.montant) });
      }
    }
    const impute = imputations.reduce((t, i) => t + i.montant, 0);
    return {
      id: d.id,
      annee_origine: d.annee_origine,
      type: d.type,
      montant_initial: num(d.montant_initial),
      source: d.source,
      note: d.note,
      imputations,
      impute,
      reste: Math.max(0, num(d.montant_initial) - impute),
    };
  });
}

async function ajouterDeficit(tenantId, corps) {
  const c = corps || {};
  const annee = validerAnnee(c.annee_origine);
  if (!["ORDINAIRE", "AMORTISSEMENT_DIFFERE"].includes(c.type)) throw new FiscaliteError("FISCALITE_CODE_INVALIDE");
  const m = Number(c.montant_initial);
  if (!Number.isFinite(m) || m < 0) throw new FiscaliteError("FISCALITE_MONTANT_INVALIDE");
  await db.query(
    `INSERT INTO fiscalite_is_deficit (id, tenant_id, annee_origine, type, montant_initial, source, note)
     VALUES ($1,$2,$3,$4,$5,'MANUEL',$6)
     ON CONFLICT (tenant_id, annee_origine, type) DO UPDATE SET montant_initial = EXCLUDED.montant_initial, source = 'MANUEL', note = EXCLUDED.note`,
    [uuidv4(), tenantId, annee, c.type, arrondi(m), String(c.note || "").trim().slice(0, 300) || null]
  );
}

async function supprimerDeficit(tenantId, id) {
  const d = (await listerDeficits(tenantId)).find((x) => x.id === id);
  if (!d) throw new FiscaliteError("FISCALITE_DEFICIT_INTROUVABLE", 404);
  if (d.source === "DECLARATION") throw new FiscaliteError("FISCALITE_DEFICIT_ISSU_DECLARATION", 409);
  if (d.imputations.length > 0) throw new FiscaliteError("FISCALITE_DEFICIT_DEJA_IMPUTE", 409);
  await db.query(`DELETE FROM fiscalite_is_deficit WHERE tenant_id = $1 AND id = $2`, [tenantId, id]);
}

async function listerPaiements(tenantId, annee) {
  const r = await db.query(
    `SELECT id, annee_exercice, nature, montant, date_paiement, reference, note FROM fiscalite_is_paiement
     WHERE tenant_id = $1 AND annee_exercice = $2 ORDER BY date_paiement, date_creation`,
    [tenantId, annee]
  );
  return r.rows.map((p) => ({ ...p, montant: num(p.montant), date_paiement: dateIso(p.date_paiement) }));
}

async function ajouterPaiement(tenantId, userId, annee, corps) {
  const c = corps || {};
  validerAnnee(annee);
  if (!["ACOMPTE_1", "ACOMPTE_2", "SOLDE", "AUTRE"].includes(c.nature)) throw new FiscaliteError("FISCALITE_CODE_INVALIDE");
  const m = Number(c.montant);
  if (!Number.isFinite(m) || m <= 0) throw new FiscaliteError("FISCALITE_MONTANT_INVALIDE");
  if (typeof c.date_paiement !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(c.date_paiement)) throw new FiscaliteError("FISCALITE_DATE_INVALIDE");
  await db.query(
    `INSERT INTO fiscalite_is_paiement (id, tenant_id, annee_exercice, nature, montant, date_paiement, reference, note, cree_par)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [uuidv4(), tenantId, annee, c.nature, arrondi(m), c.date_paiement, String(c.reference || "").trim().slice(0, 100) || null, String(c.note || "").trim().slice(0, 300) || null, userId]
  );
}

async function supprimerPaiement(tenantId, id) {
  const r = await db.query(`DELETE FROM fiscalite_is_paiement WHERE tenant_id = $1 AND id = $2 RETURNING id`, [tenantId, id]);
  if (r.rows.length === 0) throw new FiscaliteError("FISCALITE_PAIEMENT_INTROUVABLE", 404);
}

// ----------------------------------------------------------------------------
// Calcul
// ----------------------------------------------------------------------------

const floorMille = (v) => Math.floor(Math.max(0, v) / 1000) * 1000;
const floorCentaine = (v) => Math.floor(Math.max(0, v) / 100) * 100;

async function calculer(tenantId, annee, saisiesBrutes) {
  validerAnnee(annee);
  const dossier = await getDossier(tenantId, annee);
  const saisies = nettoyerSaisies(saisiesBrutes === undefined ? (dossier && dossier.saisies) || {} : saisiesBrutes);
  const parametres = nettoyerParametres(saisies.parametres);
  const avertissements = [];
  const avert = (code, details = {}) => avertissements.push({ code, ...details });

  // --- Exercice et balance (comptabilite de la plateforme, fichiers importes ou saisie) -----------------
  const data = await donnees.charger(tenantId, annee, { source: saisies.utiliser_saisie ? "MANUEL" : saisies.source_donnees, exerciceId: dossier && dossier.exercice_id });
  const source = data.source;
  const infoExercice = data.exercice;
  const comptes = data.comptes;
  const nbInstance = data.nb_instance;
  if (infoExercice) {
    if (infoExercice.duree_mois !== 12) avert("EXERCICE_DUREE_ATYPIQUE", { mois: infoExercice.duree_mois });
    if (source === "COMPTABILITE" && infoExercice.statut !== "CLOTURE") avert("EXERCICE_NON_CLOTURE");
  } else {
    avert("EXERCICE_COMPTABLE_ABSENT");
  }
  for (const a of data.avertissements) avert(a.code, a);
  if (nbInstance > 0) avert("ECRITURES_EN_INSTANCE", { nombre: nbInstance });

  // Comptes de la fiscalite parametres par l'entreprise (plan comptable adopte) ; defaut : catalogue de fiscaliteComptes.js.
  const cpt = await comptesSvc.getComptes(tenantId);
  const CLE_REGLE = { IS_COMPTABILISE: "IS_IMPOT", AMENDES_PENALITES: "IS_AMENDES", DONS_EXCEDENT: "IS_DONS", PROVISIONS_A_VERIFIER: "IS_PROVISIONS", REPRISES_PROVISIONS_TAXEES: "IS_REPRISES" };
  const comptesRegle = (regle) => cpt[CLE_REGLE[regle.code]] || regle.comptes;
  const debitNet = (prefixes) => Math.max(0, sommeNet(comptes, prefixes));
  const creditNet = (prefixes) => Math.max(0, -sommeNet(comptes, prefixes));

  let ca;
  let resultatComptable;
  let amortissements;
  let rao;
  let provisions;
  if (source !== "MANUEL") {
    ca = arrondi(creditNet(["70"]));
    resultatComptable = arrondi(-sommeNet(comptes, ["6", "7", "8"]));
    amortissements = arrondi(debitNet(["68"]));
    rao = arrondi(-sommeNet(comptes, ["6", "7"]));
    provisions = arrondi(debitNet(["69"]));
    if (source === "IMPORT") avert("SOURCE_IMPORT");
  } else {
    ca = num(saisies.ca_manuel);
    resultatComptable = num(saisies.resultat_comptable_manuel);
    amortissements = num(saisies.amortissements_manuel);
    rao = resultatComptable;
    provisions = 0;
    avert("RESULTAT_COMPTABLE_SAISI");
  }
  if (ca === 0) avert("CA_NUL");

  // --- Retraitements --------------------------------------------------------
  const ctx = { ca, parametres };
  const lignes = [];
  for (const regle of REGLES_AUTO) {
    const comptabilise = source !== "MANUEL" ? arrondi(regle.cote === "debit" ? debitNet(comptesRegle(regle)) : creditNet(comptesRegle(regle))) : 0;
    const aj = saisies.ajustements[regle.code];
    if (comptabilise === 0 && !aj) continue;
    let retenu;
    if (aj) retenu = aj.montant;
    else if (regle.mode === "SUGGESTION") retenu = 0;
    else retenu = regle.retenu ? regle.retenu(comptabilise, ctx) : comptabilise;
    lignes.push({
      cle: regle.code,
      code: regle.code,
      sens: regle.sens,
      libelle: null,
      reference: regle.reference,
      comptes: comptesRegle(regle),
      mode: regle.mode,
      comptabilise,
      montant: retenu,
      modifie: !!aj,
      note: aj ? aj.note : null,
    });
    if (regle.code === "DONS_EXCEDENT" && comptabilise > 0) avert("DONS_A_VERIFIER", { montant: comptabilise });
    if (regle.code === "PROVISIONS_A_VERIFIER" && retenu === 0 && !aj) avert("PROVISIONS_A_VERIFIER", { montant: comptabilise });
    if (regle.code === "REPRISES_PROVISIONS_TAXEES" && retenu === 0 && !aj) avert("REPRISES_A_VERIFIER", { montant: comptabilise });
  }
  for (const r of saisies.retraitements) {
    const modele = TYPES_MANUELS[r.sens].find((x) => x.code === r.code);
    lignes.push({
      cle: r.id,
      id: r.id,
      code: r.code,
      sens: r.sens,
      libelle: r.libelle,
      reference: modele ? modele.reference : null,
      comptes: [],
      mode: "MANUEL",
      comptabilise: null,
      montant: r.montant,
      modifie: false,
      note: r.note,
    });
  }
  // --- Taxe sur les voitures particulieres (lot 5) : non deductible (art. 9-7), a reintegrer si elle est en charges -----
  {
    const veh = await db.query(`SELECT montant_du FROM fiscalite_dossier_annuel WHERE tenant_id = $1 AND type = 'VEHICULES' AND annee = $2`, [tenantId, annee]);
    const taxe = veh.rows[0] ? Number(veh.rows[0].montant_du || 0) : 0;
    if (taxe > 0 && !saisies.retraitements.some((r) => r.code === "TAXE_VOITURES_PM")) avert("TAXE_VOITURES_A_REINTEGRER", { montant: taxe });
  }
  // --- Interets de comptes courants d'associes (art. 11-2) ------------------------------------------
  const cca = await ccaSvc.calculerPourExercice({ tenantId, annee, data, saisies, rao, amortissements, provisions, taux_is: parametres.taux_is });
  for (const code of CODES_CCA) {
    const calcule = cca.retraitements.find((x) => x.code === code);
    const aj = saisies.ajustements[code];
    if (!calcule && !aj) continue;
    lignes.push({
      cle: code,
      code,
      sens: SENS_CCA[code] || "REINTEGRATION",
      libelle: null,
      reference: calcule ? calcule.detail : "Art. 11-2",
      comptes: [],
      mode: "AUTO",
      comptabilise: null,
      calcule: calcule ? calcule.montant : 0,
      montant: aj ? aj.montant : calcule.montant,
      modifie: !!aj,
      note: aj ? aj.note : null,
    });
  }
  for (const a of cca.avertissements) avert(a.code, a);
  const reintegrations = lignes.filter((l) => l.sens === "REINTEGRATION");
  const deductions = lignes.filter((l) => l.sens === "DEDUCTION");
  const totalReint = reintegrations.reduce((t, l) => t + l.montant, 0);
  const totalDed = deductions.reduce((t, l) => t + l.montant, 0);

  // --- Resultat fiscal avant deficits ----------------------------------------
  const resultatFiscalAvant = resultatComptable + totalReint - totalDed;
  const amortNonAdmis = reintegrations.filter((l) => l.code === "AMORT_NON_ADMIS").reduce((t, l) => t + l.montant, 0);
  const amortAdmis = Math.max(0, amortissements - amortNonAdmis);

  let deficitCree = { ordinaire: 0, amortissement_differe: 0 };
  const imputations = [];
  let resultatImposable = 0;
  if (resultatFiscalAvant < 0) {
    // Art. 16-3 : exercice deficitaire -> les amortissements comptabilises sont reputes differes (report illimite),
    // le reste du deficit est un deficit ordinaire (report sur 3 exercices).
    const ard = Math.min(amortAdmis, -resultatFiscalAvant);
    deficitCree = { ordinaire: -resultatFiscalAvant - ard, amortissement_differe: ard };
    avert("DEFICIT_EXERCICE", { ordinaire: deficitCree.ordinaire, amortissement_differe: deficitCree.amortissement_differe });
  } else {
    // Imputation : deficits ordinaires encore reportables (les plus anciens d'abord), puis amortissements reputes differes.
    const deficits = (await listerDeficits(tenantId)).filter((d) => d.annee_origine < annee);
    // Un dossier non depose ne consomme rien : on ne retient que les imputations des exercices deposes anterieurs a annee.
    const reste = (d) => Math.max(0, d.montant_initial - d.imputations.filter((i) => i.annee < annee).reduce((t, i) => t + i.montant, 0));
    const ordinaires = deficits.filter((d) => d.type === "ORDINAIRE" && annee - d.annee_origine <= parametres.report_deficit_exercices);
    const perimes = deficits.filter((d) => d.type === "ORDINAIRE" && annee - d.annee_origine > parametres.report_deficit_exercices && reste(d) > 0);
    if (perimes.length > 0) avert("DEFICIT_PERIME", { annee: perimes[0].annee_origine, montant: perimes.reduce((t, d) => t + reste(d), 0) });
    const differes = deficits.filter((d) => d.type === "AMORTISSEMENT_DIFFERE");
    let aImputer = resultatFiscalAvant;
    for (const d of [...ordinaires, ...differes]) {
      const dispo = reste(d);
      if (dispo <= 0) continue;
      const imput = Math.min(dispo, aImputer);
      if (imput > 0) {
        imputations.push({ deficit_id: d.id, type: d.type, annee_origine: d.annee_origine, montant: imput, reste_apres: dispo - imput });
        aImputer -= imput;
      }
      if (aImputer <= 0) break;
    }
    resultatImposable = aImputer;
  }
  const totalImputations = imputations.reduce((t, i) => t + i.montant, 0);

  // --- IS, IMF, impot du ----------------------------------------------------
  const baseIs = floorMille(resultatImposable);
  const isCalcule = arrondi((baseIs * parametres.taux_is) / 100);
  const imfBrut = arrondi((ca * parametres.imf_taux) / 100);
  const imfDu = saisies.imf_exonere ? 0 : Math.min(Math.max(imfBrut, parametres.imf_plancher), parametres.imf_plafond);
  const credits = saisies.credits_impot;
  const totalCredits = credits.reduce((t, c) => t + c.montant, 0);
  const impotNet = Math.max(isCalcule - Math.min(totalCredits, isCalcule), imfDu);
  const impotApplicable = isCalcule > imfDu ? "IS" : "IMF";
  const creditImpute = isCalcule - Math.min(totalCredits, isCalcule) >= imfDu ? Math.min(totalCredits, isCalcule) : Math.max(0, isCalcule - imfDu);
  if (imfDu > 0 && imfDu >= isCalcule) avert("IMF_APPLICABLE", { imf: imfDu, is: isCalcule });
  if (saisies.imf_exonere) avert("IMF_EXONERE_SAISI", { motif: saisies.imf_motif || "—" });
  if (totalCredits > creditImpute) avert("CREDIT_IMPOT_NON_IMPUTE", { montant: totalCredits - creditImpute });

  // --- Acomptes verses et solde -------------------------------------------------
  const paiements = await listerPaiements(tenantId, annee);
  const acomptesVerses = paiements.filter((p) => p.nature !== "SOLDE").reduce((t, p) => t + p.montant, 0);
  const soldeVerse = paiements.filter((p) => p.nature === "SOLDE").reduce((t, p) => t + p.montant, 0);
  const soldeAPayer = Math.max(0, impotNet - acomptesVerses);
  const excedent = Math.max(0, acomptesVerses - impotNet);
  if (excedent > 0) avert("ACOMPTES_SUPERIEURS_A_IMPOT", { montant: excedent });

  // --- Acomptes a verser l'annee suivante (base : impot du dernier exercice) -----
  let basePrec = saisies.is_precedent;
  let originePrec = basePrec !== null ? "SAISIE" : null;
  if (basePrec === null) {
    const prec = await getDossier(tenantId, annee - 1);
    if (prec && prec.impot_du !== null) {
      basePrec = prec.impot_du;
      originePrec = "DOSSIER";
    }
  }
  const plan = { base: null, origine: originePrec, imf_provisoire: imfDu, acompte_1: null, acompte_2: null, echeance_1: `${annee + 1}-02-15`, echeance_2: `${annee + 1}-04-30` };
  if (basePrec !== null) {
    const tiers = floorCentaine(basePrec / 3);
    plan.base = basePrec;
    plan.acompte_2 = tiers;
    plan.acompte_1 = Math.max(tiers, floorCentaine(imfDu));
  } else {
    avert("ACOMPTES_BASE_ABSENTE");
  }

  return {
    annee,
    source,
    exercice: infoExercice,
    parametres,
    statut: dossier ? dossier.statut : "BROUILLON",
    donnees: { source, sources_disponibles: data.sources_disponibles, import: data.import },
    cca,
    comptable: { rao, provisions, ca_ht: ca, resultat_comptable: resultatComptable, amortissements, impot_comptabilise: arrondi(debitNet(cpt.IS_IMPOT)), ecritures_en_instance: nbInstance },
    retraitements: { reintegrations, deductions, total_reintegrations: totalReint, total_deductions: totalDed },
    resultat_fiscal_avant_deficits: resultatFiscalAvant,
    amortissements_admis: amortAdmis,
    deficit_cree: deficitCree,
    imputations,
    total_imputations: totalImputations,
    resultat_fiscal_imposable: resultatImposable,
    base_is: baseIs,
    is_calcule: isCalcule,
    imf: { ca, taux: parametres.imf_taux, brut: imfBrut, plancher: parametres.imf_plancher, plafond: parametres.imf_plafond, du: imfDu, exonere: saisies.imf_exonere, motif: saisies.imf_motif },
    impot_applicable: impotApplicable,
    credits_impot: { lignes: credits, total: totalCredits, impute: creditImpute },
    impot_du: impotNet,
    acomptes: { verses: acomptesVerses, detail: paiements, plan },
    solde_a_payer: soldeAPayer,
    solde_verse: soldeVerse,
    reste_a_payer: Math.max(0, soldeAPayer - soldeVerse),
    excedent_a_imputer: excedent,
    saisies,
    avertissements,
  };
}

async function listerAnnees(tenantId) {
  const annees = new Set();
  const ex = await db.query(`SELECT DISTINCT EXTRACT(YEAR FROM date_fin)::int AS a FROM exercice_comptable WHERE tenant_id = $1`, [tenantId]);
  ex.rows.forEach((x) => annees.add(x.a));
  const imp = await db.query(`SELECT DISTINCT annee FROM fiscalite_import_jeu WHERE tenant_id = $1 AND actif AND role = 'EXERCICE'`, [tenantId]);
  imp.rows.forEach((x) => annees.add(x.annee));
  const dos = await db.query(`SELECT annee FROM fiscalite_is_dossier WHERE tenant_id = $1`, [tenantId]);
  dos.rows.forEach((x) => annees.add(x.annee));
  const courante = new Date().getFullYear();
  annees.add(courante - 1);
  const liste = [];
  for (const a of [...annees].sort((x, y) => y - x)) {
    const d = await getDossier(tenantId, a);
    liste.push({
      annee: a,
      statut: d ? d.statut : "A_PREPARER",
      impot_du: d ? d.impot_du : null,
      solde_a_payer: d ? d.solde_a_payer : null,
      date_depot: d ? d.date_depot : null,
      date_limite_declaration: `${a + 1}-04-30`,
      date_limite_solde: `${a + 1}-06-15`,
    });
  }
  return liste;
}

// ----------------------------------------------------------------------------
// Preparation, depot, paiement
// ----------------------------------------------------------------------------

/** Dossier ouvert pour les saisies : enregistre les saisies sans figer de calcul (brouillon). */
async function enregistrerSaisies(tenantId, annee, saisiesBrutes) {
  validerAnnee(annee);
  const d = await getDossier(tenantId, annee);
  if (d && d.statut !== "BROUILLON" && d.statut !== "PREPAREE") throw new FiscaliteError("FISCALITE_DECLARATION_DEJA_DEPOSEE", 409);
  const saisies = nettoyerSaisies(saisiesBrutes);
  await db.query(
    `INSERT INTO fiscalite_is_dossier (tenant_id, annee, saisies_json) VALUES ($1,$2,$3)
     ON CONFLICT (tenant_id, annee) DO UPDATE SET saisies_json = EXCLUDED.saisies_json, date_modification = now()`,
    [tenantId, annee, JSON.stringify(saisies)]
  );
  return getDossier(tenantId, annee);
}

async function preparer(tenantId, userId, annee, saisiesBrutes) {
  validerAnnee(annee);
  const existant = await getDossier(tenantId, annee);
  if (existant && (existant.statut === "DEPOSEE" || existant.statut === "PAYEE")) throw new FiscaliteError("FISCALITE_DECLARATION_DEJA_DEPOSEE", 409);
  const calcul = await calculer(tenantId, annee, saisiesBrutes);
  await db.query(
    `INSERT INTO fiscalite_is_dossier (tenant_id, annee, exercice_id, statut, saisies_json, calcul_json, impot_du, solde_a_payer, prepare_par, date_preparation)
     VALUES ($1,$2,$3,'PREPAREE',$4,$5,$6,$7,$8, now())
     ON CONFLICT (tenant_id, annee) DO UPDATE SET
       exercice_id = EXCLUDED.exercice_id, statut = 'PREPAREE', saisies_json = EXCLUDED.saisies_json, calcul_json = EXCLUDED.calcul_json,
       impot_du = EXCLUDED.impot_du, solde_a_payer = EXCLUDED.solde_a_payer, prepare_par = EXCLUDED.prepare_par,
       date_preparation = now(), date_modification = now()`,
    [tenantId, annee, calcul.exercice ? calcul.exercice.id : null, JSON.stringify(calcul.saisies), JSON.stringify(calcul), calcul.impot_du, calcul.solde_a_payer, userId]
  );
  return getDossier(tenantId, annee);
}

async function changerStatut(tenantId, annee, corps) {
  validerAnnee(annee);
  const d = await getDossier(tenantId, annee);
  if (!d || !d.calcul) throw new FiscaliteError("FISCALITE_DECLARATION_INTROUVABLE", 404);
  const action = corps && corps.action;
  const estDate = (v) => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);
  if (action === "deposer") {
    if (d.statut !== "PREPAREE") throw new FiscaliteError("FISCALITE_ACTION_INVALIDE", 409);
    if (!estDate(corps.date_depot)) throw new FiscaliteError("FISCALITE_DATE_INVALIDE");
    await db.query(
      `UPDATE fiscalite_is_dossier SET statut = 'DEPOSEE', date_depot = $3, reference_depot = $4, date_modification = now() WHERE tenant_id = $1 AND annee = $2`,
      [tenantId, annee, corps.date_depot, String(corps.reference_depot || "").trim().slice(0, 100) || null]
    );
    // La fraction d'interets d'associes non deduite devient reportable (art. 11-2 j).
    await ccaSvc.enregistrerReportDeclaration(tenantId, annee, d.calcul.cca && d.calcul.cca.report ? d.calcul.cca.report.nouveau : 0);
    // Les deficits constates par cet exercice deviennent reportables.
    for (const [type, montant] of [["ORDINAIRE", d.calcul.deficit_cree.ordinaire], ["AMORTISSEMENT_DIFFERE", d.calcul.deficit_cree.amortissement_differe]]) {
      if (montant > 0) {
        await db.query(
          `INSERT INTO fiscalite_is_deficit (id, tenant_id, annee_origine, type, montant_initial, source)
           VALUES ($1,$2,$3,$4,$5,'DECLARATION')
           ON CONFLICT (tenant_id, annee_origine, type) DO UPDATE SET montant_initial = EXCLUDED.montant_initial, source = 'DECLARATION'`,
          [uuidv4(), tenantId, annee, type, montant]
        );
      }
    }
  } else if (action === "payer") {
    if (d.statut === "PREPAREE") throw new FiscaliteError("FISCALITE_DEPOT_AVANT_PAIEMENT", 409);
    if (!estDate(corps.date_paiement)) throw new FiscaliteError("FISCALITE_DATE_INVALIDE");
    await db.query(`UPDATE fiscalite_is_dossier SET statut = 'PAYEE', date_paiement = $3, date_modification = now() WHERE tenant_id = $1 AND annee = $2`, [tenantId, annee, corps.date_paiement]);
  } else if (action === "rouvrir") {
    // On ne rouvre pas un exercice dont les deficits ont deja ete imputes par un exercice suivant.
    const utilises = (await listerDeficits(tenantId)).filter((x) => x.annee_origine === annee && x.source === "DECLARATION" && x.imputations.length > 0);
    if (utilises.length > 0) throw new FiscaliteError("FISCALITE_DEFICIT_DEJA_IMPUTE", 409);
    const reportsUtilises = (await ccaSvc.listerReports(tenantId)).filter((x) => x.annee_origine === annee && x.source === "DECLARATION" && x.imputations.length > 0);
    if (reportsUtilises.length > 0) throw new FiscaliteError("FISCALITE_DEFICIT_DEJA_IMPUTE", 409);
    await ccaSvc.enregistrerReportDeclaration(tenantId, annee, 0);
    await db.query(`DELETE FROM fiscalite_is_deficit WHERE tenant_id = $1 AND annee_origine = $2 AND source = 'DECLARATION'`, [tenantId, annee]);
    await db.query(
      `UPDATE fiscalite_is_dossier SET statut = 'PREPAREE', date_depot = NULL, reference_depot = NULL, date_paiement = NULL, date_modification = now() WHERE tenant_id = $1 AND annee = $2`,
      [tenantId, annee]
    );
  } else {
    throw new FiscaliteError("FISCALITE_ACTION_INVALIDE");
  }
  return getDossier(tenantId, annee);
}

module.exports = {
  PARAMETRES_DEFAUT,
  TYPES_MANUELS,
  REGLES_AUTO,
  calculer,
  getDossier,
  listerAnnees,
  enregistrerSaisies,
  preparer,
  changerStatut,
  listerDeficits,
  ajouterDeficit,
  supprimerDeficit,
  listerPaiements,
  ajouterPaiement,
  supprimerPaiement,
  nettoyerSaisies,
  CODES_CCA,
};
