"use client";

import { useEffect, useState } from "react";
import { api } from "../../../../lib/api";
import { useLangue } from "../../../../lib/i18n/LanguageContext";
import AppShell from "../../../../lib/components/AppShell";
import ConsultationRestreinteSousNav from "../../../../lib/components/ConsultationRestreinteSousNav";

const DEVIS_STATUTS = ["BROUILLON", "ENVOYE", "VALIDE", "REFUSE", "EXPIRE"];
const CONSULTATION_STATUTS = ["RECUE", "DEVIS_EN_COURS", "CONVERTIE", "SANS_SUITE"];

// Pourcentage arrondi, 0 si le denominateur est nul - calcule cote client a
// partir des compteurs bruts renvoyes par GET /marches/consultation-restreinte/statistiques (evite de
// dupliquer une logique d'arrondi des deux cotes, voir routes/ventes.js).
function pourcentage(numerateur, denominateur) {
  if (!denominateur) return 0;
  return Math.round((numerateur / denominateur) * 100);
}

export default function StatistiquesVentesPage() {
  const { t } = useLangue();
  const [stats, setStats] = useState(null);
  const [erreur, setErreur] = useState("");
  const [chargement, setChargement] = useState(true);

  useEffect(() => {
    api
      .getStatistiquesVentes()
      .then(setStats)
      .catch((err) => setErreur(err.message))
      .finally(() => setChargement(false));
  }, []);

  return (
    <AppShell title={t("venteStatistiquesPageTitle")} subNav={<ConsultationRestreinteSousNav />}>
      <p style={{ fontSize: 12.5, color: "var(--sub)", marginTop: -6, marginBottom: 16 }}>
        {t("venteStatistiquesPageSubtitle")}
      </p>

      {erreur && <p style={{ color: "var(--brique)", fontSize: 12.5, marginBottom: 14 }}>{erreur}</p>}

      {chargement ? (
        <p style={{ fontSize: 12.5, color: "var(--sub)" }}>{t("loading")}</p>
      ) : (
        <div style={{ display: "grid", gap: 16 }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 14 }}>
            <div className="card" style={{ textAlign: "center" }}>
              <div className="mono" style={{ fontSize: 26, fontWeight: 700, color: "var(--petrol)" }}>
                {stats.consultations.total}
              </div>
              <div style={{ fontSize: 11.5, color: "var(--sub)", marginTop: 2 }}>{t("venteStatTotalConsultations")}</div>
            </div>
            <div className="card" style={{ textAlign: "center" }}>
              <div className="mono" style={{ fontSize: 26, fontWeight: 700, color: "var(--petrol)" }}>
                {stats.devis.total}
              </div>
              <div style={{ fontSize: 11.5, color: "var(--sub)", marginTop: 2 }}>{t("venteStatTotalDevis")}</div>
            </div>
            <div className="card" style={{ textAlign: "center" }}>
              <div className="mono" style={{ fontSize: 26, fontWeight: 700, color: "var(--petrol)" }}>
                {stats.factures.total}
              </div>
              <div style={{ fontSize: 11.5, color: "var(--sub)", marginTop: 2 }}>{t("venteStatTotalFactures")}</div>
            </div>
          </div>

          <div className="card">
            <h2 style={{ fontSize: 13, fontWeight: 700, marginBottom: 12 }}>{t("venteStatDevisParStatutSection")}</h2>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 10 }}>
              {DEVIS_STATUTS.map((statut) => (
                <div key={statut} style={{ textAlign: "center" }}>
                  <div className="mono" style={{ fontSize: 20, fontWeight: 700 }}>
                    {stats.devis.par_statut[statut]}
                  </div>
                  <div style={{ fontSize: 11, color: "var(--sub)" }}>{t(`venteDevisStatut_${statut}`)}</div>
                </div>
              ))}
            </div>
          </div>

          <div className="card">
            <h2 style={{ fontSize: 13, fontWeight: 700, marginBottom: 12 }}>{t("venteStatConsultationsParStatutSection")}</h2>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 10 }}>
              {CONSULTATION_STATUTS.map((statut) => (
                <div key={statut} style={{ textAlign: "center" }}>
                  <div className="mono" style={{ fontSize: 20, fontWeight: 700 }}>
                    {stats.consultations.par_statut[statut]}
                  </div>
                  <div style={{ fontSize: 11, color: "var(--sub)" }}>{t(`venteConsultationStatut_${statut}`)}</div>
                </div>
              ))}
            </div>
          </div>

          <div className="card">
            <h2 style={{ fontSize: 13, fontWeight: 700, marginBottom: 12 }}>{t("venteStatConversionSection")}</h2>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 16 }}>
              <div>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12.5, marginBottom: 6 }}>
                  <span>{t("venteStatTauxConsultationVersDevis")}</span>
                  <span className="mono" style={{ fontWeight: 700 }}>
                    {pourcentage(stats.consultations.par_statut.CONVERTIE, stats.consultations.total)}%
                  </span>
                </div>
                <div style={barreFondStyle}>
                  <div style={{ ...barreRemplieStyle, width: `${pourcentage(stats.consultations.par_statut.CONVERTIE, stats.consultations.total)}%` }} />
                </div>
                <div style={{ fontSize: 11, color: "var(--sub)", marginTop: 4 }}>
                  {stats.consultations.par_statut.CONVERTIE} / {stats.consultations.total}
                </div>
              </div>
              <div>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12.5, marginBottom: 6 }}>
                  <span>{t("venteStatTauxDevisVersFacture")}</span>
                  <span className="mono" style={{ fontWeight: 700 }}>
                    {pourcentage(stats.devis.convertis_en_facture, stats.devis.total)}%
                  </span>
                </div>
                <div style={barreFondStyle}>
                  <div style={{ ...barreRemplieStyle, width: `${pourcentage(stats.devis.convertis_en_facture, stats.devis.total)}%` }} />
                </div>
                <div style={{ fontSize: 11, color: "var(--sub)", marginTop: 4 }}>
                  {stats.devis.convertis_en_facture} / {stats.devis.total}
                </div>
              </div>
            </div>
          </div>

          <div className="card">
            <h2 style={{ fontSize: 13, fontWeight: 700, marginBottom: 12 }}>{t("venteStatChiffreAffairesSection")}</h2>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 14 }}>
              <div style={{ textAlign: "center" }}>
                <div className="mono" style={{ fontSize: 18, fontWeight: 700, color: "var(--petrol)" }}>
                  {Number(stats.factures.total_ttc_facture).toLocaleString()} XOF
                </div>
                <div style={{ fontSize: 11, color: "var(--sub)" }}>{t("venteStatCaFacture")}</div>
              </div>
              <div style={{ textAlign: "center" }}>
                <div className="mono" style={{ fontSize: 18, fontWeight: 700, color: "#2E7D5B" }}>
                  {Number(stats.factures.total_ttc_paye).toLocaleString()} XOF
                </div>
                <div style={{ fontSize: 11, color: "var(--sub)" }}>{t("venteStatCaPaye")}</div>
              </div>
              <div style={{ textAlign: "center" }}>
                <div className="mono" style={{ fontSize: 18, fontWeight: 700, color: "var(--brique)" }}>
                  {Number(stats.factures.total_ttc_impaye).toLocaleString()} XOF
                </div>
                <div style={{ fontSize: 11, color: "var(--sub)" }}>{t("venteStatCaImpaye")}</div>
              </div>
            </div>
          </div>
        </div>
      )}
    </AppShell>
  );
}

const barreFondStyle = { width: "100%", height: 8, borderRadius: 4, background: "rgba(91,106,108,0.12)", overflow: "hidden" };
const barreRemplieStyle = { height: "100%", background: "var(--petrol)", borderRadius: 4 };
