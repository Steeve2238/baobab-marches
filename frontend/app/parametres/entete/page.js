"use client";

import { useEffect, useState } from "react";
import { api } from "../../../lib/api";
import { useLangue } from "../../../lib/i18n/LanguageContext";
import AppShell from "../../../lib/components/AppShell";

export default function EnteteSettingsPage() {
  const { t } = useLangue();
  const [form, setForm] = useState({
    raison_sociale: "",
    adresse: "",
    telephone: "",
    email: "",
    signataire_nom: "",
    signataire_titre: "",
  });
  const [chargement, setChargement] = useState(true);
  const [enregistrement, setEnregistrement] = useState(false);
  const [confirmation, setConfirmation] = useState(false);
  const [erreur, setErreur] = useState("");

  useEffect(() => {
    api
      .getEntete()
      .then((data) =>
        setForm({
          raison_sociale: data.raison_sociale || "",
          adresse: data.adresse || "",
          telephone: data.telephone || "",
          email: data.email || "",
          signataire_nom: data.signataire_nom || "",
          signataire_titre: data.signataire_titre || "",
        })
      )
      .catch((err) => setErreur(err.message))
      .finally(() => setChargement(false));
  }, []);

  async function handleSubmit(e) {
    e.preventDefault();
    setEnregistrement(true);
    setConfirmation(false);
    try {
      await api.updateEntete(form);
      setConfirmation(true);
      setTimeout(() => setConfirmation(false), 2500);
    } catch (err) {
      setErreur(err.message);
    } finally {
      setEnregistrement(false);
    }
  }

  return (
    <AppShell title={t("enteteTitle")}>
      <p style={{ fontSize: 12.5, color: "var(--sub)", marginBottom: 16 }}>{t("enteteDescription")}</p>

      {erreur && <p style={{ color: "var(--brique)", fontSize: 12.5, marginBottom: 14 }}>{erreur}</p>}

      {!chargement && (
        <form onSubmit={handleSubmit} className="card" style={{ maxWidth: 560 }}>
          <label style={labelStyle}>{t("raisonSocialeLabel")}</label>
          <input
            value={form.raison_sociale}
            onChange={(e) => setForm((f) => ({ ...f, raison_sociale: e.target.value }))}
            style={inputStyle}
          />

          <label style={{ ...labelStyle, marginTop: 12 }}>{t("adresseLabel")}</label>
          <input
            value={form.adresse}
            onChange={(e) => setForm((f) => ({ ...f, adresse: e.target.value }))}
            style={inputStyle}
          />

          <label style={{ ...labelStyle, marginTop: 12 }}>{t("telephoneLabel")}</label>
          <input
            value={form.telephone}
            onChange={(e) => setForm((f) => ({ ...f, telephone: e.target.value }))}
            style={inputStyle}
          />

          <label style={{ ...labelStyle, marginTop: 12 }}>{t("emailLabel2")}</label>
          <input
            type="email"
            value={form.email}
            onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
            style={inputStyle}
          />

          <label style={{ ...labelStyle, marginTop: 12 }}>{t("signataireNomLabel")}</label>
          <input
            value={form.signataire_nom}
            onChange={(e) => setForm((f) => ({ ...f, signataire_nom: e.target.value }))}
            style={inputStyle}
          />

          <label style={{ ...labelStyle, marginTop: 12 }}>{t("signataireTitreLabel")}</label>
          <input
            value={form.signataire_titre}
            onChange={(e) => setForm((f) => ({ ...f, signataire_titre: e.target.value }))}
            style={inputStyle}
          />

          <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 16 }}>
            <button type="submit" disabled={enregistrement} style={boutonPrincipalStyle}>
              {t("save")}
            </button>
            {confirmation && (
              <span style={{ fontSize: 12.5, color: "var(--vert)" }}>{t("savedConfirmation")}</span>
            )}
          </div>
        </form>
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
