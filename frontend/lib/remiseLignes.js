// Repartition de la remise globale d'un devis / d'une facture sur chacune de ses lignes (13/10/2026).
// La remise est enregistree une seule fois (pourcentage + montant, au niveau du document) ; chaque ligne
// en porte la meme part proportionnelle, calculee a l'affichage. Les arrondis sont repartis au plus fort
// reste en centimes : la somme des remises par ligne est EXACTEMENT egale au montant de remise du document.

export function remisesParLigne(lignes, montantRemise) {
  const resultat = new Map();
  const cible = Math.round((Number(montantRemise) || 0) * 100);
  const lignesChiffrees = (lignes || []).filter((l) => Number(l.montant_ht) > 0);
  const total = lignesChiffrees.reduce((s, l) => s + Math.round(Number(l.montant_ht) * 100), 0);
  if (!(cible > 0) || !(total > 0)) return resultat;
  const brut = lignesChiffrees.map((l) => (cible * Math.round(Number(l.montant_ht) * 100)) / total);
  const parts = brut.map((x) => Math.floor(x));
  let reste = cible - parts.reduce((s, p) => s + p, 0);
  const ordre = brut.map((x, i) => ({ i, f: x - Math.floor(x) })).sort((a, b) => b.f - a.f || a.i - b.i);
  for (let k = 0; reste > 0 && k < ordre.length; k++, reste--) parts[ordre[k].i] += 1;
  lignesChiffrees.forEach((l, i) => {
    const ht = Math.round(Number(l.montant_ht) * 100);
    resultat.set(l.id, { remise: parts[i] / 100, net: (ht - parts[i]) / 100 });
  });
  return resultat;
}
