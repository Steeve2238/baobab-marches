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
  const [chargement, setChargement] = useState(true);
  const [erreur, setErreur] = useState("");
  const [filtreGroupe, setFiltreGroupe] = useState(null);

  useEffect(() => {
    async function charger() {
      try {
        const [dossiersData, signauxData] = await Promise.all([
          api.getDossiers(),
          api.getSignaux(),
        ]);
        setDossiers(dossiersData);
        setSignaux(signauxData);
      } catch (err) {
        setErreur(err.message || t("defaultLoadError"));
        if (String(err.message).includes("Authentification") || String(err.message).includes("expiree") || String(err.message).includes("Authentication") || String(err.message).includes("expired")) {
          router.push("/login");
        }
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

  const statsGroupes = { OUVERT: 0, EN_COURS: 0, TERMINE: 0, REJETE: 0 };
  for (const d of dossiers) {
    const groupe = GROUPES_STATUT[d.statut];
    if (groupe) statsGroupes[groupe] += 1;
  }
  const dossiersAffiches = filtreGroupe
    ? dossiers.filter((d) => GROUPES_STATUT[d.statut] === filtreGroupe)
    : dossiers;

  function handleClicStat(groupe) {
    setFiltreGroupe((prev) => (prev === groupe ? null : groupe));
  }

  return (
    <AppShell title={t("navDashboard")}>
      {chargement && <p>{t("loading")}</p>}
      {erreur && <p style={{ color: "var(--brique)" }}>{erreur}</p>}

      {!chargement && !erreur && (
        <>
          <section
            className="card"
            style={{ background: "var(--petrol)", color: "#fff", marginBottom: 24 }}
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

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))",
              gap: 10,
              marginBottom: 24,
            }}
          >
            <StatCard
              valeur={dossiers.length}
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
            {filtreGroupe && (
              <button onClick={() => setFiltreGroupe(null)} style={boutonEffacerFiltreStyle}>
                {t("clearFilter")}
              </button>
            )}
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
