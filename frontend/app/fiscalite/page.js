"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { api } from "../../lib/api";
import { useLangue } from "../../lib/i18n/LanguageContext";
import AppShell from "../../lib/components/AppShell";
import FiscaliteSousNav from "../../lib/components/FiscaliteSousNav";
import { STYLE_ALERTE, pastilleStyle, texteAlerte, formaterXof, dateCourte, nomMois } from "../../lib/fiscaliteUi";

/** Lien vers l'ecran qui traite une echeance (la TVA a sa propre page de declaration). */
function lienEcheance(e) {
  if (e.type === "TVA") return `/fiscalite/tva/${e.annee_periode}/${e.mois_periode}`;
  if (e.type === "IS_DECLARATION" || e.type === "IS_SOLDE") return `/fiscalite/is/${Number(e.periode)}`;
  if (e.type === "CEL_LOCAUX" || e.type.startsWith("CEL_")) return `/fiscalite/cel/${e.periode}`;
  if (e.type === "VEHICULES") return "/fiscalite/vehicules";
  if (e.type === "RETENUES") return `/fiscalite/retenues?annee=${e.annee_periode}&mois=${e.mois_periode}`;
  return "/fiscalite/calendrier";
}

export default function FiscaliteAccueilPage() {
  const { t } = useLangue();
  const locale = t("dateLocale");
  const [synthese, setSynthese] = useState(null);
  const [regime, setRegime] = useState(null);
  const [erreur, setErreur] = useState("");

  useEffect(() => {
    api.fiscaliteSynthese().then(setSynthese).catch((e) => setErreur(e.message));
    api.fiscaliteRegime().then(setRegime).catch(() => {});
  }, []);

  const libelleEcheance = (e) => {
    if (e.type === "TVA") return `${t("fiscEchTVA")} — ${nomMois(e.mois_periode, locale)} ${e.annee_periode}`;
    if (e.type === "RETENUES") return `${t("fiscEchRETENUES")} — ${nomMois(e.mois_periode, locale)} ${e.annee_periode}`;
    return `${t(`fiscEch${e.type}`)} ${e.periode}`;
  };

  const ligne = (e) => (
    <div key={e.cle} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, padding: "7px 0", borderBottom: "1px solid var(--line-soft)", fontSize: 12.5, flexWrap: "wrap" }}>
      <span>
        <Link href={lienEcheance(e)} style={{ color: "var(--petrol)", fontWeight: 600 }}>{libelleEcheance(e)}</Link>
        <span style={{ color: "var(--sub)" }}> · {t("fiscLimite")} {dateCourte(e.date_limite, locale)}</span>
      </span>
      <span style={pastilleStyle(STYLE_ALERTE[e.alerte])}>
        {e.alerte === "EN_RETARD" ? `${t("fiscAlerteEN_RETARD")} (${-e.jours_restants} ${t("fiscJours")})` : e.alerte === "IMMINENT" ? `${t("fiscAlerteIMMINENT")} (${e.jours_restants} ${t("fiscJours")})` : `${t("fiscDans")} ${e.jours_restants} ${t("fiscJours")}`}
      </span>
    </div>
  );

  return (
    <AppShell title={t("fiscTitre")} subNav={<FiscaliteSousNav />}>
      {erreur && <p style={{ color: "var(--brique)", fontSize: 12.5, marginBottom: 12 }}>{erreur}</p>}
      <p style={{ fontSize: 12, color: "var(--sub)", marginBottom: 14, maxWidth: 780, lineHeight: 1.5 }}>{t("fiscAccueilAide")}</p>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(340px, 1fr))", gap: 14, alignItems: "start" }}>
        <div className="card">
          <h3 style={{ fontSize: 13.5, color: "var(--petrol)", marginBottom: 8 }}>{t("fiscATraiter")}</h3>
          {!synthese && <p style={{ fontSize: 12.5, color: "var(--sub)" }}>{t("loading")}</p>}
          {synthese && synthese.en_retard.length === 0 && synthese.imminentes.length === 0 && synthese.prochaines.length === 0 && (
            <p style={{ fontSize: 12.5, color: "var(--sub)", margin: 0 }}>{t("fiscRienATraiter")}</p>
          )}
          {synthese && [...synthese.en_retard, ...synthese.imminentes, ...synthese.prochaines.filter((p) => p.alerte === "A_VENIR")].map(ligne)}
          {synthese && (
            <p style={{ fontSize: 11.5, color: "var(--sub)", marginTop: 10, marginBottom: 0 }}>
              <Link href="/fiscalite/calendrier" style={{ color: "var(--petrol)", fontWeight: 600 }}>{t("fiscVoirCalendrier")}</Link>
            </p>
          )}
        </div>

        <div className="card">
          <h3 style={{ fontSize: 13.5, color: "var(--petrol)", marginBottom: 8 }}>{t("fiscRegimeTitre")}</h3>
          {!regime && <p style={{ fontSize: 12.5, color: "var(--sub)" }}>{t("loading")}</p>}
          {regime && (
            <>
              <div style={{ fontSize: 12.5, lineHeight: 1.7 }}>
                <div>{t("fiscRegimeDeclare")} : <strong>{regime.regime_declare_libelle || t("fiscNonRenseigne")}</strong></div>
                <div>{t("fiscRegimeAttendu")} : <strong>{regime.regime_attendu_libelle}</strong> <span style={{ color: "var(--sub)" }}>({regime.regime_attendu.article})</span></div>
                {regime.cofi_decode?.regime && (
                  <div>{t("fiscRegimeCofi")} : <strong>{regime.cofi_decode.regime.libelle}</strong></div>
                )}
                <div style={{ color: "var(--sub)" }}>
                  {t("fiscCaEnCours")} {regime.annee} : {formaterXof(regime.ca_en_cours.ca_ttc, locale)} XOF {t("fiscTTC")}
                </div>
              </div>
              {regime.alertes.length > 0 && (
                <ul style={{ margin: "10px 0 0", paddingLeft: 18, fontSize: 12, lineHeight: 1.55 }}>
                  {regime.alertes.map((a, i) => (
                    <li key={i} style={{ color: ["CGU_PLUS_APPLICABLE", "REEL_NORMAL_OBLIGATOIRE", "SEUIL_DEPASSE_EN_COURS", "CGU_PERSONNE_MORALE_IMPOSSIBLE", "COFI_DIFFERENT_DU_REGIME_DECLARE"].includes(a.code) ? "var(--brique)" : "inherit" }}>
                      {texteAlerte(t, "fiscReg_", a, locale)}
                    </li>
                  ))}
                </ul>
              )}
              <p style={{ fontSize: 11.5, color: "var(--sub)", marginTop: 10, marginBottom: 0 }}>
                <Link href="/fiscalite/profil" style={{ color: "var(--petrol)", fontWeight: 600 }}>{t("fiscOuvrirProfil")}</Link>
              </p>
            </>
          )}
        </div>
      </div>

      <div className="card" style={{ marginTop: 14, maxWidth: 780 }}>
        <h3 style={{ fontSize: 13.5, color: "var(--petrol)", marginBottom: 8 }}>{t("fiscModulesTitre")}</h3>
        <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12.5, lineHeight: 1.7 }}>
          <li>{t("fiscModTva")}</li>
          <li>{t("fiscModIs")}</li>
          <li>{t("fiscModCel")}</li>
          <li>{t("fiscModRetenues")}</li>
          <li>{t("fiscModVehicules")}</li>
          <li>{t("fiscModConformite")}</li>
          <li>{t("fiscModPenalites")}</li>
          <li>{t("fiscModCalendrier")}</li>
          <li>{t("fiscModTiers")}</li>
          <li style={{ color: "var(--sub)" }}>{t("fiscModBientot")}</li>
        </ul>
      </div>
    </AppShell>
  );
}
