"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { api } from "../../../lib/api";
import { useLangue } from "../../../lib/i18n/LanguageContext";
import AppShell from "../../../lib/components/AppShell";

export default function StatistiquesParcAutoPage() {
  const { t, statutVehiculeLabel, alerteTypeLabel, alerteSeveriteLabel } = useLangue();
  const [stats, setStats] = useState(null);
  const [erreur, setErreur] = useState("");

  useEffect(() => {
    api.getStatistiquesParcAuto().then(setStats).catch((err) => setErreur(err.message));
  }, []);

  if (erreur) {
    return (
      <AppShell title={t("statistiquesPageTitle")}>
        <p style={{ color: "var(--brique)", fontSize: 12.5 }}>{erreur}</p>
      </AppShell>
    );
  }

  if (!stats) {
    return (
      <AppShell title={t("statistiquesPageTitle")}>
        <p style={{ fontSize: 12.5, color: "var(--sub)" }}>{t("loading")}</p>
      </AppShell>
    );
  }

  const statutsOrdre = ["DISPONIBLE", "EN_SORTIE", "EN_ENTRETIEN", "HORS_SERVICE"];

  return (
    <AppShell title={t("statistiquesPageTitle")}>
      <Link href="/parc-auto" style={{ fontSize: 12, color: "var(--petrol)", display: "inline-block", marginBottom: 12 }}>
        {t("backToParcAuto")}
      </Link>

      <h2 style={{ fontSize: 13.5, color: "var(--petrol)", marginBottom: 10, fontWeight: 700 }}>
        {t("vehiculesParStatutSection")}
      </h2>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 10, marginBottom: 20 }}>
        {statutsOrdre.map((statut) => (
          <div key={statut} className="card" style={{ textAlign: "center" }}>
            <div className="mono" style={{ fontSize: 22, fontWeight: 700 }}>
              {stats.vehicules_par_statut[statut] || 0}
            </div>
            <div style={{ fontSize: 11, color: "var(--sub)", marginTop: 4 }}>{statutVehiculeLabel(statut)}</div>
          </div>
        ))}
      </div>

      <h2 style={{ fontSize: 13.5, color: "var(--petrol)", marginBottom: 10, fontWeight: 700 }}>
        {t("kilometrageMoisSection")}
      </h2>
      <div className="card" style={{ marginBottom: 20, maxWidth: 260 }}>
        <div className="mono" style={{ fontSize: 22, fontWeight: 700 }}>
          {Number(stats.kilometrage_mois_courant).toLocaleString()} km
        </div>
      </div>

      <h2 style={{ fontSize: 13.5, color: "var(--petrol)", marginBottom: 10, fontWeight: 700 }}>
        {t("alertesUrgentesSection")}
      </h2>
      {stats.alertes_urgentes.length === 0 ? (
        <p style={{ fontSize: 12.5, color: "var(--sub)", marginBottom: 20 }}>{t("noAlertes")}</p>
      ) : (
        <div style={{ display: "grid", gap: 6, marginBottom: 20 }}>
          {stats.alertes_urgentes.map((a, i) => (
            <Link
              key={i}
              href={`/parc-auto/vehicules/${a.vehicule_id}`}
              className="card"
              style={{ display: "grid", gridTemplateColumns: "auto 1fr auto", gap: 12, alignItems: "center", textDecoration: "none", color: "inherit" }}
            >
              <span className={a.severite === "DEPASSEE" ? "chip risk" : "chip warn"}>
                {alerteSeveriteLabel(a.severite)}
              </span>
              <div>
                <div style={{ fontWeight: 700, fontSize: 13 }}>{a.immatriculation}</div>
                <div style={{ fontSize: 11.5, color: "var(--sub)" }}>{alerteTypeLabel(a.type)}</div>
              </div>
              <div className="mono" style={{ fontSize: 11.5, color: "var(--sub)" }}>
                {a.jours_restants != null ? `${a.jours_restants}${t("joursRestantsSuffix")}` : ""}
                {a.marge_km != null ? `${Math.round(a.marge_km)}${t("margeKmSuffix")}` : ""}
              </div>
            </Link>
          ))}
        </div>
      )}

      <h2 style={{ fontSize: 13.5, color: "var(--petrol)", marginBottom: 10, fontWeight: 700 }}>
        {t("statsParVehiculeSection")}
      </h2>
      {stats.par_vehicule.length === 0 ? (
        <p style={{ fontSize: 12.5, color: "var(--sub)", marginBottom: 20 }}>{t("aucuneDonneeStatistique")}</p>
      ) : (
        <div style={{ display: "grid", gap: 8, marginBottom: 20 }}>
          {stats.par_vehicule.map((v) => (
            <div
              key={v.vehicule_id}
              className="card"
              style={{ display: "grid", gridTemplateColumns: "1.4fr 1fr 1fr 1fr", gap: 12, alignItems: "center" }}
            >
              <div>
                <div style={{ fontWeight: 700, fontSize: 13 }}>{v.immatriculation}</div>
                <div style={{ fontSize: 11.5, color: "var(--sub)" }}>{v.marque_modele || "—"}</div>
              </div>
              <div>
                <div style={{ fontSize: 9.5, color: "var(--sub)", textTransform: "uppercase" }}>{t("nombreSortiesLabel")}</div>
                <div className="mono" style={{ fontSize: 13 }}>{v.nombre_sorties}</div>
              </div>
              <div>
                <div style={{ fontSize: 9.5, color: "var(--sub)", textTransform: "uppercase" }}>{t("distanceTotaleLabel")}</div>
                <div className="mono" style={{ fontSize: 13 }}>{Number(v.distance_totale).toLocaleString()} km</div>
              </div>
              <div>
                <div style={{ fontSize: 9.5, color: "var(--sub)", textTransform: "uppercase" }}>{t("coutEntretienTotalLabel")}</div>
                <div className="mono" style={{ fontSize: 13 }}>{Number(v.cout_entretien_total).toLocaleString()}</div>
              </div>
            </div>
          ))}
        </div>
      )}

      <h2 style={{ fontSize: 13.5, color: "var(--petrol)", marginBottom: 10, fontWeight: 700 }}>
        {t("statsParLocaliteSection")}
      </h2>
      {stats.par_localite.length === 0 ? (
        <p style={{ fontSize: 12.5, color: "var(--sub)" }}>{t("aucuneDonneeStatistique")}</p>
      ) : (
        <div style={{ display: "grid", gap: 8 }}>
          {stats.par_localite.map((l, i) => (
            <div key={i} className="card" style={{ display: "grid", gridTemplateColumns: "1.4fr 1fr 1fr", gap: 12, alignItems: "center" }}>
              <div style={{ fontWeight: 700, fontSize: 13 }}>{l.localite_depart}</div>
              <div>
                <div style={{ fontSize: 9.5, color: "var(--sub)", textTransform: "uppercase" }}>{t("nombreSortiesLabel")}</div>
                <div className="mono" style={{ fontSize: 13 }}>{l.nombre_sorties}</div>
              </div>
              <div>
                <div style={{ fontSize: 9.5, color: "var(--sub)", textTransform: "uppercase" }}>{t("distanceTotaleLabel")}</div>
                <div className="mono" style={{ fontSize: 13 }}>{Number(l.distance_totale).toLocaleString()} km</div>
              </div>
            </div>
          ))}
        </div>
      )}
    </AppShell>
  );
}
