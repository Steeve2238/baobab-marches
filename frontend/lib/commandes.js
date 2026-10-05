// Libelle du dossier auquel une commande fournisseur est rattachee (Lot 5).
export function libelleDossier(c, t) {
  if (c.dossier_ao_id) return [c.dossier_ao_reference, c.dossier_ao_intitule].filter(Boolean).join(" · ");
  if (c.consultation_id) return [c.consultation_client_nom, c.consultation_objet].filter(Boolean).join(" · ");
  return t("cmdStockGeneral");
}
