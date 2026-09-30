"use client";

import { useState } from "react";
import Link from "next/link";
import { api } from "../../../../../lib/api";
import { useLangue } from "../../../../../lib/i18n/LanguageContext";
import AppShell from "../../../../../lib/components/AppShell";

// Import des devis historiques (chantier du 30/09/2026 avec Steeve) : le
// client veut recharger dans Baobab Marches les devis qu'il avait avant
// d'utiliser la plateforme (~300). Decisions actees avec Steeve (voir
// claude/complement_30092026_devis_modifiable_apres_validation.md) :
// resume global uniquement, statut renseigne par le client dans le fichier,
// devis seulement (pas de factures), doublons de numero signales sans
// bloquer le reste du fichier. Voir POST /ventes/devis/importer.
export default function ImporterDevisHistoriquesPage() {
  const { t } = useLangue();
  const [erreur, setErreur] = useState("");
  const [enCours, setEnCours] = useState(false);
  const [resultat, setResultat] = useState(null);

  async function handleTelechargerModele() {
    try {
      await api.telechargerModeleImportDevis();
    } catch (err) {
      setErreur(err.message);
    }
  }

  async function handleImporter(e) {
    const fichier = e.target.files?.[0];
    if (!fichier) return;
    setEnCours(true);
    setErreur("");
    setResultat(null);
    try {
      const r = await api.importerDevisHistoriques(fichier);
      setResultat(r);
    } catch (err) {
      setErreur(err.message);
    } finally {
      setEnCours(false);
      e.target.value = "";
    }
  }

  return (
    <AppShell title={t("venteImportDevisPageTitle")} backHref="/marches/consultation-restreinte/devis">
      {erreur && <p style={{ color: "var(--brique)", fontSize: 12.5, marginBottom: 14 }}>{erreur}</p>}

      <div className="card" style={{ marginBottom: 16 }}>
        <p style={{ fontSize: 12.5, color: "var(--sub)", marginTop: 0, marginBottom: 16 }}>{t("venteImportDevisIntro")}</p>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          <button onClick={handleTelechargerModele} style={boutonSecondaireStyle}>
            {t("telechargerModeleButton")}
          </button>
          <label style={{ ...boutonPrincipalStyle, cursor: "pointer" }}>
            {enCours ? t("venteImportDevisEnCours") : t("venteImportDevisChoisirFichier")}
            <input type="file" accept=".xlsx" onChange={handleImporter} disabled={enCours} style={{ display: "none" }} />
          </label>
        </div>
      </div>

      {resultat && (
        <div className="card">
          <h3 style={{ fontSize: 13.5, color: "var(--petrol)", marginTop: 0, marginBottom: 12 }}>{t("venteImportDevisResultatTitle")}</h3>
          <p style={{ fontSize: 13, fontWeight: 600, color: "#2E7D5B", marginBottom: 16 }}>
            {resultat.nombre_importes} {t("venteImportDevisNombreImportesSuffixe")}
          </p>

          {resultat.anomalies_statut && resultat.anomalies_statut.length > 0 && (
            <div style={{ marginBottom: 16 }}>
              <h4 style={{ fontSize: 12.5, color: "var(--ocre)", marginBottom: 8 }}>{t("venteImportDevisAnomaliesStatutTitle")}</h4>
              <div style={{ display: "grid", gap: 4 }}>
                {resultat.anomalies_statut.map((a, i) => (
                  <div key={i} style={{ fontSize: 12, color: "var(--sub)" }}>
                    {t("venteImportDevisLigneLabel")} {a.ligne} — {a.numero} : "{a.statut_origine}"
                  </div>
                ))}
              </div>
            </div>
          )}

          <h4 style={{ fontSize: 12.5, color: "var(--brique)", marginBottom: 8 }}>{t("venteImportDevisErreursTitle")}</h4>
          {resultat.erreurs.length === 0 ? (
            <p style={{ fontSize: 12.5, color: "var(--sub)" }}>{t("venteImportDevisAucuneErreur")}</p>
          ) : (
            <div style={{ display: "grid", gap: 6 }}>
              {resultat.erreurs.map((e, i) => (
                <div key={i} style={{ fontSize: 12.5, padding: "8px 10px", borderRadius: 8, background: "rgba(196,74,58,0.08)" }}>
                  <span style={{ fontWeight: 600 }}>
                    {t("venteImportDevisLigneLabel")} {e.ligne}
                    {e.numero ? ` (${e.numero})` : ""}
                  </span>{" "}
                  — {e.motif}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <div style={{ marginTop: 16 }}>
        <Link href="/marches/consultation-restreinte/devis" style={{ fontSize: 12.5, color: "var(--petrol)" }}>
          {t("venteImportDevisRetourListe")}
        </Link>
      </div>
    </AppShell>
  );
}

const boutonPrincipalStyle = {
  background: "var(--petrol)",
  color: "#fff",
  border: "none",
  borderRadius: 8,
  padding: "8px 16px",
  fontSize: 12.5,
  fontWeight: 600,
  whiteSpace: "nowrap",
};
const boutonSecondaireStyle = {
  background: "transparent",
  color: "var(--petrol)",
  border: "1px solid var(--line)",
  borderRadius: 8,
  padding: "7px 14px",
  fontSize: 12.5,
  fontWeight: 600,
  whiteSpace: "nowrap",
};
