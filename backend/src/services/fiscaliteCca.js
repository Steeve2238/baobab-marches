/**
 * Module Fiscalite (payant) - lot 3b : interets servis aux associes (comptes courants), CGI 2025 art. 11-2.
 *
 *   a) taux des interets <= taux des avances de l'institut d'emission (BCEAO) + 3 points ;
 *   b) deduction seulement si le capital est entierement libere ;
 *   c) personnes physiques : deduction limitee a la remuneration des sommes mises a disposition <= capital social ;
 *   d) personnes morales : n'est pas deductible la part des interets qui, SIMULTANEMENT,
 *        - remunere des sommes mises a disposition depassant 1,5 fois le capital social, et
 *        - depasse 15 % du resultat des activites ordinaires majore desdits interets, des amortissements et des provisions ;
 *   j) la fraction non deduite en application du 15 % se reporte cinq ans et se deduit les annees ou il reste de la marge.
 *
 * Le calcul (`moteur`) est une fonction pure : il recoit les montants et rend les retraitements + le detail par associe.
 * La variante « methode Excel » (le plus restrictif des deux plafonds) est calculee a cote, avec l'ecart d'IS, pour information.
 * L'alinea e) (groupe de societes) et les interets verses par des etablissements financiers ne sont pas traites : retraitement manuel.
 */
const db = require("../db");
const { v4: uuidv4 } = require("uuid");
const { FiscaliteError } = require("./fiscaliteTva");
const donnees = require("./fiscaliteDonnees");

const num = (v) => Number(v || 0);
const arrondi = (v) => Math.round(num(v));

const CCA_DEFAUT = {
  majoration_points: 3, // art. 11-2 a) : taux des avances de l'institut d'emission + 3 points
  seuil_ebitda_pct: 15, // art. 11-2 d) : 15 % du RAO majore
  coef_capital_pm: 1.5, // art. 11-2 d) : 1,5 fois le capital social
  coef_capital_pp: 1, // art. 11-2 c) : une fois le capital social
  report_annees: 5, // art. 11-2 j)
};
const COMPTES_DEFAUT = {
  capital: ["101"],
  cca: ["466", "455"],
  interets: ["6742"],
};

const NATURES = ["PERSONNE_MORALE", "PERSONNE_PHYSIQUE"];

function listeComptes(v, defaut) {
  if (!Array.isArray(v)) return defaut;
  const propres = v.map((x) => String(x || "").replace(/[^0-9]/g, "")).filter((x) => x.length >= 2 && x.length <= 10);
  return propres.length > 0 ? [...new Set(propres)] : defaut;
}

/** Valide et normalise la partie « comptes courants » des saisies du dossier d'IS. */
function nettoyerCca(brut) {
  const s = brut && typeof brut === "object" ? brut : {};
  const montant = (v, champ, positif = true) => {
    if (v === "" || v === null || v === undefined) return null;
    const n = Number(v);
    if (!Number.isFinite(n) || (positif && n < 0)) throw new FiscaliteError("FISCALITE_MONTANT_INVALIDE", 400, { champ });
    return Math.round(n * 100) / 100;
  };
  const sortie = {
    taux_bceao: montant(s.taux_bceao, "taux_bceao"),
    majoration_points: montant(s.majoration_points, "majoration_points") ?? CCA_DEFAUT.majoration_points,
    capital_social: montant(s.capital_social, "capital_social"),
    capital_libere: s.capital_libere === true || s.capital_libere === false ? s.capital_libere : null,
    base_methode: s.base_methode === "CLOTURE" ? "CLOTURE" : "MOYENNE",
    rao_manuel: montant(s.rao_manuel, "rao_manuel", false),
    provisions_manuel: montant(s.provisions_manuel, "provisions_manuel"),
    comptes_cca: listeComptes(s.comptes_cca, COMPTES_DEFAUT.cca),
    comptes_interets: listeComptes(s.comptes_interets, COMPTES_DEFAUT.interets),
    associes: [],
  };
  if (sortie.taux_bceao !== null && sortie.taux_bceao > 50) throw new FiscaliteError("FISCALITE_PARAMETRE_INVALIDE", 400, { parametre: "taux_bceao" });
  for (const a of Array.isArray(s.associes) ? s.associes : []) {
    if (!a) continue;
    const nom = String(a.nom || "").trim().slice(0, 150);
    const compte = String(a.compte || "").replace(/\s/g, "").slice(0, 20);
    if (!nom && !compte) continue;
    sortie.associes.push({
      id: typeof a.id === "string" && a.id ? a.id.slice(0, 40) : uuidv4(),
      nom: nom || compte,
      compte: compte || null,
      nature: NATURES.includes(a.nature) ? a.nature : "PERSONNE_MORALE",
      somme: montant(a.somme, "associe_somme"),
      interets: montant(a.interets, "associe_interets"),
      taux: montant(a.taux, "associe_taux"),
      exclu: !!a.exclu,
    });
  }
  return sortie;
}

