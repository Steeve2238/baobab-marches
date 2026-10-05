const { calculerOffre } = require("./calculPrixEngine");

// Couts d'approche d'une reception (Lot 2, 05/10/2026).
// Fonctions pures (aucun acces base) : la repartition est recalculee a chaque
// lecture, jamais stockee. Miroir cote frontend : lib/receptionCouts.js
// (apercu en direct) - toute modification ici doit etre reportee la-bas.

const TYPES_COUT = ["FRET", "ASSURANCE", "DOUANE", "TRANSIT", "TRANSPORT_LOCAL", "AUTRE"];
const REPARTITIONS = ["VALEUR", "QUANTITE", "POIDS"];

// Couts deja compris dans le prix facture par le fournisseur selon l'incoterm
// (a ne pas ajouter une seconde fois). Source : regles Incoterms 2020.
const INCOTERM_INCLUS = {
  EXW: [],
  FCA: [],
  FAS: [],
  FOB: [],
  CFR: ["FRET"],
  CPT: ["FRET"],
  CIF: ["FRET", "ASSURANCE"],
  CIP: ["FRET", "ASSURANCE"],
  DAP: ["FRET", "ASSURANCE", "TRANSPORT_LOCAL"],
  DPU: ["FRET", "ASSURANCE", "TRANSPORT_LOCAL"],
  DDP: ["FRET", "ASSURANCE", "TRANSPORT_LOCAL", "DOUANE", "TRANSIT"],
};

const arr2 = (n) => Math.round(n * 100) / 100;

function montantCoutXof(cout, cours) {
  const m = Number(cout.montant) || 0;
  return arr2(cout.en_devise_facture ? m * cours : m);
}

// Repartit `totalCentimes` (entier) au prorata de `cles` (nombres >= 0) ; la
// somme des parts est EXACTEMENT egale au total (methode du plus fort reste).
function repartirEntier(totalCentimes, cles) {
  const somme = cles.reduce((s, c) => s + c, 0);
  if (!(somme > 0)) return cles.map(() => 0);
  const brut = cles.map((c) => (totalCentimes * c) / somme);
  const parts = brut.map((x) => Math.floor(x));
  let reste = totalCentimes - parts.reduce((s, p) => s + p, 0);
  const ordre = brut
    .map((x, i) => ({ i, f: x - Math.floor(x) }))
    .sort((a, b) => b.f - a.f || a.i - b.i);
  for (let k = 0; reste > 0 && k < ordre.length; k++, reste--) parts[ordre[k].i] += 1;
  return parts;
}

/**
 * @param {Array} lignes  {quantite, prix_unitaire_devise, poids_unitaire_kg}
 * @param {Array} couts   {type_cout, libelle, montant, en_devise_facture, repartition}
 * @param {number} cours  cours de la devise de la facture (1 si XOF)
 */
