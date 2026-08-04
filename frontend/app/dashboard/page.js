"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { api } from "../../lib/api";
import { useLangue } from "../../lib/i18n/LanguageContext";
import AppShell from "../../lib/components/AppShell";

export default function DashboardPage() {
  const router = useRouter();
  const { t, statutLabel, dict } = useLangue();
  const [dossiers, setDossiers] = useState([]);
  const [signaux, setSignaux] = useState([]);
  const [chargement, setChargement] = useState(true);
  const [erreur, setErreur] = useState("");

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

          <h2 style={{ fontSize: 15.5, color: "var(--petrol)", marginBottom: 12 }}>{t("ongoingFiles")}</h2>
          <div className="card">
            {dossiers.length === 0 ? (
              <p style={{ fontSize: 13, color: "var(--sub)" }}>
                {t("noFiles")}
              </p>
            ) : (
              dossiers.map((d, idx) => (
                <Link
                  key={d.id}
                  href={`/dossiers/${d.id}`}
                  style={{
                    display: "grid",
                    gridTemplateColumns: "2.2fr 1fr 1fr 1fr",
                    padding: "13px 4px",
                    borderBottom: idx < dossiers.length - 1 ? "1px solid var(--line-soft)" : "none",
                    alignItems: "center",
                  }}
                >
                  <div>
                    <div style={{ fontWeight: 600, fontSize: 13.3 }}>{d.intitule}</div>
                    <div className="mono" style={{ fontSize: 11, color: "var(--sub)", marginTop: 1 }}>
                      {d.reference_externe} {d.maitre_ouvrage_nom ? `· ${d.maitre_ouvrage_nom}` : ""}
                    </div>
                  </div>
                  <div>
                    <span className={`chip ${statutClasse(d.statut)}`}>{statutLabel(d.statut)}</span>
                  </div>
                  <div className="mono" style={{ fontSize: 13 }}>
                    {d.montant_estime
                      ? `${Number(d.montant_estime).toLocaleString(dict.dateLocale)} ${d.devise}`
                      : "—"}
                  </div>
                  <div style={{ fontSize: 12.5, color: "var(--sub)" }}>
                    {d.date_limite_soumission
                      ? new Date(d.date_limite_soumission).toLocaleDateString(dict.dateLocale)
                      : "—"}
                  </div>
                </Link>
              ))
            )}
          </div>
        </>
      )}
    </AppShell>
  );
}

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
