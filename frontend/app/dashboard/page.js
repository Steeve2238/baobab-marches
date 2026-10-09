"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { api } from "../../lib/api";
import { useLangue } from "../../lib/i18n/LanguageContext";
import AppShell from "../../lib/components/AppShell";

// Regroupement des statuts detailles du dossier en 4 grandes categories pour
// les cartes de statistiques du tableau de bord (le statut precis reste
// visible sur chaque carte de dossier - ce regroupement est uniquement une
// vue d'ensemble en un coup d'oeil).
const GROUPES_STATUT = {
  ANALYSE: "OUVERT",
  GO: "OUVERT",
  SOUMIS: "OUVERT",
  ATTRIBUE: "EN_COURS",
  EN_EXECUTION: "EN_COURS",
  RECEPTION: "EN_COURS",
  CLOTURE: "TERMINE",
  NON_ATTRIBUE: "REJETE",
  NO_GO: "REJETE",
};

export default function DashboardPage() {
  const router = useRouter();
  const { t, statutLabel, dict } = useLangue();
  const [dossiers, setDossiers] = useState([]);
  const [signaux, setSignaux] = useState([]);
  const [fournisseurs, setFournisseurs] = useState([]);
  const [partenaires, setPartenaires] = useState([]);
  const [incoterms, setIncoterms] = useState([]);
  const [transitaires, setTransitaires] = useState([]);
  const [modelesCourrier, setModelesCourrier] = useState([]);
  const [utilisateurs, setUtilisateurs] = useState([]);
  const [roles, setRoles] = useState([]);
  const [permissions, setPermissions] = useState(null);
  const [chargement, setChargement] = useState(true);
  const [erreur, setErreur] = useState("");
  const [filtreGroupe, setFiltreGroupe] = useState(null);
  // Periode d'analyse (vue dirigeant) : filtre les dossiers selon leur date de creation.
  const [periode, setPeriode] = useState("TOUT");

  useEffect(() => {
    async function charger() {
      try {
        // Permissions d'abord (systeme de permissions par role, 04-05/09/2026) :
        // certains profils qui accedent au tableau de bord (tableauDeBord true)
        // n'ont neanmoins pas tous les modules dans leur perimetre - ex.
        // Directeur Financier (financement uniquement) ou Directeur Technique
        // (pas financement/marches/courriers). On n'appelle donc que les
        // routes de module que le profil connecte peut effectivement lire,
        // pour ne jamais provoquer un 403 evitable.
        const permissionsData = await api.getPermissions().catch(() => null);
        setPermissions(permissionsData);
        const modulesAutorises = permissionsData?.admin ? null : new Set(permissionsData?.modules || []);
        const autorise = (moduleKey) => modulesAutorises === null || modulesAutorises.has(moduleKey);

        // Les stats "par domaine" ci-dessous s'appuient sur des listes
        // globales deja exposees par chaque module (pas de nouvelle route
        // backend) : ce sont des compteurs d'INVENTAIRE (ce qui est
        // configure aujourd'hui), pas encore des stats d'ACTIVITE agregees
        // sur l'ensemble des dossiers (montant total finance, delai moyen
        // reel...) - celles-ci demanderaient une route d'agregation dediee.
        //
        // Promise.allSettled (et non Promise.all, jusqu'au 05/09/2026) : avec
        // Promise.all, un seul module hors du perimetre du profil connecte
        // (403 attendu, pas une panne) faisait echouer TOUT le chargement et
        // affichait une page d'erreur generique a la place du tableau de
        // bord entier - y compris pour les sections auxquelles la personne a
        // bien droit.
        const resultats = await Promise.allSettled([
          api.getDossiers(),
          api.getSignaux(),
          autorise("fournisseurs") ? api.getFournisseurs() : Promise.resolve([]),
          autorise("financement") ? api.finBanques() : Promise.resolve([]),
          autorise("logistique") ? api.getIncoterms() : Promise.resolve([]),
          autorise("logistique") ? api.getTransitaires() : Promise.resolve([]),
          autorise("courriers") ? api.getModelesCourrier() : Promise.resolve([]),
          api.getUtilisateurs(),
          api.getRoles(),
        ]);
        const [
          dossiersR,
          signauxR,
          fournisseursR,
          partenairesR,
          incotermsR,
          transitairesR,
          modelesCourrierR,
          utilisateursR,
          rolesR,
        ] = resultats;

        setDossiers(dossiersR.status === "fulfilled" ? dossiersR.value : []);
        setSignaux(signauxR.status === "fulfilled" ? signauxR.value : []);
        setFournisseurs(fournisseursR.status === "fulfilled" ? fournisseursR.value : []);
        setPartenaires(partenairesR.status === "fulfilled" ? partenairesR.value : []);
        setIncoterms(incotermsR.status === "fulfilled" ? incotermsR.value : []);
        setTransitaires(transitairesR.status === "fulfilled" ? transitairesR.value : []);
        setModelesCourrier(modelesCourrierR.status === "fulfilled" ? modelesCourrierR.value : []);
        setUtilisateurs(utilisateursR.status === "fulfilled" ? utilisateursR.value : []);
        setRoles(rolesR.status === "fulfilled" ? rolesR.value : []);

        // Si TOUS les appels echouent, c'est vraisemblablement une session
        // invalide/expiree (et non un simple 403 de perimetre localise) - on
        // redirige alors vers la connexion, comme le faisait l'ancienne
        // version a base de Promise.all pour toute erreur.
        if (resultats.every((r) => r.status === "rejected")) {
          const message = resultats[0].reason?.message || "";
          if (
            String(message).includes("Authentification") ||
            String(message).includes("expiree") ||
            String(message).includes("Authentication") ||
            String(message).includes("expired")
          ) {
            router.push("/login");
            return;
          }
          setErreur(message || t("defaultLoadError"));
        }
      } catch (err) {
        setErreur(err.message || t("defaultLoadError"));
      } finally {
        setChargement(false);
      }
    }
    charger();
  }, [router, t]);

  async function handleAcquitter(id) {
    try {
      await api.acquitterSignal(id);
      setSignaux((prev) => prev.map((s) => (s.id === id ? { ...s, accuse_reception: true } : s)));
    } catch (err) {
      // silencieux : l'utilisateur peut reessayer
    }
  }

  const signauxActifs = signaux.filter((s) => !s.accuse_reception);

  const maintenant = new Date();
  const debutPeriode =
    periode === "MOIS"
      ? new Date(maintenant.getFullYear(), maintenant.getMonth(), 1)
      : periode === "TRIMESTRE"
      ? new Date(maintenant.getFullYear(), maintenant.getMonth() - 2, 1)
      : periode === "ANNEE"
      ? new Date(maintenant.getFullYear(), 0, 1)
      : null;
  const dossiersPeriode = debutPeriode
    ? dossiers.filter((d) => d.date_creation && new Date(d.date_creation) >= debutPeriode)
    : dossiers;

  const statsGroupes = { OUVERT: 0, EN_COURS: 0, TERMINE: 0, REJETE: 0 };
  const parStatut = {};
  for (const d of dossiersPeriode) {
    const groupe = GROUPES_STATUT[d.statut];
    if (groupe) statsGroupes[groupe] += 1;
    parStatut[d.statut] = (parStatut[d.statut] || 0) + 1;
  }
  const dossiersAffiches = filtreGroupe
    ? dossiersPeriode.filter((d) => GROUPES_STATUT[d.statut] === filtreGroupe)
    : dossiersPeriode;
  const totalPeriode = dossiersPeriode.length;
  const tauxRejet = totalPeriode > 0 ? Math.round((statsGroupes.REJETE / totalPeriode) * 100) : null;

  // Points d'attention : faits lisibles dans les donnees, sans regle de retard inventee.
  // Dossiers rejetes ; date limite de soumission proche (7 jours) ou depassee pour un dossier pas encore soumis.
  const pointsAttention = [];
  for (const d of dossiersPeriode) {
    if (GROUPES_STATUT[d.statut] === "REJETE") pointsAttention.push({ id: d.id, niveau: "critique", type: "rejete", dossier: d });
    else if ((d.statut === "ANALYSE" || d.statut === "GO") && d.date_limite_soumission) {
      const jours = Math.ceil((new Date(d.date_limite_soumission) - maintenant) / 86400000);
      if (jours < 0) pointsAttention.push({ id: d.id, niveau: "critique", type: "depasse", dossier: d, jours: -jours });
      else if (jours <= 7) pointsAttention.push({ id: d.id, niveau: "attention", type: "proche", dossier: d, jours });
    }
  }
  pointsAttention.sort((a, b) => (a.niveau === b.niveau ? 0 : a.niveau === "critique" ? -1 : 1));

  function handleClicStat(groupe) {
    setFiltreGroupe((prev) => (prev === groupe ? null : groupe));
  }

  const scoresFiabilite = fournisseurs.map((f) => (f.score_fiabilite == null ? null : Number(f.score_fiabilite))).filter((s) => s != null && Number.isFinite(s));
  const scoreFiabiliteMoyen = scoresFiabilite.length
    ? Math.round(scoresFiabilite.reduce((a, b) => a + b, 0) / scoresFiabilite.length)
    : null;
  const nbBanques = partenaires.filter((p) => p.type_partenaire === "BANQUE").length;
  const nbAssurances = partenaires.filter((p) => p.type_partenaire === "ASSURANCE").length;
  const utilisateursActifs = utilisateurs.filter((u) => u.actif).length;

  // moduleKey : null = jamais filtre (routes utilisateurs/roles non
  // restreintes par module cote backend, voir routes/utilisateurs.js et
  // roles.js) ; sinon la carte n'apparait que si le profil connecte a ce
  // module dans son perimetre (memes cles que permissions.modules).
  const domainesDefinis = [
    {
      href: "/fournisseurs",
      moduleKey: "fournisseurs",
      titre: t("domainSuppliers"),
      lignes: [
        { valeur: fournisseurs.length, libelle: t("domainSuppliersCount") },
        { valeur: scoreFiabiliteMoyen != null ? `${scoreFiabiliteMoyen}%` : "—", libelle: t("domainAvgReliability") },
      ],
    },
    {
      href: "/financement",
      moduleKey: "financement",
      titre: t("domainFinancing"),
      lignes: [
        { valeur: partenaires.length, libelle: t("domainPartnersCount") },
        { valeur: `${nbBanques} / ${nbAssurances}`, libelle: t("domainBanksInsurers") },
      ],
    },
    {
      href: "/logistique",
      moduleKey: "logistique",
      titre: t("domainLogistics"),
      lignes: [
        { valeur: incoterms.length, libelle: t("domainIncotermsCount") },
        { valeur: transitaires.length, libelle: t("domainForwardersCount") },
      ],
    },
    {
      href: "/courriers",
      moduleKey: "courriers",
      titre: t("domainLetters"),
      lignes: [{ valeur: modelesCourrier.length, libelle: t("domainTemplatesCount") }],
    },
    {
      href: "/utilisateurs",
      moduleKey: null,
      titre: t("domainTeam"),
      lignes: [
        { valeur: `${utilisateursActifs} / ${utilisateurs.length}`, libelle: t("domainActiveUsers") },
        { valeur: roles.length, libelle: t("domainRolesCount") },
      ],
    },
  ];
  const domaines = domainesDefinis.filter(
    (d) => !d.moduleKey || permissions?.admin || (permissions?.modules || []).includes(d.moduleKey)
  );

  return (
    <AppShell title={t("navDashboard")}>
      {chargement && <p>{t("loading")}</p>}
      {erreur && <p style={{ color: "var(--brique)" }}>{erreur}</p>}

      {!chargement && !erreur && (
        <>
          {/* Filtre de periode (vue dirigeant) */}
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center", marginBottom: 14 }}>
            <span style={{ fontSize: 11.5, color: "var(--sub)", fontWeight: 600 }}>{t("dashPeriode")}</span>
            {[["TOUT", "dashPeriodeTout"], ["MOIS", "dashPeriodeMois"], ["TRIMESTRE", "dashPeriodeTrimestre"], ["ANNEE", "dashPeriodeAnnee"]].map(([k, cle]) => (
              <button
                key={k}
                type="button"
                onClick={() => {
                  setPeriode(k);
                  setFiltreGroupe(null);
                }}
                style={{
                  border: "1px solid var(--line)",
                  background: periode === k ? "var(--petrol)" : "#fff",
                  color: periode === k ? "#fff" : "var(--ink)",
                  borderRadius: 999,
                  padding: "4px 12px",
                  fontSize: 11.5,
                  fontWeight: 600,
                  cursor: "pointer",
                }}
              >
                {t(cle)}
              </button>
            ))}
          </div>

          {signauxActifs.length === 0 ? (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                background: "var(--petrol)",
                color: "#C9DEDC",
                borderRadius: 10,
                padding: "8px 14px",
                fontSize: 12,
                marginBottom: 16,
              }}
            >
              <span style={{ width: 8, height: 8, borderRadius: "50%", background: "#5FB8C4", flexShrink: 0 }} />
              <span>
                <strong style={{ color: "#fff" }}>0 {t("signalSingular")}</strong> · {t("dashAucunSignalCourt")}
              </span>
            </div>
          ) : (
          <section
            className="card"
            style={{ background: "var(--petrol)", color: "#fff", marginBottom: 16 }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 14 }}>
              <div style={{ fontFamily: "Space Grotesk", fontWeight: 700, fontSize: 15 }}>
                {signauxActifs.length} {signauxActifs.length > 1 ? t("signalPlural") : t("signalSingular")}
              </div>
            </div>
            {signauxActifs.length === 0 ? (
              <p style={{ fontSize: 13, color: "#C9DEDC" }}>
                {t("noActiveSignal")}
              </p>
            ) : (
              <div style={{ display: "grid", gap: 10 }}>
                {signauxActifs.map((s) => (
                  <div
                    key={s.id}
                    style={{
                      background: "rgba(255,255,255,0.05)",
                      border: "1px solid rgba(255,255,255,0.09)",
                      borderLeft: `3px solid ${severiteColor(s.severite)}`,
                      borderRadius: 9,
                      padding: "12px 13px",
                      display: "flex",
                      justifyContent: "space-between",
                      gap: 12,
                    }}
                  >
                    <div>
                      <div style={{ fontSize: 10, textTransform: "uppercase", color: "#9FC6C2", marginBottom: 4 }}>
                        {s.domaine || t("general")} · {s.dossier_intitule || t("portfolio")}
                      </div>
                      <div style={{ fontSize: 12.8 }}>{s.message}</div>
                    </div>
                    <button
                      onClick={() => handleAcquitter(s.id)}
                      style={{
                        background: "rgba(255,255,255,0.1)",
                        border: "none",
                        color: "#fff",
                        borderRadius: 6,
                        padding: "4px 10px",
                        fontSize: 11.5,
                        height: "fit-content",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {t("acknowledge")}
                    </button>
                  </div>
                ))}
              </div>
            )}
          </section>

          )}

          {/* 4 indicateurs essentiels */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: 10, marginBottom: 16 }}>
            <StatCard valeur={totalPeriode} libelle={t("statTotalFiles")} actif={filtreGroupe === null} onClick={() => setFiltreGroupe(null)} />
            <StatCard valeur={statsGroupes.OUVERT} libelle={t("statOpenFiles")} couleur="var(--ocre)" actif={filtreGroupe === "OUVERT"} onClick={() => handleClicStat("OUVERT")} />
            <StatCard
              valeur={tauxRejet === null ? "—" : `${tauxRejet} %`}
              libelle={`${t("dashTauxRejet")}${totalPeriode > 0 ? ` (${statsGroupes.REJETE}/${totalPeriode})` : ""}`}
              couleur={statsGroupes.REJETE > 0 ? "var(--brique)" : "var(--petrol)"}
              actif={filtreGroupe === "REJETE"}
              onClick={() => handleClicStat("REJETE")}
            />
            <StatCard valeur={signauxActifs.length} libelle={t("dashSignauxActifs")} couleur={signauxActifs.length > 0 ? "var(--ocre)" : "var(--petrol)"} actif={false} onClick={() => {}} />
          </div>
          {totalPeriode > 0 && totalPeriode < 5 && (
            <p style={{ fontSize: 11, color: "var(--sub)", marginTop: -8, marginBottom: 14 }}>{t("dashPetitEchantillon")}</p>
          )}

          {/* Graphiques de synthese */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: 10, marginBottom: 16 }}>
            <section className="card" style={{ padding: "14px 16px" }}>
              <h2 style={chartTitreStyle}>{t("dashRepartitionStatut")}</h2>
              <Anneau
                total={totalPeriode}
                segments={[
                  { cle: "OUVERT", libelle: t("statOpenFiles"), valeur: statsGroupes.OUVERT, couleur: "var(--ocre)" },
                  { cle: "EN_COURS", libelle: t("statOngoingFiles"), valeur: statsGroupes.EN_COURS, couleur: "#5FB8C4" },
                  { cle: "TERMINE", libelle: t("statClosedFiles"), valeur: statsGroupes.TERMINE, couleur: "#2E7D5B" },
                  { cle: "REJETE", libelle: t("statRejectedFiles"), valeur: statsGroupes.REJETE, couleur: "var(--brique)" },
                ]}
                actifCle={filtreGroupe}
                onChoisir={handleClicStat}
                unite={t("dashUniteDossiers")}
                vide={t("dashAucunDossier")}
              />
            </section>
            <section className="card" style={{ padding: "14px 16px" }}>
              <h2 style={chartTitreStyle}>{t("dashDossiersParEtape")}</h2>
              <BarresHorizontales
                lignes={["ANALYSE", "GO", "SOUMIS", "ATTRIBUE", "EN_EXECUTION", "RECEPTION", "CLOTURE", "NON_ATTRIBUE", "NO_GO"].map((st) => ({
                  cle: st,
                  libelle: statutLabel(st),
                  valeur: parStatut[st] || 0,
                  couleur: GROUPES_STATUT[st] === "REJETE" ? "var(--brique)" : GROUPES_STATUT[st] === "TERMINE" ? "#2E7D5B" : GROUPES_STATUT[st] === "EN_COURS" ? "#5FB8C4" : "var(--ocre)",
                }))}
                vide={t("dashAucunDossier")}
              />
            </section>
          </div>

          {/* Points d'attention */}
          <section className="card" style={{ padding: "14px 16px", marginBottom: 24 }}>
            <h2 style={chartTitreStyle}>{t("dashPointsAttention")}</h2>
            {pointsAttention.length === 0 ? (
              <p style={{ fontSize: 12, color: "var(--sub)", margin: 0 }}>{t("dashAucunPoint")}</p>
            ) : (
              <div style={{ display: "grid", gap: 6 }}>
                {pointsAttention.slice(0, 6).map((p) => (
                  <Link
                    key={`${p.type}-${p.id}`}
                    href={`/dossiers/${p.id}`}
                    style={{ display: "flex", gap: 10, alignItems: "baseline", fontSize: 12.5, color: "var(--ink)", textDecoration: "none" }}
                  >
                    <span style={{ width: 8, height: 8, borderRadius: "50%", flexShrink: 0, background: p.niveau === "critique" ? "var(--brique)" : "var(--ocre)" }} />
                    <span style={{ fontWeight: 600 }}>{p.dossier.intitule}</span>
                    <span style={{ color: "var(--sub)" }}>
                      {p.type === "rejete" && t("dashPointRejete")}
                      {p.type === "depasse" && `${t("dashPointDepasse")} (${p.jours} ${t("dashJours")})`}
                      {p.type === "proche" && `${t("dashPointProche")} ${p.jours} ${t("dashJours")}`}
                    </span>
                  </Link>
                ))}
                {pointsAttention.length > 6 && (
                  <span style={{ fontSize: 11, color: "var(--sub)" }}>+ {pointsAttention.length - 6}</span>
                )}
              </div>
            )}
          </section>

          <h2 style={{ fontSize: 15.5, color: "var(--petrol)", marginBottom: 12 }}>{t("domainStatsSection")}</h2>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
              gap: 10,
              marginBottom: 24,
            }}
          >
            {domaines.map((domaine) => (
              <Link key={domaine.href} href={domaine.href} className="card" style={domainCardStyle}>
                <div style={{ fontSize: 11.5, fontWeight: 700, color: "var(--petrol)", marginBottom: 8 }}>
                  {domaine.titre}
                </div>
                <div style={{ display: "grid", gap: 6 }}>
                  {domaine.lignes.map((ligne) => (
                    <div key={ligne.libelle} style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                      <span style={{ fontSize: 10.5, color: "var(--sub)" }}>{ligne.libelle}</span>
                      <span className="mono" style={{ fontSize: 14, fontWeight: 700, color: "var(--ink)" }}>
                        {ligne.valeur}
                      </span>
                    </div>
                  ))}
                </div>
              </Link>
            ))}
          </div>

          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
            <h2 style={{ fontSize: 15.5, color: "var(--petrol)" }}>{t("ongoingFiles")}</h2>
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              {filtreGroupe && (
                <button onClick={() => setFiltreGroupe(null)} style={boutonEffacerFiltreStyle}>
                  {t("clearFilter")}
                </button>
              )}
              {/* Masque en mode lecture seule (Directeur General) : le clic
                  aboutirait de toute facon a un 403 cote backend
                  (blockLectureSeule sur dossiers.js), autant ne pas exposer
                  un bouton qui ne peut jamais fonctionner pour ce profil. */}
              {!permissions?.lectureSeule && (
                <Link href="/dossiers/nouveau" style={boutonNouveauDossierStyle}>
                  + {t("newDossierButton")}
                </Link>
              )}
            </div>
          </div>

          {dossiersAffiches.length === 0 ? (
            <p className="card" style={{ fontSize: 13, color: "var(--sub)" }}>
              {t("noFiles")}
            </p>
          ) : (
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))",
                gap: 10,
              }}
            >
              {dossiersAffiches.map((d) => (
                <Link key={d.id} href={`/dossiers/${d.id}`} className="card" style={fileCardStyle}>
                  <div style={{ fontWeight: 600, fontSize: 13 }}>{d.intitule}</div>
                  <div className="mono" style={{ fontSize: 10.5, color: "var(--sub)", marginTop: 2 }}>
                    {d.reference_externe} {d.maitre_ouvrage_nom ? `· ${d.maitre_ouvrage_nom}` : ""}
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 10 }}>
                    <span className={`chip ${statutClasse(d.statut)}`}>{statutLabel(d.statut)}</span>
                    <span className="mono" style={{ fontSize: 12 }}>
                      {d.montant_estime
                        ? `${Number(d.montant_estime).toLocaleString(dict.dateLocale)} ${d.devise}`
                        : "—"}
                    </span>
                  </div>
                  <div style={{ fontSize: 11, color: "var(--sub)", marginTop: 6 }}>
                    {d.date_limite_soumission
                      ? new Date(d.date_limite_soumission).toLocaleDateString(dict.dateLocale)
                      : "—"}
                  </div>
                </Link>
              ))}
            </div>
          )}
        </>
      )}
    </AppShell>
  );
}

