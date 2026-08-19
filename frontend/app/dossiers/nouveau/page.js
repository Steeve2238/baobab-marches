"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { api } from "../../../lib/api";
import { useLangue } from "../../../lib/i18n/LanguageContext";
import AppShell from "../../../lib/components/AppShell";
import { DEVISES } from "../../../lib/constants/devises";

export default function NouveauDossierPage() {
  const router = useRouter();
  const { t } = useLangue();
  const [maitresOuvrage, setMaitresOuvrage] = useState([]);
  const [erreur, setErreur] = useState("");
  const [enCours, setEnCours] = useState(false);
  const [form, setForm] = useState({
    intitule: "",
    reference_externe: "",
    maitre_ouvrage_id: "",
    secteur: "",
    montant_estime: "",
    devise: "XOF",
    date_limite_soumission: "",
  });

  useEffect(() => {
    api.getMaitresOuvrage().then(setMaitresOuvrage).catch((err) => setErreur(err.message));
  }, []);

  async function handleCreer(e) {
    e.preventDefault();
    setEnCours(true);
    try {
      const nouveau = await api.createDossier({
        ...form,
        maitre_ouvrage_id: form.maitre_ouvrage_id || null,
        montant_estime: form.montant_estime ? Number(form.montant_estime) : null,
        date_limite_soumission: form.date_limite_soumission || null,
      });
      router.push(`/dossiers/${nouveau.id}`);
    } catch (err) {
      setErreur(err.message);
      setEnCours(false);
    }
  }

  return (
    <AppShell title={t("dossierNewPageTitle")}>
      <Link href="/dashboard" style={{ fontSize: 12, color: "var(--petrol)", display: "inline-block", marginBottom: 12 }}>
        {t("backToDashboard")}
      </Link>

      {erreur && <p style={{ color: "var(--brique)", fontSize: 12.5, marginBottom: 14 }}>{erreur}</p>}

      <form onSubmit={handleCreer} className="card" style={{ maxWidth: 560 }}>
        <label style={labelStyle}>{t("intituleLabel")}</label>
        <input
          required
          value={form.intitule}
          onChange={(e) => setForm((f) => ({ ...f, intitule: e.target.value }))}
          style={inputStyle}
        />

        <label style={{ ...labelStyle, marginTop: 10 }}>{t("referenceExterneLabel")}</label>
        <input
          value={form.reference_externe}
          onChange={(e) => setForm((f) => ({ ...f, reference_externe: e.target.value }))}
          style={inputStyle}
        />

        <label style={{ ...labelStyle, marginTop: 10 }}>{t("maitreOuvrageLabel")}</label>
        <select
          value={form.maitre_ouvrage_id}
          onChange={(e) => setForm((f) => ({ ...f, maitre_ouvrage_id: e.target.value }))}
          style={inputStyle}
        >
          <option value="">{t("selectMaitreOuvrage")}</option>
          {maitresOuvrage.map((m) => (
            <option key={m.id} value={m.id}>
              {m.nom}
            </option>
          ))}
        </select>

        <label style={{ ...labelStyle, marginTop: 10 }}>{t("secteurLabel")}</label>
        <input
          value={form.secteur}
          onChange={(e) => setForm((f) => ({ ...f, secteur: e.target.value }))}
          style={inputStyle}
        />

        <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 12, marginTop: 10 }}>
          <div>
            <label style={labelStyle}>{t("montantEstimeLabel")}</label>
            <input
              type="number"
              step="0.01"
              value={form.montant_estime}
              onChange={(e) => setForm((f) => ({ ...f, montant_estime: e.target.value }))}
              style={inputStyle}
            />
          </div>
          <div>
            <label style={labelStyle}>{t("deviseLabel")}</label>
            <select
              value={form.devise}
              onChange={(e) => setForm((f) => ({ ...f, devise: e.target.value }))}
              style={inputStyle}
            >
              {DEVISES.map((d) => (
                <option key={d.code} value={d.code}>
                  {d.code}
                </option>
              ))}
            </select>
          </div>
        </div>

        <label style={{ ...labelStyle, marginTop: 10 }}>{t("dateLimiteSoumissionLabel")}</label>
        <input
          type="datetime-local"
          value={form.date_limite_soumission}
          onChange={(e) => setForm((f) => ({ ...f, date_limite_soumission: e.target.value }))}
          style={inputStyle}
        />
        <p style={{ fontSize: 11, color: "var(--sub)", marginTop: 5 }}>{t("dateLimiteSoumissionHint")}</p>

        <button type="submit" disabled={enCours} style={{ ...boutonPrincipalStyle, marginTop: 14, width: "100%" }}>
          {t("createDossierButton")}
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
