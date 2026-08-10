"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { api } from "../../../../lib/api";
import { useLangue } from "../../../../lib/i18n/LanguageContext";
import AppShell from "../../../../lib/components/AppShell";

export default function VehiculeDetailPage() {
  const { id } = useParams();
  const { t, statutVehiculeLabel, statutSortieLabel, dict } = useLangue();
  const [vehicule, setVehicule] = useState(null);
  const [erreur, setErreur] = useState("");

  useEffect(() => {
    api.getVehicule(id).then(setVehicule).catch((err) => setErreur(err.message));
  }, [id]);

  function chipClasse(statut) {
    if (statut === "DISPONIBLE") return "chip ok";
    if (statut === "EN_SORTIE") return "chip warn";
    if (statut === "EN_ENTRETIEN") return "chip warn";
    return "chip risk";
  }

  if (erreur) {
    return (
      <AppShell title={t("vehiculeDetailTitle")}>
        <p style={{ color: "var(--brique)", fontSize: 12.5 }}>{erreur}</p>
      </AppShell>
    );
  }

  if (!vehicule) {
    return (
      <AppShell title={t("vehiculeDetailTitle")}>
        <p style={{ fontSize: 12.5, color: "var(--sub)" }}>{t("loading")}</p>
      </AppShell>
    );
  }

  return (
    <AppShell title={vehicule.immatriculation}>
      <Link href="/parc-auto" style={{ fontSize: 12, color: "var(--petrol)", display: "inline-block", marginBottom: 12 }}>
        {t("backToVehicules")}
      </Link>

      <div className="card" style={{ marginBottom: 20, display: "grid", gridTemplateColumns: "1fr 1fr 1fr auto", gap: 16, alignItems: "center" }}>
        <div>
          <div style={{ fontSize: 9.5, color: "var(--sub)", textTransform: "uppercase" }}>{t("marqueModeleLabel")}</div>
          <div style={{ fontSize: 13.5, fontWeight: 600 }}>{vehicule.marque_modele || "—"}</div>
        </div>
        <div>
          <div style={{ fontSize: 9.5, color: "var(--sub)", textTransform: "uppercase" }}>{t("affectationServiceLabel")}</div>
          <div style={{ fontSize: 13.5 }}>{vehicule.affectation_service || "—"}</div>
        </div>
        <div>
          <div style={{ fontSize: 9.5, color: "var(--sub)", textTransform: "uppercase" }}>{t("kilometrageActuelLabel")}</div>
          <div className="mono" style={{ fontSize: 14, fontWeight: 700 }}>
            {vehicule.kilometrage_actuel != null ? Number(vehicule.kilometrage_actuel).toLocaleString() : "—"}
          </div>
        </div>
        <span className={chipClasse(vehicule.statut)}>{statutVehiculeLabel(vehicule.statut)}</span>
      </div>

      <h2 style={{ fontSize: 13.5, color: "var(--petrol)", marginBottom: 10, fontWeight: 700 }}>
        {t("tripsHistorySection")}
      </h2>

      {vehicule.sorties.length === 0 ? (
        <p style={{ fontSize: 12.5, color: "var(--sub)" }}>{t("noTripsForVehicule")}</p>
      ) : (
        <div style={{ display: "grid", gap: 8 }}>
          {vehicule.sorties.map((s) => (
            <Link
              key={s.id}
              href={`/parc-auto/sorties/${s.id}`}
              className="card"
              style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr auto", gap: 12, alignItems: "center", textDecoration: "none", color: "inherit" }}
            >
              <div>
                <div style={{ fontWeight: 600, fontSize: 13 }}>{s.destination || "—"}</div>
                <div style={{ fontSize: 11, color: "var(--sub)" }}>{s.localite_depart || "—"}</div>
              </div>
              <div style={{ fontSize: 12, color: "var(--sub)" }}>
                {new Date(s.date_depart).toLocaleDateString(dict.dateLocale)}
              </div>
              <div className="mono" style={{ fontSize: 12 }}>
                {s.distance_parcourue != null ? `${Number(s.distance_parcourue).toLocaleString()} km` : "—"}
              </div>
              <span className={s.statut === "CLOTUREE" ? "chip ok" : "chip warn"}>{statutSortieLabel(s.statut)}</span>
            </Link>
          ))}
        </div>
      )}
    </AppShell>
  );
}
