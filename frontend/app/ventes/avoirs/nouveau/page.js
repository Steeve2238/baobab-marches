"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "../../../../lib/api";
import { useLangue } from "../../../../lib/i18n/LanguageContext";
import AppShell from "../../../../lib/components/AppShell";
import ModeReglementSelect from "../../../../lib/components/ModeReglementSelect";
import { labelStyle, inputStyle, boutonPrincipalStyle, boutonSecondaireStyle, thStyle, tdStyle, numStyle } from "../../../../lib/comptaUi";

const fmt = (n) => Math.round(Number(n) || 0).toLocaleString("fr-FR").replace(/[  ]/g, " ");
const fmtQ = (n) => (Number(n) || 0).toLocaleString("fr-FR", { maximumFractionDigits: 3 }).replace(/[  ]/g, " ");
const sub = (txt, vars) => String(txt).replace(/\{(\w+)\}/g, (_, k) => (vars && vars[k] !== undefined ? vars[k] : `{${k}}`));
const aujourdhui = () => new Date().toISOString().slice(0, 10);
const il = (d) => (d ? String(d).slice(0, 10).split("-").reverse().join("/") : "—");
const arr2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
const MOTIFS = ["RETOUR_MARCHANDISE", "ERREUR_FACTURATION", "REMISE_COMMERCIALE", "ANNULATION_VENTE", "AUTRE"];

function ChoixFacture({ t, onChoisir }) {
  const [q, setQ] = useState("");
  const [liste, setListe] = useState([]);
  useEffect(() => {
    const h = setTimeout(() => { api.avoirFactures(q).then((r) => setListe(r.factures || [])).catch(() => setListe([])); }, 250);
    return () => clearTimeout(h);
  }, [q]);
  return (
    <div className="card">
      <label style={labelStyle}>{t("avoChoisirFacture")}</label>
      <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("avoChercherFacture")} style={{ ...inputStyle, maxWidth: 380 }} />
      <div style={{ marginTop: 10, display: "grid", gap: 6 }}>
        {liste.length === 0 ? <span style={{ fontSize: 12.5, color: "var(--sub)" }}>{t("avoAucuneFacture")}</span> : liste.map((f) => (
          <button key={f.id} type="button" onClick={() => onChoisir(f.id)} style={{ textAlign: "left", border: "1px solid var(--line)", background: "#fff", borderRadius: 8, padding: "8px 12px", cursor: "pointer", fontSize: 13 }}>
            <b>{f.numero}</b> · {f.client_nom} · {il(f.date_facture)} · <span style={{ color: "var(--sub)" }}>{fmt(f.total_ttc)} F</span>
          </button>
        ))}
      </div>
    </div>
  );
}