// ---------------------------------------------------------------------------
// Moteur pur
// ---------------------------------------------------------------------------

/**
 * @param {object} e {
 *   capital, capital_libere, taux_bceao, majoration, rao, amortissements, provisions, taux_is,
 *   associes: [{cle, nom, nature, somme, interets, taux}], reports: [{annee_origine, reste}], annee, parametres
 * }
 */
function moteur(e) {
  const p = { ...CCA_DEFAUT, ...(e.parametres || {}) };
  const K = num(e.capital);
  const plafondTaux = e.taux_bceao === null || e.taux_bceao === undefined ? null : num(e.taux_bceao) + num(e.majoration ?? p.majoration_points);
  const associes = e.associes.map((a) => ({
    ...a,
    interets: num(a.interets),
    somme: num(a.somme),
    taux_effectif: a.taux !== null && a.taux !== undefined && num(a.taux) > 0 ? num(a.taux) : num(a.somme) > 0 ? (num(a.interets) / num(a.somme)) * 100 : 0,
    reint_capital: 0,
    reint_taux: 0,
    reint_pp: 0,
    reint_pm: 0,
    reste_apres_a: 0,
  }));
  const avertissements = [];
  const totalInterets = associes.reduce((t, a) => t + a.interets, 0);

  // b) capital non libere : aucune deduction
  const capitalLibere = e.capital_libere !== false;
  for (const a of associes) {
    if (!capitalLibere) a.reint_capital = a.interets;
  }
  // a) taux
  let statutTaux = "A_RENSEIGNER";
  if (plafondTaux !== null) {
    statutTaux = "OK";
    for (const a of associes) {
      const apres = a.interets - a.reint_capital;
      if (apres > 0 && a.taux_effectif > plafondTaux) {
        a.reint_taux = arrondi((apres * (a.taux_effectif - plafondTaux)) / a.taux_effectif);
        statutTaux = "DEPASSE";
      }
    }
  }
  for (const a of associes) a.reste_apres_a = Math.max(0, a.interets - a.reint_capital - a.reint_taux);

  // c) personnes physiques
  const pp = associes.filter((a) => a.nature === "PERSONNE_PHYSIQUE");
  const sommePP = pp.reduce((t, a) => t + a.somme, 0);
  const plafondPP = K * p.coef_capital_pp;
  const excesPP = Math.max(0, sommePP - plafondPP);
  if (sommePP > 0 && excesPP > 0) {
    for (const a of pp) a.reint_pp = arrondi((a.reste_apres_a * excesPP) / sommePP);
  }

  // d) personnes morales
  const pm = associes.filter((a) => a.nature === "PERSONNE_MORALE");
  const sommePM = pm.reduce((t, a) => t + a.somme, 0);
  const interetsPMComptabilises = pm.reduce((t, a) => t + a.interets, 0);
  const restePM = pm.reduce((t, a) => t + a.reste_apres_a, 0);
  const plafondStructurel = K * p.coef_capital_pm;
  const excesPM = Math.max(0, sommePM - plafondStructurel);
  const ratioStructurel = sommePM > 0 ? Math.min(1, plafondStructurel / sommePM) : 1;
  const baseEbitda = num(e.rao) + interetsPMComptabilises + num(e.amortissements) + num(e.provisions);
  const plafond15 = Math.max(0, (baseEbitda * p.seuil_ebitda_pct) / 100);
  // Part des interets qui remunere l'exces de sommes (condition 1) et part qui depasse 15 % (condition 2)
  const partExces = sommePM > 0 ? (restePM * excesPM) / sommePM : 0;
  const partAuDela15 = Math.max(0, restePM - plafond15);
  const reintD = arrondi(Math.min(partExces, partAuDela15));
  if (restePM > 0 && reintD > 0) {
    for (const a of pm) a.reint_pm = arrondi((reintD * a.reste_apres_a) / restePM);
    // ajuste l'arrondi sur le plus gros associe
    const ecart = reintD - pm.reduce((t, a) => t + a.reint_pm, 0);
    if (ecart !== 0) {
      const plusGros = [...pm].sort((x, y) => y.reste_apres_a - x.reste_apres_a)[0];
      plusGros.reint_pm += ecart;
    }
  }

  // j) report : deduction des fractions non deduites des 5 exercices precedents
  const margeDispo = Math.max(0, plafond15 - restePM);
  let aDeduire = margeDispo;
  const imputationsReport = [];
  const reports = (e.reports || []).filter((r) => num(r.reste) > 0).sort((x, y) => x.annee_origine - y.annee_origine);
  let reportPerime = 0;
  for (const r of reports) {
    const age = e.annee - r.annee_origine;
    if (age > p.report_annees || age < 1) {
      if (age > p.report_annees) reportPerime += num(r.reste);
      continue;
    }
    if (aDeduire <= 0) break;
    const m = Math.min(num(r.reste), aDeduire);
    if (m > 0) {
      imputationsReport.push({ annee_origine: r.annee_origine, montant: arrondi(m) });
      aDeduire -= m;
    }
  }
  const deductionReport = imputationsReport.reduce((t, x) => t + x.montant, 0);

  const totalCapital = associes.reduce((t, a) => t + a.reint_capital, 0);
  const totalTaux = associes.reduce((t, a) => t + a.reint_taux, 0);
  const totalPP = associes.reduce((t, a) => t + a.reint_pp, 0);
  const totalPM = associes.reduce((t, a) => t + a.reint_pm, 0);

  // Variante « methode Excel » : on retient le plus restrictif des deux plafonds (au lieu de les cumuler).
  const admisStructurel = restePM * ratioStructurel;
  const admisExcel = Math.min(admisStructurel, plafond15);
  const reintExcelPM = arrondi(Math.max(0, restePM - admisExcel));
  const variante = {
    reintegration_pm: reintExcelPM,
    total: totalCapital + totalTaux + totalPP + reintExcelPM,
    ecart_reintegration: totalCapital + totalTaux + totalPP + reintExcelPM - (totalCapital + totalTaux + totalPP + totalPM),
    ecart_is: arrondi(((totalCapital + totalTaux + totalPP + reintExcelPM - (totalCapital + totalTaux + totalPP + totalPM)) * num(e.taux_is)) / 100),
  };

  if (K <= 0 && associes.length > 0) avertissements.push({ code: "CCA_CAPITAL_ABSENT" });
  if (!capitalLibere) avertissements.push({ code: "CCA_CAPITAL_NON_LIBERE", montant: arrondi(e.capital_non_libere || 0) });
  if (plafondTaux === null && totalInterets > 0) avertissements.push({ code: "CCA_TAUX_BCEAO_A_RENSEIGNER" });
  if (statutTaux === "DEPASSE") avertissements.push({ code: "CCA_TAUX_DEPASSE", plafond: Math.round(plafondTaux * 100) / 100 });
  if (reportPerime > 0) avertissements.push({ code: "CCA_REPORT_PERIME", montant: arrondi(reportPerime) });
  if (deductionReport > 0) avertissements.push({ code: "CCA_REPORT_DEDUIT", montant: deductionReport });
  if (reintD > 0) avertissements.push({ code: "CCA_REINTEGRATION_PM", montant: reintD });

  const retraitements = [];
  const ajouter = (code, sens, montant, detail) => {
    if (montant > 0) retraitements.push({ code, sens, montant: arrondi(montant), detail });
  };
  ajouter("CCA_CAPITAL_NON_LIBERE", "REINTEGRATION", totalCapital, "Art. 11-2 b)");
  ajouter("CCA_TAUX_EXCEDENTAIRE", "REINTEGRATION", totalTaux, "Art. 11-2 a)");
  ajouter("CCA_PERSONNES_PHYSIQUES", "REINTEGRATION", totalPP, "Art. 11-2 c)");
  ajouter("CCA_PERSONNES_MORALES", "REINTEGRATION", totalPM, "Art. 11-2 d)");
  ajouter("CCA_REPORT_DEDUCTION", "DEDUCTION", deductionReport, "Art. 11-2 j)");

  return {
    actif: associes.length > 0,
    capital: { montant: K, libere: capitalLibere, non_libere: arrondi(e.capital_non_libere || 0) },
    taux: { bceao: e.taux_bceao ?? null, majoration: num(e.majoration ?? p.majoration_points), plafond: plafondTaux, statut: statutTaux },
    associes: associes.map((a) => ({
      cle: a.cle,
      nom: a.nom,
      compte: a.compte,
      nature: a.nature,
      somme: arrondi(a.somme),
      interets: arrondi(a.interets),
      taux_effectif: Math.round(a.taux_effectif * 100) / 100,
      reint_capital: a.reint_capital,
      reint_taux: a.reint_taux,
      reint_pp: a.reint_pp,
      reint_pm: a.reint_pm,
      reintegration: a.reint_capital + a.reint_taux + a.reint_pp + a.reint_pm,
      deductible: a.interets - (a.reint_capital + a.reint_taux + a.reint_pp + a.reint_pm),
      origine: a.origine || null,
      methode: a.methode || null,
      somme_cloture: a.somme_cloture === undefined ? null : arrondi(a.somme_cloture),
    })),
    pm: {
      somme: arrondi(sommePM),
      plafond_structurel: arrondi(plafondStructurel),
      exces: arrondi(excesPM),
      ratio_deductible: Math.round(ratioStructurel * 10000) / 10000,
      interets_comptabilises: arrondi(interetsPMComptabilises),
      interets_apres_taux: arrondi(restePM),
      base_ebitda: arrondi(baseEbitda),
      composantes: { rao: arrondi(e.rao), interets: arrondi(interetsPMComptabilises), amortissements: arrondi(e.amortissements), provisions: arrondi(e.provisions) },
      plafond_15: arrondi(plafond15),
      part_sur_exces: arrondi(partExces),
      part_au_dela_15: arrondi(partAuDela15),
      reintegration: reintD,
    },
    pp: { somme: arrondi(sommePP), plafond: arrondi(plafondPP), exces: arrondi(excesPP) },
    report: { marge_disponible: arrondi(margeDispo), deduction: deductionReport, imputations: imputationsReport, nouveau: reintD },
    totaux: { interets: arrondi(totalInterets), reintegration: totalCapital + totalTaux + totalPP + totalPM, deductible: arrondi(totalInterets) - (totalCapital + totalTaux + totalPP + totalPM), deduction_report: deductionReport },
    variante_excel: variante,
    retraitements,
    avertissements,
  };
}

