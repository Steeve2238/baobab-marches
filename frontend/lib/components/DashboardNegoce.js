"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { api } from "../api";
import { useLangue } from "../i18n/LanguageContext";

const fmt = (n) => Math.round(Number(n) || 0).toLocaleString("fr-FR").replace(/[  ]/g, " ");
const sub = (txt, vars) => String(txt).replace(/\{(\w+)\}/g, (_, k) => (vars && vars[k] !== undefined ? vars[k] : `{${k}}`));

function Tuile({ titre, valeur, aide, ton }) {
  return (
    <div className="card" style={{ padding: "14px 16px" }}>
      <div style={{ fontSize: 10.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.4, color: "var(--sub)" }}>{titre}</div>
      <div style={{ fontFamily: "Space Grotesk", fontWeight: 700, fontSize: 24, margin: "4px 0 2px", color: ton || "var(--ink)" }}>{valeur}</div>
      <div style={{ fontSize: 11.5, color: "var(--sub)" }}>{aide}</div>
    </div>
  );
}

function Barres({ data }) {
  const max = Math.max(1, ...data.map((d) => d.valeur));
  const W = 560, H = 150, bas = 128, haut = 8;
  const pas = W / Math.max(1, data.length);
  const largeur = Math.min(26, pas * 0.62);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height: "auto", display: "block" }} role="img">
      <line x1="0" y1={bas} x2={W} y2={bas} stroke="var(--line)" />
      {data.map((d, i) => {
        const h = d.valeur > 0 ? Math.max(2, ((bas - haut) * d.valeur) / max) : 0;
        const x = i * pas + (pas - largeur) / 2;
        return (
          <g key={d.cle}>
            <rect x={x} y={bas - h} width={largeur} height={h} rx="3" fill="var(--petrol)" opacity={d.valeur > 0 ? 1 : 0.15}>
              <title>{`${d.cle} : ${fmt(d.valeur)} F`}</title>
            </rect>
            {(data.length <= 16 || i % 2 === 0) && <text x={x + largeur / 2} y={H - 6} textAnchor="middle" fontSize="10" fill="var(--sub)">{d.libelle}</text>}
          </g>
        );
      })}
    </svg>
  );
}

