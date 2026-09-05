"use client";

import Link from "next/link";
import { useLangue } from "../../lib/i18n/LanguageContext";
import AppShell from "../../lib/components/AppShell";

// Ecran de choix du module "Marche", qui regroupe depuis le 04/09/2026 les
// deux anciens modules independants Ventes/Negoce (devenu la branche
// "Consultation restreinte" ci-dessous) et Concurrence (devenu la branche
// "Appel d'offres") sous une seule entree de la barre laterale - demande de
// Steeve pour reduire le nombre d'onglets et clarifier que les deux
// branches concernent le meme type d'activite (poursuite de marches),
// simplement selon deux circuits differents (prive/consultation restreinte
// vs public/appel d'offres soumis a mise en concurrence).
const BRANCHES = [
  {
    href: "/marches/consultation-restreinte/consultations",
    titleKey: "marchesConsultationRestreinteTitle",
    descKey: "marchesConsultationRestreinteDesc",
    accent: "var(--petrol)",
  },
  {
    href: "/marches/appel-offres",
    titleKey: "marchesAppelOffresTitle",
    descKey: "marchesAppelOffresDesc",
    accent: "var(--ocre)",
  },
];

export default function MarchesPage() {
  const { t } = useLangue();

  return (
    <AppShell title={t("marchesPageTitle")}>
      <p style={{ fontSize: 12.5, color: "var(--sub)", marginTop: -6, marginBottom: 22 }}>
        {t("marchesPageSubtitle")}
      </p>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 18 }}>
        {BRANCHES.map((branche) => (
          <Link
            key={branche.href}
            href={branche.href}
            className="card"
            style={{
              display: "block",
              padding: "26px 24px",
              textDecoration: "none",
              color: "inherit",
              borderTop: `3px solid ${branche.accent}`,
            }}
          >
            <h2 style={{ fontSize: 16.5, color: "var(--petrol)", marginBottom: 8 }}>
              {t(branche.titleKey)}
            </h2>
            <p style={{ fontSize: 12.5, color: "var(--sub)", lineHeight: 1.5, marginBottom: 14 }}>
              {t(branche.descKey)}
            </p>
            <span style={{ fontSize: 12.5, fontWeight: 700, color: branche.accent }}>
              {t("marchesOuvrirLabel")} →
            </span>
          </Link>
        ))}
      </div>
    </AppShell>
  );
}
