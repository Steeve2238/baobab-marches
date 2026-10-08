"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { api } from "../../lib/api";
import { useLangue } from "../../lib/i18n/LanguageContext";
import AppShell from "../../lib/components/AppShell";
import PaieSousNav from "../../lib/components/PaieSousNav";
import { Pastille, boutonLeger, cellule, enteteCellule, droite, fmt, fmtDec } from "../../lib/components/paieUi";

export default function PaieAccueilPage() {
  const { t } = useLangue();
  const [etat, setEtat] = useState(null);
  const [erreur, setErreur] = useState("");

  useEffect(() => {
    api.paieEtat().then(setEtat).catch((e) => setErreur(e.message));
  }, []);

  const etape = (ok, titre, texte, lien, libLien) => (
    <div className="card" style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
      <Pastille ton={ok ? "ok" : "alerte"}>{ok ? t("paieFait") : t("paieAFaire")}</Pastille>
      <div style={{ flex: 1 }}>
        <div style={{ fontWeight: 700, fontSize: 13.5 }}>{titre}</div>
        <div style={{ fontSize: 12, color: "var(--sub)", margin: "3px 0 8px", lineHeight: 1.5 }}>{texte}</div>
        {lien && <Link href={lien} style={boutonLeger}>{libLien}</Link>}
      </div>
    </div>
  );

  return (
    <AppShell title={t("paieTitre")} subNav={<PaieSousNav />}>
      {erreur && <p style={{ color: "var(--brique)", fontSize: 12.5, marginBottom: 12 }}>{erreur}</p>}
      <p style={{ fontSize: 12.5, color: "var(--sub)", marginBottom: 14, maxWidth: 780, lineHeight: 1.5 }}>{t("paieAccueilAide")}</p>
      {!etat ? <p style={{ fontSize: 12.5, color: "var(--sub)" }}>{t("loading")}</p> : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(340px, 1fr))", gap: 14, alignItems: "start" }}>
          <div style={{ display: "grid", gap: 10 }}>
            <h3 style={{ fontSize: 13.5, color: "var(--petrol)", margin: 0 }}>{t("paiePreparation")}</h3>
            {etape(etat.nb_salaries > 0 && etat.nb_sans_dossier === 0 && etat.nb_dossiers_complets === etat.nb_salaries,
              t("paieEtapeDossiers"), `${etat.nb_dossiers_complets} / ${etat.nb_salaries} ${t("paieEtapeDossiersTexte")}`, "/paie/dossiers", t("paieOuvrirDossiers"))}
            {etape(true, t("paieEtapeBaremes"),
              `${t("paieBarType_IR_MENSUEL")} : ${etat.baremes.ir.source === "OFFICIEL" ? t("paieBarOfficiel") : t("paieBarEntreprise")} ${etat.baremes.ir.annee} · ${t("paieBarType_TRIMF_ANNUEL")} : ${etat.baremes.trimf.source === "OFFICIEL" ? t("paieBarOfficiel") : t("paieBarEntreprise")} ${etat.baremes.trimf.annee}`,
              "/paie/parametres?section=impot", t("paieVoirBaremes"))}
            {etape(false, t("paieEtapeTaux"), t("paieEtapeTauxTexte"), "/paie/parametres?section=cotisations", t("paieVoirCotisations"))}
            {etape(false, t("paieEtapeComptes"), t("paieEtapeComptesTexte"), "/paie/parametres?section=comptes", t("paieVoirComptes"))}
          </div>
          <div className="card">
            <h3 style={{ fontSize: 13.5, color: "var(--petrol)", margin: "0 0 8px" }}>{t("paieCotEnVigueur")}</h3>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead><tr><th style={enteteCellule}>{t("paieCotCode")}</th><th style={{ ...enteteCellule, ...droite }}>{t("paieCotSalarie")}</th><th style={{ ...enteteCellule, ...droite }}>{t("paieCotPatronal")}</th><th style={{ ...enteteCellule, ...droite }}>{t("paieCotPlafond")}</th></tr></thead>
              <tbody>
                {etat.cotisations.map((c) => (
                  <tr key={c.code}>
                    <td style={cellule}>{c.libelle}</td>
                    <td style={{ ...cellule, ...droite }}>{fmtDec(c.taux_salarie, 3)} %</td>
                    <td style={{ ...cellule, ...droite }}>{fmtDec(c.taux_patronal, 3)} %</td>
                    <td style={{ ...cellule, ...droite }}>{c.plafond_mensuel == null ? "—" : fmt(c.plafond_mensuel)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p style={{ fontSize: 11.5, color: "var(--sub)", margin: "10px 0 0", lineHeight: 1.5 }}>{t("paieCotProvisoireCourt")}</p>
          </div>
        </div>
      )}
    </AppShell>
  );
}