export default function NouvelAvoirPage() {
  const { t } = useLangue();
  const router = useRouter();
  const [factureId, setFactureId] = useState("");
  const [el, setEl] = useState(null);
  const [mode, setMode] = useState("LIGNES");
  const [motifType, setMotifType] = useState("RETOUR_MARCHANDISE");
  const [motif, setMotif] = useState("");
  const [date, setDate] = useState(aujourdhui());
  const [qtes, setQtes] = useState({});
  const [stock, setStock] = useState({});
  const [montantLibre, setMontantLibre] = useState("");
  const [modeRemb, setModeRemb] = useState("");
  const [reference, setReference] = useState("");
  const [erreur, setErreur] = useState("");
  const [envoi, setEnvoi] = useState(false);

  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get("facture_id");
    if (id) setFactureId(id);
  }, []);
  const charger = useCallback(() => {
    if (!factureId) { setEl(null); return; }
    api.avoirEligibilite(factureId).then((r) => {
      setEl(r); setQtes({}); setStock({}); setMontantLibre("");
      // Pour un retour, on pre-coche la remise en stock des lignes livrees.
      const s = {};
      r.lignes.forEach((l) => { if (l.quantite_retournable > 0) s[l.id] = true; });
      setStock(s);
    }).catch((e) => setErreur(e.message));
  }, [factureId]);
  useEffect(() => { charger(); }, [charger]);

  const libreAutorise = ["ERREUR_FACTURATION", "REMISE_COMMERCIALE", "AUTRE"].includes(motifType);
  useEffect(() => { if (!libreAutorise && mode === "LIBRE") setMode("LIGNES"); }, [libreAutorise, mode]);

  const calc = useMemo(() => {
    if (!el) return null;
    const taux = el.facture.taux_tva_effectif_pct / 100;
    let ht = 0;
    if (mode === "LIGNES") {
      for (const l of el.lignes) {
        const q = Number(String(qtes[l.id] ?? "").replace(",", "."));
        if (q > 0) ht += arr2(q * l.prix_unitaire_ht_net);
      }
    } else {
      ht = Number(String(montantLibre).replace(/\s/g, "").replace(",", ".")) || 0;
    }
    ht = arr2(ht);
    let ttc = arr2(ht * (1 + taux));
    // Dernière tranche : l'avoir solde exactement la facture (arrondi).
    if (Math.abs(ttc - el.reste_creditable_ttc) <= 1 && ttc > 0) ttc = el.reste_creditable_ttc;
    const tva = arr2(ttc - ht);
    const solde = Math.max(el.facture.solde_du, 0);
    const impute = arr2(Math.min(ttc, solde));
    return { ht, tva, ttc, impute, rembourse: arr2(ttc - impute) };
  }, [el, mode, qtes, montantLibre]);

  async function creer(e) {
    e.preventDefault();
    setErreur("");
    setEnvoi(true);
    try {
      const body = { facture_id: factureId, motif_type: motifType, motif, date_avoir: date, reference, mode_reglement_id: calc.rembourse > 0 ? modeRemb : undefined };
      if (mode === "LIGNES") {
        body.lignes = el.lignes.filter((l) => Number(String(qtes[l.id] ?? "").replace(",", ".")) > 0).map((l) => ({
          facture_ligne_id: l.id, quantite: Number(String(qtes[l.id]).replace(",", ".")), retour_stock: !!stock[l.id] && l.quantite_retournable > 0,
        }));
      } else {
        body.montant_ht = Number(String(montantLibre).replace(/\s/g, "").replace(",", "."));
      }
      const r = await api.avoirCreer(body);
      router.push(`/ventes/avoirs/${r.id}`);
    } catch (err) {
      setErreur(err.message);
      setEnvoi(false);
    }
  }

  return (
    <AppShell title={t("avoNouveauTitre")} backHref="/ventes/avoirs" backLabelKey="avoRetourListe">
      {erreur && <p style={{ color: "var(--brique)", fontSize: 12.5 }}>{erreur}</p>}
      {!factureId && <ChoixFacture t={t} onChoisir={setFactureId} />}
      {factureId && el && (
        <form onSubmit={creer} style={{ display: "grid", gap: 16, maxWidth: 1000 }}>
          <div className="card" style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
            <div>
              <div style={{ fontWeight: 700, fontSize: 14 }}>{sub(t("avoFactureLabel"), { n: el.facture.numero, c: el.facture.client_nom, d: il(el.facture.date_facture) })}</div>
              <div style={{ fontSize: 12.5, color: "var(--sub)", marginTop: 3 }}>
                {sub(t("avoFactureResume"), { ttc: fmt(el.facture.montant_net_a_payer), deja: fmt(el.ttc_deja_credite), reste: fmt(el.reste_creditable_ttc), solde: fmt(el.facture.solde_du) })}
              </div>
            </div>
            <button type="button" onClick={() => { setFactureId(""); setEl(null); }} style={boutonSecondaireStyle}>{t("avoChanger")}</button>
          </div>
          {!el.eligible && <p style={{ color: "var(--brique)", fontSize: 13 }}>{t("avoNonEligible")} {el.raisons.map((r) => r).join(" ")}</p>}
          {el.eligible && (
            <>
              <div className="card" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 12 }}>
                <div>
                  <label style={labelStyle}>{t("avoMotif")}</label>
                  <select value={motifType} onChange={(e) => setMotifType(e.target.value)} style={inputStyle}>
                    {MOTIFS.map((m) => <option key={m} value={m}>{t("avoMotif" + m)}</option>)}
                  </select>
                </div>
                <div><label style={labelStyle}>{t("avoPrecision")}</label><input value={motif} maxLength={300} onChange={(e) => setMotif(e.target.value)} style={inputStyle} /></div>
                <div><label style={labelStyle}>{t("avoDateAvoir")}</label><input type="date" max={aujourdhui()} min={el.facture.date_facture} value={date} onChange={(e) => setDate(e.target.value)} style={inputStyle} /></div>
              </div>

              <div className="card" style={{ padding: 0, overflowX: "auto" }}>
                <div style={{ padding: "12px 14px", display: "flex", gap: 16, alignItems: "center", flexWrap: "wrap" }}>
                  <b style={{ fontSize: 13.5 }}>{t("avoModeCredit")}</b>
                  <label style={{ fontSize: 13 }}><input type="radio" checked={mode === "LIGNES"} onChange={() => setMode("LIGNES")} /> {t("avoParLignes")}</label>
                  {libreAutorise && <label style={{ fontSize: 13 }}><input type="radio" checked={mode === "LIBRE"} onChange={() => setMode("LIBRE")} /> {t("avoMontantLibre")}</label>}
                </div>
                {mode === "LIGNES" ? (
                  <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 760 }}>
                    <thead><tr>
                      <th style={thStyle}>{t("avoColDesignation")}</th><th style={{ ...thStyle, textAlign: "right" }}>{t("avoColFacturee")}</th><th style={{ ...thStyle, textAlign: "right" }}>{t("avoColDejaCredite")}</th>
                      <th style={{ ...thStyle, textAlign: "right" }}>{t("avoColPu")}</th><th style={{ ...thStyle, textAlign: "right" }}>{t("avoColACrediter")}</th><th style={thStyle}>{t("avoColStock")}</th><th style={{ ...thStyle, textAlign: "right" }}>{t("avoColMontantHt")}</th>
                    </tr></thead>
                    <tbody>
                      {el.lignes.map((l) => {
                        const q = Number(String(qtes[l.id] ?? "").replace(",", ".")) || 0;
                        const grise = l.quantite_creditable <= 0;
                        return (
                          <tr key={l.id} style={{ opacity: grise ? 0.5 : 1 }}>
                            <td style={tdStyle}>{l.designation}{l.reference ? <span style={{ color: "var(--sub)" }}> · {l.reference}</span> : null}</td>
                            <td style={{ ...tdStyle, ...numStyle }}>{fmtQ(l.quantite_facturee)}</td>
                            <td style={{ ...tdStyle, ...numStyle }}>{fmtQ(l.quantite_deja_creditee)}</td>
                            <td style={{ ...tdStyle, ...numStyle }}>{fmt(l.prix_unitaire_ht_net)}</td>
                            <td style={{ ...tdStyle, textAlign: "right" }}>
                              <input disabled={grise} inputMode="decimal" value={qtes[l.id] ?? ""} placeholder={sub(t("avoMax"), { n: fmtQ(l.quantite_creditable) })}
                                onChange={(e) => setQtes({ ...qtes, [l.id]: e.target.value })} style={{ ...inputStyle, width: 100, textAlign: "right", padding: "4px 8px" }} />
                            </td>
                            <td style={tdStyle}>
                              {l.produit_id ? (l.quantite_retournable > 0
                                ? <label style={{ fontSize: 12.5 }}><input type="checkbox" checked={!!stock[l.id]} onChange={(e) => setStock({ ...stock, [l.id]: e.target.checked })} /> {fmtQ(l.quantite_retournable)}</label>
                                : <span style={{ fontSize: 12, color: "var(--sub)" }}>{t("avoRetournableAucun")}</span>) : "—"}
                            </td>
                            <td style={{ ...tdStyle, ...numStyle }}>{q > 0 ? fmt(q * l.prix_unitaire_ht_net) : "—"}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                ) : (
                  <div style={{ padding: "0 14px 14px" }}>
                    <label style={labelStyle}>{t("avoMontantHtLibre")}</label>
                    <input inputMode="decimal" value={montantLibre} onChange={(e) => setMontantLibre(e.target.value)} style={{ ...inputStyle, width: 220, textAlign: "right", fontWeight: 600 }} />
                  </div>
                )}
              </div>

              {calc && calc.ttc > 0 && (
                <div className="card" style={{ display: "grid", gap: 12 }}>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12 }}>
                    {[["avoResumeHt", calc.ht], ["avoResumeTva", calc.tva], ["avoResumeTtc", calc.ttc], ["avoImpute", calc.impute], ["avoRembourse", calc.rembourse]].map(([k, v]) => (
                      <div key={k}>
                        <div style={{ fontSize: 11, color: "var(--sub)", textTransform: "uppercase", fontWeight: 700 }}>{t(k)}</div>
                        <div style={{ fontFamily: "Space Grotesk", fontWeight: 700, fontSize: k === "avoResumeTtc" ? 22 : 17, color: k === "avoRembourse" && v > 0 ? "var(--brique)" : "inherit" }}>{fmt(v)} F</div>
                      </div>
                    ))}
                  </div>
                  {calc.rembourse > 0 && (
                    <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
                      <div style={{ minWidth: 240 }}>
                        <label style={labelStyle}>{t("avoModeRemboursement")}</label>
                        <ModeReglementSelect sens="DECAISSEMENT" vide={false} value={modeRemb} onChange={(id) => setModeRemb(id)} style={inputStyle} />
                      </div>
                      <div style={{ minWidth: 240 }}><label style={labelStyle}>{t("avoReference")}</label><input value={reference} onChange={(e) => setReference(e.target.value)} style={inputStyle} /></div>
                    </div>
                  )}
                  <p style={{ fontSize: 12, color: "var(--sub)", margin: 0 }}>{t("avoAvertCompta")}</p>
                  <div><button type="submit" disabled={envoi || (calc.rembourse > 0 && !modeRemb)} style={boutonPrincipalStyle}>{t("avoCreer")}</button></div>
                </div>
              )}
            </>
          )}
        </form>
      )}
    </AppShell>
  );
}
