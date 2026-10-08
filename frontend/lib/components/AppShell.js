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
// Barre laterale a deux niveaux maximum (groupe -> module), demande de Steeve
// du 05/10/2026 (proposition A, "par metier") : 17 entrees a plat remplacees
// par 2 acces directs + 5 groupes depliables (un seul ouvert a la fois, celui
// de la page en cours s'ouvre tout seul). Les onglets internes de chaque
// module (ex les 7 de Marche, les 9 de Comptabilite) restent dans les pages,
// ils ne sont JAMAIS dupliques ici. Les regles d'acces de chaque entree sont
// inchangees (voir itemVisible) ; un groupe disparait si aucune de ses
// entrees n'est visible. `alsoActive` : sous-pages d'un module qui n'ont pas
// d'entree propre mais doivent garder le bon module surligne.
const NAV_ITEMS = [
  { href: "/dashboard", key: "navDashboard", tableauDeBordOnly: true },
  { href: "/mes-taches", key: "navMyTasks" },
  {
    id: "marches-ventes",
    key: "navGroupMarchesVentes",
    items: [
      { href: "/marches", key: "navMarches", moduleKey: "marches" },
      { href: "/dossiers", key: "navDossiers", moduleKey: "dossiers" },
      // "Dossier de calcul" (prix de revient et marge) est rattache soit a un
      // dossier d'AO soit a une consultation restreinte (jamais les deux) -
      // donc visible des qu'on a l'un OU l'autre des deux modules
      // correspondants, meme regle d'acces que le gate OR dans
      // routes/calculPrix.js cote backend (moduleKeyAny, distinct de
      // moduleKey qui exige une egalite exacte a une seule cle).
      { href: "/calcul-prix", key: "navCalculPrix", moduleKeyAny: ["marches", "dossiers"] },
      // Catalogue produits (base de calcul globale) : meme regle d'acces que le dossier de calcul.
      { href: "/produits", key: "navProduits", moduleKeyAny: ["marches", "dossiers"] },
      { href: "/courriers", key: "navLetters", moduleKey: "courriers" },
    ],
  },
  {
    id: "finance",
    key: "navGroupFinance",
    items: [
      { href: "/financement", key: "navFinancing", moduleKey: "financement" },
      // Comptabilite : cle stricte (ni tableau de bord ni validateur universel seul) - voir routes/comptabilite.js.
      // requiresFlag : module vendu en option (migration 032), verrouille par defaut -
      // masque tant que le Super Admin ne l'a pas active pour ce client (meme pour un ADMIN).
      { href: "/comptabilite", key: "navComptabilite", moduleKeyStrictAny: ["comptabilite", "comptabilite-validation"], requiresFlag: "comptabiliteActive" },
      // Fiscalite : module payant distinct (migration 049), meme principe de verrou que la Comptabilite.
      { href: "/fiscalite", key: "navFiscalite", moduleKeyStrictAny: ["fiscalite", "fiscalite-validation"], requiresFlag: "fiscaliteActive" },
    ],
  },
  {
    id: "achats-moyens",
    key: "navGroupAchatsMoyens",
    items: [
      { href: "/fournisseurs", key: "navSuppliers", moduleKey: "fournisseurs" },
      // Receptions de marchandises + stock : fournisseurs OU marches (les equipes commerciales consultent le stock).
      { href: "/commandes", key: "navCommandes", moduleKeyAny: ["fournisseurs", "marches"] },
      { href: "/receptions", key: "navReceptions", moduleKeyAny: ["fournisseurs", "marches"] },
      { href: "/prix-fournisseurs", key: "navPrixFournisseurs", moduleKeyAny: ["fournisseurs", "marches"] },
      { href: "/livraisons-dossier", key: "navLivraisonsDossier", moduleKeyAny: ["dossiers", "marches", "fournisseurs"] },
      { href: "/transitaires", key: "navTransitaires", moduleKeyAny: ["logistique", "fournisseurs", "marches"] },
      { href: "/logistique", key: "navLogistics", moduleKey: "logistique" },
      { href: "/parc-auto", key: "navParcAuto", moduleKey: "parc-auto" },
    ],
  },
  {
    id: "rh",
    key: "navGroupRH",
    items: [
      { href: "/rh/mon-espace", key: "navMonEspaceRH" },
      { href: "/rh/demandes", key: "navDemandesRH" },
      { href: "/rh/fiches-temps", key: "navFichesTemps" },
      {
        href: "/rh/personnel",
        key: "navPersonnelRH",
        moduleKey: "rh",
        alsoActive: ["/rh/circuit-approbation", "/rh/planning-conges", "/rh/statistiques"],
      },
      { href: "/rh/courriers", key: "navCourriersRH", moduleKey: "rh", alsoActive: ["/rh/modeles-courriers"] },
      // Paie : module payant (migration 061), meme principe de verrou que la Fiscalite.
      { href: "/paie", key: "navPaie", moduleKeyStrictAny: ["paie", "paie-validation"], requiresFlag: "paieActive", alsoActive: ["/rh/contrats", "/rh/modeles-contrats", "/rh/dmt", "/rh/ordres-virement"] },
    ],
  },
  {
    id: "administration",
    key: "navGroupAdmin",
    items: [
      { href: "/roles", key: "navRoles", adminOnly: true },
      { href: "/utilisateurs", key: "navUsers", adminOnly: true },
      { href: "/parametres/entete", key: "navSettings" },
    ],
  },
];

