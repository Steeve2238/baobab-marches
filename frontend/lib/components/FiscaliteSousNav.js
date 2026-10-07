"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useLangue } from "../i18n/LanguageContext";

// Sous-navigation du module Fiscalite : quelques entrees de premier niveau,
// les autres regroupees en menus deroulants (survol ou clic) pour que la barre
// reste sur une seule ligne quelle que soit le nombre de pages.
const ELEMENTS = [
  { href: "/fiscalite", key: "fiscNavAccueil", exact: true },
  {
    groupe: "fiscGroupeDeclarations",
    items: [
      { href: "/fiscalite/tva", key: "fiscNavTva" },
      { href: "/fiscalite/is", key: "fiscNavIs" },
      { href: "/fiscalite/retenues", key: "fiscNavRetenues" },
      { href: "/fiscalite/cel", key: "fiscNavCel" },
      { href: "/fiscalite/vehicules", key: "fiscNavVehicules" },
    ],
  },
  {
    groupe: "fiscGroupeSuivi",
    items: [
      { href: "/fiscalite/calendrier", key: "fiscNavCalendrier" },
      { href: "/fiscalite/conformite", key: "fiscNavConformite" },
      { href: "/fiscalite/penalites", key: "fiscNavPenalites" },
    ],
  },
  {
    groupe: "fiscGroupeDonnees",
    items: [
      { href: "/fiscalite/donnees", key: "fiscNavDonnees" },
      { href: "/fiscalite/tiers", key: "fiscNavTiers" },
      { href: "/fiscalite/profil", key: "fiscNavProfil" },
      { href: "/fiscalite/comptes", key: "fiscNavComptes" },
    ],
  },
];

const estActif = (pathname, o) =>
  o.exact ? pathname === o.href : pathname === o.href || pathname.startsWith(o.href + "/");

const boutonStyle = (actif) => ({
  display: "inline-flex",
  alignItems: "center",
  gap: 5,
  padding: "6px 12px",
  borderRadius: 20,
  fontSize: 12.5,
  fontWeight: actif ? 700 : 500,
  color: actif ? "#fff" : "var(--petrol)",
  background: actif ? "var(--petrol)" : "transparent",
  border: "none",
  textDecoration: "none",
  cursor: "pointer",
  fontFamily: "inherit",
  whiteSpace: "nowrap",
});

export default function FiscaliteSousNav() {
  const pathname = usePathname();
  const { t } = useLangue();
  const [ouvert, setOuvert] = useState(null);
  const racine = useRef(null);
  const minuteur = useRef(null);

  // Ferme le menu a chaque navigation, au clic ailleurs et sur Echap.
  useEffect(() => setOuvert(null), [pathname]);
  useEffect(() => {
    const clicEx = (e) => racine.current && !racine.current.contains(e.target) && setOuvert(null);
    const echap = (e) => e.key === "Escape" && setOuvert(null);
    document.addEventListener("mousedown", clicEx);
    document.addEventListener("keydown", echap);
    return () => {
      document.removeEventListener("mousedown", clicEx);
      document.removeEventListener("keydown", echap);
    };
  }, []);

  const ouvrir = (g) => {
    clearTimeout(minuteur.current);
    setOuvert(g);
  };
  // Petit delai a la fermeture : on peut traverser l'interstice sans que le menu disparaisse.
  const fermerBientot = () => {
    clearTimeout(minuteur.current);
    minuteur.current = setTimeout(() => setOuvert(null), 180);
  };

  return (
    <div ref={racine} style={{ display: "flex", gap: 6, flexWrap: "wrap", borderBottom: "1px solid var(--line)", paddingBottom: 12, position: "relative", zIndex: 20 }}>
      {ELEMENTS.map((el) => {
        if (!el.groupe) {
          const actif = estActif(pathname, el);
          return (
            <Link key={el.href} href={el.href} style={boutonStyle(actif)}>
              {t(el.key)}
            </Link>
          );
        }
        const actif = el.items.some((i) => estActif(pathname, i));
        const estOuvert = ouvert === el.groupe;
        return (
          <div
            key={el.groupe}
            style={{ position: "relative" }}
            onMouseEnter={() => ouvrir(el.groupe)}
            onMouseLeave={fermerBientot}
          >
            <button
              type="button"
              aria-haspopup="menu"
              aria-expanded={estOuvert}
              onClick={() => setOuvert(estOuvert ? null : el.groupe)}
              style={{ ...boutonStyle(actif), ...(estOuvert && !actif ? { background: "var(--line-soft)" } : {}) }}
            >
              {t(el.groupe)}
              <span aria-hidden="true" style={{ fontSize: 9, opacity: 0.7, transform: estOuvert ? "rotate(180deg)" : "none", transition: "transform .15s" }}>▼</span>
            </button>
            {estOuvert && (
              <div
                role="menu"
                style={{
                  position: "absolute",
                  top: "100%",
                  left: 0,
                  minWidth: 210,
                  marginTop: 2,
                  padding: 6,
                  background: "#fff",
                  border: "1px solid var(--line)",
                  borderRadius: 10,
                  boxShadow: "0 8px 24px rgba(15,50,55,0.14)",
                  display: "grid",
                  gap: 2,
                }}
              >
                {el.items.map((it) => {
                  const itemActif = estActif(pathname, it);
                  return (
                    <Link
                      key={it.href}
                      href={it.href}
                      role="menuitem"
                      onClick={() => setOuvert(null)}
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                        padding: "8px 12px",
                        borderRadius: 7,
                        fontSize: 12.5,
                        fontWeight: itemActif ? 700 : 500,
                        color: itemActif ? "#fff" : "var(--petrol)",
                        background: itemActif ? "var(--petrol)" : "transparent",
                        textDecoration: "none",
                        whiteSpace: "nowrap",
                      }}
                      onMouseEnter={(e) => { if (!itemActif) e.currentTarget.style.background = "var(--line-soft)"; }}
                      onMouseLeave={(e) => { if (!itemActif) e.currentTarget.style.background = "transparent"; }}
                    >
                      {t(it.key)}
                    </Link>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