// ---------------------------------------------------------------------------
// Reports (art. 11-2 j)
// ---------------------------------------------------------------------------

async function listerReports(tenantId) {
  const r = await db.query(`SELECT id, annee_origine, montant_initial, source, note FROM fiscalite_interets_report WHERE tenant_id = $1 ORDER BY annee_origine`, [tenantId]);
  const dos = await db.query(`SELECT annee, calcul_json FROM fiscalite_is_dossier WHERE tenant_id = $1 AND statut IN ('DEPOSEE','PAYEE') ORDER BY annee`, [tenantId]);
  const utilisations = [];
  for (const d of dos.rows) {
    const imp = d.calcul_json && d.calcul_json.cca && d.calcul_json.cca.report && d.calcul_json.cca.report.imputations;
    for (const i of imp || []) utilisations.push({ annee: d.annee, annee_origine: i.annee_origine, montant: num(i.montant) });
  }
  return r.rows.map((x) => {
    const imputations = utilisations.filter((u) => u.annee_origine === x.annee_origine);
    return {
      id: x.id,
      annee_origine: x.annee_origine,
      montant_initial: num(x.montant_initial),
      source: x.source,
      note: x.note,
      imputations,
      impute: imputations.reduce((t, i) => t + i.montant, 0),
      reste: Math.max(0, num(x.montant_initial) - imputations.reduce((t, i) => t + i.montant, 0)),
    };
  });
}

