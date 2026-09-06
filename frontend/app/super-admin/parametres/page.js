"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { superAdminApi } from "../../../lib/superAdminApi";
import { useLangue } from "../../../lib/i18n/LanguageContext";
import SuperAdminShell from "../../../lib/components/SuperAdminShell";

// Parametres d'entete + pied de page + logo du Super Admin lui-meme (Steeve /
// YMS Groupe), utilises sur les factures d'abonnement generees pour les
// clients (voir super-admin/factures/[id]/page.js) - demande explicite de
// Steeve le 05/09/2026, meme principe que l'entete du module Ventes cote
// client (voir app/parametres/entete/page.js) mais pour la plateforme
// elle-meme.
export default function SuperAdminParametresPage() {
  const router = useRouter();
  const { t } = useLangue();
  const [form, setForm] = useState({
    raison_sociale: "",
    adresse: "",
    telephone: "",
    email: "",
    rccm: "",
    ninea: "",
    site_web: "",
    coordonnees_bancaires: "",
  });
  const [logo, setLogo] = useState(null);
  const [chargement, setChargement] = useState(true);
  const [enregistrement, setEnregistrement] = useState(false);
  const [confirmation, setConfirmation] = useState(false);
  const [televersementLogo, setTeleversementLogo] = useState(false);
  const [erreur, setErreur] = useState("");
  const inputLogoRef = useRef(null);

  useEffect(() => {
    superAdminApi
      .getParametresEntete()
      .then((data) => {
        setForm({
          raison_sociale: data.raison_sociale || "",
          adresse: data.adresse || "",
          telephone: data.telephone || "",
          email: data.email || "",
          rccm: data.rccm || "",
          ninea: data.ninea || "",
          site_web: data.site_web || "",
          coordonnees_bancaires: data.coordonnees_bancaires || "",
        });
        setLogo(data.logo_base64 ? { base64: data.logo_base64, mime: data.logo_type_mime } : null);
      })
      .catch((err) => {
        if (err.status === 401) {
          router.push("/super-admin/login");
          return;
        }
        setErreur(err.message);
      })
      .finally(() => setChargement(false));
  }, [router]);

  async function handleSubmit(e) {
    e.preventDefault();
    setEnregistrement(true);
    setConfirmation(false);
    setErreur("");
    try {
      await superAdminApi.patchParametresEntete(form);
      setConfirmation(true);
      setTimeout(() => setConfirmation(false), 2500);
    } catch (err) {
      setErreur(err.message);
    } finally {
      setEnregistrement(false);
    }
  }

  async function handleChoisirLogo(e) {
    const fichier = e.target.files?.[0];
    if (!fichier) return;
    setTeleversementLogo(true);
    setErreur("");
    try {
      const maj = await superAdminApi.uploaderLogoEntete(fichier);
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
      await superAdminApi.supprimerLogoEntete();
      setLogo(null);
    } catch (err) {
      setErreur(err.message);
    } finally {
      setTeleversementLogo(false);
    }
  }

  return (
    <SuperAdminShell title={t("saParametresPageTitle")}>
      <p style={{ fontSize: 12.5, color: "var(--sub)", marginBottom: 16 }}>{t("saParametresPageDescription")}</p>

      {erreur && <p style={{ color: "var(--brique)", fontSize: 12.5, marginBottom: 14 }}>{erreur}</p>}

      {!chargement && (
        <form onSubmit={handleSubmit} className="card" style={{ maxWidth: 560 }}>
          <label style={labelStyle}>{t("venteLogoLabel")}</label>
          <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 18 }}>
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

          <h3 style={{ fontSize: 12.5, color: "var(--petrol)", marginBottom: 10 }}>{t("enteteTitle")}</h3>

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

          <h3 style={{ fontSize: 12.5, color: "var(--petrol)", marginTop: 20, marginBottom: 4 }}>
            {t("enteteFooterSection")}
          </h3>
          <p style={{ fontSize: 11, color: "var(--sub)", marginBottom: 10 }}>{t("enteteFooterDescription")}</p>

          <label style={labelStyle}>{t("enteteRccmLabel")}</label>
          <input
            value={form.rccm}
            onChange={(e) => setForm((f) => ({ ...f, rccm: e.target.value }))}
            style={inputStyle}
          />

          <label style={{ ...labelStyle, marginTop: 12 }}>{t("enteteNineaLabel")}</label>
          <input
            value={form.ninea}
            onChange={(e) => setForm((f) => ({ ...f, ninea: e.target.value }))}
            style={inputStyle}
          />

          <label style={{ ...labelStyle, marginTop: 12 }}>{t("enteteSiteWebLabel")}</label>
          <input
            value={form.site_web}
            onChange={(e) => setForm((f) => ({ ...f, site_web: e.target.value }))}
            style={inputStyle}
          />

          <label style={{ ...labelStyle, marginTop: 12 }}>{t("enteteCoordonneesBancairesLabel")}</label>
          <input
            value={form.coordonnees_bancaires}
            onChange={(e) => setForm((f) => ({ ...f, coordonnees_bancaires: e.target.value }))}
            style={inputStyle}
          />

          <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 18 }}>
            <button type="submit" disabled={enregistrement} style={boutonPrincipalStyle}>
              {t("save")}
            </button>
            {confirmation && <span style={{ fontSize: 12.5, color: "var(--vert)" }}>{t("savedConfirmation")}</span>}
          </div>
        </form>
      )}

      <div className="card" style={{ maxWidth: 560, marginTop: 16 }}>
        <h3 style={{ fontSize: 13.5, color: "var(--petrol)", marginBottom: 4 }}>{t("securitySection")}</h3>
        <p style={{ fontSize: 11.5, color: "var(--sub)", marginBottom: 14 }}>{t("securityDescription")}</p>
        <Link
          href="/super-admin/changer-mot-de-passe"
          style={{ ...boutonSecondaireStyle, display: "inline-block", textDecoration: "none" }}
        >
          {t("securityChangePasswordLink")}
        </Link>
      </div>
    </SuperAdminShell>
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
