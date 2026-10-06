"use client";

import { useEffect, useState } from "react";
import { api } from "../../api";
import { useLangue } from "../../i18n/LanguageContext";
import { boutonPrincipalStyle, boutonSecondaireStyle } from "../../financementUi";

// Section « Financement » d'un dossier (appel d'offres OU consultation
// restreinte) : simulations rattachees, banque choisie, cout bancaire retenu
// (repris dans la marge du dossier). type : "ao" | "consultation".
export default function FinancementDossierSection({ type, id, onLoaded }) {
  const { t, dict } = useLangue();
  const [fin, setFin] = useState({ simulations: [], cout_retenu_total_xof: 0 });
  useEffect(() => {
    api
      .finDossier(type, id)
      .then((d) => {
        setFin(d);
        if (onLoaded) onLoaded(d);
      })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [type, id]);
  const param = type === "ao" ? "dossier_ao_id" : "consultation_id";
  const nf = (n) => Number(n).toLocaleString(dict.dateLocale);
  const lienStyle = { textDecoration: "none", display: "inline-block" };
  return (
    <section style={{ marginBottom: 30 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6, gap: 10, flexWrap: "wrap" }}>
        <h2 style={{ fontSize: 15.5, color: "var(--petrol)" }}>{t("finDossierTitre")}</h2>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <a href={`/financement/compte/${type}/${id}`} style={{ ...boutonSecondaireStyle, ...lienStyle }}>
            {t("cexLienOuvrir")}
          </a>
          <a href={`/financement/plan/${type}/${id}`} style={{ ...boutonSecondaireStyle, ...lienStyle }}>
            {t("planLienOuvrir")}
          </a>
          <a href={`/financement?${param}=${id}`} style={{ ...boutonPrincipalStyle, ...lienStyle }}>
            {t("finDossierSimuler")}
          </a>
        </div>
      </div>
      <p style={{ fontSize: 12, color: "var(--sub)", marginBottom: 10 }}>{t("finDossierIntro")}</p>
      {fin.simulations.length === 0 ? (
        <p className="card" style={{ fontSize: 13, color: "var(--sub)" }}>{t("finDossierVide")}</p>
      ) : (
        <div style={{ display: "grid", gap: 8 }}>
          {fin.simulations.map((sim) => (
            <div key={sim.id} className="card" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
              <div>
                <div style={{ fontWeight: 600, fontSize: 13.3 }}>{sim.libelle || t(`finType_${sim.type_facilite}`)}</div>
                <div style={{ fontSize: 12, color: "var(--sub)" }}>
                  {t(`finType_${sim.type_facilite}`)} — {nf(sim.montant)} XOF — {sim.duree_jours} {t("finDays")}
                  {sim.partenaire_retenu_nom ? ` — ${t("finDossierBanque")} : ${sim.partenaire_retenu_nom}` : ""}
                </div>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                <span className="chip" style={{ fontSize: 11 }}>{t(`finStatutSim_${sim.statut}`)}</span>
                {sim.cout_retenu_xof ? <span className="mono">{nf(sim.cout_retenu_xof)} XOF</span> : null}
                <a href={`/financement/simulations/${sim.id}`} style={{ ...boutonSecondaireStyle, ...lienStyle }}>
                  {t("finDossierOuvrir")}
                </a>
              </div>
            </div>
          ))}
          <div style={{ textAlign: "right", fontSize: 13 }}>
            {t("finDossierCoutTotal")} : <b className="mono">{nf(fin.cout_retenu_total_xof || 0)} XOF</b>
          </div>
        </div>
      )}
    </section>
  );
}
