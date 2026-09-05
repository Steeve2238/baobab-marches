"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useLangue } from "../i18n/LanguageContext";
import LanguageSwitcher from "../i18n/LanguageSwitcher";
import { api, clearToken, clearUtilisateurCourant, estAdmin, getUtilisateurCourant } from "../api";

// moduleKey / tableauDeBordOnly reprennent exactement les cles renvoyees par
// GET /api/auth/permissions (voir middleware/auth.js cote backend, systeme de
// permissions par role construit le 04-05/09/2026 a la demande de Steeve) :
// un element sans l'une de ces deux marques reste visible pour tout
// utilisateur connecte (ex "Mes taches", "Mes demandes RH" - universels,
// jamais restreints par role). adminOnly reste un affichage separe (roles /
// utilisateurs / RH personnel), independant du systeme de permissions par
// module.
const NAV_ITEMS = [
  { href: "/dashboard", key: "navDashboard", tableauDeBordOnly: true },
  { href: "/mes-taches", key: "navMyTasks" },
  { href: "/financement", key: "navFinancing", moduleKey: "financement" },
  { href: "/logistique", key: "navLogistics", moduleKey: "logistique" },
  { href: "/fournisseurs", key: "navSuppliers", moduleKey: "fournisseurs" },
  { href: "/courriers", key: "navLetters", moduleKey: "courriers" },
  { href: "/parc-auto", key: "navParcAuto", moduleKey: "parc-auto" },
  { href: "/marches", key: "navMarches", moduleKey: "marches" },
  { href: "/dossiers", key: "navDossiers", moduleKey: "dossiers" },
  { href: "/rh/demandes", key: "navDemandesRH" },
  { href: "/rh/fiches-temps", key: "navFichesTemps" },
  { href: "/rh/personnel", key: "navRH", moduleKey: "rh" },
  { href: "/roles", key: "navRoles", adminOnly: true },
  { href: "/utilisateurs", key: "navUsers", adminOnly: true },
  { href: "/parametres/entete", key: "navSettings" },
];

/**
 * Coquille commune a toutes les pages authentifiees : barre laterale de
 * navigation (fixe), en-tete de contenu (titre + selecteur de langue), et
 * zone de contenu. Utiliser sur chaque page apres connexion pour une
 * navigation coherente dans toute l'application.
 */
