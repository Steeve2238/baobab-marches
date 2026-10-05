"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { api } from "../../lib/api";
import { useLangue } from "../../lib/i18n/LanguageContext";
import AppShell from "../../lib/components/AppShell";

// Liste des receptions de marchandises (facture fournisseur -> articles + stock).
// Back : routes/receptions.js (05/10/2026).
export default function ReceptionsPage() {
  const { t, dict } = useLangue();
  const [receptions, setReceptions] = useState([]);
  const [statut, setStatut] = useState("");
  const [chargement, setChargement] = useState(true);
  const [erreur, setErreur] = useState("");

  useEffect(() => {
    setChargement(true);
    api
      .getReceptions(statut ? { statut } : {})
      .then(setReceptions)
      .catch((err) => setErreur(err.message || t("defaultLoadError")))
      .finally(() => setChargement(false));
  }, [statut, t]);

  return (
    <AppShell title={t("receptionsTitle")}>
      <p style={{ fontSize: 12.5, color: "var(--sub)", marginBottom: 12 }}>{t("receptionsSubtitle")}</p>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center", marginBottom: 14 }}>
        <select value={statut} onChange={(e) => setStatut(e.target.value)} style={{ ...inputStyle, width: "auto" }}>
          <option value="">{t("receptionsFiltreTous")}</option>
          {["BROUILLON", "VALIDEE", "ANNULEE"].map((s) => (
            <option key={s} value={s}>
              {t(`receptionsStatut${s}`)}
            </option>
          ))}
        </select>
        <Link href="/produits" style={{ ...boutonSecondaireStyle, textDecoration: "none" }}>
          {t("navProduits")}
        </Link>
        <span style={{ flex: 1 }} />
        <Link href="/receptions/nouvelle" style={{ ...boutonPrincipalStyle, textDecoration: "none" }}>
          {t("receptionsNouvelle")}
        </Link>
      </div>
      {erreur && <p style={{ color: "var(--brique)", fontSize: 12.5, marginBottom: 12 }}>{erreur}</p>}
      {chargement ? (
        <p style={{ fontSize: 12.5, color: "var(--sub)" }}>{t("loading")}</p>
      ) : receptions.length === 0 ? (
        <p className="card" style={{ fontSize: 13, color: "var(--sub)" }}>{t("receptionsVide")}</p>
      ) : (
        <div className="card" style={{ overflowX: "auto", padding: 0 }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5, minWidth: 820 }}>
            <thead>
              <tr>
                <th style={thStyle}>{t("receptionsColNumero")}</th>
                <th style={thStyle}>{t("receptionsColFournisseur")}</th>
                <th style={thStyle}>{t("receptionsColFacture")}</th>
                <th style={thStyle}>{t("receptionsColDate")}</th>
                <th style={{ ...thStyle, textAlign: "right" }}>{t("receptionsColLignes")}</th>
                <th style={{ ...thStyle, textAlign: "right" }}>{t("receptionsColTotalDevise")}</th>
                <th style={{ ...thStyle, textAlign: "right" }}>{t("receptionsColTotalXof")}</th>
                <th style={thStyle}>{t("receptionsColStatut")}</th>
              </tr>
            </thead>
            <tbody>
              {receptions.map((r) => (
                <tr key={r.id} style={{ borderTop: "1px solid var(--line)" }}>
                  <td className="mono" style={tdStyle}>
                    <Link href={`/receptions/${r.id}`} style={{ color: "var(--petrol)", fontWeight: 600 }}>
                      {r.numero}
                    </Link>
                  </td>
                  <td style={tdStyle}>{r.fournisseur_nom}</td>
                  <td className="mono" style={tdStyle}>{r.reference_facture || "—"}</td>
                  <td className="mono" style={tdStyle}>{new Date(r.date_reception).toLocaleDateString(dict.dateLocale)}</td>
                  <td className="mono" style={{ ...tdStyle, textAlign: "right" }}>{r.nb_lignes}</td>
                  <td className="mono" style={{ ...tdStyle, textAlign: "right" }}>
                    {Number(r.total_devise).toLocaleString()} {r.devise}
                  </td>
                  <td className="mono" style={{ ...tdStyle, textAlign: "right", fontWeight: 600 }}>{Number(r.total_xof).toLocaleString()}</td>
                  <td style={tdStyle}>
                    <span style={{ ...pastille, ...(r.statut === "VALIDEE" ? pastilleVerte : r.statut === "ANNULEE" ? pastilleRouge : {}) }}>
                      {t(`receptionsStatut${r.statut}`)}
                    </span>
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
const boutonSecondaireStyle = { background: "transparent", color: "var(--petrol)", border: "1px solid var(--line)", borderRadius: 8, padding: "8px 14px", fontSize: 12, fontWeight: 600, cursor: "pointer", display: "inline-block" };
const thStyle = { padding: "8px 10px", textAlign: "left", color: "var(--sub)", fontWeight: 600, fontSize: 11, borderBottom: "1px solid var(--line)", whiteSpace: "nowrap" };
const tdStyle = { padding: "8px 10px", verticalAlign: "top" };
const pastille = { fontSize: 10.5, fontWeight: 700, padding: "3px 8px", borderRadius: 20, whiteSpace: "nowrap", background: "rgba(0,0,0,0.06)", color: "var(--sub)" };
const pastilleVerte = { background: "rgba(46,125,91,0.12)", color: "var(--vert)" };
const pastilleRouge = { background: "rgba(180,60,40,0.12)", color: "var(--brique)" };
