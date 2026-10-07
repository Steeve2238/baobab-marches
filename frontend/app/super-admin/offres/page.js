"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { superAdminApi } from "../../../lib/superAdminApi";
import { useLangue } from "../../../lib/i18n/LanguageContext";
import SuperAdminShell from "../../../lib/components/SuperAdminShell";
import { boutonPrincipalStyle, thStyle, tdStyle } from "../../../lib/comptaUi";

export const STYLE_STATUT_OFFRE = {
  BROUILLON: { color: "var(--sub)", background: "rgba(91,106,108,0.1)" },
  ENVOYEE: { color: "#9A6A00", background: "rgba(200,140,0,0.13)" },
  ACCEPTEE: { color: "#2E7D5B", background: "rgba(46,125,91,0.12)" },
  REFUSEE: { color: "var(--brique)", background: "rgba(196,74,58,0.1)" },
  ANNULEE: { color: "var(--sub)", background: "rgba(91,106,108,0.1)" },
};
const FILTRES = ["TOUTES", "BROUILLON", "ENVOYEE", "ACCEPTEE", "REFUSEE", "ANNULEE"];
const mm = (n) => Math.round(Number(n) || 0).toLocaleString("fr-FR");

// Vue d'ensemble des offres commerciales (devis) et de leurs contrats.
export default function SuperAdminOffresPage() {
  const router = useRouter();
  const { t } = useLangue();
  const [offres, setOffres] = useState([]);
  const [filtre, setFiltre] = useState("TOUTES");
  const [erreur, setErreur] = useState("");
  const [chargement, setChargement] = useState(true);

  useEffect(() => {
    setChargement(true);
    superAdminApi
      .getOffres(filtre === "TOUTES" ? "" : `?statut=${filtre}`)
      .then(setOffres)
      .catch((err) => {
        if (err.status === 401) return router.push("/super-admin/login");
        setErreur(err.message);
      })
      .finally(() => setChargement(false));
  }, [filtre, router]);

  return (
    <SuperAdminShell title={t("saOffTitre")}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap", marginBottom: 14 }}>
        <p style={{ fontSize: 12.5, color: "var(--sub)", maxWidth: 640 }}>{t("saOffAide")}</p>
        <Link href="/super-admin/offres/nouvelle" style={{ ...boutonPrincipalStyle, textDecoration: "none", display: "inline-block" }}>{t("saOffNouvelle")}</Link>
      </div>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 14 }}>
        {FILTRES.map((f) => (
          <button key={f} onClick={() => setFiltre(f)} style={{ border: "1px solid var(--line)", borderRadius: 20, padding: "6px 14px", fontSize: 12, fontWeight: 600, background: filtre === f ? "var(--petrol)" : "transparent", color: filtre === f ? "#fff" : "var(--petrol)" }}>
            {f === "TOUTES" ? t("saOffToutes") : t(`saOffStatut_${f}`)}
          </button>
        ))}
      </div>
      {erreur && <p style={{ color: "var(--brique)", fontSize: 12.5, marginBottom: 12 }}>{erreur}</p>}
      {chargement ? (
        <p style={{ fontSize: 12.5, color: "var(--sub)" }}>{t("loading")}</p>
      ) : offres.length === 0 ? (
        <p style={{ fontSize: 12.5, color: "var(--sub)" }}>{t("saOffAucune")}</p>
      ) : (
        <div className="card" style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 820 }}>
            <thead>
              <tr>
                <th style={thStyle}>{t("saOffColNumero")}</th>
                <th style={thStyle}>{t("saOffClient")}</th>
                <th style={thStyle}>{t("saOffColFormule")}</th>
                <th style={{ ...thStyle, textAlign: "right" }}>{t("saOffColTotal")}</th>
                <th style={thStyle}>{t("saOffColStatut")}</th>
                <th style={thStyle}>{t("saOffColContrat")}</th>
              </tr>
            </thead>
            <tbody>
              {offres.map((o) => (
                <tr key={o.id}>
                  <td style={tdStyle}><Link href={`/super-admin/offres/${o.id}`} style={{ fontWeight: 700, color: "var(--petrol)" }}>{o.numero}</Link><div style={{ fontSize: 11, color: "var(--sub)" }}>{o.date_offre ? String(o.date_offre).slice(0, 10).split("-").reverse().join("/") : ""}</div></td>
                  <td style={tdStyle}>{o.client_raison_sociale}</td>
                  <td style={{ ...tdStyle, fontSize: 12 }}>{o.formule_nom || "-"} · {t(`saOffMode${o.mode_hebergement}`)} · {o.duree_mois} {t("saOffMois")}</td>
                  <td style={{ ...tdStyle, textAlign: "right", fontVariantNumeric: "tabular-nums", fontWeight: 700 }}>{mm(o.totaux.total_ttc)} XOF</td>
                  <td style={tdStyle}>
                    <span style={{ fontSize: 10.5, fontWeight: 700, padding: "3px 8px", borderRadius: 20, whiteSpace: "nowrap", ...STYLE_STATUT_OFFRE[o.statut] }}>{t(`saOffStatut_${o.statut}`)}</span>
                    {o.expiree && <span style={{ fontSize: 11, color: "var(--brique)", marginLeft: 6 }}>{t("saOffExpiree")}</span>}
                  </td>
                  <td style={{ ...tdStyle, fontSize: 12 }}>{o.contrat_numero ? `${o.contrat_numero} · ${t(`saCtrStatut_${o.contrat_statut}`)}` : "-"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </SuperAdminShell>
  );
}
