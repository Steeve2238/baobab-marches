"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { api } from "../../lib/api";
import { useLangue } from "../../lib/i18n/LanguageContext";
import AppShell from "../../lib/components/AppShell";
import { libelleDossier } from "../../lib/commandes";

// Liste des commandes fournisseur (Lot 5, 05/10/2026). Back : routes/commandes.js.
const nf = (n) => Number(n).toLocaleString(undefined, { maximumFractionDigits: 2 });

export default function CommandesPage() {
  const { t, dict } = useLangue();
  const [liste, setListe] = useState([]);
  const [filtre, setFiltre] = useState("");
  const [chargement, setChargement] = useState(true);
  const [erreur, setErreur] = useState("");

  useEffect(() => {
    setChargement(true);
    const params = filtre === "A_RECEVOIR" ? { a_recevoir: "1" } : filtre ? { statut: filtre } : {};
    api
      .getCommandes(params)
      .then(setListe)
      .catch((e) => setErreur(e.message))
      .finally(() => setChargement(false));
  }, [filtre]);

  return (
    <AppShell title={t("cmdTitle")}>
      <p style={{ fontSize: 12.5, color: "var(--sub)", marginBottom: 12 }}>{t("cmdSubtitle")}</p>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center", marginBottom: 14 }}>
        <select value={filtre} onChange={(e) => setFiltre(e.target.value)} style={{ ...inputStyle, width: "auto" }}>
          <option value="">{t("cmdFiltreTous")}</option>
          <option value="A_RECEVOIR">{t("cmdARecevoir")}</option>
          {["BROUILLON", "CONFIRMEE", "ANNULEE"].map((s) => (
            <option key={s} value={s}>{t(`cmdStatut${s}`)}</option>
          ))}
        </select>
        <span style={{ flex: 1 }} />
        <Link href="/commandes/nouvelle" style={{ ...boutonPrincipalStyle, textDecoration: "none" }}>{t("cmdNouvelle")}</Link>
      </div>
      {erreur && <p style={{ color: "var(--brique)", fontSize: 12.5, marginBottom: 12 }}>{erreur}</p>}
      {chargement ? (
        <p style={{ fontSize: 12.5, color: "var(--sub)" }}>{t("loading")}</p>
      ) : liste.length === 0 ? (
        <p className="card" style={{ fontSize: 13, color: "var(--sub)" }}>{t("cmdVide")}</p>
      ) : (
        <div className="card" style={{ overflowX: "auto", padding: 0 }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5, minWidth: 900 }}>
            <thead>
              <tr>
                <th style={thStyle}>{t("cmdColNumero")}</th>
                <th style={thStyle}>{t("cmdColFournisseur")}</th>
                <th style={thStyle}>{t("cmdColRattachement")}</th>
                <th style={thStyle}>{t("cmdColDate")}</th>
                <th style={{ ...thStyle, textAlign: "right" }}>{t("cmdColTotal")}</th>
                <th style={{ ...thStyle, textAlign: "right" }}>XOF</th>
                <th style={thStyle}>{t("cmdColStatut")}</th>
                <th style={thStyle}>{t("cmdColReception")}</th>
              </tr>
            </thead>
            <tbody>
              {liste.map((c) => (
                <tr key={c.id} style={{ borderTop: "1px solid var(--line)" }}>
                  <td className="mono" style={tdStyle}>
                    <Link href={`/commandes/${c.id}`} style={{ color: "var(--petrol)", fontWeight: 600 }}>{c.numero}</Link>
                  </td>
                  <td style={tdStyle}>{c.fournisseur_nom}</td>
                  <td style={{ ...tdStyle, color: c.dossier_ao_id || c.consultation_id ? "inherit" : "var(--sub)" }}>{libelleDossier(c, t)}</td>
                  <td className="mono" style={tdStyle}>{new Date(c.date_commande).toLocaleDateString(dict.dateLocale)}</td>
                  <td className="mono" style={{ ...tdStyle, textAlign: "right" }}>{nf(c.total_devise)} {c.devise}</td>
                  <td className="mono" style={{ ...tdStyle, textAlign: "right" }}>{nf(c.total_xof)}</td>
                  <td style={tdStyle}>{t(`cmdStatut${c.statut}`)}</td>
                  <td style={{ ...tdStyle, color: c.statut_reception === "COMPLETE" ? "var(--vert)" : "inherit" }}>{c.statut_reception ? t(`cmdRec${c.statut_reception}`) : "—"}</td>
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
const boutonPrincipalStyle = { background: "var(--petrol)", color: "#fff", border: "none", borderRadius: 8, padding: "9px 18px", fontSize: 12.5, fontWeight: 600, cursor: "pointer" };
const thStyle = { textAlign: "left", fontSize: 11, color: "var(--sub)", padding: "10px 12px", fontWeight: 600, whiteSpace: "nowrap" };
const tdStyle = { padding: "9px 12px", verticalAlign: "top" };
