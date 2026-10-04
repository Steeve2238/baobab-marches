"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useLangue } from "../i18n/LanguageContext";
import { useComptaStatut } from "../comptaUi";

// Sous-navigation du module Comptabilite (meme principe que VentesSousNav).
const ONGLETS = [
  { href: "/comptabilite", key: "comptaNavAccueil", exact: true },
  { href: "/comptabilite/instance", key: "comptaNavInstance", badge: true },
  { href: "/comptabilite/ecritures", key: "comptaNavEcritures" },
  { href: "/comptabilite/grand-livre", key: "comptaNavGrandLivre" },
  { href: "/comptabilite/balance", key: "comptaNavBalance" },
  { href: "/comptabilite/plan", key: "comptaNavPlan" },
  { href: "/comptabilite/tiers", key: "comptaNavTiers" },
  { href: "/comptabilite/parametres", key: "comptaNavParametres" },
];

export default function ComptaSousNav() {
  const pathname = usePathname();
  const { t } = useLangue();
  const { statut } = useComptaStatut();
  const enInstance = statut?.en_attente?.en_instance || 0;
  return (
    <div style={{ display: "flex", gap: 6, flexWrap: "wrap", borderBottom: "1px solid var(--line)", paddingBottom: 12 }}>
      {ONGLETS.map((o) => {
        const actif = o.exact ? pathname === o.href : pathname.startsWith(o.href);
        return (
          <Link
            key={o.href}
            href={o.href}
            style={{
              padding: "6px 12px",
              borderRadius: 20,
              fontSize: 12.5,
              fontWeight: actif ? 700 : 500,
              color: actif ? "#fff" : "var(--petrol)",
              background: actif ? "var(--petrol)" : "transparent",
              textDecoration: "none",
            }}
          >
            {t(o.key)}
            {o.badge && enInstance > 0 && (
              <span style={{ marginLeft: 6, padding: "1px 7px", borderRadius: 10, fontSize: 11, fontWeight: 700, background: actif ? "#fff" : "var(--ocre)", color: actif ? "var(--petrol)" : "#fff" }}>{enInstance}</span>
            )}
          </Link>
        );
      })}
    </div>
  );
}
