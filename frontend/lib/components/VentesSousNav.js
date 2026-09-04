"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useLangue } from "../i18n/LanguageContext";

// Sous-navigation du module Ventes/Negoce, affichee en haut de chaque page
// de liste (Clients, Consultations, Devis, Factures, Bons de livraison).
// Meme principe que les liens croises deja utilises sur la page d'accueil
// du Parc auto (voir app/parc-auto/page.js) : l'entree de navigation
// principale "Ventes" ne mene qu'a une seule des 5 pages (Consultations),
// les 4 autres n'etaient auparavant accessibles qu'en tapant l'URL a la
// main - corrige le 04/09/2026 suite au retour de Steeve.
const ONGLETS = [
  { href: "/ventes/consultations", key: "navVentesConsultations" },
  { href: "/ventes/devis", key: "navVentesDevis" },
  { href: "/ventes/factures", key: "navVentesFactures" },
  { href: "/ventes/bl", key: "navVentesBl" },
  { href: "/ventes/clients", key: "navVentesClients" },
  { href: "/ventes/suivi", key: "navVentesSuivi" },
  { href: "/ventes/statistiques", key: "navVentesStatistiques" },
];

export default function VentesSousNav() {
  const pathname = usePathname();
  const { t } = useLangue();

  return (
    <div style={{ display: "flex", gap: 6, flexWrap: "wrap", borderBottom: "1px solid var(--line)", paddingBottom: 12 }}>
      {ONGLETS.map((onglet) => {
        const actif = pathname === onglet.href;
        return (
          <Link
            key={onglet.href}
            href={onglet.href}
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
            {t(onglet.key)}
          </Link>
        );
      })}
    </div>
  );
}
