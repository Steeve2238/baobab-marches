"use client";

import { useEffect, useState } from "react";
import { api } from "../../lib/api";
import { useLangue } from "../../lib/i18n/LanguageContext";
import AppShell from "../../lib/components/AppShell";

// Module Fiscalite vendu en option (migration 049) : tant que le Super Admin ne l'a pas active pour l'entreprise,
// TOUTES les pages /fiscalite/* affichent cet ecran (le serveur refuse de toute facon chaque requete : ce garde-fou
// n'est qu'un confort d'affichage, pas le controle d'acces).
export default function FiscaliteLayout({ children }) {
  const { t } = useLangue();
  const [active, setActive] = useState(null);

  useEffect(() => {
    api
      .getPermissions()
      .then((p) => setActive(!!p?.fiscaliteActive))
      .catch(() => setActive(true));
  }, []);

  if (active === null) return null;
  if (!active) {
    return (
      <AppShell title={t("fiscVerrouTitre")}>
        <div className="card" style={{ maxWidth: 520 }}>
          <p style={{ fontSize: 13.5, margin: 0, lineHeight: 1.6 }}>{t("fiscVerrouTexte")}</p>
        </div>
      </AppShell>
    );
  }
  return children;
}
