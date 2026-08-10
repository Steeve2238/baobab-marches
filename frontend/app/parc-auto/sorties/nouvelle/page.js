"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "../../../../lib/api";
import { useLangue } from "../../../../lib/i18n/LanguageContext";
import AppShell from "../../../../lib/components/AppShell";

const NIVEAUX_CARBURANT = ["PLEIN", "TROIS_QUARTS", "DEMI", "QUART", "RESERVE"];

export default function NouvelleSortiePage() {
  const router = useRouter();
  const { t, niveauCarburantLabel } = useLangue();
  const [vehicules, setVehicules] = useState([]);
  const [dossiers, setDossiers] = useState([]);
  const [erreur, setErreur] = useState("");
  const [enCours, setEnCours] = useState(false);
  const [form, setForm] = useState({
    vehicule_id: "",
    dossier_ao_id: "",
    chauffeur_nom: "",
    chef_mission_nom: "",
    passagers: "",
    localite_depart: "",
    destination: "",
    itineraire: "",
    kilometrage_depart: "",
    niveau_carburant_depart: "",
  });

  useEffect(() => {
    api.getVehicules().then(setVehicules).catch((err) => setErreur(err.message));
    api.getDossiers().then(setDossiers).catch((err) => setErreur(err.message));
  }, []);

  const vehiculesDisponibles = vehicules.filter((v) => v.statut === "DISPONIBLE");

  async function handleCreer(e) {
    e.preventDefault();
    setEnCours(true);
    try {
      const nouvelle = await api.createSortie({
        ...form,
        dossier_ao_id: form.dossier_ao_id || null,
        kilometrage_depart: Number(form.kilometrage_depart),
      });
      router.push(`/parc-auto/sorties/${nouvelle.id}`);
    } catch (err) {
      setErreur(err.message);
      setEnCours(false);
    }
  }

  return (
    <AppShell title={t("sortieNewPageTitle")}>
      {erreur && <p style={{ color: "var(--brique)", fontSize: 12.5, marginBottom: 14 }}>{erreur}</p>}

      <form onSubmit={handleCreer} className="card" style={{ maxWidth: 560 }}>
        <label style={labelStyle}>{t("vehiculeLabel")}</label>
        <select
          required
          value={form.vehicule_id}
          onChange={(e) => setForm((f) => ({ ...f, vehicule_id: e.target.value }))}
          style={inputStyle}
        >
          <option value="">{t("selectVehicule")}</option>
          {vehiculesDisponibles.map((v) => (
            <option key={v.id} value={v.id}>
              {v.immatriculation} {v.marque_modele ? `— ${v.marque_modele}` : ""}
            </option>
          ))}
        </select>
        {vehiculesDisponibles.length === 0 && (
          <p style={{ fontSize: 11.5, color: "var(--brique)", marginTop: 4 }}>{t("noVehiculeDisponible")}</p>
        )}

        <label style={{ ...labelStyle, marginTop: 10 }}>{t("dossierLieLabel")}</label>
        <select
          value={form.dossier_ao_id}
          onChange={(e) => setForm((f) => ({ ...f, dossier_ao_id: e.target.value }))}
          style={inputStyle}
        >
          <option value="">{t("selectDossier")}</option>
          {dossiers.map((d) => (
            <option key={d.id} value={d.id}>
              {d.reference_externe || d.intitule}
            </option>
          ))}
        </select>

        <label style={{ ...labelStyle, marginTop: 10 }}>{t("chauffeurLabel")}</label>
        <input
          value={form.chauffeur_nom}
          onChange={(e) => setForm((f) => ({ ...f, chauffeur_nom: e.target.value }))}
          style={inputStyle}
        />

        <label style={{ ...labelStyle, marginTop: 10 }}>{t("chefMissionLabel")}</label>
        <input
          value={form.chef_mission_nom}
          onChange={(e) => setForm((f) => ({ ...f, chef_mission_nom: e.target.value }))}
          style={inputStyle}
        />

        <label style={{ ...labelStyle, marginTop: 10 }}>{t("passagersLabel")}</label>
        <input
          value={form.passagers}
          onChange={(e) => setForm((f) => ({ ...f, passagers: e.target.value }))}
          style={inputStyle}
        />

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginTop: 10 }}>
          <div>
            <label style={labelStyle}>{t("localiteDepartLabel")}</label>
            <input
              value={form.localite_depart}
              onChange={(e) => setForm((f) => ({ ...f, localite_depart: e.target.value }))}
              style={inputStyle}
            />
          </div>
          <div>
            <label style={labelStyle}>{t("destinationLabel")}</label>
            <input
              value={form.destination}
              onChange={(e) => setForm((f) => ({ ...f, destination: e.target.value }))}
              style={inputStyle}
            />
          </div>
        </div>

        <label style={{ ...labelStyle, marginTop: 10 }}>{t("itineraireLabel")}</label>
        <input
          value={form.itineraire}
          onChange={(e) => setForm((f) => ({ ...f, itineraire: e.target.value }))}
          style={inputStyle}
        />

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginTop: 10 }}>
          <div>
            <label style={labelStyle}>{t("kilometrageDepartLabel")}</label>
            <input
              required
              type="number"
              step="0.1"
              value={form.kilometrage_depart}
              onChange={(e) => setForm((f) => ({ ...f, kilometrage_depart: e.target.value }))}
              style={inputStyle}
            />
          </div>
          <div>
            <label style={labelStyle}>{t("niveauCarburantDepartLabel")}</label>
            <select
              value={form.niveau_carburant_depart}
              onChange={(e) => setForm((f) => ({ ...f, niveau_carburant_depart: e.target.value }))}
              style={inputStyle}
            >
              <option value="">{t("selectNiveauCarburant")}</option>
              {NIVEAUX_CARBURANT.map((n) => (
                <option key={n} value={n}>
                  {niveauCarburantLabel(n)}
                </option>
              ))}
            </select>
          </div>
        </div>

        <button type="submit" disabled={enCours} style={{ ...boutonPrincipalStyle, marginTop: 14, width: "100%" }}>
          {t("createSortieButton")}
        </button>
      </form>
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
