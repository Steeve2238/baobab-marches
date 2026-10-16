"use client";

import { useEffect, useState } from "react";
import { api } from "../../lib/api";
import { useLangue } from "../../lib/i18n/LanguageContext";
import AppShell from "../../lib/components/AppShell";
import { labelStyle, inputStyle, thStyle, tdStyle, numStyle } from "../../lib/comptaUi";

const fmt = (n) => Math.round(Number(n) || 0).toLocaleString("fr-FR").replace(/[  ]/g, " ");
const sub = (txt, vars) => String(txt).replace(/\{(\w+)\}/g, (_, k) => (vars && vars[k] !== undefined ? vars[k] : `{${k}}`));
const aujourdhui = () => new Date().toISOString().slice(0, 10);

function Ligne({ libelle, valeur, fort, negatif, aide }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", padding: fort ? "10px 0" : "7px 0", borderTop: fort ? "1.5px solid var(--ink)" : "1px solid var(--line-soft)", fontWeight: fort ? 700 : 400 }}>
      <span>{libelle}{aide && <span style={{ display: "block", fontSize: 11, color: "var(--sub)", fontWeight: 400 }}>{aide}</span>}</span>
      <span style={{ fontSize: fort ? 20 : 14, fontFamily: fort ? "Space Grotesk" : undefined, color: negatif ? "var(--brique)" : undefined, fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>{fmt(valeur)} F</span>
    </div>
  );
}

function Serie({ serie }) {
  const max = Math.max(1, ...serie.map((s) => Math.max(s.ca_ht, Math.abs(s.resultat))));
  const W = 560, H = 160, bas = 140, haut = 10, pas = W / serie.length, l = Math.min(34, pas * 0.5);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height: "auto" }} role="img">
      <line x1="0" y1={bas} x2={W} y2={bas} stroke="var(--line)" />
      {serie.map((s, i) => {
        const x = i * pas + (pas - l) / 2;
        const hCa = (s.ca_ht / max) * (bas - haut);
        const hRes = (Math.abs(s.resultat) / max) * (bas - haut);
        return (
          <g key={s.mois}>
            <rect x={x} y={bas - hCa} width={l / 2 - 1} height={hCa} rx="2" fill="var(--petrol)" opacity="0.35"><title>{`${s.mois} · CA ${fmt(s.ca_ht)} F`}</title></rect>
            <rect x={x + l / 2 + 1} y={bas - hRes} width={l / 2 - 1} height={hRes} rx="2" fill={s.resultat >= 0 ? "var(--vert)" : "var(--brique)"}><title>{`${s.mois} · ${fmt(s.resultat)} F`}</title></rect>
            <text x={x + l / 2} y={H - 6} textAnchor="middle" fontSize="10" fill="var(--sub)">{s.mois.slice(5)}/{s.mois.slice(2, 4)}</text>
          </g>
        );
      })}
    </svg>
  );
}

