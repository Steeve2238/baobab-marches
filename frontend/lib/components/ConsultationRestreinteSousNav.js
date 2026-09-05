"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useLangue } from "../i18n/LanguageContext";

// Sous-navigation de la branche "Consultation restreinte" du module Marche
// (anciennement module Ventes/Negoce autonome, fusionne le 04/09/2026 avec
// Concurrence/Appel d'offres sous un seul onglet principal "Marche" - voir
// app/marches/page.js pour l'ecran de choix entre les deux branches).
// Meme principe que les liens croises deja utilises sur la page d'accueil
// du Parc auto (voir app/parc-auto/page.js) : l'entree de navigation
// principale ne menait qu'a une seule des 5 pages (Consultations), les
// autres n'etaient accessibles qu'en tapant l'URL a la main - corrige le
// 04/09/2026 suite au retour de Steeve.
const ONGLETS = [
  { href: "/marches/consultation-restreinte/consultations", key: "navVentesConsultations" },
  { href: "/marches/consultation-restreinte/devis", key: "navVentesDevis" },
  { href: "/marches/consultation-restreinte/factures", key: "navVentesFactures" },
  { href: "/marches/consultation-restreinte/bl", key: "navVentesBl" },
  { href: "/marches/consultation-restreinte/clients", key: "navVentesClients" },
  { href: "/marches/consultation-restreinte/suivi", key: "navVentesSuivi" },
  { href: "/marches/consultation-restreinte/statistiques", key: "navVentesStatistiques" },
];

export default function ConsultationRestreinteSousNav() {
  const pathname = usePathname();
  const { t } = useLangue();

  return (
    <div>
      <Link
        href="/marches"
        style={{ fontSize: 11.5, color: "var(--sub)", display: "inline-block", marginBottom: 8 }}
      >
        ← {t("backToMarches")}
      </Link>
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
    </div>
  );
}
