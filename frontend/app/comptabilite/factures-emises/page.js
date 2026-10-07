"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { api } from "../../../lib/api";
import { useLangue } from "../../../lib/i18n/LanguageContext";
import AppShell from "../../../lib/components/AppShell";
import ComptaSousNav from "../../../lib/components/ComptaSousNav";
import { labelStyle, inputStyle, boutonPrincipalStyle, boutonSecondaireStyle, thStyle as thBase, tdStyle as tdBase, numStyle } from "../../../lib/comptaUi";

const STATUT_STYLE = {
  IMPAYEE: { color: "var(--brique)", background: "rgba(196,74,58,0.1)" },
  PAYEE: { color: "#2E7D5B", background: "rgba(46,125,91,0.12)" },
  ANNULEE: { color: "var(--sub)", background: "rgba(91,106,108,0.1)" },
};

// Cellules plus serrees que le standard compta : ce tableau a 12 colonnes.
const thStyle = { ...thBase, padding: "8px 5px" };
const tdStyle = { ...tdBase, padding: "7px 5px", fontSize: 12 };

const anneeCourante = () => new Date().getFullYear();
const filtresInitiaux = () => ({
  debut: `${anneeCourante()}-01-01`,
  fin: `${anneeCourante()}-12-31`,
  client_id: "",
  statut: "",
  recherche: "",
});

