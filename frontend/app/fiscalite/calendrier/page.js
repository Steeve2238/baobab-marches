"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { api } from "../../../lib/api";
import { useLangue } from "../../../lib/i18n/LanguageContext";
import AppShell from "../../../lib/components/AppShell";
import FiscaliteSousNav from "../../../lib/components/FiscaliteSousNav";
import {
  inputStyle, labelStyle, thStyle, tdStyle, boutonPrincipalStyle, boutonSecondaireStyle,
  STYLE_STATUT, STYLE_ALERTE, pastilleStyle, formaterXof, dateCourte, nomMois,
} from "../../../lib/fiscaliteUi";

const STATUTS = ["A_FAIRE", "PREPAREE", "DEPOSEE", "PAYEE", "NON_CONCERNE"];

/** Ecran qui traite une echeance (null = suivi manuel dans ce calendrier). */
function lienEcheance(e) {
  if (e.type === "TVA") return `/fiscalite/tva/${e.annee_periode}/${e.mois_periode}`;
  if (e.type === "IS_DECLARATION" || e.type === "IS_SOLDE") return `/fiscalite/is/${Number(e.periode)}`;
  if (e.type.startsWith("CEL_")) return `/fiscalite/cel/${e.periode}`;
  if (e.type === "VEHICULES") return "/fiscalite/vehicules";
  if (e.type === "RETENUES") return `/fiscalite/retenues?annee=${e.annee_periode}&mois=${e.mois_periode}`;
  return null;
}

