"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useLangue } from "../i18n/LanguageContext";
import LanguageSwitcher from "../i18n/LanguageSwitcher";
import {
  clearSuperAdminToken,
  clearSuperAdminCourant,
  getSuperAdminCourant,
} from "../superAdminApi";

const NAV_ITEMS = [
  { href: "/super-admin", key: "saNavDashboard" },
  { href: "/super-admin/clients", key: "saNavClients" },
  { href: "/super-admin/formules", key: "saNavFormules" },
  { href: "/super-admin/factures", key: "saNavFactures" },
];

/**
 * Coquille commune a toutes les pages de l'espace Super Admin - distincte
 * de lib/components/AppShell.js (espace client) : navigation, couleurs et
 * session totalement separees (voir lib/superAdminApi.js). Un badge visuel
 * distinct (bandeau "Espace Super Admin") evite toute confusion pour Steeve
 * s'il a les deux espaces ouverts dans des onglets differents.
 */
export default function SuperAdminShell({ children, title, backHref }) {
  const pathname = usePathname();
  const router = useRouter();
  const { t } = useLangue();
  const [profil, setProfil] = useState(null);

  useEffect(() => {
    setProfil(getSuperAdminCourant());
  }, []);

  function handleLogout() {
    clearSuperAdminToken();
    clearSuperAdminCourant();
    router.push("/super-admin/login");
  }

  return (
    <div style={{ display: "flex", minHeight: "100vh" }}>
      <aside style={sidebarStyle}>
        <div style={{ padding: "22px 18px 18px", display: "flex", alignItems: "center", gap: 10 }}>
          <div style={logoStyle}>B</div>
          <div>
            <div style={{ fontFamily: "Space Grotesk", fontWeight: 700, fontSize: 14.5, color: "#fff" }}>
              Baobab Marchés
            </div>
            <div style={{ fontSize: 10.5, color: "rgba(255,255,255,0.6)" }}>{t("saShellSubtitle")}</div>
          </div>
        </div>

        <nav style={{ padding: "8px 12px", flex: 1 }}>
          {NAV_ITEMS.map((item) => {
            const actif = pathname === item.href;
            return (
              <Link
                key={item.href}
                href={item.href}
                style={{
                  display: "block",
                  padding: "9px 12px",
                  borderRadius: 8,
                  fontSize: 13,
                  fontWeight: actif ? 700 : 500,
                  color: actif ? "#fff" : "rgba(255,255,255,0.65)",
                  background: actif ? "rgba(255,255,255,0.14)" : "transparent",
                  marginBottom: 2,
                }}
              >
                {t(item.key)}
              </Link>
            );
          })}
        </nav>

        <div style={{ padding: "0 16px 16px" }}>
          {profil?.email && (
            <div
              style={{
                padding: "10px 4px",
                borderTop: "1px solid rgba(255,255,255,0.1)",
                marginBottom: 10,
              }}
            >
              <div style={{ fontSize: 12.5, fontWeight: 600, color: "#fff" }}>{profil.nom}</div>
              <div
                style={{
                  fontSize: 10,
                  color: "rgba(255,255,255,0.55)",
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                }}
              >
                {profil.email}
              </div>
            </div>
          )}
          <button onClick={handleLogout} style={logoutBtnStyle}>
            {t("signOut")}
          </button>
        </div>
      </aside>

      <main style={{ flex: 1, background: "var(--bg)", minWidth: 0 }}>
        <div
          style={{
            background: "var(--ocre)",
            color: "#fff",
            fontSize: 11.5,
            fontWeight: 700,
            letterSpacing: "0.03em",
            textAlign: "center",
            padding: "5px 0",
            textTransform: "uppercase",
          }}
        >
          {t("saShellBanner")}
        </div>
        <div style={{ maxWidth: 1100, margin: "0 auto", padding: "24px 28px 60px" }}>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "flex-start",
              marginBottom: 20,
              gap: 16,
            }}
          >
            <div>
              {backHref && (
                <Link
                  href={backHref}
                  style={{ fontSize: 12.5, color: "var(--sub)", display: "block", marginBottom: 6 }}
                >
                  ← {t("saBackToClients")}
                </Link>
              )}
              {title && <h1 style={{ fontSize: 19, color: "var(--petrol)" }}>{title}</h1>}
            </div>
            <LanguageSwitcher variant="default" />
          </div>
          {children}
        </div>
      </main>
    </div>
  );
}

const sidebarStyle = {
  width: 216,
  flexShrink: 0,
  background: "#1E1508",
  display: "flex",
  flexDirection: "column",
  position: "sticky",
  top: 0,
  height: "100vh",
};

const logoStyle = {
  width: 32,
  height: 32,
  borderRadius: 9,
  background: "linear-gradient(135deg, var(--ocre), #E0954C)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  fontWeight: 700,
  color: "#1a1a1a",
  flexShrink: 0,
};

const logoutBtnStyle = {
  width: "100%",
  background: "rgba(255,255,255,0.08)",
  border: "1px solid rgba(255,255,255,0.15)",
  color: "#fff",
  borderRadius: 8,
  padding: "8px 12px",
  fontSize: 12.5,
};
