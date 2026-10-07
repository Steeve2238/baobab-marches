"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useLangue } from "../i18n/LanguageContext";
import { useComptaStatut } from "../comptaUi";

// Sous-navigation du module Comptabilite : quelques entrees de premier niveau,
// les autres regroupees en menus deroulants (survol ou clic) pour que la barre
// reste sur une seule ligne quelle que soit le nombre de pages.
const ELEMENTS = [
  { href: "/comptabilite", key: "comptaNavAccueil", exact: true },
  {
    groupe: "comptaGroupeOperations",
    items: [
      { href: "/comptabilite/factures-emises", key: "comptaNavFacturesEmises" },
      { href: "/comptabilite/achats", key: "comptaNavAchats" },
      { href: "/comptabilite/reglements", key: "comptaNavReglements" },
      { href: "/comptabilite/tresorerie", key: "comptaNavTresorerie" },
    ],
  },
  {
    groupe: "comptaGroupeEcritures",
    items: [
      { href: "/comptabilite/instance", key: "comptaNavInstance", badge: true },
      { href: "/comptabilite/ecritures", key: "comptaNavEcritures" },
      { href: "/comptabilite/lettrage", key: "comptaNavLettrage" },
      { href: "/comptabilite/importer", key: "comptaNavImporter" },
    ],
  },
  {
    groupe: "comptaGroupeEtats",
    items: [
      { href: "/comptabilite/grand-livre", key: "comptaNavGrandLivre" },
      { href: "/comptabilite/balance", key: "comptaNavBalance" },
      { href: "/comptabilite/balances-tiers", key: "comptaNavBalancesTiers" },
      { href: "/comptabilite/balance-agee", key: "comptaNavBalanceAgee" },
      { href: "/comptabilite/analytique", key: "comptaNavAnalytique" },
      { href: "/comptabilite/bilan", key: "comptaNavBilan" },
      { href: "/comptabilite/resultat", key: "comptaNavResultat" },
    ],
  },
  {
    groupe: "comptaGroupeReferentiels",
    items: [
      { href: "/comptabilite/immobilisations", key: "comptaNavImmobilisations" },
      { href: "/comptabilite/plan", key: "comptaNavPlan" },
      { href: "/comptabilite/tiers", key: "comptaNavTiers" },
    ],
  },
  { href: "/comptabilite/parametres", key: "comptaNavParametres" },
];

const estActif = (pathname, o) =>
  o.exact ? pathname === o.href : pathname === o.href || pathname.startsWith(o.href + "/");

const pastilleStyle = (actif) => ({
  marginLeft: 6,
  padding: "1px 7px",
  borderRadius: 10,
  fontSize: 11,
  fontWeight: 700,
  background: actif ? "#fff" : "var(--ocre)",
  color: actif ? "var(--petrol)" : "#fff",
});

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

export default function ComptaSousNav() {
  const pathname = usePathname();
  const { t } = useLangue();
  const { statut } = useComptaStatut();
  const enInstance = statut?.en_attente?.en_instance || 0;
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
        const nbInstance = el.items.some((i) => i.badge) ? enInstance : 0;
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
              {nbInstance > 0 && <span style={{ ...pastilleStyle(actif), marginLeft: 2 }}>{nbInstance}</span>}
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
                      {it.badge && enInstance > 0 && <span style={pastilleStyle(itemActif)}>{enInstance}</span>}
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