function StatCard({ valeur, libelle, couleur = "var(--petrol)", actif, onClick }) {
  return (
    <button
      onClick={onClick}
      className="card"
      style={{
        textAlign: "left",
        cursor: "pointer",
        width: "100%",
        fontFamily: "inherit",
        border: actif ? `1.5px solid ${couleur}` : "1px solid var(--line)",
        background: actif ? "rgba(0,0,0,0.02)" : "#fff",
      }}
    >
      <div className="mono" style={{ fontSize: 22, fontWeight: 700, color: couleur }}>
        {valeur}
      </div>
      <div style={{ fontSize: 11, color: "var(--sub)", marginTop: 2 }}>{libelle}</div>
    </button>
  );
}

const chartTitreStyle = { fontSize: 13, color: "var(--petrol)", margin: "0 0 10px", fontWeight: 700 };

// Anneau de repartition (SVG) : un segment par groupe de statut, cliquable pour filtrer la liste.
function Anneau({ total, segments, actifCle, onChoisir, vide, unite }) {
  const R = 44;
  const C = 2 * Math.PI * R;
  if (total === 0) return <p style={{ fontSize: 12, color: "var(--sub)", margin: 0 }}>{vide}</p>;
  let cumul = 0;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 18, flexWrap: "wrap" }}>
      <svg width="124" height="124" viewBox="0 0 124 124" role="img" aria-label="Répartition par statut">
        <circle cx="62" cy="62" r={R} fill="none" stroke="#E6ECEB" strokeWidth="16" />
        {segments
          .filter((sg) => sg.valeur > 0)
          .map((sg) => {
            const longueur = (sg.valeur / total) * C;
            const decalage = -cumul;
            cumul += longueur;
            return (
              <circle
                key={sg.cle}
                cx="62"
                cy="62"
                r={R}
                fill="none"
                stroke={sg.couleur}
                strokeWidth={actifCle === sg.cle ? 20 : 16}
                strokeDasharray={`${Math.max(longueur - 1.5, 0.5)} ${C}`}
                strokeDashoffset={decalage}
                transform="rotate(-90 62 62)"
                style={{ cursor: "pointer", opacity: actifCle && actifCle !== sg.cle ? 0.35 : 1 }}
                onClick={() => onChoisir(sg.cle)}
              />
            );
          })}
        <text x="62" y="60" textAnchor="middle" style={{ fontSize: 22, fontWeight: 700, fill: "#12292C" }}>{total}</text>
        <text x="62" y="76" textAnchor="middle" style={{ fontSize: 9, fill: "#5B6A6C" }}>{unite}</text>
      </svg>
      <div style={{ display: "grid", gap: 6, fontSize: 12 }}>
        {segments.map((sg) => (
          <button
            key={sg.cle}
            type="button"
            onClick={() => onChoisir(sg.cle)}
            style={{ display: "flex", alignItems: "center", gap: 8, background: "none", border: "none", padding: 0, cursor: "pointer", fontFamily: "inherit", fontSize: 12, color: "var(--ink)", textAlign: "left", fontWeight: actifCle === sg.cle ? 700 : 400 }}
          >
            <span style={{ width: 10, height: 10, borderRadius: 3, background: sg.couleur, flexShrink: 0 }} />
            <span>{sg.libelle}</span>
            <span className="mono" style={{ marginLeft: "auto", paddingLeft: 10 }}>
              {sg.valeur} · {Math.round((sg.valeur / total) * 100)} %
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

// Barres horizontales : meme unite (nombre de dossiers) pour toutes les lignes.
function BarresHorizontales({ lignes, vide }) {
  const max = Math.max(1, ...lignes.map((l) => l.valeur));
  if (lignes.every((l) => l.valeur === 0)) return <p style={{ fontSize: 12, color: "var(--sub)", margin: 0 }}>{vide}</p>;
  return (
    <div style={{ display: "grid", gap: 7 }}>
      {lignes.map((l) => (
        <div key={l.cle} style={{ display: "grid", gridTemplateColumns: "92px 1fr 22px", gap: 8, alignItems: "center", fontSize: 11.5 }}>
          <span style={{ color: "var(--sub)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{l.libelle}</span>
          <span style={{ background: "#E6ECEB", borderRadius: 4, height: 9, overflow: "hidden" }}>
            <span style={{ display: "block", height: "100%", width: `${(l.valeur / max) * 100}%`, background: l.couleur, borderRadius: 4 }} />
          </span>
          <span className="mono" style={{ textAlign: "right" }}>{l.valeur}</span>
        </div>
      ))}
    </div>
  );
}

const fileCardStyle = {
  display: "block",
  padding: "13px 14px",
};

const domainCardStyle = {
  display: "block",
  padding: "13px 14px",
};

const boutonEffacerFiltreStyle = {
  background: "none",
  border: "1px solid var(--line)",
  borderRadius: 6,
  padding: "4px 10px",
  fontSize: 11.5,
  color: "var(--sub)",
  whiteSpace: "nowrap",
};

const boutonNouveauDossierStyle = {
  background: "var(--petrol)",
  color: "#fff",
  border: "none",
  borderRadius: 6,
  padding: "6px 12px",
  fontSize: 12,
  fontWeight: 600,
  textDecoration: "none",
  whiteSpace: "nowrap",
};

function severiteColor(severite) {
  if (severite === "CRITIQUE") return "#FF7A59";
  if (severite === "ALERTE") return "var(--ocre)";
  return "#5FB8C4";
}

function statutClasse(statut) {
  if (["ATTRIBUE", "EN_EXECUTION", "RECEPTION", "CLOTURE"].includes(statut)) return "ok";
  if (["NON_ATTRIBUE", "NO_GO"].includes(statut)) return "risk";
  return "warn";
}
