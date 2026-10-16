"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { api } from "../../../lib/api";
import { useLangue } from "../../../lib/i18n/LanguageContext";
import AppShell from "../../../lib/components/AppShell";
import ComptaSousNav from "../../../lib/components/ComptaSousNav";
import { boutonPrincipalStyle, boutonSecondaireStyle, thStyle, tdStyle, numStyle, formaterMontant } from "../../../lib/comptaUi";

const sub = (txt, vars) => String(txt).replace(/\{(\w+)\}/g, (_, k) => (vars && vars[k] !== undefined ? vars[k] : `{${k}}`));

// Stock en comptabilite : ecriture de variation de stock a chaque inventaire valide (stock initial annule, stock final constate).
export default function ComptaStockPage() {
  const { t } = useLangue();
  const locale = t("dateLocale");
  const m = (v) => formaterMontant(v, locale);
  const [etat, setEtat] = useState(null);
  const [erreur, setErreur] = useState("");
  const [info, setInfo] = useState("");

  const charger = () => api.comptaStock().then(setEtat).catch((e) => setErreur(e.message));
  useEffect(() => { charger(); }, []);

  async function comptabiliser(id) {
    setErreur(""); setInfo("");
    try { await api.comptaStockComptabiliser(id); setInfo(t("cstComptabilise")); charger(); } catch (e) { setErreur(e.message); }
  }
  async function rattraper() {
    setErreur(""); setInfo("");
    try { const r = await api.comptaStockRattraper(); setInfo(sub(t("cstRattrapage"), { n: r.ecritures })); charger(); } catch (e) { setErreur(e.message); }
  }
  const manquants = (etat?.inventaires || []).filter((i) => !i.ecriture_id).length;
  const ap = etat?.apercu;
  const carte = { padding: 14, minWidth: 210, flex: "1 1 210px" };
  const lib = { fontSize: 11.5, color: "var(--sub)", margin: "0 0 4px" };
  const val = { fontSize: 18, fontWeight: 700, margin: 0, fontVariantNumeric: "tabular-nums" };

  return (
    <AppShell title={t("cstTitre")} subNav={<ComptaSousNav />}>
      <p style={{ fontSize: 12, color: "var(--sub)", marginBottom: 12, maxWidth: 800, lineHeight: 1.5 }}>{t("cstAide")}</p>
      {erreur && <p style={{ color: "var(--brique)", fontSize: 12.5 }}>{erreur}</p>}
      {info && <p style={{ color: "var(--vert)", fontSize: 12.5 }}>{info}</p>}

      {etat?.comptes && (
        <p style={{ fontSize: 12.5, margin: "0 0 12px" }}>
          <strong>{t("cstComptes")} :</strong> {t("cstCompteStock")} {etat.comptes.stock} · {t("cstCompteVariation")} {etat.comptes.variation}
          <span style={{ color: "var(--sub)" }}> — {t(etat.parametre_stock ? "cstModifierComptes" : "cstComptesProposes")} <Link href="/comptabilite/parametres" style={{ color: "var(--petrol)" }}>{t("cstLienParametres")}</Link></span>
        </p>
      )}

      {ap && (
        <>
          <h3 style={{ fontSize: 14, margin: "6px 0 8px" }}>{t("cstApercu")}</h3>
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 6 }}>
            <div className="card" style={carte}><p style={lib}>{t("cstStockInitial")}</p><p style={val}>{m(ap.stock_initial)}</p></div>
            <div className="card" style={carte}><p style={lib}>{t("cstStockFinal")}</p><p style={val}>{m(ap.stock_final)}</p></div>
            <div className="card" style={carte}><p style={lib}>{t("cstVariation")}</p><p style={val}>{m(ap.variation)}</p></div>
          </div>
          <p style={{ fontSize: 11.5, color: "var(--sub)", margin: "0 0 16px" }}>{sub(t("cstMethode"), { m: t(`stkMethode${ap.methode}`) })} — {t("cstApercuAide")}</p>
        </>
      )}

      <div style={{ display: "flex", gap: 10, alignItems: "center", margin: "6px 0 8px" }}>
        <h3 style={{ fontSize: 14, margin: 0 }}>{t("cstInventaires")}</h3>
        {manquants > 0 && <button type="button" onClick={rattraper} style={{ ...boutonPrincipalStyle, padding: "4px 12px", fontSize: 12 }}>{t("cstRattraper")}</button>}
        <Link href="/stock" style={{ fontSize: 12, color: "var(--petrol)" }}>{t("cstVoirStock")}</Link>
      </div>
      <div className="card" style={{ padding: 0, overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 620 }}>
          <thead><tr><th style={thStyle}>{t("cstColNumero")}</th><th style={thStyle}>{t("cstColDate")}</th><th style={thStyle}>{t("cstColLibelle")}</th><th style={thStyle}>{t("cstColEcriture")}</th><th style={thStyle} /></tr></thead>
          <tbody>
            {etat && etat.inventaires.length === 0 && <tr><td style={tdStyle} colSpan={5}>{t("cstAucun")}</td></tr>}
            {(etat?.inventaires || []).map((i) => (
              <tr key={i.id}>
                <td style={tdStyle}>{i.numero}</td><td style={tdStyle}>{i.date_inventaire}</td><td style={tdStyle}>{i.libelle}</td>
                <td style={tdStyle}>{i.ecriture_id ? t(`cstEcriture_${i.ecriture_statut}`) : <span style={{ color: "var(--brique)" }}>{t("cstNonComptabilise")}</span>}</td>
                <td style={tdStyle}>{!i.ecriture_id && <button type="button" onClick={() => comptabiliser(i.id)} style={{ ...boutonSecondaireStyle, padding: "3px 10px", fontSize: 11.5 }}>{t("cstComptabiliser")}</button>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </AppShell>
  );
}
