"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useLangue } from "../i18n/LanguageContext";

// Deux niveaux : categories (rangee du haut) puis pages de la categorie active (rangee du bas).
const GROUPES = [
  { key: "paieGrpAccueil", items: [{ href: "/paie", key: "paieNavAccueil", exact: true }] },
  {
    key: "paieGrpMois",
    items: [
      { href: "/paie/variables", key: "paieNavVariables" },
      { href: "/paie/mois", key: "paieNavMois" },
      { href: "/rh/ordres-virement", key: "navOrdresVirementRH" },
      { href: "/paie/archives", key: "paieNavArchives" },
    ],
  },
  {
    key: "paieGrpEtats",
    items: [
      { href: "/paie/etats", key: "paieNavEtats" },
      { href: "/paie/retraite", key: "paieNavRetraite" },
      { href: "/paie/provision-retraite", key: "paieNavProvision" },
    ],
  },
  {
    // Anciennement dans le menu Ressources humaines : relevent du module Paie (08/10/2026).
    key: "paieGrpSalaries",
    items: [
      { href: "/paie/dossiers", key: "paieNavDossiers" },
      { href: "/rh/contrats", key: "navContratsRH", also: ["/rh/modeles-contrats"] },
      { href: "/rh/dmt", key: "navDmtRH" },
    ],
  },
  {
    key: "paieGrpOutils",
    items: [
      { href: "/paie/simulateur", key: "paieNavSimulateur" },
      { href: "/paie/parametres", key: "paieNavParametres" },
    ],
  },
];

const estActif = (e, pathname) =>
  e.exact ? pathname === e.href : [e.href, ...(e.also || [])].some((h) => pathname === h || pathname.startsWith(h + "/"));

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

const sousPilule = (actif) => ({
  display: "inline-flex",
  alignItems: "center",
  padding: "4px 12px",
  borderRadius: 6,
  fontSize: 12,
  fontWeight: actif ? 700 : 500,
  color: actif ? "var(--petrol)" : "var(--sub)",
  background: actif ? "rgba(15, 76, 92, 0.1)" : "transparent",
  textDecoration: "none",
  whiteSpace: "nowrap",
});

export default function PaieSousNav() {
  const pathname = usePathname();
  const { t } = useLangue();
  const courant = GROUPES.find((g) => g.items.some((e) => estActif(e, pathname))) || GROUPES[0];
  return (
    <nav style={{ borderBottom: "1px solid var(--line-soft)", paddingBottom: 10, display: "grid", gap: 8 }}>
      <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
        {GROUPES.map((g) => (
          <Link key={g.key} href={g.items[0].href} style={pilule(g === courant)}>
            {t(g.key)}
          </Link>
        ))}
      </div>
      {courant.items.length > 1 && (
        <div style={{ display: "flex", gap: 2, flexWrap: "wrap", paddingLeft: 6 }}>
          {courant.items.map((e) => (
            <Link key={e.href} href={e.href} style={sousPilule(estActif(e, pathname))}>
              {t(e.key)}
            </Link>
          ))}
        </div>
      )}
    </nav>
  );
}
