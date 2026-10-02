"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { api } from "../../lib/api";
import { useLangue } from "../../lib/i18n/LanguageContext";
import AppShell from "../../lib/components/AppShell";

// Meme regroupement de statuts que le tableau de bord (voir dashboard/page.js)
// - garde volontairement identique pour que les deux ecrans presentent les
// memes 4 grandes categories.
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

// Page dediee au portefeuille des dossiers (04-05/09/2026, systeme de
// permissions par role demande par Steeve) : contrairement au tableau de bord
// (qui agrege aussi des stats par module - financement, logistique...), cette
// page ne montre QUE les dossiers. Elle existe comme entree de menu
// independante justement pour permettre, a l'avenir, d'accorder l'acces au
// portefeuille des dossiers a un role SANS lui donner le tableau de bord
// executif complet (voir requireModule("dossiers") cote backend, qui accepte
// soit "dossiers" explicitement dans le perimetre, soit tableauDeBord=true).
//
// Depuis le chantier du 02/10/2026 (demande de Steeve : "l'interface dossier
// doit aussi bien faire apparaitre les marches restreint que les appels
// d'offres"), consomme GET /api/dossiers/unifies plutot que GET /api/dossiers :
// chaque ligne porte type_dossier ("AO" ou "CONSULTATION"), le backend
// filtrant deja selon le perimetre de l'utilisateur (voir routes/dossiers.js).
// Les 5 tuiles statistiques (StatCard) gardent EXPRES leur sens d'origine -
// uniquement les dossiers AO, memes 4 categories qu'avant ce chantier - une
// consultation restreinte n'a pas les memes statuts (RECUE, DEVIS_EN_COURS...)
// et les meler aux tuiles OUVERT/EN_COURS/TERMINE/REJETE n'aurait pas de sens.
// La liste en dessous, elle, montre bien la chronologie fusionnee.
export default function DossiersPage() {
  const router = useRouter();
  const { t, statutLabel, dict } = useLangue();
  const [dossiers, setDossiers] = useState([]);
  const [permissions, setPermissions] = useState(null);
  const [chargement, setChargement] = useState(true);
  const [erreur, setErreur] = useState("");
  const [filtreGroupe, setFiltreGroupe] = useState(null);

  useEffect(() => {
    async function charger() {
      try {
        const [dossiersData, permissionsData] = await Promise.all([
          api.getDossiersUnifies(),
          api.getPermissions().catch(() => null),
        ]);
        setDossiers(dossiersData);
        setPermissions(permissionsData);
      } catch (err) {
        setErreur(err.message || t("defaultLoadError"));
        if (
          String(err.message).includes("Authentification") ||
          String(err.message).includes("expiree") ||
          String(err.message).includes("Authentication") ||
          String(err.message).includes("expired")
        ) {
          router.push("/login");
        }
      } finally {
        setChargement(false);
      }
    }
    charger();
  }, [router, t]);

  const dossiersAo = dossiers.filter((d) => d.type_dossier === "AO");

  const statsGroupes = { OUVERT: 0, EN_COURS: 0, TERMINE: 0, REJETE: 0 };
  for (const d of dossiersAo) {
    const groupe = GROUPES_STATUT[d.statut];
    if (groupe) statsGroupes[groupe] += 1;
  }
  const dossiersAffiches = filtreGroupe
    ? dossiersAo.filter((d) => GROUPES_STATUT[d.statut] === filtreGroupe)
    : dossiers;

  function handleClicStat(groupe) {
    setFiltreGroupe((prev) => (prev === groupe ? null : groupe));
  }

  return (
    <AppShell title={t("dossiersPageTitle")}>
      {chargement && <p>{t("loading")}</p>}
      {erreur && <p style={{ color: "var(--brique)" }}>{erreur}</p>}

      {!chargement && !erreur && (
        <>
          <p style={{ fontSize: 13, color: "var(--sub)", marginBottom: 20 }}>{t("dossiersPageSubtitle")}</p>

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))",
              gap: 10,
              marginBottom: 24,
            }}
          >
            <StatCard
              valeur={dossiersAo.length}
              libelle={t("statTotalFiles")}
              actif={filtreGroupe === null}
              onClick={() => setFiltreGroupe(null)}
            />
            <StatCard
              valeur={statsGroupes.OUVERT}
              libelle={t("statOpenFiles")}
              couleur="var(--ocre)"
              actif={filtreGroupe === "OUVERT"}
              onClick={() => handleClicStat("OUVERT")}
            />
            <StatCard
              valeur={statsGroupes.EN_COURS}
              libelle={t("statOngoingFiles")}
              couleur="#5FB8C4"
              actif={filtreGroupe === "EN_COURS"}
              onClick={() => handleClicStat("EN_COURS")}
            />
            <StatCard
              valeur={statsGroupes.TERMINE}
              libelle={t("statClosedFiles")}
              couleur="#2E7D5B"
              actif={filtreGroupe === "TERMINE"}
              onClick={() => handleClicStat("TERMINE")}
            />
            <StatCard
              valeur={statsGroupes.REJETE}
              libelle={t("statRejectedFiles")}
              couleur="var(--brique)"
              actif={filtreGroupe === "REJETE"}
              onClick={() => handleClicStat("REJETE")}
            />
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
                  (blockLectureSeule sur dossiers.js). */}
              {!permissions?.lectureSeule && (
                <Link href="/dossiers/nouveau" style={boutonNouveauDossierStyle}>
                  + {t("newDossierButton")}
                </Link>
              )}
            </div>
          </div>

          {dossiersAffiches.length === 0 ? (
            <p className="card" style={{ fontSize: 13, color: "var(--sub)" }}>
              {t("dossiersAucun")}
            </p>
          ) : (
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))",
                gap: 10,
              }}
            >
              {dossiersAffiches.map((d) => {
                const estAo = d.type_dossier === "AO";
                const href = estAo
                  ? `/dossiers/${d.id}`
                  : `/marches/consultation-restreinte/consultations/${d.id}`;
                const libelleStatut = estAo ? statutLabel(d.statut) : t(`venteConsultationStatut_${d.statut}`);
                return (
                  <Link key={d.id} href={href} className="card" style={fileCardStyle}>
                    <div
                      style={{
                        display: "inline-block",
                        fontSize: 9.5,
                        fontWeight: 700,
                        padding: "2px 7px",
                        borderRadius: 4,
                        marginBottom: 6,
                        color: estAo ? "var(--petrol)" : "var(--ocre)",
                        background: estAo ? "rgba(11,61,64,0.08)" : "rgba(224,149,76,0.12)",
                      }}
                    >
                      {t(estAo ? "dossierTypeAO" : "dossierTypeCONSULTATION")}
                    </div>
                    <div style={{ fontWeight: 600, fontSize: 13 }}>{d.intitule}</div>
                    <div className="mono" style={{ fontSize: 10.5, color: "var(--sub)", marginTop: 2 }}>
                      {d.reference_externe} {d.tiers_nom ? `· ${d.tiers_nom}` : ""}
                    </div>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 10 }}>
                      <span className={`chip ${statutClasse(d.statut)}`}>{libelleStatut}</span>
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
                );
              })}
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

const fileCardStyle = {
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

// Couvre a la fois les statuts d'un dossier AO et ceux d'une consultation
// restreinte (CONVERTIE/SANS_SUITE) - les deux jeux de codes ne se recoupent
// jamais, donc aucune ambiguite a les traiter dans une seule fonction.
function statutClasse(statut) {
  if (["ATTRIBUE", "EN_EXECUTION", "RECEPTION", "CLOTURE", "CONVERTIE"].includes(statut)) return "ok";
  if (["NON_ATTRIBUE", "NO_GO", "SANS_SUITE"].includes(statut)) return "risk";
  return "warn";
}