export default function AppShell({ children, title, backHref, backLabelKey, subNav }) {
  const pathname = usePathname();
  const router = useRouter();
  const { t } = useLangue();

  // localStorage n'existe pas cote serveur (SSR) : lire le profil directement
  // dans le corps du composant produirait un HTML different entre le rendu
  // serveur et le rendu client, ce que React signale comme une erreur
  // d'hydratation (et peut faire clignoter/rebasculer toute la page en rendu
  // client). On lit donc le profil dans un effet (cote client uniquement,
  // apres le premier rendu), comme le fait deja LanguageContext pour la
  // langue choisie.
  const [profil, setProfil] = useState(null);
  const [estAdminConnecte, setEstAdminConnecte] = useState(false);
  // null tant que non chargees : les entrees de menu filtrees par module (ou
  // par tableau de bord) restent masquees jusque-la, meme principe de
  // securite deja applique aux liens adminOnly ci-dessous (on prefere ne rien
  // montrer plutot que de montrer puis retirer un lien).
  const [permissions, setPermissions] = useState(null);

  useEffect(() => {
    setProfil(getUtilisateurCourant());
    setEstAdminConnecte(estAdmin());
    api
      .getPermissions()
      .then(setPermissions)
      .catch(() => setPermissions(null));
  }, []);

  function handleLogout() {
    clearToken();
    clearUtilisateurCourant();
    router.push("/login");
  }

  // Tant que le profil n'est pas encore lu (avant l'effet ci-dessus), les
  // liens reserves ADMIN restent masques : c'est aussi ce que le serveur
  // rend, donc pas de decalage d'hydratation. Si les roles ont change depuis
  // la connexion, le backend renverra 403 de toute facon a la moindre
  // requete (voir requireRole cote backend) - ce filtre est un confort
  // d'affichage, pas un controle d'acces.
  const navItems = NAV_ITEMS.filter((item) => {
    if (item.adminOnly) return estAdminConnecte;
    if (item.tableauDeBordOnly) return !!permissions?.tableauDeBord;
    if (item.moduleKey) {
      if (!permissions) return false;
      if (permissions.admin) return true;
      // "dossiers" fait exception : quiconque a le tableau de bord general y
      // a deja acces de fait (le tableau de bord EST le portefeuille des
      // dossiers) - meme regle que requireModule cote backend.
      if (item.moduleKey === "dossiers" && permissions.tableauDeBord) return true;
      // "marches" fait aussi exception pour un validateur universel (DG /
      // Directeur Financier, Phase 2 du systeme de permissions par role,
      // 05/09/2026) : meme sans "marches" dans son perimetre standard
      // (ex Directeur Financier = Financement uniquement), il doit pouvoir
      // consulter et valider/refuser un devis en l'absence de l'autre
      // validateur - voir le meme raisonnement cote backend dans
      // routes/ventes.js.
      if (item.moduleKey === "marches" && permissions.validateurUniversel) return true;
      return (permissions.modules || []).includes(item.moduleKey);
    }
    return true;
  });

  return (
    <div style={{ display: "flex", minHeight: "100vh" }}>
      <aside style={sidebarStyle}>
        <div style={{ padding: "22px 18px 18px", display: "flex", alignItems: "center", gap: 10 }}>
          <div style={logoStyle}>B</div>
          <div>
            <div style={{ fontFamily: "Space Grotesk", fontWeight: 700, fontSize: 14.5, color: "#fff" }}>
              Baobab Marchés
            </div>
            <div style={{ fontSize: 10.5, color: "rgba(255,255,255,0.6)" }}>{t("appSubtitle")}</div>
          </div>
        </div>

        {/* flex 1 1 auto + minHeight:0 + overflowY:auto : quand la liste de
            liens est plus haute que l'espace disponible (barre laterale a
            hauteur fixe 100vh, voir sidebarStyle), c'est CETTE zone qui
            defile avec sa propre barre de defilement - le logo en haut et le
            profil/deconnexion en bas restent toujours visibles et ne sont
            jamais pousses hors du fond colore de la barre laterale (bug
            constate et corrige le 04/09/2026, apparu avec l'ajout de
            l'entree de navigation Ventes qui a fait deborder la liste). */}
        <nav style={{ padding: "8px 12px", flex: "1 1 auto", minHeight: 0, overflowY: "auto" }}>
          {navItems.map((item) => {
            // Egalite stricte ou prefixe (pour les modules a plusieurs
            // sous-pages, ex "/marches/consultation-restreinte/devis" doit
            // garder l'entree "Marche" active) - avant la fusion
            // Ventes/Concurrence sous "Marche" (04/09/2026), seule l'egalite
            // stricte etait utilisee et les sous-pages ne mettaient rien en
            // surbrillance dans la barre laterale (la sous-navigation en
            // haut de page suffisait pour ce cas precis, mais ne s'applique
            // pas a l'ecran de choix /marches lui-meme).
            const actif = pathname === item.href || pathname.startsWith(`${item.href}/`);
            return (
              <Link
                key={item.href}
                href={item.href}
                style={{
                  display: "block",
                  padding: "9px 12px",
                  borderRadius: 8,
                  fontSize: 13,
                  fontWeight: actif ? 700 : 500,
                  color: actif ? "#fff" : "rgba(255,255,255,0.65)",
                  background: actif ? "rgba(255,255,255,0.14)" : "transparent",
                  marginBottom: 2,
                }}
              >
                {t(item.key)}
              </Link>
            );
          })}
        </nav>

        <div style={{ padding: "0 16px 16px" }}>
          {profil?.email && (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                padding: "10px 4px",
                borderTop: "1px solid rgba(255,255,255,0.1)",
                marginBottom: 10,
              }}
            >
              <div style={avatarStyle}>
                {profil.prenom ? profil.prenom.charAt(0) : profil.email.charAt(0)}
                {profil.nom ? profil.nom.charAt(0) : ""}
              </div>
              <div style={{ minWidth: 0 }}>
                {/* prenom/nom sont absents si le profil vient du secours par
                    decodage du token (session ouverte avant l'ajout de ce
                    profil - voir getUtilisateurCourant) : on affiche alors
                    seulement l'e-mail plutot qu'un nom vide. Une
                    reconnexion normale retablit prenom/nom. */}
                {profil.prenom && (
                  <div
                    style={{
                      fontSize: 12.5,
                      fontWeight: 600,
                      color: "#fff",
                      whiteSpace: "nowrap",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                    }}
                  >
                    {profil.prenom} {profil.nom}
                  </div>
                )}
                <div
                  style={{
                    fontSize: profil.prenom ? 10 : 12.5,
                    fontWeight: profil.prenom ? 400 : 600,
                    color: profil.prenom ? "rgba(255,255,255,0.55)" : "#fff",
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                  }}
                >
                  {profil.email}
                </div>
              </div>
            </div>
          )}
          <button onClick={handleLogout} style={logoutBtnStyle}>
            {t("signOut")}
          </button>
        </div>
      </aside>

      <main style={{ flex: 1, background: "var(--bg)", minWidth: 0 }}>
        <div style={{ maxWidth: 1100, margin: "0 auto", padding: "24px 28px 60px" }}>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "flex-start",
              marginBottom: 20,
              gap: 16,
            }}
          >
            <div>
              {backHref && (
                <Link
                  href={backHref}
                  style={{ fontSize: 12.5, color: "var(--sub)", display: "block", marginBottom: 6 }}
                >
                  ← {t(backLabelKey || "backToDashboard")}
                </Link>
              )}
              {title && <h1 style={{ fontSize: 19, color: "var(--petrol)" }}>{title}</h1>}
            </div>
            <LanguageSwitcher variant="default" persistToBackend />
          </div>
          {subNav && <div style={{ marginBottom: 18 }}>{subNav}</div>}
          {children}
        </div>
      </main>
    </div>
  );
}

const sidebarStyle = {
  width: 216,
  flexShrink: 0,
  background: "var(--petrol)",
  display: "flex",
  flexDirection: "column",
  position: "sticky",
  top: 0,
  height: "100vh",
};

const logoStyle = {
  width: 32,
  height: 32,
  borderRadius: 9,
  background: "linear-gradient(135deg, var(--ocre), #E0954C)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  fontWeight: 700,
  color: "#1a1a1a",
  flexShrink: 0,
};

const avatarStyle = {
  width: 30,
  height: 30,
  borderRadius: "50%",
  background: "rgba(255,255,255,0.14)",
  color: "#fff",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  fontSize: 11.5,
  fontWeight: 700,
  flexShrink: 0,
  textTransform: "uppercase",
};

const logoutBtnStyle = {
  width: "100%",
  background: "rgba(255,255,255,0.08)",
  border: "1px solid rgba(255,255,255,0.15)",
  color: "#fff",
  borderRadius: 8,
  padding: "8px 12px",
  fontSize: 12.5,
};
