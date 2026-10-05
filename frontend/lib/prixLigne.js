// Prix unitaire de ligne de devis : nombre OU mention texte ("NC", "Non
// chiffré", "En attente d'informations"...) - chantier du 04/10/2026.
// Les calculs d'affichage ici ne font que PREVISUALISER : le serveur recalcule
// toujours les totaux (voir calculerLignesEtTotaux dans routes/ventes.js).

export const MENTIONS_PRIX_SUGGEREES = ["NC", "Non chiffré", "En attente d'informations"];

// Analyse la saisie d'un prix. Renvoie { vide } | { chiffre, valeur } | { mention }.
export function analyserSaisiePrix(saisie) {
  if (saisie === undefined || saisie === null) return { vide: true };
  if (typeof saisie === "number") return Number.isFinite(saisie) ? { chiffre: true, valeur: saisie } : { vide: true };
  const texte = String(saisie).trim();
  if (texte === "") return { vide: true };
  const compact = texte.replace(/[\s  ]/g, "").replace(",", ".");
  if (/^-?\d+(\.\d+)?$/.test(compact)) return { chiffre: true, valeur: Number(compact) };
  return { mention: texte };
}

// Ligne en cours d'edition (champ prix_unitaire_ht = saisie brute).
export function ligneSaisieNonChiffree(ligne) {
  const a = analyserSaisiePrix(ligne.prix_unitaire_ht);
  return !a.chiffre;
}

export function montantLigneSaisie(ligne) {
  const a = analyserSaisiePrix(ligne.prix_unitaire_ht);
  if (!a.chiffre) return null;
  return Math.round((Number(ligne.quantite) || 0) * a.valeur * 100) / 100;
}

// Ligne telle que renvoyee par l'API (flag non_chiffre + mention_prix).
export function ligneApiNonChiffree(ligne) {
  return ligne && ligne.non_chiffre === true;
}

export function mentionLigneApi(ligne) {
  return (ligne && ligne.mention_prix) || "NC";
}

// Totaux previsualises a partir de lignes en cours de saisie.
export function totauxPrevisualises(lignes, tauxTva, pourcentageRemise) {
  let totalHt = 0;
  let nbNonChiffrees = 0;
  for (const l of lignes) {
    const m = montantLigneSaisie(l);
    if (m === null) nbNonChiffrees += 1;
    else totalHt += m;
  }
  totalHt = Math.round(totalHt * 100) / 100;
  const remisePct = Math.min(100, Math.max(0, Number(pourcentageRemise) || 0));
  const montantRemise = Math.round(totalHt * (remisePct / 100) * 100) / 100;
  const htNet = Math.round((totalHt - montantRemise) * 100) / 100;
  const tva = Math.round(htNet * ((Number(tauxTva) || 0) / 100) * 100) / 100;
  return { totalHt, montantRemise, htNet, tva, totalTtc: Math.round((htNet + tva) * 100) / 100, nbNonChiffrees };
}

// --- Catalogue produits (05/10/2026) ---------------------------------------
// Prix de vente unitaire = cout de revient x (1 + marge), arrondi au multiple
// de 100 superieur (meme regle que le serveur, services/produitsCatalogue.js).
// marge = fraction (0.25 = 25 %).
export function prixVenteDepuisCout(cout, marge) {
  const c = Number(cout) || 0;
  const m = Number(marge) || 0;
  if (c <= 0) return 0;
  return Math.ceil(Math.round(c * (1 + m) * 100) / 100 / 100) * 100;
}

// Champs a appliquer a une ligne de devis quand on choisit un produit.
export function champsLigneDepuisProduit(produit) {
  return {
    designation: produit.designation,
    unite: produit.unite || "U",
    prix_unitaire_ht: String(prixVenteDepuisCout(produit.cout_revient_unitaire_xof, produit.marge_pct) || ""),
    produit_id: produit.id,
    cout_revient_unitaire_ht: Number(produit.cout_revient_unitaire_xof),
  };
}

// Marge effective d'une ligne liee a un produit (fraction), ou null si le prix
// n'est pas un nombre ou si le cout est inconnu.
export function margeEffectiveLigne(ligne) {
  const a = analyserSaisiePrix(ligne.prix_unitaire_ht);
  const cout = Number(ligne.cout_revient_unitaire_ht);
  if (!a.chiffre || !(cout > 0)) return null;
  return a.valeur / cout - 1;
}
