"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { api } from "../../lib/api";
import { useLangue } from "../../lib/i18n/LanguageContext";
import AppShell from "../../lib/components/AppShell";

// Liste des livraisons de dossier d'appel d'offres (Lot 5, 05/10/2026).
// Back : routes/livraisonsDossier.js. La validation sort la marchandise du stock.
export default function LivraisonsDossierPage() {
  const { t, dict } = useLangue();
  const [liste, setListe] = useState([]);
  const [statut, setStatut] = useState("");
  const [chargement, setChargement] = useState(true);
  const [erreur, setErreur] = useState("");

  useEffect(() => {
    setChargement(true);
    api
      .getLivraisonsDossier(statut ? { statut } : {})
      .then(setListe)
      .catch((e) => setErreur(e.message))
      .finally(() => setChargement(false));
  }, [statut]);

  return (
    <AppShell title={t("livTitle")}>
      <p style={{ fontSize: 12.5, color: "var(--sub)", marginBottom: 12 }}>{t("livSubtitle")}</p>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center", marginBottom: 14 }}>
        <select value={statut} onChange={(e) => setStatut(e.target.value)} style={{ ...inputStyle, width: "auto" }}>
          <option value="">{t("receptionsFiltreTous")}</option>
          {["BROUILLON", "LIVREE", "ANNULEE"].map((s) => (
            <option key={s} value={s}>{t(`livStatut${s}`)}</option>
          ))}
        </select>
        <span style={{ flex: 1 }} />
        <Link href="/livraisons-dossier/nouvelle" style={{ ...boutonPrincipalStyle, textDecoration: "none" }}>{t("livNouvelle")}</Link>
      </div>
      {erreur && <p style={{ color: "var(--brique)", fontSize: 12.5, marginBottom: 12 }}>{erreur}</p>}
      {chargement ? (
        <p style={{ fontSize: 12.5, color: "var(--sub)" }}>{t("loading")}</p>
      ) : liste.length === 0 ? (
        <p className="card" style={{ fontSize: 13, color: "var(--sub)" }}>{t("livVide")}</p>
      ) : (
        <div className="card" style={{ overflowX: "auto", padding: 0 }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5, minWidth: 720 }}>
            <thead>
              <tr>
                <th style={thStyle}>{t("livColNumero")}</th>
                <th style={thStyle}>{t("livColDossier")}</th>
                <th style={thStyle}>{t("livColDate")}</th>
                <th style={{ ...thStyle, textAlign: "right" }}>{t("livColLignes")}</th>
                <th style={thStyle}>{t("livColStatut")}</th>
              </tr>
            </thead>
            <tbody>
              {liste.map((l) => (
                <tr key={l.id} style={{ borderTop: "1px solid var(--line)" }}>
                  <td className="mono" style={tdStyle}>
                    <Link href={`/livraisons-dossier/${l.id}`} style={{ color: "var(--petrol)", fontWeight: 600 }}>{l.numero}</Link>
                  </td>
                  <td style={tdStyle}>{[l.dossier_reference, l.dossier_intitule].filter(Boolean).join(" · ")}</td>
                  <td className="mono" style={tdStyle}>{new Date(l.date_livraison).toLocaleDateString(dict.dateLocale)}</td>
                  <td className="mono" style={{ ...tdStyle, textAlign: "right" }}>{l.nb_lignes}</td>
                  <td style={tdStyle}>
                    <span style={{ ...pastille, ...(l.statut === "LIVREE" ? pastilleVerte : l.statut === "ANNULEE" ? pastilleRouge : {}) }}>{t(`livStatut${l.statut}`)}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </AppShell>
  );
}

const inputStyle = { width: "100%", padding: "8px 10px", border: "1px solid var(--line)", borderRadius: 8, fontSize: 13, fontFamily: "inherit" };
const boutonPrincipalStyle = { background: "var(--petrol)", color: "#fff", border: "none", borderRadius: 8, padding: "9px 18px", fontSize: 12.5, fontWeight: 600, cursor: "pointer", display: "inline-block" };
const thStyle = { padding: "8px 10px", textAlign: "left", color: "var(--sub)", fontWeight: 600, fontSize: 11, borderBottom: "1px solid var(--line)", whiteSpace: "nowrap" };
const tdStyle = { padding: "8px 10px", verticalAlign: "top" };
const pastille = { fontSize: 10.5, fontWeight: 700, padding: "3px 8px", borderRadius: 20, whiteSpace: "nowrap", background: "rgba(0,0,0,0.06)", color: "var(--sub)" };
const pastilleVerte = { background: "rgba(46,125,91,0.12)", color: "var(--vert)" };
const pastilleRouge = { background: "rgba(180,60,40,0.12)", color: "var(--brique)" };