export default function FiscaliteCalendrierPage() {
  const { t } = useLangue();
  const locale = t("dateLocale");
  const [annee, setAnnee] = useState(new Date().getFullYear());
  const [lignes, setLignes] = useState(null);
  const [erreur, setErreur] = useState("");
  const [edition, setEdition] = useState(null); // { cle, statut, date_depot, date_paiement, reference, montant, note }
  const [filtre, setFiltre] = useState("OUVERTES");
  const [simu, setSimu] = useState({ montant: "", jours: "", type: "TVA", deposee: false });
  const [simuRes, setSimuRes] = useState(null);
  const anneeCourante = new Date().getFullYear();

  const charger = useCallback(() => {
    setLignes(null);
    api.fiscaliteCalendrier(annee).then(setLignes).catch((e) => setErreur(e.message));
  }, [annee]);
  useEffect(charger, [charger]);

  const libelle = (e) => {
    if (e.type === "TVA" || e.type === "RETENUES") return `${t(`fiscEch${e.type}`)} — ${nomMois(e.mois_periode, locale)} ${e.annee_periode}`;
    return `${t(`fiscEch${e.type}`)} ${e.periode}`;
  };

  async function enregistrer() {
    setErreur("");
    try {
      await api.fiscaliteMajSuivi(edition.cle, {
        statut: edition.statut,
        date_depot: edition.date_depot || null,
        date_paiement: edition.date_paiement || null,
        reference: edition.reference,
        montant: edition.montant === "" ? null : edition.montant,
        note: edition.note,
      });
      setEdition(null);
      charger();
    } catch (e) {
      setErreur(e.message);
    }
  }

  async function simuler() {
    setErreur("");
    try {
      setSimuRes(await api.fiscalitePenalites({ montant: simu.montant || 0, jours: simu.jours || 0, type: simu.type, deposee: simu.deposee ? 1 : 0 }));
    } catch (e) {
      setErreur(e.message);
    }
  }

  const visibles = (lignes || []).filter((e) => {
    if (filtre === "TOUTES") return true;
    if (filtre === "RETARD") return e.alerte === "EN_RETARD";
    return ["EN_RETARD", "IMMINENT", "A_VENIR"].includes(e.alerte);
  });

  return (
    <AppShell title={t("fiscCalTitre")} subNav={<FiscaliteSousNav />}>
      {erreur && <p style={{ color: "var(--brique)", fontSize: 12.5, marginBottom: 12 }}>{erreur}</p>}
      <p style={{ fontSize: 12, color: "var(--sub)", marginBottom: 12, maxWidth: 800, lineHeight: 1.5 }}>{t("fiscCalAide")}</p>

      <div className="card" style={{ marginBottom: 14, display: "flex", gap: 10, alignItems: "flex-end", flexWrap: "wrap" }}>
        <div>
          <label style={labelStyle}>{t("fiscAnnee")}</label>
          <select value={annee} onChange={(e) => setAnnee(Number(e.target.value))} style={{ ...inputStyle, width: 110 }}>
            {[anneeCourante + 1, anneeCourante, anneeCourante - 1, anneeCourante - 2].map((a) => <option key={a} value={a}>{a}</option>)}
          </select>
        </div>
        <div>
          <label style={labelStyle}>{t("fiscAfficher")}</label>
          <select value={filtre} onChange={(e) => setFiltre(e.target.value)} style={{ ...inputStyle, width: 190 }}>
            <option value="OUVERTES">{t("fiscFiltreOuvertes")}</option>
            <option value="RETARD">{t("fiscFiltreRetard")}</option>
            <option value="TOUTES">{t("fiscFiltreToutes")}</option>
          </select>
        </div>
      </div>

      {edition && (
        <div className="card" style={{ marginBottom: 14 }}>
          <h3 style={{ fontSize: 13, color: "var(--petrol)", marginBottom: 10 }}>{edition.titre}</h3>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end" }}>
            <div>
              <label style={labelStyle}>{t("fiscStatut")}</label>
              <select value={edition.statut} onChange={(e) => setEdition({ ...edition, statut: e.target.value })} style={{ ...inputStyle, width: 170 }}>
                {STATUTS.map((s) => <option key={s} value={s}>{t(`fiscStatut_${s}`)}</option>)}
              </select>
            </div>
            <div>
              <label style={labelStyle}>{t("fiscDateDepot")}</label>
              <input type="date" value={edition.date_depot || ""} onChange={(e) => setEdition({ ...edition, date_depot: e.target.value })} style={{ ...inputStyle, width: 150 }} />
            </div>
            <div>
              <label style={labelStyle}>{t("fiscDatePaiement")}</label>
              <input type="date" value={edition.date_paiement || ""} onChange={(e) => setEdition({ ...edition, date_paiement: e.target.value })} style={{ ...inputStyle, width: 150 }} />
            </div>
            <div>
              <label style={labelStyle}>{t("fiscMontant")}</label>
              <input type="number" min="0" value={edition.montant} onChange={(e) => setEdition({ ...edition, montant: e.target.value })} style={{ ...inputStyle, width: 140, textAlign: "right" }} />
            </div>
            <div>
              <label style={labelStyle}>{t("fiscReference")}</label>
              <input value={edition.reference || ""} onChange={(e) => setEdition({ ...edition, reference: e.target.value })} style={{ ...inputStyle, width: 170 }} />
            </div>
            <div>
              <label style={labelStyle}>{t("fiscNote")}</label>
              <input value={edition.note || ""} onChange={(e) => setEdition({ ...edition, note: e.target.value })} style={{ ...inputStyle, width: 220 }} />
            </div>
            <button style={boutonPrincipalStyle} onClick={enregistrer}>{t("fiscEnregistrer")}</button>
            <button style={boutonSecondaireStyle} onClick={() => setEdition(null)}>{t("fiscAnnuler")}</button>
          </div>
        </div>
      )}

      <div className="card" style={{ padding: 0, overflowX: "auto", marginBottom: 16 }}>
        <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 860 }}>
          <thead>
            <tr>
              <th style={thStyle}>{t("fiscLimite")}</th>
              <th style={thStyle}>{t("fiscObligation")}</th>
              <th style={thStyle}>{t("fiscStatut")}</th>
              <th style={thStyle}>{t("fiscEtat")}</th>
              <th style={{ ...thStyle, textAlign: "right" }}>{t("fiscMontant")}</th>
              <th style={thStyle}></th>
            </tr>
          </thead>
          <tbody>
            {lignes && visibles.length === 0 && <tr><td colSpan={6} style={{ ...tdStyle, color: "var(--sub)" }}>{t("fiscRienATraiter")}</td></tr>}
            {visibles.map((e) => (
              <tr key={e.cle} style={e.alerte === "HISTORIQUE" ? { color: "var(--sub)" } : {}}>
                <td style={{ ...tdStyle, whiteSpace: "nowrap" }}>{dateCourte(e.date_limite, locale)}</td>
                <td style={tdStyle}>
                  {lienEcheance(e) ? <Link href={lienEcheance(e)} style={{ color: "var(--petrol)", fontWeight: 600 }}>{libelle(e)}</Link> : libelle(e)}
                  {!e.automatique && e.type === "RETENUES" && <div style={{ fontSize: 11, color: "var(--sub)" }}>{t("fiscSuiviManuel")}</div>}
                  {e.penalites_estimees && e.penalites_estimees.total > 0 && (
                    <div style={{ fontSize: 11, color: "var(--brique)" }}>
                      {t("fiscPenalitesEstimees")} : {formaterXof(e.penalites_estimees.total, locale)} XOF ({e.penalites_estimees.jours_retard} {t("fiscJours")})
                    </div>
                  )}
                  {e.note && <div style={{ fontSize: 11, color: "var(--sub)" }}>{e.note}</div>}
                </td>
                <td style={tdStyle}><span style={pastilleStyle(STYLE_STATUT[e.statut])}>{t(`fiscStatut_${e.statut}`)}</span></td>
                <td style={tdStyle}>
                  <span style={pastilleStyle(STYLE_ALERTE[e.alerte])}>
                    {e.alerte === "EN_RETARD" ? `${t("fiscAlerteEN_RETARD")} (${-e.jours_restants} ${t("fiscJours")})` : e.alerte === "IMMINENT" ? `${t("fiscAlerteIMMINENT")} (${e.jours_restants} ${t("fiscJours")})` : e.alerte === "A_VENIR" ? `${t("fiscDans")} ${e.jours_restants} ${t("fiscJours")}` : t(`fiscAlerte${e.alerte}`)}
                  </span>
                </td>
                <td style={{ ...tdStyle, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{e.montant ? formaterXof(e.montant, locale) : ""}</td>
                <td style={{ ...tdStyle, textAlign: "right" }}>
                  <button
                    style={boutonSecondaireStyle}
                    onClick={() => setEdition({ cle: e.cle, titre: libelle(e), statut: e.statut, date_depot: e.date_depot, date_paiement: e.date_paiement, reference: e.reference, montant: e.montant ?? "", note: e.note })}
                  >
                    {t("fiscSuivre")}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="card" style={{ maxWidth: 820 }}>
        <h3 style={{ fontSize: 13.5, color: "var(--petrol)", marginBottom: 6 }}>{t("fiscSimuTitre")}</h3>
        <p style={{ fontSize: 12, color: "var(--sub)", marginTop: 0, marginBottom: 10, lineHeight: 1.5 }}>{t("fiscSimuAide")}</p>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end" }}>
          <div>
            <label style={labelStyle}>{t("fiscSimuMontant")}</label>
            <input type="number" min="0" value={simu.montant} onChange={(e) => setSimu({ ...simu, montant: e.target.value })} style={{ ...inputStyle, width: 150, textAlign: "right" }} />
          </div>
          <div>
            <label style={labelStyle}>{t("fiscSimuJours")}</label>
            <input type="number" min="0" value={simu.jours} onChange={(e) => setSimu({ ...simu, jours: e.target.value })} style={{ ...inputStyle, width: 110, textAlign: "right" }} />
          </div>
          <div>
            <label style={labelStyle}>{t("fiscSimuType")}</label>
            <select value={simu.type} onChange={(e) => setSimu({ ...simu, type: e.target.value })} style={{ ...inputStyle, width: 190 }}>
              <option value="TVA">{t("fiscSimuTypeTva")}</option>
              <option value="AUTRE">{t("fiscSimuTypeAutre")}</option>
            </select>
          </div>
          <label style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 12, paddingBottom: 8 }}>
            <input type="checkbox" checked={simu.deposee} onChange={(e) => setSimu({ ...simu, deposee: e.target.checked })} />
            {t("fiscSimuDeposee")}
          </label>
          <button style={boutonPrincipalStyle} onClick={simuler}>{t("fiscSimuCalculer")}</button>
        </div>
        {simuRes && (
          <table style={{ marginTop: 12, borderCollapse: "collapse", fontSize: 12.5 }}>
            <tbody>
              <tr><td style={{ padding: "3px 14px 3px 0" }}>{t("fiscSimuInteret")} ({simuRes.taux_interet ?? 0} %)</td><td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{formaterXof(simuRes.interet_retard, locale)}</td></tr>
              <tr><td style={{ padding: "3px 14px 3px 0" }}>{t("fiscSimuPenalite")} ({simuRes.taux_penalite} %)</td><td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{formaterXof(simuRes.penalite, locale)}</td></tr>
              <tr><td style={{ padding: "3px 14px 3px 0" }}>{t("fiscSimuAmende")}</td><td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{formaterXof(simuRes.amende, locale)}</td></tr>
              <tr style={{ fontWeight: 700, borderTop: "1px solid var(--line)" }}><td style={{ padding: "5px 14px 3px 0" }}>{t("fiscSimuTotal")}</td><td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{formaterXof(simuRes.total, locale)}</td></tr>
            </tbody>
          </table>
        )}
      </div>
    </AppShell>
  );
}
