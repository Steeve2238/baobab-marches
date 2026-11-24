/**
 * Recherche dans les listes (24/11/2026) : insensible aux accents et a la casse, plusieurs mots = tous doivent etre
 * presents (« dupont 0042 »), les champs sont assembles en un seul texte de recherche par ligne.
 */
export function normaliserRecherche(s) {
  return String(s == null ? "" : s)
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/** Ne garde que les lignes dont un des champs contient tous les mots saisis. getChamps(ligne) -> tableau de valeurs. */
export function filtrerRecherche(lignes, q, getChamps) {
  const mots = normaliserRecherche(q).split(" ").filter(Boolean);
  if (!mots.length || !Array.isArray(lignes)) return lignes || [];
  return lignes.filter((l) => {
    const texte = normaliserRecherche(getChamps(l).filter((v) => v !== null && v !== undefined && v !== "").join(" "));
    return mots.every((m) => texte.includes(m));
  });
}
