"use client";

// Utilitaires partages par les pages du module Comptabilite (chantier E).
import { useEffect, useState } from "react";
import { api } from "./api";

export const labelStyle = { fontSize: 11.5, fontWeight: 600, display: "block", marginBottom: 5 };
export const inputStyle = {
  width: "100%",
  padding: "8px 10px",
  border: "1px solid var(--line)",
  borderRadius: 8,
  fontSize: 13,
  fontFamily: "inherit",
  background: "#fff",
};
export const boutonPrincipalStyle = {
  background: "var(--petrol)",
  color: "#fff",
  border: "none",
  borderRadius: 8,
  padding: "8px 16px",
  fontSize: 12.5,
  fontWeight: 600,
  whiteSpace: "nowrap",
};
export const boutonSecondaireStyle = {
  background: "transparent",
  color: "var(--petrol)",
  border: "1px solid var(--line)",
  borderRadius: 8,
  padding: "6px 12px",
  fontSize: 12,
  fontWeight: 600,
  whiteSpace: "nowrap",
};
export const boutonDangerStyle = { ...boutonSecondaireStyle, color: "var(--brique)" };
export const thStyle = {
  textAlign: "left",
  fontSize: 11,
  fontWeight: 700,
  color: "var(--sub)",
  padding: "8px 8px",
  borderBottom: "1px solid var(--line)",
  whiteSpace: "nowrap",
};
export const tdStyle = { padding: "7px 8px", borderBottom: "1px solid var(--line-soft)", fontSize: 12.5, verticalAlign: "top" };
export const numStyle = { textAlign: "right", fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" };

/** Formate un montant (2 decimales, separateur de milliers selon la langue). Zero => vide si `videSiZero`. */
export function formaterMontant(valeur, locale = "fr-FR", videSiZero = false) {
  const n = Number(valeur || 0);
  if (videSiZero && Math.abs(n) < 0.005) return "";
  return n.toLocaleString(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** Arrondi au centime (pour les controles d'equilibre cote saisie). */
export const centimes = (v) => Math.round((Number(v) || 0) * 100);

/**
 * Etat du module pour l'utilisateur courant : initialise ou non, droits
 * (validation / ecriture), compteurs d'ecritures en attente.
 */
export function useComptaStatut() {
  const [statut, setStatut] = useState(null);
  const [erreur, setErreur] = useState("");
  const [version, setVersion] = useState(0);
  useEffect(() => {
    api
      .comptaStatut()
      .then(setStatut)
      .catch((e) => setErreur(e.message));
  }, [version]);
  return { statut, erreur, recharger: () => setVersion((v) => v + 1) };
}

export function statutLibelleCle(statut) {
  return { BROUILLON: "comptaStatutBrouillon", EN_INSTANCE: "comptaStatutEnInstance", VALIDEE: "comptaStatutValidee" }[statut] || statut;
}

export const STATUT_COULEURS = {
  BROUILLON: { color: "var(--sub)", background: "rgba(91,106,108,0.12)" },
  EN_INSTANCE: { color: "var(--ocre)", background: "var(--ocre-bg)" },
  VALIDEE: { color: "var(--vert)", background: "var(--vert-bg)" },
};
