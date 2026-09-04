"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { superAdminApi } from "../../../lib/superAdminApi";
import { useLangue } from "../../../lib/i18n/LanguageContext";
import LanguageSwitcher from "../../../lib/i18n/LanguageSwitcher";

// Changement de mot de passe force apres la premiere connexion Super Admin
// (mot de passe temporaire seede par la migration 014). Meme logique que
// /changer-mot-de-passe (espace client), branchee sur superAdminApi.
export default function SuperAdminChangerMotDePassePage() {
  const router = useRouter();
  const { t } = useLangue();
  const [nouveau, setNouveau] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [erreur, setErreur] = useState("");
  const [chargement, setChargement] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setErreur("");

    if (nouveau.length < 8) {
      setErreur(t("passwordTooShort"));
      return;
    }
    if (nouveau !== confirmation) {
      setErreur(t("passwordsDontMatch"));
      return;
    }

    setChargement(true);
    try {
      await superAdminApi.changerMotDePasse(nouveau);
      router.push("/super-admin");
    } catch (err) {
      setErreur(err.message);
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
          <h1 style={{ fontSize: 19, color: "var(--petrol)" }}>{t("changePasswordTitle")}</h1>
          <p style={{ fontSize: 12.5, color: "var(--sub)", marginTop: 6 }}>
            {t("changePasswordDescription")}
          </p>
        </div>

        <form onSubmit={handleSubmit}>
          <label style={{ fontSize: 12.5, fontWeight: 600, display: "block", marginBottom: 6 }}>
            {t("newPasswordLabel")}
          </label>
          <input
            type="password"
            value={nouveau}
            onChange={(e) => setNouveau(e.target.value)}
            required
            minLength={8}
            style={inputStyle}
          />

          <label style={{ fontSize: 12.5, fontWeight: 600, display: "block", margin: "14px 0 6px" }}>
            {t("confirmPasswordLabel")}
          </label>
          <input
            type="password"
            value={confirmation}
            onChange={(e) => setConfirmation(e.target.value)}
            required
            minLength={8}
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
            {chargement ? t("signingIn") : t("changePasswordButton")}
          </button>
        </form>
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
