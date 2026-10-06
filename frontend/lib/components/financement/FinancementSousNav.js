"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useLangue } from "../../i18n/LanguageContext";

// Sous-navigation du module Financement (meme principe que VentesSousNav).
const ONGLETS = [
  { href: "/financement", key: "finNavSimulateur", exact: true },
  { href: "/financement/banques", key: "finNavBanques" },
  { href: "/financement/controle", key: "finNavControle" },
];

export default function FinancementSousNav() {
  const pathname = usePathname();
  const { t } = useLangue();
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
          </Link>
        );
      })}
    </div>
  );
}
