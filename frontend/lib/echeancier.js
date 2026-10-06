"use client";

// Utilitaires des echeanciers de paiement (06/10/2026).
export const EVENEMENTS = ["COMMANDE", "EXPEDITION", "ARRIVEE", "LIVRAISON", "FACTURATION", "RECEPTION"];

export const ligneVide = () => ({ pourcentage: "", evenement: "COMMANDE", jours: 0 });

export function totalPct(lignes) {
  return (lignes || []).reduce((s, l) => s + (Number(String(l.pourcentage).replace(",", ".")) || 0), 0);
}

/** Vrai si l'echeancier est complet : au moins une ligne, parts valides, total = 100. */
export function echeancierValide(lignes) {
  if (!Array.isArray(lignes) || lignes.length === 0) return false;
  for (const l of lignes) {
    const p = Number(String(l.pourcentage).replace(",", "."));
    const j = Number(l.jours === "" || l.jours == null ? 0 : l.jours);
    if (!Number.isFinite(p) || p <= 0 || p > 100) return false;
    if (!Number.isInteger(j) || j < 0 || j > 720) return false;
    if (!EVENEMENTS.includes(l.evenement)) return false;
  }
  return Math.abs(totalPct(lignes) - 100) <= 0.01;
}

/** Nettoie pour l'API (nombres) */
export function pourApi(lignes) {
  return (lignes || []).map((l) => ({
    pourcentage: Number(String(l.pourcentage).replace(",", ".")),
    evenement: l.evenement,
    jours: Number(l.jours === "" || l.jours == null ? 0 : l.jours),
  }));
}

/** Texte lisible : « 30 % à la commande ; 70 % 45 jours après la facture ». */
export function texteEcheancier(lignes, t) {
  if (!Array.isArray(lignes) || lignes.length === 0) return "";
  return lignes
    .map((l) => {
      const p = String(Math.round(Number(l.pourcentage) * 100) / 100).replace(".", ",");
      const j = Number(l.jours) || 0;
      if (j === 0) return `${p} % ${t("echA")} ${t(`echCourt_${l.evenement}`)}`;
      return `${p} % ${j} ${j > 1 ? t("echJourPluriel") : t("echJourUn")} ${t("echApresMot")} ${t(`echApres_${l.evenement}`)}`;
    })
    .join(" ; ");
}