async function ajouterReport(tenantId, { annee_origine, montant_initial, note }) {
  const a = Number(annee_origine);
  const m = Number(montant_initial);
  if (!Number.isInteger(a) || a < 2000 || a > 2100 || !Number.isFinite(m) || m <= 0) throw new FiscaliteError("FISCALITE_MONTANT_INVALIDE");
  await db.query(
    `INSERT INTO fiscalite_interets_report (id, tenant_id, annee_origine, montant_initial, source, note) VALUES ($1,$2,$3,$4,'MANUEL',$5)
     ON CONFLICT (tenant_id, annee_origine) DO UPDATE SET montant_initial = EXCLUDED.montant_initial, note = EXCLUDED.note
     WHERE fiscalite_interets_report.source = 'MANUEL'`,
    [uuidv4(), tenantId, a, Math.round(m), String(note || "").trim().slice(0, 300) || null]
  );
}

async function supprimerReport(tenantId, id) {
  const r = await db.query(`SELECT annee_origine, source FROM fiscalite_interets_report WHERE tenant_id = $1 AND id = $2`, [tenantId, id]);
  if (r.rowCount === 0) throw new FiscaliteError("FISCALITE_REPORT_INTROUVABLE", 404);
  if (r.rows[0].source === "DECLARATION") throw new FiscaliteError("FISCALITE_DEFICIT_ISSU_DECLARATION");
  const liste = await listerReports(tenantId);
  const rep = liste.find((x) => x.id === id);
  if (rep && rep.impute > 0) throw new FiscaliteError("FISCALITE_DEFICIT_DEJA_IMPUTE");
  await db.query(`DELETE FROM fiscalite_interets_report WHERE tenant_id = $1 AND id = $2`, [tenantId, id]);
}

