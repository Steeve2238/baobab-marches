"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { api } from "../../../../lib/api";
import { useLangue } from "../../../../lib/i18n/LanguageContext";
import AppShell from "../../../../lib/components/AppShell";

export default function VehiculeDetailPage() {
  const { id } = useParams();
  const { t, statutVehiculeLabel, statutSortieLabel, statutEntretienLabel, typeEntretienLabel, dict } = useLangue();
  const [vehicule, setVehicule] = useState(null);
  const [erreur, setErreur] = useState("");
  const [messageEcheances, setMessageEcheances] = useState("");
  const [formEcheances, setFormEcheances] = useState({
    date_expiration_assurance: "",
    date_expiration_visite_technique: "",
  });

  useEffect(() => {
    api.getVehicule(id).then((v) => {
      setVehicule(v);
      setFormEcheances({
        date_expiration_assurance: v.date_expiration_assurance ? v.date_expiration_assurance.slice(0, 10) : "",
        date_expiration_visite_technique: v.date_expiration_visite_technique
          ? v.date_expiration_visite_technique.slice(0, 10)
          : "",
      });
    }).catch((err) => setErreur(err.message));
  }, [id]);

  async function handleSaveEcheances(e) {
    e.preventDefault();
    setMessageEcheances("");
    try {
      const maj = await api.patchVehicule(id, {
        date_expiration_assurance: formEcheances.date_expiration_assurance || null,
        date_expiration_visite_technique: formEcheances.date_expiration_visite_technique || null,
      });
      setVehicule((prev) => ({ ...prev, ...maj }));
      setMessageEcheances(t("echeancesUpdated"));
    } catch (err) {
      setErreur(err.message);
    }
  }

  function chipClasseEntretien(statut) {
    if (statut === "TERMINE") return "chip ok";
    if (statut === "EN_COURS") return "chip warn";
    return "chip";
  }

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
        {t("echeancesSection")}
      </h2>
      <form onSubmit={handleSaveEcheances} className="card" style={{ marginBottom: 20, maxWidth: 480 }}>
        {messageEcheances && (
          <p style={{ fontSize: 12, color: "var(--petrol)", marginBottom: 8 }}>{messageEcheances}</p>
        )}
        <label style={labelStyle}>{t("dateExpirationAssuranceLabel")}</label>
        <input
          type="date"
          value={formEcheances.date_expiration_assurance}
          onChange={(e) => setFormEcheances((f) => ({ ...f, date_expiration_assurance: e.target.value }))}
          style={inputStyle}
        />
        <label style={{ ...labelStyle, marginTop: 10 }}>{t("dateExpirationVisiteTechniqueLabel")}</label>
        <input
          type="date"
          value={formEcheances.date_expiration_visite_technique}
          onChange={(e) => setFormEcheances((f) => ({ ...f, date_expiration_visite_technique: e.target.value }))}
          style={inputStyle}
        />
        <button type="submit" style={{ ...boutonPrincipalStyle, marginTop: 12 }}>
          {t("saveEcheancesButton")}
        </button>
      </form>

      <h2 style={{ fontSize: 13.5, color: "var(--petrol)", marginBottom: 10, fontWeight: 700 }}>
        {t("entretiensHistorySection")}
      </h2>

      {vehicule.entretiens.length === 0 ? (
        <p style={{ fontSize: 12.5, color: "var(--sub)", marginBottom: 20 }}>{t("noEntretiensForVehicule")}</p>
      ) : (
        <div style={{ display: "grid", gap: 8, marginBottom: 20 }}>
          {vehicule.entretiens.map((entr) => (
            <Link
              key={entr.id}
              href={`/parc-auto/entretiens/${entr.id}`}
              className="card"
              style={{ display: "grid", gridTemplateColumns: "1fr 1fr auto", gap: 12, alignItems: "center", textDecoration: "none", color: "inherit" }}
            >
              <div>
                <div style={{ fontWeight: 600, fontSize: 13 }}>{typeEntretienLabel(entr.type_entretien)}</div>
                <div style={{ fontSize: 11, color: "var(--sub)" }}>{entr.prestataire || "—"}</div>
              </div>
              <div style={{ fontSize: 12, color: "var(--sub)" }}>
                {new Date(entr.date_entretien).toLocaleDateString(dict.dateLocale)}
              </div>
              <span className={chipClasseEntretien(entr.statut)}>{statutEntretienLabel(entr.statut)}</span>
            </Link>
          ))}
        </div>
      )}

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

const labelStyle = { fontSize: 11.5, fontWeight: 600, display: "block", marginBottom: 5 };
const inputStyle = {
  width: "100%",
  padding: "8px 10px",
  border: "1px solid var(--line)",
  borderRadius: 8,
  fontSize: 13,
  fontFamily: "inherit",
};
const boutonPrincipalStyle = {
  background: "var(--petrol)",
  color: "#fff",
  border: "none",
  borderRadius: 8,
  padding: "8px 16px",
  fontSize: 12.5,
  fontWeight: 600,
};
