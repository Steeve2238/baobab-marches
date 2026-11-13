// Utilitaires partages (fiche employe et contrat) pour retrouver une convention / categorie a partir d'un texte libre.
export const norm = (s) =>
  String(s == null ? "" : s)
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();

/** Retrouve convention / categorie dans la liste a partir des textes enregistres (anciens contrats, fiche employe). */
export function retrouver(conventions, texteConv, texteCat) {
  const tc = norm(texteConv);
  const conv = tc
    ? conventions.find((c) => norm(c.libelle) === tc || norm(c.code) === tc) ||
      conventions.find((c) => norm(c.libelle).includes(tc) || tc.includes(norm(c.libelle)))
    : null;
  if (!conv) return { convention_id: "", categorie_code: "" };
  const tk = norm(texteCat);
  const cat = tk
    ? conv.categories.find((k) => norm(k.code) === tk || norm(k.libelle) === tk) || conv.categories.find((k) => norm(k.libelle).includes(tk))
    : null;
  return { convention_id: conv.id, categorie_code: cat ? cat.code : "" };
}
