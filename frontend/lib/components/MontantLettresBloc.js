"use client";

import { montantEnLettres, premiereLettreMajuscule } from "../montantEnLettres";

// Bloc "Arrete ... a la somme de ..." imprime sous les totaux d'un devis ou
// d'une facture (chantier du 04/10/2026). Le montant en lettres est toujours
// calcule a partir du MEME montant que celui affiche en chiffres, jamais
// ressaisi. Un montant nul ou invalide n'affiche rien (devis entierement non
// chiffre : pas de "zero franc" qui pourrait passer pour un total valide).
export default function MontantLettresBloc({ label, montant, partiel = false }) {
  const valeur = Number(montant);
  if (!Number.isFinite(valeur) || valeur <= 0) return null;
  const lettres = premiereLettreMajuscule(montantEnLettres(valeur));
  if (!lettres) return null;
  return (
    <div
      style={{
        marginTop: 16,
        padding: "10px 14px",
        border: `1px solid ${partiel ? "var(--brique)" : "var(--line)"}`,
        borderRadius: 6,
        fontSize: 12.5,
        lineHeight: 1.5,
      }}
    >
      <div style={{ fontSize: 11, color: "var(--sub)", textTransform: "uppercase", letterSpacing: 0.4, marginBottom: 3 }}>{label}</div>
      <div style={{ fontWeight: 700, fontStyle: "italic" }}>
        {lettres}
        <span className="mono" style={{ fontWeight: 400, fontStyle: "normal", color: "var(--sub)" }}>
          {" "}({valeur.toLocaleString()} XOF)
        </span>
      </div>
    </div>
  );
}


// Avertissement imprime : le total du devis est partiel (lignes NC exclues).
export function AvertissementTotalPartiel({ texte }) {
  return (
    <div
      style={{
        marginTop: 12,
        padding: "8px 12px",
        border: "1px dashed var(--brique)",
        borderRadius: 6,
        fontSize: 12,
        color: "var(--brique)",
        fontWeight: 600,
      }}
    >
      {texte}
    </div>
  );
}
