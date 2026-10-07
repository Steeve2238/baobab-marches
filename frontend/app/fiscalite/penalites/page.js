"use client";

import { useEffect, useState } from "react";
import { api } from "../../../lib/api";
import { useLangue } from "../../../lib/i18n/LanguageContext";
import AppShell from "../../../lib/components/AppShell";
import FiscaliteSousNav from "../../../lib/components/FiscaliteSousNav";
import { inputStyle, labelStyle, thStyle, tdStyle, boutonPrincipalStyle, formaterXof, dateCourte } from "../../../lib/fiscaliteUi";

const NATURES = ["TVA", "RETENUE", "IS", "IMPOT_LOCAL", "AUTRE"];
const OPTIONS = ["declaration_deposee", "defaut_declaration", "taxation_office", "mauvaise_foi", "recidive", "activite_non_declaree"];

export default function FiscalitePenalitesPage() {
  const { t } = useLangue();
  const locale = t("dateLocale");
  const mm = (v) => formaterXof(v, locale);
  const nb = (v) => Number(v).toLocaleString(locale, { maximumFractionDigits: 4 });
  const [form, setForm] = useState({ nature: "TVA", montant: "", mode: "date", date_echeance: "", date_paiement: new Date().toISOString().slice(0, 10), jours_retard: "", declaration_deposee: false, defaut_declaration: false, taxation_office: false, mauvaise_foi: false, recidive: false, activite_non_declaree: false });
  const [resultat, setResultat] = useState(null);
  const [retards, setRetards] = useState([]);
  const [erreur, setErreur] = useState("");

  useEffect(() => {
    api.fiscaliteSynthese().then((s) => setRetards(s.en_retard || [])).catch(() => {});
  }, []);

  async function estimer(e) {
    e.preventDefault();
    setErreur("");
    const corps = { nature: form.nature, montant: Number(form.montant || 0) };
    for (const o of OPTIONS) corps[o] = !!form[o];
    if (form.mode === "jours") corps.jours_retard = Number(form.jours_retard || 0);
    else {
      corps.date_echeance = form.date_echeance;
      corps.date_paiement = form.date_paiement;
    }
    try {
      setResultat(await api.fiscalitePenalitesEstimer(corps));
    } catch (err) {
      setErreur(err.message);
      setResultat(null);
    }
  }
  const champ = (libelle, enfant) => (
    <div>
      <label style={labelStyle}>{libelle}</label>
      {enfant}
    </div>
  );
  const ligne = (libelle, valeur, fort) => (
    <tr style={fort ? { background: "var(--line-soft)" } : {}}>
      <td style={{ ...tdStyle, fontWeight: fort ? 700 : 500 }}>{libelle}</td>
      <td style={{ ...tdStyle, textAlign: "right", fontWeight: fort ? 700 : 500, fontVariantNumeric: "tabular-nums" }}>{mm(valeur)}</td>
    </tr>
  );

  return (
    <AppShell title={t("fiscPenTitre")} subNav={<FiscaliteSousNav />}>
      {erreur && <p style={{ color: "var(--brique)", fontSize: 12.5, marginBottom: 12 }}>{erreur}</p>}
      <p style={{ fontSize: 12, color: "var(--sub)", marginBottom: 12, maxWidth: 840, lineHeight: 1.5 }}>{t("fiscPenAide")}</p>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(340px, 1fr))", gap: 14, alignItems: "start" }}>
        <form className="card" onSubmit={estimer}>
          <h3 style={{ fontSize: 13.5, color: "var(--petrol)", marginBottom: 10 }}>{t("fiscPenSimulateur")}</h3>
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 10 }}>
            {champ(t("fiscPenNature"), (
              <select value={form.nature} onChange={(e) => setForm({ ...form, nature: e.target.value })} style={{ ...inputStyle, width: 220 }}>
                {NATURES.map((n) => <option key={n} value={n}>{t(`fiscPenNature_${n}`)}</option>)}
              </select>
            ))}
            {champ(t("fiscPenMontant"), <input type="number" min="0" value={form.montant} onChange={(e) => setForm({ ...form, montant: e.target.value })} style={{ ...inputStyle, width: 170, textAlign: "right" }} required />)}
          </div>
          <div style={{ display: "flex", gap: 14, marginBottom: 8, fontSize: 12.5 }}>
            <label><input type="radio" checked={form.mode === "date"} onChange={() => setForm({ ...form, mode: "date" })} /> {t("fiscPenParDates")}</label>
            <label><input type="radio" checked={form.mode === "jours"} onChange={() => setForm({ ...form, mode: "jours" })} /> {t("fiscPenParJours")}</label>
          </div>
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 12 }}>
            {form.mode === "date" ? (
              <>
                {champ(t("fiscPenEcheance"), <input type="date" value={form.date_echeance} onChange={(e) => setForm({ ...form, date_echeance: e.target.value })} style={{ ...inputStyle, width: 160 }} required />)}
                {champ(t("fiscPenPaiement"), <input type="date" value={form.date_paiement} onChange={(e) => setForm({ ...form, date_paiement: e.target.value })} style={{ ...inputStyle, width: 160 }} required />)}
              </>
            ) : (
              champ(t("fiscPenJours"), <input type="number" min="0" value={form.jours_retard} onChange={(e) => setForm({ ...form, jours_retard: e.target.value })} style={{ ...inputStyle, width: 120, textAlign: "right" }} required />)
            )}
          </div>
          <div style={{ display: "grid", gap: 5, marginBottom: 12 }}>
            {OPTIONS.map((o) => (
              <label key={o} style={{ fontSize: 12.3, display: "flex", gap: 7, alignItems: "center" }}>
                <input type="checkbox" checked={form[o]} onChange={(e) => setForm({ ...form, [o]: e.target.checked })} />
                {t(`fiscPenOpt_${o}`)}
              </label>
            ))}
          </div>
          <button type="submit" style={boutonPrincipalStyle}>{t("fiscPenEstimer")}</button>
        </form>

        <div className="card">
          <h3 style={{ fontSize: 13.5, color: "var(--petrol)", marginBottom: 10 }}>{t("fiscPenResultat")}</h3>
          {!resultat && <p style={{ fontSize: 12.5, color: "var(--sub)", margin: 0 }}>{t("fiscPenAucunResultat")}</p>}
          {resultat && (
            <>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <tbody>
                  <tr><td style={tdStyle}>{t("fiscPenRetard")}</td><td style={{ ...tdStyle, textAlign: "right" }}>{resultat.jours_retard} {t("fiscJours")} ({resultat.mois_retard} {t("fiscPenMois")})</td></tr>
                  {ligne(`${t("fiscPenInteret")} (${nb(resultat.taux_interet)} %)`, resultat.interet_retard)}
                  {ligne(`${t("fiscPenPenalite")} (${nb(resultat.taux_penalite)} %)`, resultat.penalite)}
                  {ligne(t("fiscPenAmende"), resultat.amende)}
                  {ligne(t("fiscPenTotal"), resultat.total, true)}
                  {ligne(t("fiscPenTotalAvecDroits"), resultat.total_avec_droits)}
                </tbody>
              </table>
              <ul style={{ margin: "10px 0 0", paddingLeft: 18, fontSize: 12, lineHeight: 1.6 }}>
                {resultat.hypotheses.map((h) => <li key={h}>{t(`fiscPenHyp_${h}`)}</li>)}
              </ul>
              <p style={{ fontSize: 11, color: "var(--sub)", marginTop: 8, marginBottom: 0 }}>{resultat.references.join(" · ")}</p>
            </>
          )}
          <p style={{ fontSize: 11.5, color: "var(--sub)", marginTop: 12, marginBottom: 0, lineHeight: 1.5 }}>{t("fiscPenReserve")}</p>
        </div>
      </div>

      <h3 style={{ fontSize: 14, color: "var(--petrol)", margin: "20px 0 8px" }}>{t("fiscPenEnRetard")}</h3>
      <div className="card" style={{ padding: 0, overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 640 }}>
          <thead>
            <tr>
              <th style={thStyle}>{t("fiscPenEcheanceCol")}</th>
              <th style={thStyle}>{t("fiscLimite")}</th>
              <th style={{ ...thStyle, textAlign: "right" }}>{t("fiscMontant")}</th>
              <th style={{ ...thStyle, textAlign: "right" }}>{t("fiscPenalitesEstimees")}</th>
            </tr>
          </thead>
          <tbody>
            {retards.length === 0 && <tr><td style={{ ...tdStyle, color: "var(--sub)" }} colSpan={4}>{t("fiscPenAucunRetard")}</td></tr>}
            {retards.map((e) => (
              <tr key={e.cle}>
                <td style={tdStyle}>{t(`fiscEch${e.type}`)} {e.periode}</td>
                <td style={tdStyle}>{dateCourte(e.date_limite, locale)} ({-e.jours_restants} {t("fiscJours")})</td>
                <td style={{ ...tdStyle, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{e.montant ? mm(e.montant) : ""}</td>
                <td style={{ ...tdStyle, textAlign: "right", fontVariantNumeric: "tabular-nums", fontWeight: 700 }}>{e.penalites_estimees ? mm(e.penalites_estimees.total) : ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </AppShell>
  );
}
