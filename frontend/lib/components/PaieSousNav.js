"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useLangue } from "../i18n/LanguageContext";

const ELEMENTS = [
  { href: "/paie", key: "paieNavAccueil", exact: true },
  { href: "/paie/variables", key: "paieNavVariables" },
  { href: "/paie/mois", key: "paieNavMois" },
  { href: "/paie/archives", key: "paieNavArchives" },
  { href: "/paie/etats", key: "paieNavEtats" },
  { href: "/paie/retraite", key: "paieNavRetraite" },
  { href: "/paie/provision-retraite", key: "paieNavProvision" },
  { href: "/paie/dossiers", key: "paieNavDossiers" },
  { href: "/paie/simulateur", key: "paieNavSimulateur" },
  { href: "/paie/parametres", key: "paieNavParametres" },
];

const pilule = (actif) => ({
  display: "inline-flex",
  alignItems: "center",
  padding: "6px 14px",
  borderRadius: 20,
  fontSize: 12.5,
  fontWeight: actif ? 700 : 500,
  color: actif ? "#fff" : "var(--petrol)",
  background: actif ? "var(--petrol)" : "transparent",
  textDecoration: "none",
  whiteSpace: "nowrap",
});

export default function PaieSousNav() {
  const pathname = usePathname();
  const { t } = useLangue();
  return (
    <nav style={{ display: "flex", gap: 4, flexWrap: "wrap", borderBottom: "1px solid var(--line-soft)", paddingBottom: 10 }}>
      {ELEMENTS.map((e) => {
        const actif = e.exact ? pathname === e.href : pathname === e.href || pathname.startsWith(e.href + "/");
        return (
          <Link key={e.href} href={e.href} style={pilule(actif)}>
            {t(e.key)}
          </Link>
        );
      })}
    </nav>
  );
}
