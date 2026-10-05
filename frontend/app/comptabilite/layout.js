"use client";

import { useEffect, useState } from "react";
import { api } from "../../lib/api";
import { useLangue } from "../../lib/i18n/LanguageContext";
import AppShell from "../../lib/components/AppShell";

// Module Comptabilite vendu en option (migration 032, 05/10/2026) : tant que le
// Super Admin ne l'a pas active pour l'entreprise, TOUTES les pages
// /comptabilite/* affichent cet ecran a la place de leur contenu (le serveur
// refuse de toute facon chaque requete comptable : ce garde-fou n'est qu'un
// confort d'affichage, pas le controle d'acces).
export default function ComptabiliteLayout({ children }) {
  const { t } = useLangue();
  // null = permissions pas encore chargees : rien n'est rendu, pour ne pas
  // declencher les appels de la page puis afficher des erreurs 403.
  const [active, setActive] = useState(null);

  useEffect(() => {
    api
      .getPermissions()
      .then((p) => setActive(!!p?.comptabiliteActive))
      .catch(() => setActive(true)); // erreur reseau/session : la page gere elle-meme (401 -> connexion)
  }, []);

  if (active === null) return null;
  if (!active) {
    return (
      <AppShell title={t("comptaVerrouTitre")}>
        <div className="card" style={{ maxWidth: 520 }}>
          <p style={{ fontSize: 13.5, margin: 0, lineHeight: 1.6 }}>{t("comptaVerrouTexte")}</p>
        </div>
      </AppShell>
    );
  }
  return children;
}
