// Apercu en direct des couts d'approche d'une reception. MIROIR de
// backend/src/services/receptionCouts.js (la reference reste le serveur : apres
// enregistrement, l'ecran affiche toujours les valeurs recalculees par l'API).

export const TYPES_COUT = ["FRET", "ASSURANCE", "DOUANE", "TRANSIT", "TRANSPORT_LOCAL", "AUTRE"];
export const REPARTITIONS = ["VALEUR", "QUANTITE", "POIDS"];

// Couts normalement deja compris dans le prix facture par le fournisseur.
export const INCOTERM_INCLUS = {
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

function repartirEntier(totalCentimes, cles) {
  const somme = cles.reduce((s, c) => s + c, 0);
  if (!(somme > 0)) return cles.map(() => 0);
  const brut = cles.map((c) => (totalCentimes * c) / somme);
  const parts = brut.map((x) => Math.floor(x));
  let reste = totalCentimes - parts.reduce((s, p) => s + p, 0);
  const ordre = brut.map((x, i) => ({ i, f: x - Math.floor(x) })).sort((a, b) => b.f - a.f || a.i - b.i);
  for (let k = 0; reste > 0 && k < ordre.length; k++, reste--) parts[ordre[k].i] += 1;
  return parts;
}

// lignes : {quantite, prix_unitaire_devise, poids_unitaire_kg} (nombres)
// couts  : {type_cout, montant, en_devise_facture, repartition} (nombres)
export function repartirCouts(lignes, couts, cours) {
  const valeurs = lignes.map((l) => arr2(l.quantite * l.prix_unitaire_devise * cours));
  const quantites = lignes.map((l) => l.quantite || 0);
  const poids = lignes.map((l) => (l.poids_unitaire_kg > 0 ? l.poids_unitaire_kg * (l.quantite || 0) : 0));
  const alloc = lignes.map(() => 0);
  const avertissements = [];
  let totalCouts = 0;
  for (const c of couts) {
    const montantXof = arr2(c.en_devise_facture ? c.montant * cours : c.montant);
    totalCouts += montantXof;
    let mode = REPARTITIONS.includes(c.repartition) ? c.repartition : "VALEUR";
    let cles = mode === "VALEUR" ? valeurs : mode === "QUANTITE" ? quantites : poids;
    if (!(cles.reduce((s, x) => s + x, 0) > 0) && montantXof > 0) {
      if (mode === "POIDS") avertissements.push({ code: "POIDS_MANQUANT", type_cout: c.type_cout });
      cles = quantites;
    } else if (mode === "POIDS" && poids.some((p) => !(p > 0)) && montantXof > 0) {
      avertissements.push({ code: "POIDS_PARTIEL", type_cout: c.type_cout });
    }
    repartirEntier(Math.round(montantXof * 100), cles).forEach((p, i) => (alloc[i] += p));
  }
  return {
    lignes: lignes.map((l, i) => {
      const a = alloc[i] / 100;
      return {
        cout_approche_xof: a,
        cout_revient_total_xof: arr2(valeurs[i] + a),
        cout_revient_unitaire_xof: l.quantite > 0 ? arr2((valeurs[i] + a) / l.quantite) : 0,
      };
    }),
    total_couts_approche_xof: arr2(totalCouts),
    total_achat_xof: arr2(valeurs.reduce((s, v) => s + v, 0)),
    avertissements,
  };
}

export function typesDejaInclus(incoterm, couts) {
  const inclus = INCOTERM_INCLUS[String(incoterm || "").toUpperCase()] || [];
  return [...new Set(couts.filter((c) => inclus.includes(c.type_cout) && c.montant > 0).map((c) => c.type_cout))];
}
