"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { api } from "../../../lib/api";
import { useLangue } from "../../../lib/i18n/LanguageContext";
import AppShell from "../../../lib/components/AppShell";

const MOIS = {
  fr: ["Jan", "Fév", "Mar", "Avr", "Mai", "Jun", "Jul", "Aoû", "Sep", "Oct", "Nov", "Déc"],
  en: ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"],
};

function couleurCellule(jours) {
  if (jours === 0) return undefined;
  if (jours <= 5) return "var(--vert-bg)";
  if (jours <= 10) return "var(--ocre-bg)";
  return "var(--brique-bg)";
}

export default function PlanningCongesPage() {
  const { t, langue } = useLangue();
  const [planning, setPlanning] = useState([]);
  const [annee, setAnnee] = useState(new Date().getFullYear());
  const [erreur, setErreur] = useState("");
  const [chargement, setChargement] = useState(true);
  const [tooltip, setTooltip] = useState(null);

  useEffect(() => {
    setChargement(true);
    api
      .getPlanningCongesRH(annee)
      .then((r) => setPlanning(r.planning || []))
      .catch((err) => setErreur(err.message))
      .finally(() => setChargement(false));
  }, [annee]);

  const mois = MOIS[langue] || MOIS.fr;

  return (
    <AppShell title={t("planningCongesPageTitle")}>
      <Link href="/rh/personnel" style={{ fontSize: 12, color: "var(--petrol)", display: "inline-block", marginBottom: 12 }}>
        {t("backToPersonnel")}
      </Link>

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
        <p style={{ fontSize: 12.5, color: "var(--sub)" }}>{t("planningCongesPageSubtitle")}</p>
        <select value={annee} onChange={(e) => setAnnee(parseInt(e.target.value, 10))} style={{ ...inputStyle, width: 110 }}>
          {[annee - 1, annee, annee + 1].filter((a, i, arr) => arr.indexOf(a) === i).map((a) => (
            <option key={a} value={a}>
              {a}
            </option>
          ))}
        </select>
      </div>

      {erreur && <p style={{ color: "var(--brique)", fontSize: 12.5, marginBottom: 14 }}>{erreur}</p>}

      {chargement ? (
        <p style={{ fontSize: 12.5, color: "var(--sub)" }}>{t("loading")}</p>
      ) : planning.length === 0 ? (
        <p style={{ fontSize: 12.5, color: "var(--sub)" }}>{t("aucunEmployeActif")}</p>
      ) : (
        <div className="card" style={{ overflowX: "auto" }}>
          <table className="mono" style={{ width: "100%", borderCollapse: "collapse", fontSize: 11.5 }}>
            <thead>
              <tr>
                <th style={thStyle}>{t("demandeurLabel")}</th>
                {mois.map((m) => (
                  <th key={m} style={thStyle}>
                    {m}
                  </th>
                ))}
                <th style={thStyle}>{t("totalJoursLabel")}</th>
              </tr>
            </thead>
            <tbody>
              {planning.map((p) => (
                <tr key={p.employe_id}>
                  <td style={{ ...tdStyle, textAlign: "left", fontWeight: 700 }}>
                    {p.prenom} {p.nom}
                  </td>
                  {p.mois.map((m, mi) => (
                    <td
                      key={mi}
                      style={{ ...tdStyle, background: couleurCellule(m.jours), cursor: m.jours > 0 ? "pointer" : "default" }}
                      onMouseEnter={() => m.jours > 0 && setTooltip({ employe: `${p.prenom} ${p.nom}`, mois: mois[mi], periodes: m.periodes })}
                      onMouseLeave={() => setTooltip(null)}
                    >
                      {m.jours > 0 ? m.jours : "—"}
                    </td>
                  ))}
                  <td style={{ ...tdStyle, fontWeight: 700 }}>{p.total_jours}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {tooltip && (
        <div className="card" style={{ marginTop: 12, maxWidth: 360 }}>
          <div style={{ fontWeight: 700, fontSize: 12.5, marginBottom: 6 }}>
            {tooltip.employe} — {tooltip.mois}
          </div>
          {tooltip.periodes.map((per, i) => (
            <div key={i} style={{ fontSize: 11.5, color: "var(--sub)" }}>
              {per.debut} → {per.fin} ({per.nb_jours} j){per.motif ? ` — ${per.motif}` : ""}
            </div>
          ))}
        </div>
      )}
    </AppShell>
  );
}

const thStyle = { padding: "6px 8px", textAlign: "center", color: "var(--sub)", fontWeight: 600, borderBottom: "1px solid var(--line)" };
const tdStyle = { padding: "6px 8px", textAlign: "center", borderBottom: "1px solid var(--line)" };
const inputStyle = {
  padding: "8px 10px",
  border: "1px solid var(--line)",
  borderRadius: 8,
  fontSize: 13,
  fontFamily: "inherit",
};
