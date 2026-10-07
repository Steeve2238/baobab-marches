"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { api } from "../../../lib/api";
import { useLangue } from "../../../lib/i18n/LanguageContext";
import AppShell from "../../../lib/components/AppShell";
import FiscaliteSousNav from "../../../lib/components/FiscaliteSousNav";
import {
  inputStyle, labelStyle, thStyle, tdStyle, boutonPrincipalStyle, boutonSecondaireStyle,
  STYLE_STATUT, pastilleStyle, formaterXof, dateCourte,
} from "../../../lib/fiscaliteUi";

export default function FiscaliteIsListePage() {
  const { t } = useLangue();
  const locale = t("dateLocale");
  const [data, setData] = useState(null);
  const [erreur, setErreur] = useState("");
  const [form, setForm] = useState({ annee_origine: new Date().getFullYear() - 1, type: "ORDINAIRE", montant_initial: "", note: "" });

  const charger = useCallback(() => {
    api.fiscaliteIs().then(setData).catch((e) => setErreur(e.message));
  }, []);
  useEffect(() => {
    charger();
  }, [charger]);

  async function ajouter(e) {
    e.preventDefault();
    setErreur("");
    try {
      await api.fiscaliteIsAjouterDeficit({ ...form, annee_origine: Number(form.annee_origine), montant_initial: Number(form.montant_initial) });
      setForm({ ...form, montant_initial: "", note: "" });
      charger();
    } catch (err) {
      setErreur(err.message);
    }
  }
  async function supprimer(id) {
    setErreur("");
    try {
      await api.fiscaliteIsSupprimerDeficit(id);
      charger();
    } catch (err) {
      setErreur(err.message);
    }
  }

  const mm = (v) => formaterXof(v, locale);

  return (
    <AppShell title={t("fiscIsTitre")} subNav={<FiscaliteSousNav />}>
      {erreur && <p style={{ color: "var(--brique)", fontSize: 12.5, marginBottom: 12 }}>{erreur}</p>}
      <p style={{ fontSize: 12, color: "var(--sub)", marginBottom: 12, maxWidth: 820, lineHeight: 1.5 }}>{t("fiscIsAide")}</p>

      <div className="card" style={{ padding: 0, overflowX: "auto", marginBottom: 18 }}>
        <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 720 }}>
          <thead>
            <tr>
              <th style={thStyle}>{t("fiscIsExercice")}</th>
              <th style={thStyle}>{t("fiscIsDateDeclaration")}</th>
              <th style={thStyle}>{t("fiscIsDateSolde")}</th>
              <th style={thStyle}>{t("fiscStatut")}</th>
              <th style={{ ...thStyle, textAlign: "right" }}>{t("fiscIsImpotDu")}</th>
              <th style={{ ...thStyle, textAlign: "right" }}>{t("fiscSoldeAPayer")}</th>
              <th style={thStyle}></th>
            </tr>
          </thead>
          <tbody>
            {!data && <tr><td style={tdStyle} colSpan={7}>{t("loading")}</td></tr>}
            {(data?.annees || []).map((a) => (
              <tr key={a.annee}>
                <td style={{ ...tdStyle, fontWeight: 700 }}>{a.annee}</td>
                <td style={tdStyle}>{dateCourte(a.date_limite_declaration, locale)}</td>
                <td style={tdStyle}>{dateCourte(a.date_limite_solde, locale)}</td>
                <td style={tdStyle}>
                  {a.statut === "A_PREPARER" ? <span style={{ color: "var(--sub)", fontSize: 12 }}>{t("fiscNonPreparee")}</span> : a.statut === "BROUILLON" ? <span style={{ color: "var(--sub)", fontSize: 12 }}>{t("fiscStatut_BROUILLON")}</span> : <span style={pastilleStyle(STYLE_STATUT[a.statut])}>{t(`fiscStatut_${a.statut}`)}</span>}
                </td>
                <td style={{ ...tdStyle, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{a.impot_du === null ? "" : mm(a.impot_du)}</td>
                <td style={{ ...tdStyle, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{a.solde_a_payer === null ? "" : mm(a.solde_a_payer)}</td>
                <td style={{ ...tdStyle, textAlign: "right" }}>
                  <Link href={`/fiscalite/is/${a.annee}`}><span style={boutonSecondaireStyle}>{t("fiscOuvrir")}</span></Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h3 style={{ fontSize: 14, color: "var(--petrol)", marginBottom: 6 }}>{t("fiscDeficitsTitre")}</h3>
      <p style={{ fontSize: 12, color: "var(--sub)", marginBottom: 10, maxWidth: 820, lineHeight: 1.5 }}>{t("fiscDeficitsAide")}</p>
      <div className="card" style={{ padding: 0, overflowX: "auto", marginBottom: 14 }}>
        <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 720 }}>
          <thead>
            <tr>
              <th style={thStyle}>{t("fiscDeficitOrigine")}</th>
              <th style={thStyle}>{t("fiscDeficitNature")}</th>
              <th style={{ ...thStyle, textAlign: "right" }}>{t("fiscDeficitInitial")}</th>
              <th style={{ ...thStyle, textAlign: "right" }}>{t("fiscDeficitImpute")}</th>
              <th style={{ ...thStyle, textAlign: "right" }}>{t("fiscDeficitReste")}</th>
              <th style={thStyle}>{t("fiscSource")}</th>
              <th style={thStyle}></th>
            </tr>
          </thead>
          <tbody>
            {data && data.deficits.length === 0 && <tr><td style={{ ...tdStyle, color: "var(--sub)" }} colSpan={7}>{t("fiscDeficitAucun")}</td></tr>}
            {(data?.deficits || []).map((d) => (
              <tr key={d.id}>
                <td style={{ ...tdStyle, fontWeight: 700 }}>{d.annee_origine}</td>
                <td style={tdStyle}>{t(`fiscDeficitType_${d.type}`)}</td>
                <td style={{ ...tdStyle, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{mm(d.montant_initial)}</td>
                <td style={{ ...tdStyle, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{mm(d.impute)}</td>
                <td style={{ ...tdStyle, textAlign: "right", fontVariantNumeric: "tabular-nums", fontWeight: 700 }}>{mm(d.reste)}</td>
                <td style={tdStyle}>{d.source === "DECLARATION" ? t("fiscDeficitSourceDecl") : t("fiscSource_SAISIE")}{d.note ? <div style={{ fontSize: 11, color: "var(--sub)" }}>{d.note}</div> : null}</td>
                <td style={{ ...tdStyle, textAlign: "right" }}>
                  {d.source === "MANUEL" && d.impute === 0 && <button style={boutonSecondaireStyle} onClick={() => supprimer(d.id)}>{t("fiscSupprimer")}</button>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <form className="card" onSubmit={ajouter} style={{ display: "flex", gap: 10, alignItems: "flex-end", flexWrap: "wrap" }}>
        <div>
          <label style={labelStyle}>{t("fiscDeficitOrigine")}</label>
          <input type="number" value={form.annee_origine} onChange={(e) => setForm({ ...form, annee_origine: e.target.value })} style={{ ...inputStyle, width: 100 }} required />
        </div>
        <div>
          <label style={labelStyle}>{t("fiscDeficitNature")}</label>
          <select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })} style={{ ...inputStyle, width: 260 }}>
            <option value="ORDINAIRE">{t("fiscDeficitType_ORDINAIRE")}</option>
            <option value="AMORTISSEMENT_DIFFERE">{t("fiscDeficitType_AMORTISSEMENT_DIFFERE")}</option>
          </select>
        </div>
        <div>
          <label style={labelStyle}>{t("fiscDeficitInitial")}</label>
          <input type="number" min="0" value={form.montant_initial} onChange={(e) => setForm({ ...form, montant_initial: e.target.value })} style={{ ...inputStyle, width: 160, textAlign: "right" }} required />
        </div>
        <div>
          <label style={labelStyle}>{t("fiscNote")}</label>
          <input value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} style={{ ...inputStyle, width: 240 }} />
        </div>
        <button type="submit" style={boutonPrincipalStyle}>{t("fiscDeficitAjouter")}</button>
      </form>
    </AppShell>
  );
}
