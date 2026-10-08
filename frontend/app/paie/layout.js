"use client";

import { useEffect, useState } from "react";
import { api } from "../../lib/api";
import { useLangue } from "../../lib/i18n/LanguageContext";
import AppShell from "../../lib/components/AppShell";

// Module Paie vendu en option (migration 061) : tant que le Super Admin ne l'a pas active pour l'entreprise, TOUTES les
// pages /paie/* affichent cet ecran (le serveur refuse de toute facon chaque requete : simple confort d'affichage).
export default function PaieLayout({ children }) {
  const { t } = useLangue();
  const [active, setActive] = useState(null);

  useEffect(() => {
    api
      .getPermissions()
      .then((p) => setActive(!!p?.paieActive))
      .catch(() => setActive(true));
  }, []);

  if (active === null) return null;
  if (!active) {
    return (
      <AppShell title={t("paieVerrouTitre")}>
        <div className="card" style={{ maxWidth: 520 }}>
          <p style={{ fontSize: 13.5, margin: 0, lineHeight: 1.6 }}>{t("paieVerrouTexte")}</p>
        </div>
      </AppShell>
    );
  }
  return children;
}
