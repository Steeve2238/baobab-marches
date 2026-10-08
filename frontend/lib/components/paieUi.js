// Petits composants et styles partages par les ecrans Paie.
import { inputStyle, boutonPrincipal, boutonLeger, labelStyle, fmtMontant } from "./rhUi";

export { inputStyle, boutonPrincipal, boutonLeger, labelStyle, fmtMontant };

export const boutonDanger = { ...boutonLeger, color: "var(--brique)", borderColor: "var(--brique)" };
export const cellule = { padding: "7px 8px", borderBottom: "1px solid var(--line-soft)", fontSize: 12.5, verticalAlign: "middle" };
export const enteteCellule = { ...cellule, fontSize: 11, fontWeight: 700, color: "var(--sub)", textAlign: "left", textTransform: "uppercase", letterSpacing: 0.3, whiteSpace: "nowrap" };
export const droite = { textAlign: "right", fontVariantNumeric: "tabular-nums" };

export const fmt = (n) => (n === null || n === undefined || n === "" ? "—" : fmtMontant(n));
export const fmtDec = (n, d = 2) => (n === null || n === undefined || n === "" ? "—" : Number(n).toLocaleString("fr-FR", { minimumFractionDigits: 0, maximumFractionDigits: d }).replace(/ | /g, " "));

export function Pastille({ ton = "neutre", children }) {
  const couleurs = {
    ok: ["#2E7D5B", "rgba(46,125,91,0.12)"],
    alerte: ["#B26A00", "rgba(230,150,0,0.14)"],
    erreur: ["var(--brique)", "rgba(196,74,58,0.1)"],
    neutre: ["var(--sub)", "rgba(120,120,120,0.12)"],
  };
  const [c, f] = couleurs[ton] || couleurs.neutre;
  return <span style={{ fontSize: 11, fontWeight: 700, padding: "2px 8px", borderRadius: 10, color: c, background: f, whiteSpace: "nowrap" }}>{children}</span>;
}

export const tonStatut = { OUVERTE: "alerte", VALIDEE: "ok", CLOTUREE: "neutre" };
export const MOIS_FR = ["", "janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];

import { useState } from "react";
export { Champ, Section, grille } from "./rhUi";

/** Messages de succes / d'erreur d'un ecran de parametrage. */
export function useStatut() {
  const [message, setMessage] = useState("");
  const [erreur, setErreur] = useState("");
  return {
    message, erreur,
    ok: (m) => { setErreur(""); setMessage(m); },
    ko: (e) => { setMessage(""); setErreur(e && e.message ? e.message : String(e)); },
    raz: () => { setMessage(""); setErreur(""); },
  };
}

export function Statut({ s }) {
  return (
    <>
      {s.erreur && <p style={{ color: "var(--brique)", fontSize: 12.5, margin: "0 0 10px" }}>{s.erreur}</p>}
      {s.message && <p style={{ color: "#2E7D5B", fontSize: 12.5, margin: "0 0 10px" }}>{s.message}</p>}
    </>
  );
}

export const aujourdhui = () => new Date().toISOString().slice(0, 10);

/** Libelle court d'un type d'heures supplementaires : le taux d'abord, car c'est ce qui les distingue. */
export const libelleHs = (m) => `${Number(m.taux)} % — ${String(m.libelle || m.code).replace(/\s*majorées de [\d.,]+ ?%/i, "")}`;
