"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { superAdminApi, setSuperAdminToken, setSuperAdminCourant } from "../../../lib/superAdminApi";
import { useLangue } from "../../../lib/i18n/LanguageContext";
import LanguageSwitcher from "../../../lib/i18n/LanguageSwitcher";

// Page de connexion de l'espace Super Admin - volontairement separee de
// /login (espace client) : chemin distinct, endpoint backend distinct
// (/api/super-admin/auth/login), et jeton stocke sous une cle localStorage
// differente (voir lib/superAdminApi.js) pour que les deux sessions
// puissent coexister sans jamais se melanger dans le meme navigateur.
export default function SuperAdminLoginPage() {
  const router = useRouter();
  const { t } = useLangue();
  const [email, setEmail] = useState("");
  const [motDePasse, setMotDePasse] = useState("");
  const [erreur, setErreur] = useState("");
  const [chargement, setChargement] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setErreur("");
    setChargement(true);
    try {
      const data = await superAdminApi.login(email, motDePasse);
      setSuperAdminToken(data.token);
      setSuperAdminCourant(data.admin);
      if (data.mustChangePassword) {
        router.push("/super-admin/changer-mot-de-passe");
      } else {
        router.push("/super-admin");
      }
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
          <div
            style={{
              width: 44,
              height: 44,
              borderRadius: 10,
              margin: "0 auto 12px",
              background: "conic-gradient(from 220deg, var(--ocre), #E8A354, var(--ocre))",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontFamily: "Space Grotesk",
              fontWeight: 700,
              color: "#0A2E34",
              fontSize: 19,
            }}
          >
            B
          </div>
          <h1 style={{ fontSize: 20, color: "var(--petrol)" }}>{t("saLoginTitle")}</h1>
          <p style={{ fontSize: 12.5, color: "var(--sub)", marginTop: 4 }}>{t("saLoginSubtitle")}</p>
        </div>

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

          <label style={{ fontSize: 12.5, fontWeight: 600, display: "block", margin: "14px 0 6px" }}>
            {t("passwordLabel")}
          </label>
          <input
            type="password"
            value={motDePasse}
            onChange={(e) => setMotDePasse(e.target.value)}
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
            {chargement ? t("signingIn") : t("signIn")}
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
