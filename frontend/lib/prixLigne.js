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
