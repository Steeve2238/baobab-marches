"use client";

import { useEffect, useState } from "react";
import { api } from "../api";
import { useLangue } from "../i18n/LanguageContext";
import AppShell from "./AppShell";
import PaieSousNav from "./PaieSousNav";

// Contrats, DMT et ordres de virement relevent du module Paie (payant). Meme ecran de verrouillage que /paie/* ; le serveur
// refuse de toute facon chaque requete (simple confort d'affichage).
export default function PaieGarde({ children }) {
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
