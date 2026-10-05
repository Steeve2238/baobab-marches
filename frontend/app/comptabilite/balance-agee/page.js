"use client";

import { Fragment, useEffect, useState } from "react";
import { api } from "../../../lib/api";
import { useLangue } from "../../../lib/i18n/LanguageContext";
import AppShell from "../../../lib/components/AppShell";
import ComptaSousNav from "../../../lib/components/ComptaSousNav";
import { labelStyle, inputStyle, boutonPrincipalStyle, boutonSecondaireStyle, thStyle, tdStyle, numStyle, formaterMontant } from "../../../lib/comptaUi";

const aujourdhui = () => new Date().toISOString().slice(0, 10);
// Du vert (non echu) au rouge (tres en retard) : une couleur par tranche.
const COULEURS = ["#3f8f6b", "#9aa84b", "#d6a437", "#d57a37", "#c4503a", "#8e2f2f"];

// Balance agee : elements ouverts (non lettres) des clients ou fournisseurs
// repartis par tranche de retard. Cliquer sur un tiers affiche ses pieces.
export default function BalanceAgeePage() {
  const { t } = useLangue();
  const locale = t("dateLocale");
  const [f, setF] = useState({ type: "CLIENT", date_arrete: aujourdhui(), mode: "ECHEANCE", tri: "TOTAL", inclure_instance: false });
  const [data, setData] = useState(null);
  const [detail, setDetail] = useState(null);
  const [erreur, setErreur] = useState("");
  const [chargement, setChargement] = useState(false);

  const parametres = (extra = {}) => {
    const p = { type: f.type, date_arrete: f.date_arrete, mode: f.mode, tri: f.tri, ...extra };
    if (f.inclure_instance) p.inclure_instance = "1";
    return p;
  };

  async function afficher(courant = f) {
    setErreur("");
    setDetail(null);
    setChargement(true);
    try {
      const p = { type: courant.type, date_arrete: courant.date_arrete, mode: courant.mode, tri: courant.tri };
      if (courant.inclure_instance) p.inclure_instance = "1";
      setData(await api.comptaBalanceAgee(p));
    } catch (e) {
      setErreur(e.message);
      setData(null);
    } finally {
      setChargement(false);
    }
  }

  useEffect(() => {
    afficher();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  function maj(cle, valeur, relancer = true) {
    const n = { ...f, [cle]: valeur };
    setF(n);
    if (relancer) afficher(n);
  }

  async function voirDetail(tiersId) {
    if (detail?.tiers_id === tiersId) return setDetail(null);
    try {
      const r = await api.comptaBalanceAgee(parametres({ tiers_id: tiersId }));
      setDetail({ tiers_id: tiersId, ...r.tiers[0] });
    } catch (e) {
      setErreur(e.message);
    }
  }

  async function exporter(format) {
    setErreur("");
    try {
      await api.comptaExporter("balance-agee", format, parametres(detail ? { tiers_id: detail.tiers_id } : {}));
    } catch (e) {
      setErreur(e.message);
    }
  }

  const m = (v) => formaterMontant(v, locale, true);
  const mm = (v) => formaterMontant(v, locale);
  const pct = (v) => `${Number(v).toLocaleString(locale, { maximumFractionDigits: 1 })} %`;
  const libTranche = (tr) => {
    if (tr.de === null) return f.mode === "FACTURE" ? t("comptaAgeeZeroEtMoins") : t("comptaAgeeNonEchu");
    if (tr.a === null) return `> ${tr.de - 1} ${t("comptaAgeeJ")}`;
    return `${tr.de} ${t("comptaAgeeA")} ${tr.a} ${t("comptaAgeeJ")}`;
  };
  const nbCol = data ? data.tranches.length + 5 : 0;

  return (
    <AppShell title={t("comptaAgeeTitre")} subNav={<ComptaSousNav />}>
      {erreur && <p style={{ color: "var(--brique)", fontSize: 12.5, marginBottom: 12 }}>{erreur}</p>}
      <p style={{ fontSize: 12, color: "var(--sub)", marginBottom: 12, maxWidth: 780, lineHeight: 1.5 }}>{t("comptaAgeeAide")}</p>
      <div className="card" style={{ marginBottom: 14, display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end" }}>
        <div style={{ display: "flex", gap: 6 }} role="tablist">
          {[["CLIENT", "comptaCoteClients"], ["FOURNISSEUR", "comptaCoteFournisseurs"]].map(([c, cle]) => (
            <button key={c} role="tab" aria-selected={f.type === c} onClick={() => maj("type", c)} style={{ ...boutonSecondaireStyle, ...(f.type === c ? { background: "var(--petrol)", color: "#fff", borderColor: "var(--petrol)" } : {}) }}>{t(cle)}</button>
          ))}
        </div>
        <div>
          <label style={labelStyle}>{t("comptaAgeeDateArrete")}</label>
          <input type="date" value={f.date_arrete} onChange={(e) => maj("date_arrete", e.target.value, false)} style={{ ...inputStyle, width: 150 }} />
        </div>
        <div>
          <label style={labelStyle}>{t("comptaAgeeMode")}</label>
          <select value={f.mode} onChange={(e) => maj("mode", e.target.value)} style={{ ...inputStyle, width: 200 }}>
            <option value="ECHEANCE">{t("comptaAgeeModeEcheance")}</option>
            <option value="FACTURE">{t("comptaAgeeModeFacture")}</option>
          </select>
        </div>
        <div>
          <label style={labelStyle}>{t("comptaAgeeTri")}</label>
          <select value={f.tri} onChange={(e) => maj("tri", e.target.value)} style={{ ...inputStyle, width: 150 }}>
            <option value="TOTAL">{t("comptaAgeeTriMontant")}</option>
            <option value="CODE">{t("comptaAgeeTriCode")}</option>
          </select>
        </div>
        <label style={{ fontSize: 12, display: "flex", gap: 6, alignItems: "center", paddingBottom: 8 }}>
          <input type="checkbox" checked={f.inclure_instance} onChange={(e) => maj("inclure_instance", e.target.checked)} />
          {t("comptaInclureInstance")}
        </label>
        <button style={boutonPrincipalStyle} onClick={() => afficher()}>{t("comptaAfficher")}</button>
        <button style={boutonSecondaireStyle} onClick={() => exporter("pdf")} disabled={!data}>PDF</button>
        <button style={boutonSecondaireStyle} onClick={() => exporter("xlsx")} disabled={!data}>Excel</button>
      </div>

      {chargement && <p style={{ fontSize: 12.5, color: "var(--sub)" }}>{t("loading")}</p>}
      {!data && !chargement && <p style={{ fontSize: 12.5, color: "var(--sub)" }}>{t("comptaEtatAide")}</p>}

      {data && (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))", gap: 12, marginBottom: 14 }}>
            <div className="card">
              <div style={{ fontSize: 11, color: "var(--sub)", fontWeight: 700 }}>{t("comptaAgeeEncours")}</div>
              <div style={{ fontSize: 19, fontWeight: 700, marginTop: 4, fontVariantNumeric: "tabular-nums" }}>{mm(data.indicateurs.encours)}</div>
            </div>
            <div className="card">
              <div style={{ fontSize: 11, color: "var(--sub)", fontWeight: 700 }}>{t("comptaAgeeEchu")}</div>
              <div style={{ fontSize: 19, fontWeight: 700, marginTop: 4, fontVariantNumeric: "tabular-nums", color: data.indicateurs.echu > 0 ? "var(--brique)" : undefined }}>{mm(data.indicateurs.echu)}</div>
              <div style={{ fontSize: 11.5, color: "var(--sub)" }}>{pct(data.indicateurs.part_echue_pct)} {t("comptaAgeeDeLEncours")}</div>
            </div>
            <div className="card">
              <div style={{ fontSize: 11, color: "var(--sub)", fontWeight: 700 }}>{t("comptaAgeeRetardMoyen")}</div>
              <div style={{ fontSize: 19, fontWeight: 700, marginTop: 4 }}>{Number(data.indicateurs.retard_moyen_jours).toLocaleString(locale)} {t("comptaAgeeJ")}</div>
            </div>
            <div className="card">
              <div style={{ fontSize: 11, color: "var(--sub)", fontWeight: 700 }}>{t("comptaAgeeAuDela90")}</div>
              <div style={{ fontSize: 19, fontWeight: 700, marginTop: 4, fontVariantNumeric: "tabular-nums" }}>{mm(data.indicateurs.au_dela_90)}</div>
              <div style={{ fontSize: 11.5, color: "var(--sub)" }}>{pct(data.indicateurs.part_au_dela_90_pct)}</div>
            </div>
          </div>

          {data.totaux.total > 0 && (
            <div style={{ marginBottom: 14 }} aria-label={t("comptaAgeeRepartition")}>
              <div style={{ display: "flex", height: 14, borderRadius: 7, overflow: "hidden", background: "var(--line-soft)" }}>
                {data.pourcentages.map((p, i) => p > 0 && <div key={i} title={`${libTranche(data.tranches[i])} : ${pct(p)}`} style={{ width: `${p}%`, background: COULEURS[i % COULEURS.length] }} />)}
              </div>
              <div style={{ display: "flex", gap: 14, flexWrap: "wrap", marginTop: 6, fontSize: 11.5 }}>
                {data.tranches.map((tr, i) => (
                  <span key={i} style={{ display: "flex", gap: 5, alignItems: "center" }}>
                    <span style={{ width: 9, height: 9, borderRadius: 2, background: COULEURS[i % COULEURS.length] }} />
                    {libTranche(tr)} · {pct(data.pourcentages[i])}
                  </span>
                ))}
              </div>
            </div>
          )}

          <div className="card" style={{ padding: 0, overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 1000 }}>
              <thead>
                <tr>
                  <th style={thStyle}>{t("comptaBalancesTiersCode")}</th>
                  <th style={thStyle}>{t("comptaBalancesTiersNom")}</th>
                  {data.tranches.map((tr, i) => <th key={i} style={{ ...thStyle, textAlign: "right" }}>{libTranche(tr)}</th>)}
                  <th style={{ ...thStyle, textAlign: "right" }}>{t("comptaAgeeTotal")}</th>
                  <th style={{ ...thStyle, textAlign: "right" }}>{t("comptaAgeeNonImpute")}</th>
                  <th style={{ ...thStyle, textAlign: "right" }}>{t("comptaAgeeSoldeNet")}</th>
                </tr>
              </thead>
              <tbody>
                {data.tiers.map((l) => (
                  <Fragment key={l.tiers_id}>
                    <tr onClick={() => voirDetail(l.tiers_id)} style={{ cursor: "pointer", background: detail?.tiers_id === l.tiers_id ? "var(--line-soft)" : undefined }}>
                      <td style={{ ...tdStyle, fontFamily: "IBM Plex Mono, monospace" }}>{l.code}</td>
                      <td style={tdStyle}>
                        {l.nom}
                        {l.avances > 0 && <div style={{ fontSize: 10.5, color: "var(--ocre)" }}>{t("comptaReglementsAvance")} {mm(l.avances)}</div>}
                      </td>
                      {l.buckets.map((b, i) => <td key={i} style={{ ...tdStyle, ...numStyle }}>{m(b)}</td>)}
                      <td style={{ ...tdStyle, ...numStyle, fontWeight: 700 }}>{m(l.total)}</td>
                      <td style={{ ...tdStyle, ...numStyle }}>{m(l.non_impute)}</td>
                      <td style={{ ...tdStyle, ...numStyle, fontWeight: 700 }}>{m(l.solde_net)}</td>
                    </tr>
                    {detail?.tiers_id === l.tiers_id && (
                      <tr>
                        <td colSpan={nbCol} style={{ ...tdStyle, background: "var(--line-soft)" }}>
                          <strong style={{ fontSize: 12 }}>{t("comptaAgeePiecesOuvertes")}</strong>
                          <table style={{ width: "100%", borderCollapse: "collapse", marginTop: 6 }}>
                            <thead>
                              <tr>
                                <th style={thStyle}>{t("comptaLettragePiece")}</th>
                                <th style={thStyle}>{t("comptaLettrageLibelle")}</th>
                                <th style={thStyle}>{t("comptaDate")}</th>
                                <th style={thStyle}>{t("comptaAchatsEcheance")}</th>
                                <th style={{ ...thStyle, textAlign: "right" }}>{t("comptaAgeeMontantPiece")}</th>
                                <th style={{ ...thStyle, textAlign: "right" }}>{t("comptaAgeeResteDu")}</th>
                                <th style={{ ...thStyle, textAlign: "right" }}>{t("comptaAgeeJours")}</th>
                              </tr>
                            </thead>
                            <tbody>
                              {(detail.pieces || []).map((p) => (
                                <tr key={p.ligne_id}>
                                  <td style={tdStyle}>{p.piece}</td>
                                  <td style={tdStyle}>{p.libelle}</td>
                                  <td style={tdStyle}>{p.date}</td>
                                  <td style={tdStyle}>{p.echeance}</td>
                                  <td style={{ ...tdStyle, ...numStyle }}>{mm(p.montant)}</td>
                                  <td style={{ ...tdStyle, ...numStyle, fontWeight: 700 }}>{mm(p.restant)}</td>
                                  <td style={{ ...tdStyle, ...numStyle, color: p.jours > 0 ? "var(--brique)" : undefined }}>{p.jours}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
                {data.tiers.length === 0 && <tr><td colSpan={nbCol} style={{ ...tdStyle, color: "var(--sub)" }}>{t("comptaAgeeAucun")}</td></tr>}
                {data.tiers.length > 0 && (
                  <>
                    <tr style={{ background: "var(--line-soft)" }}>
                      <td style={{ ...tdStyle, fontWeight: 700 }} colSpan={2}>{t("comptaTotalGeneral")}</td>
                      {data.totaux.buckets.map((b, i) => <td key={i} style={{ ...tdStyle, ...numStyle, fontWeight: 700 }}>{m(b)}</td>)}
                      <td style={{ ...tdStyle, ...numStyle, fontWeight: 700 }}>{m(data.totaux.total)}</td>
                      <td style={{ ...tdStyle, ...numStyle, fontWeight: 700 }}>{m(data.totaux.non_impute)}</td>
                      <td style={{ ...tdStyle, ...numStyle, fontWeight: 700 }}>{m(data.totaux.solde_net)}</td>
                    </tr>
                    <tr>
                      <td style={{ ...tdStyle, color: "var(--sub)" }} colSpan={2}>{t("comptaAgeeRepartition")}</td>
                      {data.pourcentages.map((p, i) => <td key={i} style={{ ...tdStyle, ...numStyle, color: "var(--sub)" }}>{pct(p)}</td>)}
                      <td style={{ ...tdStyle, ...numStyle, color: "var(--sub)" }}>100 %</td>
                      <td style={tdStyle} colSpan={2}></td>
                    </tr>
                  </>
                )}
              </tbody>
            </table>
          </div>
          <p style={{ fontSize: 11.5, color: "var(--sub)", marginTop: 8 }}>{t("comptaAgeeClicDetail")}</p>

          {data.controle.lignes_sans_tiers > 0 && (
            <p style={{ fontSize: 12, color: "var(--ocre)", marginTop: 8 }}>
              {data.controle.lignes_sans_tiers} {t("comptaBalancesTiersSansTiers")} ({mm(data.controle.solde_sans_tiers)}) — {t("comptaAgeeHorsBalance")}
            </p>
          )}

          {data.indicateurs.plus_gros_retards.length > 0 && (
            <div className="card" style={{ marginTop: 14 }}>
              <strong style={{ fontSize: 12.5 }}>{t("comptaAgeePlusGrosRetards")}</strong>
              <table style={{ width: "100%", borderCollapse: "collapse", marginTop: 6, maxWidth: 560 }}>
                <tbody>
                  {data.indicateurs.plus_gros_retards.map((r) => (
                    <tr key={r.code}>
                      <td style={{ ...tdStyle, fontFamily: "IBM Plex Mono, monospace", width: 90 }}>{r.code}</td>
                      <td style={tdStyle}>{r.nom}</td>
                      <td style={{ ...tdStyle, ...numStyle, color: "var(--brique)", fontWeight: 700 }}>{mm(r.echu)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </AppShell>
  );
}
