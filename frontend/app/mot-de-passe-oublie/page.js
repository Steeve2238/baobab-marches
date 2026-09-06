"use client";

import { useState } from "react";
import Link from "next/link";
import { api } from "../../lib/api";
import { useLangue } from "../../lib/i18n/LanguageContext";
import LanguageSwitcher from "../../lib/i18n/LanguageSwitcher";

// Demande de reinitialisation de mot de passe ("mot de passe oublie") -
// demande explicite de Steeve le 06/09/2026. Repond toujours avec le meme
// message de succes generique (voir POST /api/auth/mot-de-passe-oublie cote
// backend) : ne jamais reveler si l'email correspond ou non a un compte
// existant.
export default function MotDePasseOubliePage() {
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
      await api.demanderReinitialisationMotDePasse(email);
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
        background: "linear-gradient(180deg, var(--petrol) 0%, #0A2E34 100%)",
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
              <Link href="/login" style={{ fontSize: 12.5, color: "var(--petrol)" }}>
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
                background: "var(--petrol)",
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
              <Link href="/login" style={{ fontSize: 12.5, color: "var(--petrol)" }}>
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
