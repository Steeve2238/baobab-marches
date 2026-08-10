"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { api } from "../../lib/api";
import { useLangue } from "../../lib/i18n/LanguageContext";
import AppShell from "../../lib/components/AppShell";

// Vue personnelle transverse : toutes les taches de chronogramme, sur TOUS
// les dossiers du tenant, qui concernent l'utilisateur connecte (affectees a
// lui nommement, ou a un role qu'il detient - voir GET /chronogramme/mes-taches
// cote backend pour le detail de la logique de visibilite).
export default function MesTachesPage() {
  const { t, dict, phaseChronogrammeLabel, tacheStatutLabel } = useLangue();
  const [taches, setTaches] = useState([]);
  const [afficherTerminees, setAfficherTerminees] = useState(false);
  const [erreur, setErreur] = useState("");
  const [chargement, setChargement] = useState(true);

  useEffect(() => {
    charger(afficherTerminees);
  }, [afficherTerminees]);

  function charger(tous) {
    setChargement(true);
    api
      .getMesTaches(tous)
      .then(setTaches)
      .catch((err) => setErreur(err.message))
      .finally(() => setChargement(false));
  }

  async function handlePatchStatut(tacheId, statut) {
    try {
      const maj = await api.patchTacheStatut(tacheId, statut);
      setTaches((prev) =>
        statut === "FAIT" && !afficherTerminees
          ? prev.filter((tache) => tache.id !== tacheId)
          : prev.map((tache) => (tache.id === tacheId ? { ...tache, ...maj } : tache))
      );
    } catch (err) {
      setErreur(err.message);
    }
  }

  return (
    <AppShell title={t("myTasksPageTitle")}>
      {erreur && <p style={{ color: "var(--brique)", fontSize: 12.5, marginBottom: 14 }}>{erreur}</p>}

      <label
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
          fontSize: 12.5,
          marginBottom: 16,
        }}
      >
        <input
          type="checkbox"
          checked={afficherTerminees}
          onChange={(e) => setAfficherTerminees(e.target.checked)}
        />
        {t("showAllTasksLabel")}
      </label>

      {chargement ? (
        <p style={{ fontSize: 12.5, color: "var(--sub)" }}>{t("loading")}</p>
      ) : taches.length === 0 ? (
        <p className="card" style={{ fontSize: 13, color: "var(--sub)" }}>
          {t("noMyTasks")}
        </p>
      ) : (
        <div style={{ display: "grid", gap: 8 }}>
          {taches.map((tache) => (
            <div
              key={tache.id}
              className="card"
              style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}
            >
              <div>
                <Link
                  href={`/dossiers/${tache.dossier_ao_id}`}
                  style={{ fontSize: 10.5, color: "var(--sub)", textTransform: "uppercase" }}
                >
                  {t("dossierRefLabel")} · {tache.reference_externe || tache.dossier_intitule}
                </Link>
                <div style={{ fontWeight: 600, fontSize: 13, marginTop: 2 }}>{tache.intitule}</div>
                <div style={{ fontSize: 11.5, color: "var(--sub)", marginTop: 2 }}>
                  {phaseChronogrammeLabel(tache.phase)}
                  {tache.jalon_relatif ? ` · ${tache.jalon_relatif}` : ""}
                  {tache.role_libelle ? ` · ${tache.role_libelle}` : ""}
                </div>
                <div className="mono" style={{ fontSize: 11.5, color: "var(--sub)", marginTop: 2 }}>
                  {tache.date_echeance
                    ? new Date(tache.date_echeance).toLocaleDateString(dict.dateLocale)
                    : "—"}
                </div>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 10, flexShrink: 0 }}>
                <span
                  className={`chip ${
                    tache.statut === "FAIT"
                      ? "ok"
                      : tache.statut === "EN_RETARD"
                      ? "risk"
                      : tache.statut === "EN_COURS"
                      ? "warn"
                      : ""
                  }`}
                  style={tache.statut === "A_FAIRE" ? { background: "var(--line-soft)", color: "var(--sub)" } : {}}
                >
                  {tacheStatutLabel(tache.statut)}
                </span>
                {tache.statut !== "FAIT" && (
                  <button
                    onClick={() =>
                      handlePatchStatut(tache.id, tache.statut === "A_FAIRE" ? "EN_COURS" : "FAIT")
                    }
                    style={boutonSecondaireStyle}
                  >
                    {tache.statut === "A_FAIRE" ? t("markAsInProgress") : t("markAsDone")}
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </AppShell>
  );
}

const boutonSecondaireStyle = {
  background: "none",
  border: "1px solid var(--line)",
  borderRadius: 6,
  padding: "4px 10px",
  fontSize: 11.5,
  whiteSpace: "nowrap",
};
