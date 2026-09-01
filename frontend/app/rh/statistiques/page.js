"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { api } from "../../../lib/api";
import { useLangue } from "../../../lib/i18n/LanguageContext";
import AppShell from "../../../lib/components/AppShell";

export default function StatistiquesRHPage() {
  const { t, typeDemandeRHLabel } = useLangue();
  const [periode, setPeriode] = useState("mensuel");
  const [mois, setMois] = useState(new Date().toISOString().slice(0, 7));
  const [stats, setStats] = useState(null);
  const [erreur, setErreur] = useState("");
  const [chargement, setChargement] = useState(true);

  useEffect(() => {
    setChargement(true);
    api
      .getStatistiquesRH(periode, mois)
      .then(setStats)
      .catch((err) => setErreur(err.message))
      .finally(() => setChargement(false));
  }, [periode, mois]);

  return (
    <AppShell title={t("statistiquesRHPageTitle")}>
      <Link href="/rh/personnel" style={{ fontSize: 12, color: "var(--petrol)", display: "inline-block", marginBottom: 12 }}>
        {t("backToPersonnel")}
      </Link>

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
        <p style={{ fontSize: 12.5, color: "var(--sub)" }}>{t("statistiquesRHPageSubtitle")}</p>
        <div style={{ display: "flex", gap: 8 }}>
          <select value={periode} onChange={(e) => setPeriode(e.target.value)} style={inputStyle}>
            <option value="mensuel">{t("mensuelLabel")}</option>
            <option value="annuel">{t("annuelLabel")}</option>
          </select>
          {periode === "mensuel" && (
            <input type="month" value={mois} onChange={(e) => setMois(e.target.value)} style={inputStyle} />
          )}
        </div>
      </div>

      {erreur && <p style={{ color: "var(--brique)", fontSize: 12.5, marginBottom: 14 }}>{erreur}</p>}

      {chargement ? (
        <p style={{ fontSize: 12.5, color: "var(--sub)" }}>{t("loading")}</p>
      ) : (
        <>
          {stats.absences_en_cours.length > 0 && (
            <div className="card" style={{ marginBottom: 16, borderLeft: "3px solid var(--ocre)" }}>
              <h2 style={{ fontSize: 13, fontWeight: 700, marginBottom: 8 }}>{t("absencesEnCoursSection")}</h2>
              <div style={{ display: "grid", gap: 4 }}>
                {stats.absences_en_cours.map((a) => (
                  <div key={a.id} style={{ fontSize: 12.5 }}>
                    {a.prenom} {a.nom} — {t("jusquAuLabel")} {a.date_fin}
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="card" style={{ marginBottom: 16, overflowX: "auto" }}>
            <h2 style={{ fontSize: 13, fontWeight: 700, marginBottom: 8 }}>{t("recapEmployeSection")}</h2>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5 }}>
              <thead>
                <tr>
                  <th style={thStyle}>{t("demandeurLabel")}</th>
                  <th style={thStyle}>{t("joursPrisLabel")}</th>
                  <th style={thStyle}>{t("nbAbsencesLabel")}</th>
                  <th style={thStyle}>{t("soldeCongesLabel")}</th>
                </tr>
              </thead>
              <tbody>
                {stats.stats_employes.length === 0 ? (
                  <tr>
                    <td colSpan={4} style={{ ...tdStyle, textAlign: "center", color: "var(--sub)" }}>
                      {t("aucunEmployeActif")}
                    </td>
                  </tr>
                ) : (
                  stats.stats_employes.map((e) => (
                    <tr key={e.id}>
                      <td style={{ ...tdStyle, textAlign: "left", fontWeight: 600 }}>
                        {e.prenom} {e.nom}
                      </td>
                      <td style={tdStyle} className="mono">{e.jours_pris_periode}</td>
                      <td style={tdStyle} className="mono">{e.nb_absences}</td>
                      <td style={tdStyle} className="mono">{Number(e.solde_conges)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          <div className="card">
            <h2 style={{ fontSize: 13, fontWeight: 700, marginBottom: 8 }}>{t("demandesParTypeSection")}</h2>
            {stats.stats_par_type.length === 0 ? (
              <p style={{ fontSize: 12.5, color: "var(--sub)" }}>{t("noMesDemandes")}</p>
            ) : (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 10 }}>
                {stats.stats_par_type.map((s) => (
                  <div key={s.type_demande} style={{ textAlign: "center" }}>
                    <div className="mono" style={{ fontSize: 20, fontWeight: 700 }}>
                      {s.total}
                    </div>
                    <div style={{ fontSize: 11, color: "var(--sub)" }}>{typeDemandeRHLabel(s.type_demande)}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
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
