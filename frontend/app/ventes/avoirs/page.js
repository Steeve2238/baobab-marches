"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { api } from "../../../lib/api";
import { useLangue } from "../../../lib/i18n/LanguageContext";
import AppShell from "../../../lib/components/AppShell";
import { labelStyle, inputStyle, boutonPrincipalStyle, thStyle, tdStyle, numStyle } from "../../../lib/comptaUi";

const fmt = (n) => Math.round(Number(n) || 0).toLocaleString("fr-FR").replace(/[  ]/g, " ");
const il = (d) => (d ? String(d).slice(0, 10).split("-").reverse().join("/") : "—");
const aujourdhui = () => new Date().toISOString().slice(0, 10);
const debutAnnee = () => aujourdhui().slice(0, 4) + "-01-01";

export default function AvoirsPage() {
  const { t } = useLangue();
  const [f, setF] = useState({ du: debutAnnee(), au: aujourdhui(), q: "" });
  const [data, setData] = useState({ avoirs: [], total_ttc: 0 });
  const [erreur, setErreur] = useState("");
  useEffect(() => {
    const p = { du: f.du, au: f.au };
    if (f.q.trim()) p.q = f.q.trim();
    api.avoirs(p).then(setData).catch((e) => setErreur(e.message));
  }, [f]);
  return (
    <AppShell title={t("avoTitre")}>
      <p style={{ fontSize: 12.5, color: "var(--sub)", margin: "0 0 14px", maxWidth: 780 }}>{t("avoAide")}</p>
      {erreur && <p style={{ color: "var(--brique)", fontSize: 12.5 }}>{erreur}</p>}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "flex-end", marginBottom: 12 }}>
        <div><label style={labelStyle}>{t("avoRecherche")}</label><input value={f.q} onChange={(e) => setF({ ...f, q: e.target.value })} style={{ ...inputStyle, width: 280 }} /></div>
        <div><label style={labelStyle}>{t("avoDu")}</label><input type="date" value={f.du} onChange={(e) => setF({ ...f, du: e.target.value })} style={{ ...inputStyle, width: 160 }} /></div>
        <div><label style={labelStyle}>{t("avoAu")}</label><input type="date" value={f.au} onChange={(e) => setF({ ...f, au: e.target.value })} style={{ ...inputStyle, width: 160 }} /></div>
        <Link href="/ventes/avoirs/nouveau" style={{ ...boutonPrincipalStyle, textDecoration: "none", display: "inline-block" }}>{t("avoNouveau")}</Link>
        <div style={{ marginLeft: "auto", textAlign: "right" }}>
          <div style={{ fontSize: 11, color: "var(--sub)", textTransform: "uppercase", fontWeight: 700 }}>{t("avoTotal")}</div>
          <div style={{ fontFamily: "Space Grotesk", fontWeight: 700, fontSize: 22 }}>{fmt(data.total_ttc)} F</div>
        </div>
      </div>
      <div className="card" style={{ padding: 0, overflowX: "auto" }}>
        {data.avoirs.length === 0 ? <p style={{ padding: 16, margin: 0, fontSize: 12.5, color: "var(--sub)" }}>{t("avoAucun")}</p> : (
          <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 800 }}>
            <thead><tr>
              <th style={thStyle}>{t("avoColNumero")}</th><th style={thStyle}>{t("avoColDate")}</th><th style={thStyle}>{t("avoColFacture")}</th><th style={thStyle}>{t("avoColClient")}</th>
              <th style={thStyle}>{t("avoColMotif")}</th><th style={{ ...thStyle, textAlign: "right" }}>{t("avoColTtc")}</th><th style={{ ...thStyle, textAlign: "right" }}>{t("avoColRembourse")}</th>
            </tr></thead>
            <tbody>
              {data.avoirs.map((a) => (
                <tr key={a.id}>
                  <td style={tdStyle}><Link href={`/ventes/avoirs/${a.id}`} style={{ color: "var(--petrol)", fontWeight: 600 }}>{a.numero}</Link></td>
                  <td style={tdStyle}>{il(a.date_avoir)}</td>
                  <td style={tdStyle}>{a.facture_numero}</td>
                  <td style={tdStyle}>{a.client_nom}</td>
                  <td style={tdStyle}>{t("avoMotif" + a.motif_type)}</td>
                  <td style={{ ...tdStyle, ...numStyle, fontWeight: 600 }}>{fmt(a.total_ttc)}</td>
                  <td style={{ ...tdStyle, ...numStyle }}>{a.montant_rembourse > 0 ? `${fmt(a.montant_rembourse)}${a.mode_libelle ? " · " + a.mode_libelle : ""}` : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </AppShell>
  );
}