export default function ResultatPage() {
  const { t } = useLangue();
  const [onglet, setOnglet] = useState("resultat");
  const [mois, setMois] = useState(aujourdhui().slice(0, 7));
  const [res, setRes] = useState(null);
  const [du, setDu] = useState(aujourdhui().slice(0, 8) + "01");
  const [au, setAu] = useState(aujourdhui());
  const [marges, setMarges] = useState(null);
  const [erreur, setErreur] = useState("");

  useEffect(() => { api.resultatMensuel(mois).then(setRes).catch((e) => setErreur(e.message)); }, [mois]);
  useEffect(() => { api.margesVentes(du, au).then(setMarges).catch((e) => setErreur(e.message)); }, [du, au]);

  const onglets = [["resultat", "resOngletResultat"], ["marges", "resOngletMarges"]];
  return (
    <AppShell title={t("resTitre")}>
      {erreur && <p style={{ color: "var(--brique)", fontSize: 12.5 }}>{erreur}</p>}
      <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
        {onglets.map(([k, cle]) => (
          <button key={k} type="button" onClick={() => setOnglet(k)} style={{ border: "1px solid var(--line)", background: onglet === k ? "var(--petrol)" : "#fff", color: onglet === k ? "#fff" : "var(--ink)", borderRadius: 999, padding: "6px 16px", fontSize: 12.5, fontWeight: 600, cursor: "pointer" }}>{t(cle)}</button>
        ))}
      </div>

      {onglet === "resultat" && res && (
        <>
          <div style={{ marginBottom: 14 }}><label style={labelStyle}>{t("resMois")}</label><input type="month" value={mois} onChange={(e) => e.target.value && setMois(e.target.value)} style={{ ...inputStyle, width: 180 }} /></div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(340px, 1fr))", gap: 14, marginBottom: 14 }}>
            <div className="card">
              <Ligne libelle={t("resCa")} valeur={res.ca_ht} />
              <Ligne libelle={t("resCout")} valeur={-res.cout_ventes} aide={t("resAideCout")} />
              <Ligne libelle={`${t("resMarge")}${res.taux_marge !== null ? ` (${res.taux_marge} %)` : ""}`} valeur={res.marge_brute} fort />
              <div style={{ margin: "14px 0 4px", fontSize: 11, fontWeight: 700, textTransform: "uppercase", color: "var(--sub)" }}>{t("resCharges")}</div>
              {res.charges.length === 0 ? <p style={{ fontSize: 12.5, color: "var(--sub)", margin: "4px 0 8px" }}>{t("resAucuneCharge")}</p> : res.charges.map((c) => <Ligne key={c.categorie} libelle={c.categorie} valeur={-c.montant} />)}
              <Ligne libelle={t("resResultat")} valeur={res.resultat} fort negatif={res.resultat < 0} />
              {res.precedent && <div style={{ fontSize: 11.5, color: "var(--sub)", marginTop: 4 }}>{sub(t("resVsPrec"), { m: fmt(res.precedent.resultat) })}</div>}
            </div>
            <div className="card">
              <h3 style={{ fontSize: 13, color: "var(--petrol)", margin: "0 0 10px" }}>{t("resTendance")}</h3>
              <Serie serie={res.serie} />
              <div style={{ display: "flex", gap: 14, fontSize: 11.5, color: "var(--sub)", marginTop: 4 }}>
                <span><span style={{ display: "inline-block", width: 10, height: 10, background: "var(--petrol)", opacity: 0.35, borderRadius: 2, marginRight: 5 }} />{t("resCa")}</span>
                <span><span style={{ display: "inline-block", width: 10, height: 10, background: "var(--vert)", borderRadius: 2, marginRight: 5 }} />{t("resResultat")}</span>
              </div>
            </div>
          </div>
          <p style={{ fontSize: 11.5, color: "var(--sub)", maxWidth: 820 }}>{t("resAvertissement")}</p>
        </>
      )}

      {onglet === "marges" && marges && (
        <>
          <div style={{ display: "flex", gap: 12, marginBottom: 12, flexWrap: "wrap" }}>
            <div><label style={labelStyle}>{t("depDu")}</label><input type="date" value={du} onChange={(e) => setDu(e.target.value)} style={{ ...inputStyle, width: 160 }} /></div>
            <div><label style={labelStyle}>{t("depAu")}</label><input type="date" value={au} onChange={(e) => setAu(e.target.value)} style={{ ...inputStyle, width: 160 }} /></div>
          </div>
          <div className="card" style={{ padding: 0, overflowX: "auto", marginBottom: 14 }}>
            <h3 style={{ fontSize: 13, color: "var(--petrol)", margin: 0, padding: "12px 14px 0" }}>{t("resParProduit")}</h3>
            {marges.produits.length === 0 ? <p style={{ padding: 14, margin: 0, fontSize: 12.5, color: "var(--sub)" }}>{t("resAucune")}</p> : (
              <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 620 }}>
                <thead><tr><th style={thStyle}>{t("resColProduit")}</th><th style={{ ...thStyle, textAlign: "right" }}>{t("resColQte")}</th><th style={{ ...thStyle, textAlign: "right" }}>{t("resColCa")}</th><th style={{ ...thStyle, textAlign: "right" }}>{t("resColCout")}</th><th style={{ ...thStyle, textAlign: "right" }}>{t("resColMarge")}</th><th style={{ ...thStyle, textAlign: "right" }}>{t("resColTaux")}</th></tr></thead>
                <tbody>{marges.produits.map((p) => (
                  <tr key={p.produit_id}><td style={tdStyle}>{p.designation}{p.reference ? <span style={{ color: "var(--sub)" }}> · {p.reference}</span> : null}</td><td style={{ ...tdStyle, ...numStyle }}>{p.qte}</td><td style={{ ...tdStyle, ...numStyle }}>{fmt(p.ca_ht)}</td><td style={{ ...tdStyle, ...numStyle }}>{fmt(p.cout)}</td><td style={{ ...tdStyle, ...numStyle, fontWeight: 600, color: p.marge < 0 ? "var(--brique)" : undefined }}>{fmt(p.marge)}</td><td style={{ ...tdStyle, ...numStyle }}>{p.taux === null ? "—" : `${p.taux} %`}</td></tr>
                ))}</tbody>
              </table>
            )}
          </div>
          <div className="card" style={{ padding: 0, overflowX: "auto", marginBottom: 10 }}>
            <h3 style={{ fontSize: 13, color: "var(--petrol)", margin: 0, padding: "12px 14px 0" }}>{t("resParVendeur")}</h3>
            {marges.vendeurs.length === 0 ? <p style={{ padding: 14, margin: 0, fontSize: 12.5, color: "var(--sub)" }}>{t("resAucune")}</p> : (
              <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 560 }}>
                <thead><tr><th style={thStyle}>{t("resColVendeur")}</th><th style={{ ...thStyle, textAlign: "right" }}>{t("resColVentes")}</th><th style={{ ...thStyle, textAlign: "right" }}>{t("resColCa")}</th><th style={{ ...thStyle, textAlign: "right" }}>{t("resColCout")}</th><th style={{ ...thStyle, textAlign: "right" }}>{t("resColMarge")}</th><th style={{ ...thStyle, textAlign: "right" }}>{t("resColTaux")}</th></tr></thead>
                <tbody>{marges.vendeurs.map((v, i) => (
                  <tr key={i}><td style={tdStyle}>{v.vendeur}</td><td style={{ ...tdStyle, ...numStyle }}>{v.nb_factures}</td><td style={{ ...tdStyle, ...numStyle }}>{fmt(v.ca_ht)}</td><td style={{ ...tdStyle, ...numStyle }}>{fmt(v.cout)}</td><td style={{ ...tdStyle, ...numStyle, fontWeight: 600 }}>{fmt(v.marge)}</td><td style={{ ...tdStyle, ...numStyle }}>{v.taux === null ? "—" : `${v.taux} %`}</td></tr>
                ))}</tbody>
              </table>
            )}
          </div>
          <p style={{ fontSize: 11.5, color: "var(--sub)" }}>{t("resMethode")}</p>
        </>
      )}
    </AppShell>
  );
}
