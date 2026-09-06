"use client";

import { useState } from "react";
import Link from "next/link";
import { superAdminApi } from "../../../lib/superAdminApi";
import { useLangue } from "../../../lib/i18n/LanguageContext";
import LanguageSwitcher from "../../../lib/i18n/LanguageSwitcher";

// Equivalent Super Admin de app/mot-de-passe-oublie/page.js - voir ce fichier
// pour le detail des commentaires (meme logique, espace separe).
export default function SuperAdminMotDePasseOubliePage() {
  const { t } = useLangue();
  const [email, setEmail] = useState("");
  const [envoye, setEnvoye] = useState(false);
  const [erreur, setErreur] = useState("");
  const [chargement, setChargement] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setErreur("");
    setChargement(true);
    try {
      await superAdminApi.demanderReinitialisationMotDePasse(email);
      setEnvoye(true);
    } catch (err) {
      setErreur(err.message || t("defaultLoginError"));
    } finally {
      setChargement(false);
    }
  }

  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "linear-gradient(180deg, #1E1508 0%, #0A0602 100%)",
      }}
    >
      <div className="card" style={{ width: 380, padding: 32, position: "relative" }}>
        <div style={{ position: "absolute", top: 14, right: 14 }}>
          <LanguageSwitcher variant="light" />
        </div>
        <div style={{ textAlign: "center", marginBottom: 24 }}>
          <h1 style={{ fontSize: 19, color: "var(--petrol)" }}>{t("forgotPasswordTitle")}</h1>
          <p style={{ fontSize: 12.5, color: "var(--sub)", marginTop: 6 }}>{t("forgotPasswordDescription")}</p>
        </div>

        {envoye ? (
          <>
            <p style={{ fontSize: 13, color: "var(--vert)", textAlign: "center", marginBottom: 20 }}>
              {t("forgotPasswordSuccessMessage")}
            </p>
            <div style={{ textAlign: "center" }}>
              <Link href="/super-admin/login" style={{ fontSize: 12.5, color: "var(--petrol)" }}>
                {t("backToLoginLink")}
              </Link>
            </div>
          </>
        ) : (
          <form onSubmit={handleSubmit}>
            <label style={{ fontSize: 12.5, fontWeight: 600, display: "block", marginBottom: 6 }}>
              {t("emailLabel")}
            </label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              style={inputStyle}
            />

            {erreur && <p style={{ color: "var(--brique)", fontSize: 12.5, marginTop: 10 }}>{erreur}</p>}

            <button
              type="submit"
              disabled={chargement}
              style={{
                width: "100%",
                marginTop: 20,
                padding: "11px 0",
                background: "#1E1508",
                color: "#fff",
                border: "none",
                borderRadius: 9,
                fontWeight: 600,
                fontSize: 13.5,
                opacity: chargement ? 0.7 : 1,
              }}
            >
              {chargement ? t("signingIn") : t("forgotPasswordSubmitButton")}
            </button>

            <div style={{ textAlign: "center", marginTop: 16 }}>
              <Link href="/super-admin/login" style={{ fontSize: 12.5, color: "var(--petrol)" }}>
                {t("backToLoginLink")}
              </Link>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}

const inputStyle = {
  width: "100%",
  padding: "9px 12px",
  border: "1px solid var(--line)",
  borderRadius: 8,
  fontSize: 13.5,
  fontFamily: "inherit",
};
