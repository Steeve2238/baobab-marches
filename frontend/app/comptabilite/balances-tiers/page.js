"use client";

import { useEffect, useState } from "react";
import { api } from "../../../lib/api";
import { useLangue } from "../../../lib/i18n/LanguageContext";
import AppShell from "../../../lib/components/AppShell";
import ComptaSousNav from "../../../lib/components/ComptaSousNav";
import { labelStyle, inputStyle, boutonPrincipalStyle, boutonSecondaireStyle, thStyle, tdStyle, numStyle, formaterMontant } from "../../../lib/comptaUi";

// Balance des clients ou des fournisseurs : ouverture / mouvements / soldes par tiers,
// avec controle contre le solde des comptes collectifs (411 / 401).
export default function BalancesTiersPage() {
  const { t } = useLangue();
  const locale = t("dateLocale");
  const [type, setType] = useState("CLIENT");
  const [exercices, setExercices] = useState([]);
  const [filtres, setFiltres] = useState({ exercice_id: "", date_debut: "", date_fin: "", inclure_instance: false });
  const [data, setData] = useState(null);
  const [erreur, setErreur] = useState("");
  const [chargement, setChargement] = useState(false);

  useEffect(() => {
    api.comptaExercices().then((x) => {
      setExercices(x);
      const courant = x.find((e) => e.statut === "OUVERT") || x[0];
      if (courant) setFiltres((f) => ({ ...f, exercice_id: courant.id }));
    }).catch((e) => setErreur(e.message));
  }, []);

  const parametres = () => {
    const p = { type };
    for (const [k, v] of Object.entries(filtres)) if (v) p[k] = v === true ? "1" : v;
    return p;
  };

  async function afficher() {
    setErreur("");
    setChargement(true);
    try {
      setData(await api.comptaBalanceTiers(parametres()));
    } catch (e) {
      setErreur(e.message);
      setData(null);
    } finally {
      setChargement(false);
    }
  }
  useEffect(() => {
    if (filtres.exercice_id) afficher();
  }, [type, filtres.exercice_id]); // eslint-disable-line react-hooks/exhaustive-deps

  async function exporter(format) {
    setErreur("");
    try {
      await api.comptaExporter("balance-tiers", format, parametres());
    } catch (e) {
      setErreur(e.message);
    }
  }

  const m = (v) => formaterMontant(v, locale, true);
  const maj = (k, v) => setFiltres((f) => ({ ...f, [k]: v }));
  const ecart = data ? Math.abs(Number(data.controle.ecart)) >= 0.005 : false;

  return (
    <AppShell title={t("comptaBalancesTiersTitre")} subNav={<ComptaSousNav />}>
      {erreur && <p style={{ color: "var(--brique)", fontSize: 12.5, marginBottom: 12 }}>{erreur}</p>}
      <div className="card" style={{ marginBottom: 14, display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end" }}>
        <div style={{ display: "flex", gap: 6 }} role="tablist">
          {[["CLIENT", "comptaCoteClients"], ["FOURNISSEUR", "comptaCoteFournisseurs"]].map(([c, cle]) => (
            <button key={c} role="tab" aria-selected={type === c} onClick={() => setType(c)} style={{ ...boutonSecondaireStyle, ...(type === c ? { background: "var(--petrol)", color: "#fff", borderColor: "var(--petrol)" } : {}) }}>{t(cle)}</button>
          ))}
        </div>
        <div>
          <label style={labelStyle}>{t("comptaExercice")}</label>
          <select value={filtres.exercice_id} onChange={(e) => setFiltres((f) => ({ ...f, exercice_id: e.target.value, date_debut: "", date_fin: "" }))} style={{ ...inputStyle, width: 150 }}>
            {exercices.map((x) => <option key={x.id} value={x.id}>{x.libelle}</option>)}
          </select>
        </div>
        <div>
          <label style={labelStyle}>{t("comptaPeriodeDu")}</label>
          <input type="date" value={filtres.date_debut} onChange={(e) => maj("date_debut", e.target.value)} style={{ ...inputStyle, width: 145 }} />
        </div>
        <div>
          <label style={labelStyle}>{t("comptaPeriodeAu")}</label>
          <input type="date" value={filtres.date_fin} onChange={(e) => maj("date_fin", e.target.value)} style={{ ...inputStyle, width: 145 }} />
        </div>
        <label style={{ fontSize: 12, display: "flex", gap: 6, alignItems: "center", paddingBottom: 8 }}>
          <input type="checkbox" checked={!!filtres.inclure_instance} onChange={(e) => maj("inclure_instance", e.target.checked)} />
          {t("comptaInclureInstance")}
        </label>
        <button style={boutonPrincipalStyle} onClick={afficher}>{t("comptaAfficher")}</button>
        <button style={boutonSecondaireStyle} onClick={() => exporter("pdf")}>PDF</button>
        <button style={boutonSecondaireStyle} onClick={() => exporter("xlsx")}>Excel</button>
      </div>
      {chargement && <p style={{ fontSize: 12.5, color: "var(--sub)" }}>{t("loading")}</p>}
      {data && (
        <>
          <div className="card" style={{ padding: 0, overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 980 }}>
              <thead>
                <tr>
                  <th style={thStyle} rowSpan={2}>{t("comptaBalancesTiersCode")}</th>
                  <th style={thStyle} rowSpan={2}>{t("comptaBalancesTiersNom")}</th>
                  <th style={thStyle} rowSpan={2}>{t("comptaBalancesTiersCollectif")}</th>
                  <th style={{ ...thStyle, textAlign: "center" }} colSpan={2}>{t("comptaBalOuverture")}</th>
                  <th style={{ ...thStyle, textAlign: "center" }} colSpan={2}>{t("comptaBalMouvements")}</th>
                  <th style={{ ...thStyle, textAlign: "center" }} colSpan={2}>{t("comptaBalSoldes")}</th>
                </tr>
                <tr>
                  {["od", "oc", "md", "mc", "sd", "sc"].map((k, i) => <th key={k} style={{ ...thStyle, textAlign: "right" }}>{t(i % 2 === 0 ? "comptaDebit" : "comptaCredit")}</th>)}
                </tr>
              </thead>
              <tbody>
                {data.lignes.map((l) => (
                  <tr key={l.code}>
                    <td style={{ ...tdStyle, fontFamily: "IBM Plex Mono, monospace" }}>{l.code}</td>
                    <td style={tdStyle}>{l.nom}</td>
                    <td style={{ ...tdStyle, fontFamily: "IBM Plex Mono, monospace" }}>{l.compte_collectif}</td>
                    <td style={{ ...tdStyle, ...numStyle }}>{m(l.ouverture_debit)}</td>
                    <td style={{ ...tdStyle, ...numStyle }}>{m(l.ouverture_credit)}</td>
                    <td style={{ ...tdStyle, ...numStyle }}>{m(l.mouvement_debit)}</td>
                    <td style={{ ...tdStyle, ...numStyle }}>{m(l.mouvement_credit)}</td>
                    <td style={{ ...tdStyle, ...numStyle, fontWeight: 700 }}>{m(l.solde_debit)}</td>
                    <td style={{ ...tdStyle, ...numStyle, fontWeight: 700 }}>{m(l.solde_credit)}</td>
                  </tr>
                ))}
                {data.lignes.length === 0 && <tr><td colSpan={9} style={{ ...tdStyle, color: "var(--sub)" }}>{t("comptaBalancesTiersAucun")}</td></tr>}
                {data.lignes.length > 0 && (
                  <tr style={{ background: "var(--line-soft)" }}>
                    <td style={{ ...tdStyle, fontWeight: 700 }} colSpan={3}>{t("comptaTotalGeneral")}</td>
                    {["ouverture_debit", "ouverture_credit", "mouvement_debit", "mouvement_credit", "solde_debit", "solde_credit"].map((k) => (
                      <td key={k} style={{ ...tdStyle, ...numStyle, fontWeight: 700 }}>{m(data.totaux[k])}</td>
                    ))}
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <div className="card" style={{ marginTop: 12, fontSize: 12.5, display: "flex", gap: 24, flexWrap: "wrap", alignItems: "center", borderColor: ecart || data.controle.lignes_sans_tiers > 0 ? "var(--ocre)" : undefined }}>
            <span>{t("comptaBalancesTiersControle")}</span>
            <span>{t("comptaBalancesTiersSoldeCollectif")} : <strong>{formaterMontant(data.controle.solde_collectif, locale)}</strong></span>
            <span>{t("comptaBalancesTiersSoldeTiers")} : <strong>{formaterMontant(data.controle.solde_tiers, locale)}</strong></span>
            <span style={{ color: ecart ? "var(--brique)" : "var(--vert)", fontWeight: 700 }}>{ecart ? `${t("comptaLettrageEcart")} : ${formaterMontant(data.controle.ecart, locale)}` : t("comptaBalancesTiersConcordant")}</span>
            {data.controle.lignes_sans_tiers > 0 && <span style={{ color: "var(--ocre)" }}>{data.controle.lignes_sans_tiers} {t("comptaBalancesTiersSansTiers")}</span>}
          </div>
        </>
      )}
    </AppShell>
  );
}
