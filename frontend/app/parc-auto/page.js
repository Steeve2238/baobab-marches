"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { api } from "../../lib/api";
import { useLangue } from "../../lib/i18n/LanguageContext";
import AppShell from "../../lib/components/AppShell";

export default function ParcAutoPage() {
  const { t, statutVehiculeLabel, alerteTypeLabel, alerteSeveriteLabel } = useLangue();
  const [vehicules, setVehicules] = useState([]);
  const [alertes, setAlertes] = useState([]);
  const [erreur, setErreur] = useState("");
  const [form, setForm] = useState({
    immatriculation: "",
    marque_modele: "",
    affectation_service: "",
  });

  useEffect(() => {
    api.getVehicules().then(setVehicules).catch((err) => setErreur(err.message));
    api.getAlertesParcAuto().then(setAlertes).catch(() => {});
  }, []);

  const alertesParVehicule = alertes.reduce((acc, a) => {
    acc[a.vehicule_id] = (acc[a.vehicule_id] || 0) + 1;
    return acc;
  }, {});

  async function handleAjouter(e) {
    e.preventDefault();
    try {
      const nouveau = await api.createVehicule(form);
      setVehicules((prev) => [...prev, nouveau].sort((a, b) => a.immatriculation.localeCompare(b.immatriculation)));
      setForm({ immatriculation: "", marque_modele: "", affectation_service: "" });
    } catch (err) {
      setErreur(err.message);
    }
  }

  async function handleBasculerStatut(vehicule) {
    const nouveauStatut = vehicule.statut === "HORS_SERVICE" ? "DISPONIBLE" : "HORS_SERVICE";
    try {
      const maj = await api.patchVehicule(vehicule.id, { statut: nouveauStatut });
      setVehicules((prev) => prev.map((v) => (v.id === vehicule.id ? maj : v)));
    } catch (err) {
      setErreur(err.message);
    }
  }

  function chipClasse(statut) {
    if (statut === "DISPONIBLE") return "chip ok";
    if (statut === "EN_SORTIE") return "chip warn";
    if (statut === "EN_ENTRETIEN") return "chip warn";
    return "chip risk";
  }

  return (
    <AppShell title={t("parcAutoPageTitle")}>
      <p style={{ fontSize: 12.5, color: "var(--sub)", marginTop: -6, marginBottom: 16 }}>
        {t("parcAutoPageSubtitle")}
      </p>

      {erreur && <p style={{ color: "var(--brique)", fontSize: 12.5, marginBottom: 14 }}>{erreur}</p>}

      <div style={{ marginBottom: 16, display: "flex", gap: 10 }}>
        <Link href="/parc-auto/sorties" className="card" style={{ display: "inline-block", padding: "8px 16px", fontSize: 12.5, fontWeight: 600, color: "var(--petrol)" }}>
          {t("sortiesPageTitle")} →
        </Link>
        <Link href="/parc-auto/entretiens" className="card" style={{ display: "inline-block", padding: "8px 16px", fontSize: 12.5, fontWeight: 600, color: "var(--petrol)" }}>
          {t("entretiensPageTitle")} →
        </Link>
        <Link href="/parc-auto/statistiques" className="card" style={{ display: "inline-block", padding: "8px 16px", fontSize: 12.5, fontWeight: 600, color: "var(--petrol)" }}>
          {t("statistiquesLinkLabel")} →
        </Link>
      </div>

      <h2 style={{ fontSize: 13.5, color: "var(--petrol)", marginBottom: 10, fontWeight: 700 }}>
        {t("alertesSection")}
      </h2>
      {alertes.length === 0 ? (
        <p style={{ fontSize: 12.5, color: "var(--sub)", marginBottom: 16 }}>{t("noAlertes")}</p>
      ) : (
        <div style={{ display: "grid", gap: 6, marginBottom: 20 }}>
          {alertes.map((a, i) => (
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

      <form onSubmit={handleAjouter} className="card" style={{ marginBottom: 16, maxWidth: 480 }}>
        <label style={labelStyle}>{t("immatriculationLabel")}</label>
        <input
          required
          value={form.immatriculation}
          onChange={(e) => setForm((f) => ({ ...f, immatriculation: e.target.value }))}
          style={inputStyle}
        />
        <label style={{ ...labelStyle, marginTop: 10 }}>{t("marqueModeleLabel")}</label>
        <input
          value={form.marque_modele}
          onChange={(e) => setForm((f) => ({ ...f, marque_modele: e.target.value }))}
          style={inputStyle}
        />
        <label style={{ ...labelStyle, marginTop: 10 }}>{t("affectationServiceLabel")}</label>
        <input
          value={form.affectation_service}
          onChange={(e) => setForm((f) => ({ ...f, affectation_service: e.target.value }))}
          style={inputStyle}
        />
        <button type="submit" style={{ ...boutonPrincipalStyle, marginTop: 12 }}>
          {t("newVehicule")}
        </button>
      </form>

      {vehicules.length === 0 ? (
        <p style={{ fontSize: 12.5, color: "var(--sub)" }}>{t("noVehicules")}</p>
      ) : (
        <div style={{ display: "grid", gap: 8 }}>
          {vehicules.map((v) => (
            <div
              key={v.id}
              className="card"
              style={{ display: "grid", gridTemplateColumns: "1.6fr 1fr 1fr auto auto", gap: 12, alignItems: "center" }}
            >
              <div>
                <div style={{ fontWeight: 700, fontSize: 13.5 }}>{v.immatriculation}</div>
                <div style={{ fontSize: 11.5, color: "var(--sub)" }}>{v.marque_modele || "—"}</div>
              </div>
              <div style={{ fontSize: 12, color: "var(--sub)" }}>{v.affectation_service || "—"}</div>
              <div>
                <div style={{ fontSize: 9.5, color: "var(--sub)", textTransform: "uppercase" }}>
                  {t("kilometrageActuelLabel")}
                </div>
                <div className="mono" style={{ fontSize: 13 }}>
                  {v.kilometrage_actuel != null ? Number(v.kilometrage_actuel).toLocaleString() : "—"}
                </div>
              </div>
              <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                <span className={chipClasse(v.statut)}>{statutVehiculeLabel(v.statut)}</span>
                {alertesParVehicule[v.id] > 0 && (
                  <span className="chip risk" title={t("alertesSection")}>
                    {alertesParVehicule[v.id]}
                  </span>
                )}
              </div>
              <div style={{ display: "flex", gap: 6 }}>
                <Link href={`/parc-auto/vehicules/${v.id}`} style={boutonMiniStyle}>
                  {t("viewDetail")}
                </Link>
                {(v.statut === "DISPONIBLE" || v.statut === "HORS_SERVICE") && (
                  <button onClick={() => handleBasculerStatut(v)} style={boutonMiniStyle}>
                    {v.statut === "HORS_SERVICE" ? t("markAvailable") : t("markOutOfService")}
                  </button>
                )}
              </div>
            </div>
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
const boutonMiniStyle = {
  background: "transparent",
  color: "var(--petrol)",
  border: "1px solid var(--petrol)",
  borderRadius: 6,
  padding: "4px 10px",
  fontSize: 11,
  fontWeight: 600,
  cursor: "pointer",
  textDecoration: "none",
  whiteSpace: "nowrap",
};
