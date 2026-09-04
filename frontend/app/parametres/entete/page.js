"use client";

import { useEffect, useRef, useState } from "react";
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

  // Parametres du module Ventes : taux de TVA systematique + logo, utilises
  // automatiquement sur chaque devis/facture genere (voir routes/ventes.js
  // cote backend). Regroupes sur cette meme page d'en-tete de structure :
  // ce sont les memes informations d'identite de l'entreprise.
  const [tauxTva, setTauxTva] = useState("18");
  const [logo, setLogo] = useState(null);
  const [enregistrementTva, setEnregistrementTva] = useState(false);
  const [confirmationTva, setConfirmationTva] = useState(false);
  const [televersementLogo, setTeleversementLogo] = useState(false);
  const inputLogoRef = useRef(null);

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

    api
      .getParametresVentes()
      .then((data) => {
        setTauxTva(String(data.taux_tva_pourcentage));
        setLogo(data.logo_base64 ? { base64: data.logo_base64, mime: data.logo_type_mime } : null);
      })
      .catch(() => {});
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

  async function handleEnregistrerTva(e) {
    e.preventDefault();
    setEnregistrementTva(true);
    setConfirmationTva(false);
    setErreur("");
    try {
      await api.patchParametresVentes({ taux_tva_pourcentage: Number(tauxTva) });
      setConfirmationTva(true);
      setTimeout(() => setConfirmationTva(false), 2500);
    } catch (err) {
      setErreur(err.message);
    } finally {
      setEnregistrementTva(false);
    }
  }

  async function handleChoisirLogo(e) {
    const fichier = e.target.files?.[0];
    if (!fichier) return;
    setTeleversementLogo(true);
    setErreur("");
    try {
      const maj = await api.uploaderLogoVentes(fichier);
      setLogo(maj.logo_base64 ? { base64: maj.logo_base64, mime: maj.logo_type_mime } : null);
    } catch (err) {
      setErreur(err.message);
    } finally {
      setTeleversementLogo(false);
      if (inputLogoRef.current) inputLogoRef.current.value = "";
    }
  }

  async function handleSupprimerLogo() {
    setTeleversementLogo(true);
    setErreur("");
    try {
      await api.supprimerLogoVentes();
      setLogo(null);
    } catch (err) {
      setErreur(err.message);
    } finally {
      setTeleversementLogo(false);
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

      {!chargement && (
        <div className="card" style={{ maxWidth: 560, marginTop: 16 }}>
          <h3 style={{ fontSize: 13.5, color: "var(--petrol)", marginBottom: 4 }}>{t("venteParametresSection")}</h3>
          <p style={{ fontSize: 11.5, color: "var(--sub)", marginBottom: 14 }}>{t("venteParametresDescription")}</p>

          <label style={labelStyle}>{t("venteLogoLabel")}</label>
          <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 16 }}>
            {logo ? (
              <img
                src={`data:${logo.mime};base64,${logo.base64}`}
                alt="logo"
                style={{ maxWidth: 100, maxHeight: 70, objectFit: "contain", border: "1px solid var(--line)", borderRadius: 8, padding: 4 }}
              />
            ) : (
              <span style={{ fontSize: 12, color: "var(--sub)" }}>{t("venteNoLogo")}</span>
            )}
            <div style={{ display: "flex", gap: 8 }}>
              <button
                type="button"
                onClick={() => inputLogoRef.current?.click()}
                disabled={televersementLogo}
                style={boutonSecondaireStyle}
              >
                {televersementLogo ? t("saCreating") : t("venteUploadLogoButton")}
              </button>
              {logo && (
                <button type="button" onClick={handleSupprimerLogo} disabled={televersementLogo} style={boutonSecondaireStyle}>
                  {t("venteRemoveLogoButton")}
                </button>
              )}
            </div>
            <input ref={inputLogoRef} type="file" accept="image/png,image/jpeg" onChange={handleChoisirLogo} style={{ display: "none" }} />
          </div>

          <form onSubmit={handleEnregistrerTva}>
            <label style={labelStyle}>{t("venteTauxTvaLabel")}</label>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <input
                type="number"
                min="0"
                max="100"
                step="0.5"
                value={tauxTva}
                onChange={(e) => setTauxTva(e.target.value)}
                style={{ ...inputStyle, width: 120 }}
              />
              <span style={{ fontSize: 13 }}>%</span>
              <button type="submit" disabled={enregistrementTva} style={boutonPrincipalStyle}>
                {t("save")}
              </button>
              {confirmationTva && <span style={{ fontSize: 12.5, color: "var(--vert)" }}>{t("savedConfirmation")}</span>}
            </div>
            <p style={{ fontSize: 11, color: "var(--sub)", marginTop: 6 }}>{t("venteTauxTvaNote")}</p>
          </form>
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
const boutonSecondaireStyle = {
  background: "transparent",
  color: "var(--petrol)",
  border: "1px solid var(--line)",
  borderRadius: 8,
  padding: "7px 14px",
  fontSize: 12,
  fontWeight: 600,
  whiteSpace: "nowrap",
};
