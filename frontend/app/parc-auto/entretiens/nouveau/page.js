"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "../../../../lib/api";
import { useLangue } from "../../../../lib/i18n/LanguageContext";
import AppShell from "../../../../lib/components/AppShell";

const TYPES_ENTRETIEN = ["VIDANGE", "REVISION", "PNEUS", "FREINS", "REPARATION", "CARROSSERIE", "AUTRE"];
const STATUTS_ENTRETIEN = ["PLANIFIE", "EN_COURS", "TERMINE"];

export default function NouvelEntretienPage() {
  const router = useRouter();
  const { t, typeEntretienLabel, statutEntretienLabel } = useLangue();
  const [vehicules, setVehicules] = useState([]);
  const [erreur, setErreur] = useState("");
  const [enCours, setEnCours] = useState(false);
  const [form, setForm] = useState({
    vehicule_id: "",
    type_entretien: "",
    date_entretien: "",
    kilometrage: "",
    prestataire: "",
    description: "",
    pieces_changees: "",
    cout: "",
    prochain_entretien_date: "",
    prochain_entretien_km: "",
    statut: "PLANIFIE",
  });

  useEffect(() => {
    api.getVehicules().then(setVehicules).catch((err) => setErreur(err.message));
  }, []);

  async function handleCreer(e) {
    e.preventDefault();
    setEnCours(true);
    try {
      const nouveau = await api.createEntretien({
        ...form,
        kilometrage: form.kilometrage ? Number(form.kilometrage) : null,
        cout: form.cout ? Number(form.cout) : null,
        prochain_entretien_km: form.prochain_entretien_km ? Number(form.prochain_entretien_km) : null,
      });
      router.push(`/parc-auto/entretiens/${nouveau.id}`);
    } catch (err) {
      setErreur(err.message);
      setEnCours(false);
    }
  }

  return (
    <AppShell title={t("entretienNewPageTitle")}>
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
          {vehicules.map((v) => (
            <option key={v.id} value={v.id}>
              {v.immatriculation} {v.marque_modele ? `— ${v.marque_modele}` : ""}
            </option>
          ))}
        </select>

        <label style={{ ...labelStyle, marginTop: 10 }}>{t("typeEntretienLabel")}</label>
        <select
          required
          value={form.type_entretien}
          onChange={(e) => setForm((f) => ({ ...f, type_entretien: e.target.value }))}
          style={inputStyle}
        >
          <option value="">{t("selectTypeEntretien")}</option>
          {TYPES_ENTRETIEN.map((ty) => (
            <option key={ty} value={ty}>
              {typeEntretienLabel(ty)}
            </option>
          ))}
        </select>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginTop: 10 }}>
          <div>
            <label style={labelStyle}>{t("dateEntretienLabel")}</label>
            <input
              type="date"
              value={form.date_entretien}
              onChange={(e) => setForm((f) => ({ ...f, date_entretien: e.target.value }))}
              style={inputStyle}
            />
          </div>
          <div>
            <label style={labelStyle}>{t("kilometrageLabel")}</label>
            <input
              type="number"
              step="0.1"
              value={form.kilometrage}
              onChange={(e) => setForm((f) => ({ ...f, kilometrage: e.target.value }))}
              style={inputStyle}
            />
          </div>
        </div>

        <label style={{ ...labelStyle, marginTop: 10 }}>{t("prestataireLabel")}</label>
        <input
          value={form.prestataire}
          onChange={(e) => setForm((f) => ({ ...f, prestataire: e.target.value }))}
          style={inputStyle}
        />

        <label style={{ ...labelStyle, marginTop: 10 }}>{t("descriptionLabel")}</label>
        <input
          value={form.description}
          onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
          style={inputStyle}
        />

        <label style={{ ...labelStyle, marginTop: 10 }}>{t("piecesChangeesLabel")}</label>
        <input
          value={form.pieces_changees}
          onChange={(e) => setForm((f) => ({ ...f, pieces_changees: e.target.value }))}
          style={inputStyle}
        />

        <label style={{ ...labelStyle, marginTop: 10 }}>{t("coutLabel")}</label>
        <input
          type="number"
          step="0.01"
          value={form.cout}
          onChange={(e) => setForm((f) => ({ ...f, cout: e.target.value }))}
          style={inputStyle}
        />

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginTop: 10 }}>
          <div>
            <label style={labelStyle}>{t("prochainEntretienDateLabel")}</label>
            <input
              type="date"
              value={form.prochain_entretien_date}
              onChange={(e) => setForm((f) => ({ ...f, prochain_entretien_date: e.target.value }))}
              style={inputStyle}
            />
          </div>
          <div>
            <label style={labelStyle}>{t("prochainEntretienKmLabel")}</label>
            <input
              type="number"
              step="0.1"
              value={form.prochain_entretien_km}
              onChange={(e) => setForm((f) => ({ ...f, prochain_entretien_km: e.target.value }))}
              style={inputStyle}
            />
          </div>
        </div>

        <label style={{ ...labelStyle, marginTop: 10 }}>{t("statutEntretienLabel")}</label>
        <select
          value={form.statut}
          onChange={(e) => setForm((f) => ({ ...f, statut: e.target.value }))}
          style={inputStyle}
        >
          {STATUTS_ENTRETIEN.map((s) => (
            <option key={s} value={s}>
              {statutEntretienLabel(s)}
            </option>
          ))}
        </select>

        <button type="submit" disabled={enCours} style={{ ...boutonPrincipalStyle, marginTop: 14, width: "100%" }}>
          {t("createEntretienButton")}
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
