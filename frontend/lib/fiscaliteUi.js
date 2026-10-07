"use client";

// Utilitaires partages par les pages du module Fiscalite (migration 049).
export { labelStyle, inputStyle, boutonPrincipalStyle, boutonSecondaireStyle, boutonDangerStyle, thStyle, tdStyle, numStyle } from "./comptaUi";

export const MOIS_FR = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];
export const MOIS_EN = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/** Nom du mois (1-12) selon la langue de l'interface (locale "fr-FR" / "en-US"). */
export function nomMois(mois, locale) {
  return String(locale || "").toLowerCase().startsWith("en") ? MOIS_EN[mois - 1] : MOIS_FR[mois - 1];
}

/** Montant entier en francs CFA : separateur de milliers, aucune decimale ; zero => "0". */
export function formaterXof(valeur, locale = "fr-FR") {
  return Number(valeur || 0).toLocaleString(locale, { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}

export function dateCourte(iso, locale = "fr-FR") {
  return iso ? new Date(`${String(iso).slice(0, 10)}T00:00:00`).toLocaleDateString(locale) : "";
}

/** Couleurs des pastilles d'etat (declaration / echeance). */
export const STYLE_STATUT = {
  A_FAIRE: { color: "var(--sub)", background: "rgba(91,106,108,0.1)" },
  PREPAREE: { color: "#8A6200", background: "rgba(214,160,40,0.16)" },
  DEPOSEE: { color: "#1F5F8B", background: "rgba(40,110,170,0.12)" },
  PAYEE: { color: "#2E7D5B", background: "rgba(46,125,91,0.12)" },
  NON_CONCERNE: { color: "var(--sub)", background: "rgba(91,106,108,0.1)" },
};

export const STYLE_ALERTE = {
  EN_RETARD: { color: "var(--brique)", background: "rgba(196,74,58,0.1)" },
  IMMINENT: { color: "#8A6200", background: "rgba(214,160,40,0.16)" },
  A_VENIR: { color: "var(--petrol)", background: "rgba(15,50,55,0.07)" },
  OK: { color: "#2E7D5B", background: "rgba(46,125,91,0.12)" },
  HISTORIQUE: { color: "var(--sub)", background: "rgba(91,106,108,0.08)" },
};

export const pastilleStyle = (style) => ({
  display: "inline-block",
  padding: "2px 9px",
  borderRadius: 20,
  fontSize: 11,
  fontWeight: 700,
  whiteSpace: "nowrap",
  ...style,
});

/**
 * Message d'un avertissement ou d'une alerte du moteur : la cle de dictionnaire est `prefixe + code` et le texte
 * peut contenir des {champs} remplaces par les valeurs de l'objet (montants formates en XOF).
 */
export function texteAlerte(t, prefixe, a, locale = "fr-FR") {
  let texte = t(`${prefixe}${a.code}`);
  const CHAMPS_REGIME = ["attendu", "declare", "cofi_regime"];
  const CHAMPS_MONTANT = ["montant", "tva", "ca", "reste", "seuil", "collectee", "deductible", "ordinaire", "amortissement_differe", "imf", "is", "compta", "saisis", "va", "plafond", "total", "ventes"];
  const CHAMPS_OUI_NON = ["cofi_assujetti", "profil_assujetti"];
  for (const [k, v] of Object.entries(a)) {
    if (k === "code") continue;
    let valeur;
    if (CHAMPS_REGIME.includes(k) && typeof v === "string") valeur = t(`fiscRegime_${v}`);
    else if (CHAMPS_OUI_NON.includes(k)) valeur = v === true ? t("fiscOui") : v === false ? t("fiscNon") : t("fiscInconnu");
    else if (Array.isArray(v)) valeur = v.join(", ");
    else if (typeof v === "number") valeur = CHAMPS_MONTANT.includes(k) ? formaterXof(v, locale) : String(v);
    else valeur = String(v ?? "");
    texte = texte.split(`{${k}}`).join(valeur);
  }
  return texte;
}
