"use client";

import { useEffect, useState } from "react";
import { api } from "../api";

// Elements communs des documents imprimables (meme presentation que les
// devis, factures et bons de livraison) : en-tete de l'entreprise, bloc
// signature + cachet, pied de page legal.

export function useEntete() {
  const [entete, setEntete] = useState(null);
  useEffect(() => {
    let annule = false;
    Promise.all([api.getEntete(), api.getParametresVentes()])
      .then(([e, p]) => {
        if (!annule) setEntete({ ...e, ...p });
      })
      .catch(() => {
        if (!annule) setEntete({});
      });
    return () => {
      annule = true;
    };
  }, []);
  return entete;
}

export function piedDePage(entete) {
  return [
    entete?.rccm ? `RCCM ${entete.rccm}` : null,
    entete?.ninea ? `NINEA ${entete.ninea}` : null,
    entete?.site_web || null,
    entete?.coordonnees_bancaires || null,
  ].filter(Boolean);
}

export function EnteteOfficielle({ entete, titre, sousTitre, droite }) {
  return (
    <>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 24, borderBottom: "2px solid var(--petrol)", paddingBottom: 16, marginBottom: 18 }}>
        <div style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
          {entete?.logo_base64 && (
            <img src={`data:${entete.logo_type_mime};base64,${entete.logo_base64}`} alt="logo" style={{ maxWidth: 90, maxHeight: 70, objectFit: "contain" }} />
          )}
          <div>
            <div style={{ fontFamily: "Space Grotesk", fontWeight: 700, fontSize: 14, color: "var(--petrol)" }}>{entete?.raison_sociale || "—"}</div>
            <div style={{ fontSize: 11, color: "var(--sub)", marginTop: 2 }}>{entete?.adresse}</div>
            <div style={{ fontSize: 11, color: "var(--sub)" }}>{entete?.telephone}</div>
            <div style={{ fontSize: 11, color: "var(--sub)" }}>{entete?.email}</div>
          </div>
        </div>
        {droite && <div style={{ textAlign: "right" }}>{droite}</div>}
      </div>
      {titre && (
        <div style={{ textAlign: "center", marginBottom: 16 }}>
          <div style={{ fontFamily: "Space Grotesk", fontWeight: 700, fontSize: 17, letterSpacing: 0.3 }}>{titre}</div>
          {sousTitre && <div style={{ fontSize: 12.5, color: "var(--sub)", marginTop: 3 }}>{sousTitre}</div>}
        </div>
      )}
    </>
  );
}

export function SignatureOfficielle({ entete, lieuDate }) {
  return (
    <div style={{ marginTop: 56, textAlign: "right", breakInside: "avoid" }}>
      {lieuDate && <div style={{ fontSize: 11.5, color: "var(--sub)", marginBottom: 6 }}>{lieuDate}</div>}
      <div style={{ fontWeight: 700, fontSize: 12.5 }}>{entete?.signataire_nom}</div>
      <div style={{ fontSize: 11.5, color: "var(--sub)" }}>{entete?.signataire_titre}</div>
      {entete?.signature_cachet_base64 && (
        <img
          src={`data:${entete.signature_cachet_type_mime};base64,${entete.signature_cachet_base64}`}
          alt="signature et cachet"
          style={{ maxWidth: 150, maxHeight: 100, objectFit: "contain", marginTop: 8 }}
        />
      )}
    </div>
  );
}

export function PiedOfficiel({ entete }) {
  const lignes = piedDePage(entete);
  if (lignes.length === 0) return null;
  return (
    <div style={{ marginTop: 32, paddingTop: 12, borderTop: "1px solid var(--line)", textAlign: "center", fontSize: 10.5, color: "var(--sub)" }}>
      {lignes.join(" · ")}
    </div>
  );
}