/** Enregistre (ou retire) le report issu d'une declaration d'IS deposee. */
async function enregistrerReportDeclaration(tenantId, annee, montant) {
  await db.query(`DELETE FROM fiscalite_interets_report WHERE tenant_id = $1 AND annee_origine = $2 AND source = 'DECLARATION'`, [tenantId, annee]);
  if (montant > 0) {
    await db.query(
      `INSERT INTO fiscalite_interets_report (id, tenant_id, annee_origine, montant_initial, source) VALUES ($1,$2,$3,$4,'DECLARATION')
       ON CONFLICT (tenant_id, annee_origine) DO NOTHING`,
      [uuidv4(), tenantId, annee, Math.round(montant)]
    );
  }
}

// ---------------------------------------------------------------------------
// Preparation des entrees depuis la balance / le grand livre / les saisies
// ---------------------------------------------------------------------------

/**
 * Calcul complet pour un exercice : recupere automatiquement ce que la balance (comptabilite ou import) sait, complete par les saisies.
 * @param {object} arg { tenantId, annee, data, saisies (saisies du dossier, deja nettoyees), rao, amortissements, provisions, taux_is }
 */
async function calculerPourExercice({ tenantId, annee, data, saisies, rao, amortissements, provisions, taux_is }) {
  const cca = saisies.cca || nettoyerCca({});
  const comptes = data.comptes || [];
  const sommeNet = (prefixes) => donnees.sommeNet(comptes, prefixes);
  const creditNet = (prefixes) => Math.max(0, -sommeNet(prefixes));
  const debitNet = (prefixes) => Math.max(0, sommeNet(prefixes));

  // Capital : compte 101x ; non libere = capital non appele (1011 / 109) + appele non verse (1012)
  const capitalAuto = arrondi(creditNet(["101"]));
  const nonLibereAuto = arrondi(Math.max(debitNet(["109"]), creditNet(["1011"])) + creditNet(["1012"]));
  const capital = cca.capital_social !== null ? cca.capital_social : capitalAuto;
  const capitalLibere = cca.capital_libere !== null ? cca.capital_libere : nonLibereAuto === 0;

  // Associes : lignes deduites des comptes courants + saisies de l'utilisateur
  const auto = data.source === "MANUEL" ? [] : await donnees.soldesCompte(data, cca.comptes_cca);
  const methodeCloture = cca.base_methode === "CLOTURE";
  const interetsComptabilises = arrondi(debitNet(cca.comptes_interets));
  const lignes = [];
  const utilises = new Set();
  for (const s of cca.associes) {
    const correspondants = s.compte ? auto.filter((x) => x.compte === s.compte || x.compte.startsWith(s.compte) || (s.compte.length > 3 && s.compte.startsWith(x.compte) && x.tiers && x.tiers.toLowerCase() === s.nom.toLowerCase())) : [];
    const a = correspondants[0];
    if (a) utilises.add(a.cle);
    lignes.push({
      cle: s.id,
      nom: s.nom,
      compte: s.compte,
      nature: s.nature,
      somme: s.somme !== null ? s.somme : a ? (methodeCloture ? a.cloture : a.moyen) : 0,
      somme_cloture: a ? a.cloture : s.somme,
      interets: s.interets,
      taux: s.taux,
      exclu: s.exclu,
      origine: s.somme !== null || s.interets !== null ? "SAISIE" : a ? "COMPTES" : "SAISIE",
      methode: s.somme !== null ? "SAISIE" : a ? (methodeCloture ? "CLOTURE" : a.methode) : "SAISIE",
    });
  }
  for (const a of auto) {
    if (utilises.has(a.cle) || a.cloture <= 0) continue; // seuls les soldes crediteurs sont des sommes mises a disposition
    lignes.push({
      cle: a.cle,
      nom: a.libelle || a.compte,
      compte: a.compte,
      nature: "PERSONNE_MORALE",
      somme: methodeCloture ? a.cloture : a.moyen,
      somme_cloture: a.cloture,
      interets: null,
      taux: null,
      exclu: false,
      origine: "COMPTES",
      methode: methodeCloture ? "CLOTURE" : a.methode,
      nature_a_confirmer: true,
    });
  }
  const actives = lignes.filter((l) => !l.exclu);
  // Interets : saisis par associe, sinon repartis au prorata des sommes sur ce qui n'est pas saisi
  const interetsSaisis = actives.reduce((t, l) => t + (l.interets !== null ? l.interets : 0), 0);
  const sansInterets = actives.filter((l) => l.interets === null);
  const baseRepartition = sansInterets.reduce((t, l) => t + l.somme, 0);
  const resteARepartir = Math.max(0, interetsComptabilises - interetsSaisis);
  for (const l of sansInterets) {
    l.interets = baseRepartition > 0 ? arrondi((resteARepartir * l.somme) / baseRepartition) : 0;
    l.interets_deduits = true;
  }
  const raoUtilise = cca.rao_manuel !== null ? cca.rao_manuel : rao;
  const provisionsUtilisees = cca.provisions_manuel !== null ? cca.provisions_manuel : provisions;
  const reports = await listerReports(tenantId);
  const res = moteur({
    capital,
    capital_libere: capitalLibere,
    capital_non_libere: nonLibereAuto,
    taux_bceao: cca.taux_bceao,
    majoration: cca.majoration_points,
    rao: raoUtilise,
    amortissements,
    provisions: provisionsUtilisees,
    taux_is,
    associes: actives,
    reports: reports.filter((r) => r.annee_origine < annee),
    annee,
  });
  res.entrees = {
    capital_auto: capitalAuto,
    capital_non_libere_auto: nonLibereAuto,
    interets_comptabilises: interetsComptabilises,
    rao: raoUtilise,
    amortissements,
    provisions: provisionsUtilisees,
    comptes_cca: cca.comptes_cca,
    comptes_interets: cca.comptes_interets,
    base_methode: cca.base_methode,
    source: data.source,
  };
  if (res.actif) {
    const nbAConfirmer = lignes.filter((l) => l.nature_a_confirmer).length;
    if (nbAConfirmer > 0) res.avertissements.push({ code: "CCA_NATURE_A_CONFIRMER", nombre: nbAConfirmer });
    if (!methodeCloture && actives.some((l) => l.methode === "CLOTURE")) res.avertissements.push({ code: "CCA_SOLDE_CLOTURE_RETENU" });
    if (res.totaux.interets === 0) res.avertissements.push({ code: "CCA_INTERETS_ABSENTS" });
    res.avertissements.push({ code: "CCA_GROUPE_NON_TRAITE" });
  }
  res.reports = reports;
  // Dernier taux BCEAO saisi sur un autre exercice (aide a la saisie)
  if (cca.taux_bceao === null) {
    const r = await db.query(
      `SELECT annee, saisies_json->'cca'->>'taux_bceao' AS t FROM fiscalite_is_dossier WHERE tenant_id = $1 AND saisies_json->'cca'->>'taux_bceao' IS NOT NULL ORDER BY annee DESC LIMIT 1`,
      [tenantId]
    );
    if (r.rows[0]) res.taux.suggere = { annee: r.rows[0].annee, taux: Number(r.rows[0].t) };
  }
  return res;
}

module.exports = { moteur, nettoyerCca, calculerPourExercice, listerReports, ajouterReport, supprimerReport, enregistrerReportDeclaration, CCA_DEFAUT, COMPTES_DEFAUT };