export default function DashboardNegoce({ compact = false }) {
  const { t } = useLangue();
  const [periode, setPeriode] = useState("MOIS");
  const [d, setD] = useState(null);
  const [erreur, setErreur] = useState("");

  useEffect(() => {
    let actif = true;
    api.dashboardNegoce(periode).then((r) => actif && setD(r)).catch((e) => actif && setErreur(e.message));
    return () => { actif = false; };
  }, [periode]);

  if (erreur) return <p style={{ color: "var(--brique)", fontSize: 12.5 }}>{erreur}</p>;
  // « Les deux » : le panneau n'apparait que si le client vend deja (caisse) ou tient un catalogue produits.
  if (d && compact && !d.activite) return null;
  if (!d) return <p style={{ fontSize: 12.5, color: "var(--sub)" }}>{t("dgnCharge")}</p>;

  const maxMode = Math.max(1, ...d.encaissements.par_mode.map((m) => m.montant));
  const tranches = [["A_ECHOIR", "dgnAEchoir", "var(--sub)"], ["J0_30", "dgnJ030", "var(--ocre)"], ["J31_60", "dgnJ3160", "var(--brique)"], ["J60_PLUS", "dgnJ60", "var(--brique)"]];
  const maxTr = Math.max(1, ...tranches.map(([k]) => d.creances.tranches[k]));
  const evol = d.ventes.evolution_pct;

  return (
    <section style={{ marginBottom: 24 }}>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center", marginBottom: 14 }}>
        {compact && <h2 style={{ fontSize: 15, margin: "0 12px 0 0", color: "var(--petrol)" }}>{t("dgnTitre")}</h2>}
        {[["JOUR", "dgnJour"], ["SEMAINE", "dgnSemaine"], ["MOIS", "dgnMois"], ["ANNEE", "dgnAnnee"]].map(([k, cle]) => (
          <button key={k} type="button" onClick={() => setPeriode(k)} style={{ border: "1px solid var(--line)", background: periode === k ? "var(--petrol)" : "#fff", color: periode === k ? "#fff" : "var(--ink)", borderRadius: 999, padding: "4px 12px", fontSize: 11.5, fontWeight: 600, cursor: "pointer" }}>{t(cle)}</button>
        ))}
        <Link href="/caisse" style={{ marginLeft: "auto", background: "var(--petrol)", color: "#fff", borderRadius: 8, padding: "7px 14px", fontSize: 12.5, fontWeight: 600, textDecoration: "none" }}>{t("dgnOuvrirCaisse")}</Link>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(230px, 1fr))", gap: 12, marginBottom: 14 }}>
        <Tuile titre={t("dgnCa")} valeur={`${fmt(d.ventes.ttc)} F`}
          aide={<>{sub(t("dgnVentes"), { n: d.ventes.nb, m: fmt(d.ventes.panier_moyen) })}{evol !== null && <><br /><span style={{ color: evol >= 0 ? "var(--vert)" : "var(--brique)", fontWeight: 600 }}>{evol >= 0 ? "▲" : "▼"} {sub(t("dgnVsPrec"), { p: Math.abs(evol) })}</span></>}</>} />
        <Tuile titre={t("dgnEncaisse")} valeur={`${fmt(d.encaissements.total)} F`} aide={t("dgnEncaisseAide")} />
        <Tuile titre={t("dgnCreances")} valeur={`${fmt(d.creances.total)} F`} ton={d.creances.en_retard > 0 ? "var(--brique)" : undefined}
          aide={d.creances.en_retard > 0 ? sub(t("dgnCreancesRetard"), { m: fmt(d.creances.en_retard) }) : `${d.creances.nb}`} />
        <Tuile titre={t("dgnStockValeur")} valeur={`${fmt(d.stock.valeur)} F`} aide={sub(t("dgnStockAide"), { r: d.stock.ruptures, f: d.stock.faibles })} />
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(340px, 1fr))", gap: 14, marginBottom: 14 }}>
        <div className="card">
          <h3 style={h3}>{t("dgnEvolution")}</h3>
          <Barres data={d.evolution} />
        </div>
        <div className="card">
          <h3 style={h3}>{t("dgnParMode")}</h3>
          {d.encaissements.par_mode.length === 0 ? <p style={vide}>{t("dgnAucunEncaissement")}</p> : (
            <div style={{ display: "grid", gap: 10 }}>
              {d.encaissements.par_mode.map((m) => (
                <div key={m.mode}>
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12.5, marginBottom: 3 }}><span style={{ fontWeight: 600 }}>{m.mode}</span><span>{fmt(m.montant)} F</span></div>
                  <div style={{ height: 8, background: "var(--bg)", borderRadius: 4 }}><div style={{ width: `${(m.montant / maxMode) * 100}%`, height: 8, background: "var(--petrol)", borderRadius: 4 }} /></div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(340px, 1fr))", gap: 14, marginBottom: 14 }}>
        <div className="card">
          <h3 style={h3}>{t("dgnAgeing")}</h3>
          {d.creances.total <= 0 ? <p style={vide}>{t("dgnAucuneCreance")}</p> : (
            <>
              <div style={{ display: "grid", gap: 8, marginBottom: 14 }}>
                {tranches.map(([k, cle, couleur]) => (
                  <div key={k}>
                    <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12.5, marginBottom: 3 }}><span>{t(cle)}</span><span>{fmt(d.creances.tranches[k])} F</span></div>
                    <div style={{ height: 8, background: "var(--bg)", borderRadius: 4 }}><div style={{ width: `${(d.creances.tranches[k] / maxTr) * 100}%`, height: 8, background: couleur, borderRadius: 4 }} /></div>
                  </div>
                ))}
              </div>
              <div style={{ fontSize: 10.5, fontWeight: 700, textTransform: "uppercase", color: "var(--sub)", marginBottom: 6 }}>{t("dgnTopDebiteurs")}</div>
              {d.creances.top_debiteurs.map((c) => (
                <div key={c.client} style={{ display: "flex", justifyContent: "space-between", fontSize: 12.5, padding: "4px 0", borderTop: "1px solid var(--line-soft)" }}>
                  <span>{c.client}</span><span style={{ fontWeight: 600, color: c.retard > 0 ? "var(--brique)" : undefined }}>{fmt(c.du)} F</span>
                </div>
              ))}
            </>
          )}
        </div>
        <div className="card">
          <h3 style={h3}>{t("dgnAlertesStock")}</h3>
          {d.stock.alertes.length === 0 ? <p style={vide}>{t("dgnAucuneAlerte")}</p> : d.stock.alertes.map((a) => (
            <div key={a.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, fontSize: 12.5, padding: "5px 0", borderTop: "1px solid var(--line-soft)" }}>
              <span>{a.designation}{a.reference ? <span style={{ color: "var(--sub)" }}> · {a.reference}</span> : null}</span>
              <span style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <b>{fmt(a.stock)}</b>
                <span style={{ fontSize: 10.5, fontWeight: 700, padding: "2px 8px", borderRadius: 20, background: a.etat === "RUPTURE" ? "var(--brique-bg)" : "var(--ocre-bg)", color: a.etat === "RUPTURE" ? "var(--brique)" : "var(--ocre)" }}>{a.etat === "RUPTURE" ? t("dgnRupture") : t("dgnFaible")}</span>
              </span>
            </div>
          ))}
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(340px, 1fr))", gap: 14 }}>
        <div className="card">
          <h3 style={h3}>{t("dgnTopProduits")}</h3>
          {d.top_produits.length === 0 ? <p style={vide}>{t("dgnAucuneVente")}</p> : (
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5 }}>
              <thead><tr style={{ textAlign: "left", fontSize: 10.5, color: "var(--sub)", textTransform: "uppercase" }}><th style={th}>{t("dgnColProduit")}</th><th style={{ ...th, textAlign: "right" }}>{t("dgnColQte")}</th><th style={{ ...th, textAlign: "right" }}>{t("dgnColCa")}</th><th style={{ ...th, textAlign: "right" }}>{t("dgnColMarge")}</th></tr></thead>
              <tbody>
                {d.top_produits.map((p, i) => (
                  <tr key={i} style={{ borderTop: "1px solid var(--line-soft)" }}>
                    <td style={td}>{p.designation}</td><td style={{ ...td, textAlign: "right" }}>{p.qte}</td><td style={{ ...td, textAlign: "right" }}>{fmt(p.ca_ht)}</td>
                    <td style={{ ...td, textAlign: "right", color: p.marge === null ? "var(--sub)" : undefined }}>{p.marge === null ? "—" : fmt(p.marge)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
        <div style={{ display: "grid", gap: 14, alignContent: "start" }}>
          <div className="card">
            <h3 style={h3}>{t("dgnMarge")}</h3>
            {d.marge ? (
              <>
                <div style={{ fontFamily: "Space Grotesk", fontWeight: 700, fontSize: 24 }}>{fmt(d.marge.montant)} F <span style={{ fontSize: 14, color: "var(--sub)" }}>({d.marge.taux} %)</span></div>
                <div style={{ fontSize: 11.5, color: "var(--sub)", marginTop: 4 }}>{sub(t("dgnMargeAide"), { m: fmt(d.marge.ca_couvert) })}</div>
              </>
            ) : <p style={vide}>{t("dgnAucuneVente")}</p>}
          </div>
          <div className="card">
            <h3 style={h3}>{t("dgnAFaire")}</h3>
            {d.livraisons_en_attente.nb === 0 && d.achats_en_cours.nb === 0 ? <p style={vide}>{t("dgnRien")}</p> : (
              <div style={{ display: "grid", gap: 8, fontSize: 12.5 }}>
                {d.livraisons_en_attente.nb > 0 && <Link href="/ventes/suivi" style={lienStyle}>{sub(t("dgnLivraisons"), { n: d.livraisons_en_attente.nb })}</Link>}
                {d.achats_en_cours.nb > 0 && <Link href="/commandes" style={lienStyle}>{sub(t("dgnAchats"), { n: d.achats_en_cours.nb })}{d.achats_en_cours.en_retard > 0 ? ` — ${sub(t("dgnAchatsRetard"), { n: d.achats_en_cours.en_retard })}` : ""}</Link>}
              </div>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}

const h3 = { fontSize: 13, color: "var(--petrol)", margin: "0 0 12px" };
const vide = { fontSize: 12.5, color: "var(--sub)", margin: 0 };
const th = { padding: "4px 6px 6px" };
const td = { padding: "6px" };
const lienStyle = { color: "var(--petrol)", fontWeight: 600, textDecoration: "none", padding: "8px 10px", background: "var(--bg)", borderRadius: 8 };