// Une entree est "active" sur son href exact, sur ses sous-pages (ex
// "/marches/consultation-restreinte/devis" garde "Marche" actif) ou sur l'une
// de ses sous-pages declarees dans alsoActive.
function entreeActive(item, pathname) {
  const prefixes = [item.href, ...(item.alsoActive || [])];
  return prefixes.some((h) => pathname === h || pathname.startsWith(`${h}/`));
}

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
  function itemVisible(item) {
    if (item.requiresFlag && !permissions?.[item.requiresFlag]) return false;
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
    if (item.moduleKeyStrictAny) {
      if (!permissions) return false;
      if (permissions.admin) return true;
      return item.moduleKeyStrictAny.some((m) => (permissions.modules || []).includes(m));
    }
    if (item.moduleKeyAny) {
      if (!permissions) return false;
      if (permissions.admin || permissions.tableauDeBord) return true;
      return item.moduleKeyAny.some((m) => (permissions.modules || []).includes(m));
    }
    return true;
  }

  // Elements du menu a afficher : acces directs visibles + groupes dont au
  // moins une entree est visible (la liste d'entrees du groupe est deja filtree).
  // Profil d'activite du client (migration 068) : NEGOCE = menu « Ventes » (acces direct a la liste des
  // ventes, sans Appel d'offres ni Dossiers). MARCHES et LES_DEUX gardent le menu actuel. Aucune permission
  // n'est modifiee : seuls l'intitule et la destination des entrees changent.
  const profilActivite = permissions?.profilActivite || "LES_DEUX";
  function adapterProfil(entry) {
    if (profilActivite !== "NEGOCE" || entry.id !== "marches-ventes") return entry;
    return {
      ...entry,
      key: "navGroupVentes",
      items: entry.items
        .filter((i) => i.href !== "/dossiers")
        .map((i) =>
          i.href === "/marches"
            ? { ...i, href: "/marches/consultation-restreinte/consultations", key: "navVentes", alsoActive: ["/marches"] }
            : i
        ),
    };
  }
  const navItems = NAV_ITEMS.map(adapterProfil)
    .map((entry) => (entry.items ? { ...entry, items: entry.items.filter(itemVisible) } : entry))
    .filter((entry) => (entry.items ? entry.items.length > 0 : itemVisible(entry)));

  // Un seul groupe ouvert a la fois : celui de la page en cours par defaut
  // (et a chaque changement de page), sinon celui choisi par un clic.
  const groupeActif = NAV_ITEMS.find((e) => e.items && e.items.some((i) => entreeActive(i, pathname)))?.id || null;
  const [groupeOuvert, setGroupeOuvert] = useState(groupeActif);
  useEffect(() => {
    if (groupeActif) setGroupeOuvert(groupeActif);
  }, [groupeActif]);

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
          {navItems.map((entry) => {
            if (!entry.items) return <NavLien key={entry.href} item={entry} actif={entreeActive(entry, pathname)} t={t} />;
            const ouvert = groupeOuvert === entry.id;
            const contientActif = entry.items.some((i) => entreeActive(i, pathname));
            return (
              <div key={entry.id} style={{ marginTop: 6 }}>
                <button
                  type="button"
                  onClick={() => setGroupeOuvert(ouvert ? null : entry.id)}
                  aria-expanded={ouvert}
                  style={{
                    width: "100%",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    padding: "9px 12px",
                    borderRadius: 8,
                    border: "none",
                    background: "transparent",
                    cursor: "pointer",
                    fontFamily: "inherit",
                    fontSize: 13,
                    fontWeight: contientActif ? 700 : 600,
                    color: contientActif ? "#fff" : "rgba(255,255,255,0.85)",
                    textAlign: "left",
                  }}
                >
                  <span>{t(entry.key)}</span>
                  <span
                    aria-hidden="true"
                    style={{
                      width: 6,
                      height: 6,
                      borderRight: "1.5px solid rgba(255,255,255,0.7)",
                      borderBottom: "1.5px solid rgba(255,255,255,0.7)",
                      transform: ouvert ? "rotate(45deg)" : "rotate(-45deg)",
                      transition: "transform 0.15s",
                      marginRight: 3,
                      flexShrink: 0,
                    }}
                  />
                </button>
                {ouvert && (
                  <div style={{ marginLeft: 18, paddingLeft: 6, borderLeft: "1px solid rgba(255,255,255,0.14)" }}>
                    {entry.items.map((item) => (
                      <NavLien key={item.href} item={item} actif={entreeActive(item, pathname)} t={t} sousMenu />
                    ))}
                  </div>
                )}
              </div>
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

// Lien de navigation (acces direct ou entree de sous-menu).
function NavLien({ item, actif, t, sousMenu }) {
  return (
    <Link
      href={item.href}
      style={{
        display: "block",
        padding: sousMenu ? "7px 12px" : "9px 12px",
        borderRadius: 8,
        fontSize: sousMenu ? 12.5 : 13,
        fontWeight: actif ? 700 : 500,
        color: actif ? "#fff" : "rgba(255,255,255,0.65)",
        background: actif ? "rgba(255,255,255,0.14)" : "transparent",
        marginBottom: 2,
      }}
    >
      {t(item.key)}
    </Link>
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