// Registre des factures de vente emises : liste filtrable + exports PDF / Excel.
export default function FacturesEmisesPage() {
  const { t } = useLangue();
  const locale = t("dateLocale");
  const [f, setF] = useState(filtresInitiaux);
  const [data, setData] = useState(null);
  const [erreur, setErreur] = useState("");
  const [chargement, setChargement] = useState(false);

  const parametres = (courant) => {
    const p = {};
    for (const [k, v] of Object.entries(courant)) if (v) p[k] = v;
    return p;
  };

  async function afficher(courant = f) {
    setErreur("");
    setChargement(true);
    try {
      setData(await api.comptaFacturesEmises(parametres(courant)));
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

  function toutePeriode() {
    const n = { ...f, debut: "", fin: "" };
    setF(n);
    afficher(n);
  }

  async function exporter(format) {
    setErreur("");
    try {
      await api.comptaExporter("factures-emises", format, parametres(f));
    } catch (e) {
      setErreur(e.message);
    }
  }

  // XOF : pas de centimes affiches quand le montant est entier (tableau plus compact).
  const mm = (v) => Number(v || 0).toLocaleString(locale, { minimumFractionDigits: 0, maximumFractionDigits: 2 });
  const mz = (v) => (Math.abs(Number(v || 0)) < 0.005 ? "" : mm(v));
  const dateCourte = (iso) => (iso ? new Date(`${String(iso).slice(0, 10)}T00:00:00`).toLocaleDateString(locale) : "");
  const tot = data?.totaux;

  return (
    <AppShell title={t("comptaFETitre")} subNav={<ComptaSousNav />}>
      {erreur && <p style={{ color: "var(--brique)", fontSize: 12.5, marginBottom: 12 }}>{erreur}</p>}
      <p style={{ fontSize: 12, color: "var(--sub)", marginBottom: 12, maxWidth: 780, lineHeight: 1.5 }}>{t("comptaFEAide")}</p>

      <div className="card" style={{ marginBottom: 14, display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end" }}>
        <div>
          <label style={labelStyle}>{t("comptaFEDu")}</label>
          <input type="date" value={f.debut} onChange={(e) => maj("debut", e.target.value)} style={{ ...inputStyle, width: 150 }} />
        </div>
        <div>
          <label style={labelStyle}>{t("comptaFEAu")}</label>
          <input type="date" value={f.fin} onChange={(e) => maj("fin", e.target.value)} style={{ ...inputStyle, width: 150 }} />
        </div>
        <button style={boutonSecondaireStyle} onClick={toutePeriode}>{t("comptaFEToutePeriode")}</button>
        <div>
          <label style={labelStyle}>{t("comptaFEClient")}</label>
          <select value={f.client_id} onChange={(e) => maj("client_id", e.target.value)} style={{ ...inputStyle, width: 210 }}>
            <option value="">{t("comptaFETousClients")}</option>
            {(data?.clients || []).map((c) => <option key={c.id} value={c.id}>{c.nom}</option>)}
          </select>
        </div>
        <div>
          <label style={labelStyle}>{t("comptaFEStatut")}</label>
          <select value={f.statut} onChange={(e) => maj("statut", e.target.value)} style={{ ...inputStyle, width: 170 }}>
            <option value="">{t("comptaFETous")}</option>
            {["IMPAYEE", "EN_RETARD", "PAYEE", "ANNULEE"].map((s) => <option key={s} value={s}>{t(`comptaFEStatut${s}`)}</option>)}
          </select>
        </div>
        <div>
          <label style={labelStyle}>{t("comptaFERecherche")}</label>
          <input
            value={f.recherche}
            onChange={(e) => setF({ ...f, recherche: e.target.value })}
            onKeyDown={(e) => e.key === "Enter" && afficher()}
            style={{ ...inputStyle, width: 230 }}
          />
        </div>
        <button style={boutonPrincipalStyle} onClick={() => afficher()}>{t("comptaAfficher")}</button>
        <button style={boutonSecondaireStyle} onClick={() => exporter("pdf")} disabled={!data}>PDF</button>
        <button style={boutonSecondaireStyle} onClick={() => exporter("xlsx")} disabled={!data}>Excel</button>
      </div>

      {chargement && <p style={{ fontSize: 12.5, color: "var(--sub)" }}>{t("loading")}</p>}

      {data && (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: 12, marginBottom: 14 }}>
            <div className="card">
              <div style={{ fontSize: 11, color: "var(--sub)", fontWeight: 700 }}>{t("comptaFENombre")}</div>
              <div style={{ fontSize: 19, fontWeight: 700, marginTop: 4 }}>{tot.nombre}</div>
              <div style={{ fontSize: 11.5, color: "var(--sub)" }}>
                {t("comptaFEHorsAnnulees")}
                {tot.nombre_annulees > 0 ? ` · ${tot.nombre_annulees} ${t("comptaFEAnnulees")}` : ""}
              </div>
            </div>
            <div className="card">
              <div style={{ fontSize: 11, color: "var(--sub)", fontWeight: 700 }}>{t("comptaFETotalTTC")}</div>
              <div style={{ fontSize: 19, fontWeight: 700, marginTop: 4, fontVariantNumeric: "tabular-nums" }}>{mm(tot.total_ttc)}</div>
              <div style={{ fontSize: 11.5, color: "var(--sub)", fontVariantNumeric: "tabular-nums" }}>
                {t("comptaFETotalHT")} {mm(tot.total_ht)} · {t("comptaFETVA")} {mm(tot.montant_tva)}
              </div>
            </div>
            <div className="card">
              <div style={{ fontSize: 11, color: "var(--sub)", fontWeight: 700 }}>{t("comptaFEEncaisse")}</div>
              <div style={{ fontSize: 19, fontWeight: 700, marginTop: 4, color: "#2E7D5B", fontVariantNumeric: "tabular-nums" }}>{mm(tot.encaisse)}</div>
            </div>
            <div className="card">
              <div style={{ fontSize: 11, color: "var(--sub)", fontWeight: 700 }}>{t("comptaFEReste")}</div>
              <div style={{ fontSize: 19, fontWeight: 700, marginTop: 4, fontVariantNumeric: "tabular-nums" }}>{mm(tot.reste_du)}</div>
              {tot.echu > 0 && (
                <div style={{ fontSize: 11.5, color: "var(--brique)", fontVariantNumeric: "tabular-nums" }}>
                  {t("comptaFEDontEchu")} {mm(tot.echu)}
                </div>
              )}
            </div>
          </div>

          <div className="card" style={{ padding: 0, overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 960 }}>
              <thead>
                <tr>
                  <th style={thStyle}>{t("comptaFENumero")}</th>
                  <th style={thStyle}>{t("comptaFEDate")}</th>
                  <th style={thStyle}>{t("comptaFEClient")}</th>
                  <th style={thStyle}>{t("comptaFEType")}</th>
                  <th style={{ ...thStyle, textAlign: "right" }}>{t("comptaFETotalHT")}</th>
                  <th style={{ ...thStyle, textAlign: "right" }}>{t("comptaFETVA")}</th>
                  <th style={{ ...thStyle, textAlign: "right" }}>{t("comptaFETotalTTC")}</th>
                  <th style={{ ...thStyle, textAlign: "right" }}>{t("comptaFENet")}</th>
                  <th style={{ ...thStyle, textAlign: "right" }}>{t("comptaFEEncaisse")}</th>
                  <th style={{ ...thStyle, textAlign: "right" }}>{t("comptaFEReste")}</th>
                  <th style={thStyle}>{t("comptaFEEcheance")}</th>
                  <th style={thStyle}>{t("comptaFEStatutCol")}</th>
                </tr>
              </thead>
              <tbody>
                {data.lignes.map((l) => {
                  const annulee = l.statut === "ANNULEE";
                  const grise = annulee ? { color: "var(--sub)" } : {};
                  return (
                    <tr key={l.id}>
                      <td style={{ ...tdStyle, fontFamily: "IBM Plex Mono, monospace", whiteSpace: "nowrap" }}>
                        <Link href={`/marches/consultation-restreinte/factures/${l.id}`} style={{ color: "var(--petrol)", fontWeight: 600 }} title={t("comptaFEOuvrir")}>
                          {l.numero_affiche}
                        </Link>
                      </td>
                      <td style={{ ...tdStyle, ...grise, whiteSpace: "nowrap" }}>{dateCourte(l.date_facture)}</td>
                      <td style={{ ...tdStyle, ...grise }}>
                        {l.client_nom}
                        {l.reference_bc_client && <div style={{ fontSize: 11, color: "var(--sub)" }}>{l.reference_bc_client}</div>}
                      </td>
                      <td style={{ ...tdStyle, ...grise, whiteSpace: "nowrap" }}>
                        {t(`comptaFEType${l.type_facturation}`)}
                        {l.type_facturation === "ACOMPTE" && l.pourcentage_acompte ? ` ${l.pourcentage_acompte} %` : ""}
                      </td>
                      <td style={{ ...tdStyle, ...numStyle, ...grise }}>{mm(l.total_ht)}</td>
                      <td style={{ ...tdStyle, ...numStyle, ...grise }}>{mm(l.montant_tva)}</td>
                      <td style={{ ...tdStyle, ...numStyle, ...grise }}>{mm(l.total_ttc)}</td>
                      <td style={{ ...tdStyle, ...numStyle, ...grise, fontWeight: 600 }}>{mm(l.net_a_payer)}</td>
                      <td style={{ ...tdStyle, ...numStyle, ...grise }}>{mz(l.encaisse)}</td>
                      <td style={{ ...tdStyle, ...numStyle, ...grise, fontWeight: 700, color: l.en_retard ? "var(--brique)" : grise.color }}>{mz(l.reste_du)}</td>
                      <td style={{ ...tdStyle, whiteSpace: "nowrap", color: l.en_retard ? "var(--brique)" : "var(--sub)" }}>{dateCourte(l.date_echeance)}</td>
                      <td style={tdStyle}>
                        <span style={{ fontSize: 10.5, fontWeight: 700, padding: "3px 8px", borderRadius: 20, whiteSpace: "nowrap", ...(STATUT_STYLE[l.statut] || {}), ...(l.en_retard ? STATUT_STYLE.IMPAYEE : {}) }}>
                          {l.en_retard ? t("comptaFEEnRetard") : t(`comptaFEStatut${l.statut}`)}
                        </span>
                        {l.statut !== "ANNULEE" && (
                          <div style={{ fontSize: 10.5, color: "var(--sub)", marginTop: 3, whiteSpace: "nowrap" }}>
                            {t("comptaFEComptabilisee")} : {l.comptabilisee ? (l.ecriture_statut === "VALIDEE" ? t("comptaFEOui") : t("comptaFEInstance")) : t("comptaFENon")}
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
                {data.lignes.length === 0 && (
                  <tr><td colSpan={12} style={{ ...tdStyle, color: "var(--sub)" }}>{t("comptaFEAucune")}</td></tr>
                )}
                {data.lignes.length > 0 && (
                  <tr style={{ background: "var(--line-soft)" }}>
                    <td style={{ ...tdStyle, fontWeight: 700 }} colSpan={4}>{t("comptaTotalGeneral")} ({tot.nombre}, {t("comptaFEHorsAnnulees")})</td>
                    <td style={{ ...tdStyle, ...numStyle, fontWeight: 700 }}>{mm(tot.total_ht)}</td>
                    <td style={{ ...tdStyle, ...numStyle, fontWeight: 700 }}>{mm(tot.montant_tva)}</td>
                    <td style={{ ...tdStyle, ...numStyle, fontWeight: 700 }}>{mm(tot.total_ttc)}</td>
                    <td style={{ ...tdStyle, ...numStyle, fontWeight: 700 }}>{mm(tot.net_a_payer)}</td>
                    <td style={{ ...tdStyle, ...numStyle, fontWeight: 700 }}>{mm(tot.encaisse)}</td>
                    <td style={{ ...tdStyle, ...numStyle, fontWeight: 700 }}>{mm(tot.reste_du)}</td>
                    <td style={tdStyle} colSpan={2}></td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}
    </AppShell>
  );
}
