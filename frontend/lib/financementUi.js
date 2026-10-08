"use client";

// Utilitaires partages par les pages du module Financement (v2, 06/10/2026).
import { useEffect, useState } from "react";
import { api } from "./api";

export {
  labelStyle,
  inputStyle,
  boutonPrincipalStyle,
  boutonSecondaireStyle,
  boutonDangerStyle,
  thStyle,
  tdStyle,
  numStyle,
} from "./comptaUi";

export const TYPES_ORDRE = [
  "AFFACTURAGE",
  "ESCOMPTE",
  "CREDIT_TRESORERIE",
  "CREDIT_RELAIS",
  "AVANCE_MARCHE",
  "LC_INTERNATIONAL",
  "AVAL_TRAITE",
  "CAUTION_SOUMISSION",
  "CAUTION_BONNE_EXECUTION",
  "CAUTION_AVANCE_DEMARRAGE",
  "CAUTION_RETENUE_GARANTIE",
  "ASSURANCE_CREDIT",
];

export const MODES = ["POURCENT_FLAT", "POURCENT_ANNUEL", "POURCENT_PAR_PERIODE", "FORFAIT", "FORFAIT_PAR_PERIODE"];
export const PERIODES = ["MOIS", "TRIMESTRE", "SEMESTRE", "AN"];
export const RETENUES = ["INCLUSE", "EN_PLUS", "A_CONFIRMER"];
export const RECOURS = ["AVEC_RECOURS_NOTIFIE", "AVEC_RECOURS_NON_NOTIFIE", "SANS_RECOURS"];
export const STATUTS = ["EN_NEGOCIATION", "ACTIVE", "ARCHIVEE"];
export const FREQUENCES = ["PAR_OPERATION", "UNIQUE_CONTRAT"];
// Points que la proposition de la banque ne precise pas toujours : a cocher une fois confirmes par ecrit.
export const POINTS_CONFIRMABLES = {
  CREANCE: ["BASE_COMMISSION", "TAXE", "BASE_JOURS", "PRELEVEMENT_INTERETS", "FRAIS_UNIQUES", "LIBERATION_FONDS", "RETARD_PAIEMENT", "VALIDITE", "DUREE_MAX"],
  PRET: ["TAXE", "BASE_JOURS", "PRELEVEMENT_INTERETS", "VALIDITE", "DUREE_MAX"],
  GARANTIE: ["TAXE", "VALIDITE"],
};

/** Montant sans decimales (les montants du module sont en XOF entiers). */
export function fmtXof(n, locale = "fr-FR") {
  if (n === null || n === undefined || n === "" || Number.isNaN(Number(n))) return "—";
  return Number(n).toLocaleString(locale, { maximumFractionDigits: 0 });
}
export function fmtPct(n, locale = "fr-FR", d = 2) {
  if (n === null || n === undefined || Number.isNaN(Number(n))) return "—";
  return Number(n).toLocaleString(locale, { maximumFractionDigits: d });
}
export const jour = (d) => (d ? String(d).slice(0, 10) : "");
export const aujourdhui = () => new Date().toISOString().slice(0, 10);

/** Nombre de jours entre deux dates YYYY-MM-DD (null si l'une manque). */
export function joursEntre(a, b) {
  if (!a || !b) return null;
  const d = (new Date(`${b}T00:00:00Z`) - new Date(`${a}T00:00:00Z`)) / 86400000;
  return Number.isNaN(d) ? null : Math.round(d);
}

/** Catalogue des modeles (lignes pre-remplies, champs utiles par type). */
export function useCatalogue() {
  const [catalogue, setCatalogue] = useState(null);
  useEffect(() => {
    api.finCatalogue().then(setCatalogue).catch(() => setCatalogue([]));
  }, []);
  return catalogue;
}

export function Pastille({ children, couleur = "var(--sub)", fond = "transparent", titre }) {
  return (
    <span
      title={titre}
      style={{ display: "inline-block", fontSize: 10.5, fontWeight: 700, padding: "2px 8px", borderRadius: 10, color: couleur, border: `1px solid ${couleur}`, background: fond, whiteSpace: "nowrap" }}
    >
      {children}
    </span>
  );
}

export function Aide({ children }) {
  return <p style={{ fontSize: 11.5, color: "var(--sub)", marginTop: 4, lineHeight: 1.45 }}>{children}</p>;
}