function repartirCouts(lignes, couts, cours) {
  const valeurs = lignes.map((l) => arr2(Number(l.quantite) * Number(l.prix_unitaire_devise) * cours));
  const quantites = lignes.map((l) => Number(l.quantite) || 0);
  const poids = lignes.map((l) => {
    const p = Number(l.poids_unitaire_kg);
    return Number.isFinite(p) && p > 0 ? p * (Number(l.quantite) || 0) : 0;
  });
  const allocCentimes = lignes.map(() => 0);
  const avertissements = [];

  const coutsCalcules = couts.map((c) => {
    const montantXof = montantCoutXof(c, cours);
    let mode = REPARTITIONS.includes(c.repartition) ? c.repartition : "VALEUR";
    let cles = mode === "VALEUR" ? valeurs : mode === "QUANTITE" ? quantites : poids;
    if (!(cles.reduce((s, x) => s + x, 0) > 0) && montantXof > 0) {
      // Cle de repartition inexploitable (aucune valeur / aucun poids) : repli sur la quantite.
      if (mode === "POIDS") avertissements.push({ code: "POIDS_MANQUANT", type_cout: c.type_cout, libelle: c.libelle || "" });
      mode = "QUANTITE";
      cles = quantites;
    } else if (mode === "POIDS" && poids.some((p) => !(p > 0)) && montantXof > 0) {
      avertissements.push({ code: "POIDS_PARTIEL", type_cout: c.type_cout, libelle: c.libelle || "" });
    }
    const parts = repartirEntier(Math.round(montantXof * 100), cles);
    parts.forEach((p, i) => (allocCentimes[i] += p));
    return { ...c, montant: Number(c.montant) || 0, montant_xof: montantXof, repartition_effective: mode };
  });

  const lignesCalculees = lignes.map((l, i) => {
    const alloc = allocCentimes[i] / 100;
    const q = Number(l.quantite) || 0;
    return {
      valeur_achat_xof: valeurs[i],
      cout_approche_xof: alloc,
      cout_revient_total_xof: arr2(valeurs[i] + alloc),
      cout_revient_unitaire_xof: q > 0 ? arr2((valeurs[i] + alloc) / q) : 0,
    };
  });

  return {
    lignes: lignesCalculees,
    couts: coutsCalcules,
    total_couts_approche_xof: arr2(coutsCalcules.reduce((s, c) => s + c.montant_xof, 0)),
    total_achat_xof: arr2(valeurs.reduce((s, v) => s + v, 0)),
    avertissements,
  };
}

// Couts saisis qui sont normalement DEJA dans le prix du fournisseur (risque de
// double comptage) : renvoye comme simple avertissement, jamais bloquant.
function avertissementsIncoterm(incoterm, couts) {
  const inclus = INCOTERM_INCLUS[String(incoterm || "").toUpperCase()] || [];
  const vus = new Set();
  const res = [];
  for (const c of couts) {
    if (inclus.includes(c.type_cout) && !vus.has(c.type_cout) && (Number(c.montant) || 0) > 0) {
      vus.add(c.type_cout);
      res.push({ code: "INCOTERM_DEJA_INCLUS", type_cout: c.type_cout, incoterm: String(incoterm).toUpperCase() });
    }
  }
  return res;
}

/**
 * Estimation de l'assurance et des droits et taxes de douane avec les
 * parametres du tenant (le meme moteur que le dossier de calcul).
 * - fret/assurance deja compris dans le prix (CFR, CIF, DAP, DDP...) : non
 *   ajoutes a la valeur en douane (ils sont dans le prix d'achat).
 */
function estimerAssuranceEtDouane({ totalAchatXof, fretXof, incoterm }, parametres) {
  const inclus = INCOTERM_INCLUS[String(incoterm || "").toUpperCase()] || [];
  const fretInclus = inclus.includes("FRET");
  const assuranceIncluse = inclus.includes("ASSURANCE");
  const offre = {
    prix_unitaire_devise: Number(totalAchatXof) || 0,
    cours_devise: 1,
    quantite: 1,
    fret_alloue_xof: fretInclus ? 0 : Number(fretXof) || 0,
    frais_transit_xof: 0,
    marge_cible_pct: 0,
  };
  const p = assuranceIncluse ? { ...parametres, tauxAssuranceFret: 0 } : parametres;
  const r = calculerOffre(offre, p);
  return {
    assurance_xof: assuranceIncluse ? 0 : r.assurance,
    droits_taxes_xof: r.totalDroitsTaxesDouane,
    valeur_en_douane_xof: r.valeurEnDouane,
    detail: {
      droit_douane: r.droitDouane,
      redevance_statistique: r.redevanceStatistique,
      pcs: r.pcs,
      pcc_cosec: r.pccCosec,
      tva_import: r.tvaImport,
    },
    inclus: { fret: fretInclus, assurance: assuranceIncluse },
  };
}

module.exports = {
  TYPES_COUT,
  REPARTITIONS,
  INCOTERM_INCLUS,
  repartirCouts,
  repartirEntier,
  avertissementsIncoterm,
  estimerAssuranceEtDouane,
  montantCoutXof,
};
