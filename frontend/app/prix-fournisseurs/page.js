"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "../../lib/api";
import { useLangue } from "../../lib/i18n/LanguageContext";
import AppShell from "../../lib/components/AppShell";

// Prix par fournisseur (Lot 3, 05/10/2026) : historique des prix d'achat par
// article et par fournisseur (receptions validees), variations, et comparaison
// d'une offre recue avec ce qui a deja ete paye. Back : routes/prixFournisseurs.js.

const SERIES = ["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4", "#008300", "#4a3aa7", "#e34948"];
const nf = (n) => Number(n).toLocaleString(undefined, { maximumFractionDigits: 2 });

function Variation({ pct, seuil }) {
  if (pct === null || pct === undefined) return <span style={{ color: "var(--sub)" }}>—</span>;
  const hausse = pct > 0;
  const nul = pct === 0;
  const alerte = Math.abs(pct) >= seuil && !nul;
  return (
    <span className="mono" style={{ color: nul ? "var(--sub)" : hausse ? "var(--brique)" : "var(--vert)", fontWeight: alerte ? 700 : 500, whiteSpace: "nowrap" }}>
      {nul ? "= " : hausse ? "▲ +" : "▼ "}
      {nf(pct)} %
    </span>
  );
}

export default function PrixFournisseursPage() {
  const { t } = useLangue();
  const [onglet, setOnglet] = useState("historique");
  const [produitOuvert, setProduitOuvert] = useState(null);

  useEffect(() => {
    // Lien direct depuis le catalogue : /prix-fournisseurs?produit=<id>
    const p = new URLSearchParams(window.location.search).get("produit");
    if (p) setProduitOuvert(p);
  }, []);

  return (
    <AppShell title={t("prixTitle")}>
      <p style={{ fontSize: 12.5, color: "var(--sub)", marginBottom: 12 }}>{t("prixSubtitle")}</p>
      <div style={{ display: "flex", gap: 8, marginBottom: 14 }} role="tablist">
        {["historique", "comparer"].map((o) => (
          <button
            key={o}
            type="button"
            role="tab"
            aria-selected={onglet === o}
            onClick={() => {
              setOnglet(o);
              setProduitOuvert(null);
            }}
            style={{ ...boutonSecondaireStyle, ...(onglet === o ? { background: "var(--petrol)", color: "#fff", borderColor: "var(--petrol)" } : {}) }}
          >
            {t(o === "historique" ? "prixOngletHistorique" : "prixOngletComparer")}
          </button>
        ))}
      </div>
      {onglet === "comparer" ? <Comparer t={t} /> : produitOuvert ? <Detail t={t} produitId={produitOuvert} onRetour={() => setProduitOuvert(null)} /> : <Historique t={t} onOuvrir={setProduitOuvert} />}
    </AppShell>
  );
}

// ---------------------------------------------------------------------------
// Synthese : un ligne par couple article / fournisseur
// ---------------------------------------------------------------------------
function Historique({ t, onOuvrir }) {
  const { dict } = useLangue();
  const [lignes, setLignes] = useState([]);
  const [fournisseurs, setFournisseurs] = useState([]);
  const [q, setQ] = useState("");
  const [fournisseurId, setFournisseurId] = useState("");
  const [seuil, setSeuil] = useState(5);
  const [alertesSeules, setAlertesSeules] = useState(false);
  const [chargement, setChargement] = useState(true);
  const [erreur, setErreur] = useState("");

  useEffect(() => {
    api.getFournisseursReception().then(setFournisseurs).catch(() => {});
  }, []);
  useEffect(() => {
    setChargement(true);
    const timer = setTimeout(() => {
      api
        .getPrixFournisseurs({ ...(q.trim() ? { q: q.trim() } : {}), ...(fournisseurId ? { fournisseur_id: fournisseurId } : {}) })
        .then((r) => {
          setLignes(r);
          setErreur("");
        })
        .catch((err) => setErreur(err.message))
        .finally(() => setChargement(false));
    }, 250);
    return () => clearTimeout(timer);
  }, [q, fournisseurId]);

  const nbParArticle = useMemo(() => {
    const m = new Map();
    lignes.forEach((l) => m.set(l.produit_id, (m.get(l.produit_id) || 0) + 1));
    return m;
  }, [lignes]);
  const affichees = alertesSeules ? lignes.filter((l) => l.variation_prix_pct !== null && Math.abs(l.variation_prix_pct) >= seuil) : lignes;

  return (
    <>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center", marginBottom: 14 }}>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("prixRecherche")} style={{ ...inputStyle, maxWidth: 300 }} />
        <select value={fournisseurId} onChange={(e) => setFournisseurId(e.target.value)} style={{ ...inputStyle, width: "auto" }}>
          <option value="">{t("prixTousFournisseurs")}</option>
          {fournisseurs.map((f) => (
            <option key={f.id} value={f.id}>
              {f.nom}
            </option>
          ))}
        </select>
        <label style={{ fontSize: 12, display: "flex", alignItems: "center", gap: 6 }}>
          {t("prixSeuilLabel")}
          <input type="number" min="0" step="1" value={seuil} onChange={(e) => setSeuil(Math.max(0, Number(e.target.value) || 0))} style={{ ...inputStyle, width: 64 }} /> %
        </label>
        <label style={{ fontSize: 12, display: "flex", alignItems: "center", gap: 6 }}>
          <input type="checkbox" checked={alertesSeules} onChange={(e) => setAlertesSeules(e.target.checked)} />
          {t("prixSeulementAlertes")}
        </label>
      </div>
      {erreur && <p style={{ color: "var(--brique)", fontSize: 12.5, marginBottom: 12 }}>{erreur}</p>}
      {chargement ? (
        <p style={{ fontSize: 12.5, color: "var(--sub)" }}>{t("loading")}</p>
      ) : lignes.length === 0 ? (
        <p className="card" style={{ fontSize: 13, color: "var(--sub)" }}>{q || fournisseurId ? t("prixAucunResultat") : t("prixVide")}</p>
      ) : affichees.length === 0 ? (
        <p className="card" style={{ fontSize: 13, color: "var(--sub)" }}>{t("prixAucunResultat")}</p>
      ) : (
        <div className="card" style={{ overflowX: "auto", padding: 0 }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5, minWidth: 900 }}>
            <thead>
              <tr>
                <th style={thStyle}>{t("prixColArticle")}</th>
                <th style={thStyle}>{t("prixColFournisseur")}</th>
                <th style={{ ...thStyle, textAlign: "right" }}>{t("prixColAchats")}</th>
                <th style={{ ...thStyle, textAlign: "right" }}>{t("prixColDernierPrix")}</th>
                <th style={thStyle}>{t("prixColVariation")}</th>
                <th style={{ ...thStyle, textAlign: "right" }}>{t("prixColMinMoyMax")}</th>
                <th style={{ ...thStyle, textAlign: "right" }}>{t("prixColCoutRevient")}</th>
                <th style={thStyle}></th>
              </tr>
            </thead>
            <tbody>
              {affichees.map((l) => {
                const plusieurs = nbParArticle.get(l.produit_id) > 1;
                return (
                  <tr key={`${l.produit_id}-${l.fournisseur_id}`} style={{ borderTop: "1px solid var(--line-soft)" }}>
                    <td style={tdStyle}>
                      <div style={{ fontWeight: 600 }}>{l.designation}</div>
                      <div className="mono" style={{ fontSize: 11, color: "var(--sub)" }}>{l.reference || "—"}</div>
                    </td>
                    <td style={tdStyle}>
                      {l.fournisseur_nom}
                      {plusieurs && l.est_meilleur && <div style={{ fontSize: 11, color: "var(--vert)", fontWeight: 600 }}>✓ {t("prixMeilleur")}</div>}
                      {plusieurs && !l.est_meilleur && l.ecart_meilleur_pct !== null && (
                        <div style={{ fontSize: 11, color: "var(--sub)" }}>{t("prixAuDessusMeilleur").replace("{pct}", nf(l.ecart_meilleur_pct))}</div>
                      )}
                    </td>
                    <td className="mono" style={{ ...tdStyle, textAlign: "right" }}>{l.nb_achats}</td>
                    <td className="mono" style={{ ...tdStyle, textAlign: "right", fontWeight: 700 }}>
                      {nf(l.dernier_achat.prix_achat_xof)}
                      <div style={{ fontSize: 10.5, color: "var(--sub)", fontWeight: 400 }}>
                        {new Date(l.dernier_achat.date).toLocaleDateString(dict.dateLocale)} · {l.dernier_achat.numero}
                      </div>
                    </td>
                    <td style={tdStyle}><Variation pct={l.variation_prix_pct} seuil={seuil} /></td>
                    <td className="mono" style={{ ...tdStyle, textAlign: "right", fontSize: 11.5 }}>
                      {nf(l.prix_min_xof)} / {nf(l.prix_moyen_xof)} / {nf(l.prix_max_xof)}
                    </td>
                    <td className="mono" style={{ ...tdStyle, textAlign: "right" }}>{nf(l.dernier_achat.cout_revient_xof)}</td>
                    <td style={{ ...tdStyle, whiteSpace: "nowrap" }}>
                      <button type="button" onClick={() => onOuvrir(l.produit_id)} style={lienStyle}>{t("prixDetail")}</button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Detail d'un article : courbe + tableau des achats
// ---------------------------------------------------------------------------
function Detail({ t, produitId, onRetour }) {
  const { dict } = useLangue();
  const [data, setData] = useState(null);
  const [erreur, setErreur] = useState("");
  useEffect(() => {
    setData(null);
    api.getPrixProduit(produitId).then(setData).catch((err) => setErreur(err.message));
  }, [produitId]);

  if (erreur) return <p style={{ color: "var(--brique)", fontSize: 12.5 }}>{erreur}</p>;
  if (!data) return <p style={{ fontSize: 12.5, color: "var(--sub)" }}>{t("loading")}</p>;

  const { produit, fournisseurs, achats } = data;
  const couleurs = new Map(fournisseurs.map((f, i) => [f.fournisseur_id, SERIES[i % SERIES.length]]));
  const fmtDate = (d) => new Date(d).toLocaleDateString(dict.dateLocale);

  return (
    <>
      <button type="button" onClick={onRetour} style={{ ...lienStyle, marginBottom: 10 }}>{t("prixRetourListe")}</button>
      <h2 style={{ fontSize: 15, color: "var(--petrol)", margin: "0 0 4px" }}>
        {t("prixDetailTitre").replace("{article}", produit.designation)}
      </h2>
      <p className="mono" style={{ fontSize: 12, color: "var(--sub)", marginBottom: 12 }}>{produit.reference || ""}</p>

      {achats.length === 0 ? (
        <p className="card" style={{ fontSize: 13, color: "var(--sub)" }}>{t("prixVide")}</p>
      ) : (
        <>
          <section className="card" style={{ marginBottom: 16 }}>
            <h3 style={{ fontSize: 13, color: "var(--petrol)", margin: "0 0 8px" }}>{t("prixGraphiqueTitre")}</h3>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 14, marginBottom: 6 }}>
              {fournisseurs.map((f) => (
                <span key={f.fournisseur_id} style={{ fontSize: 12, display: "inline-flex", alignItems: "center", gap: 6 }}>
                  <span aria-hidden="true" style={{ width: 14, height: 3, borderRadius: 2, background: couleurs.get(f.fournisseur_id), display: "inline-block" }} />
                  {f.fournisseur_nom}
                  {f.est_meilleur && fournisseurs.length > 1 && <span style={{ color: "var(--vert)", fontWeight: 600 }}>✓ {t("prixMeilleur")}</span>}
                </span>
              ))}
            </div>
            <Courbe achats={achats} fournisseurs={fournisseurs} couleurs={couleurs} fmtDate={fmtDate} ariaLabel={t("prixGraphiqueAria")} />
          </section>

          <section className="card" style={{ padding: 0, overflowX: "auto" }}>
            <h3 style={{ fontSize: 13, color: "var(--petrol)", margin: 0, padding: "12px 14px 4px" }}>{t("prixTableauAchats")}</h3>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5, minWidth: 1020 }}>
              <thead>
                <tr>
                  <th style={thStyle}>{t("prixColDate")}</th>
                  <th style={thStyle}>{t("prixColReception")}</th>
                  <th style={thStyle}>{t("prixColFournisseur")}</th>
                  <th style={{ ...thStyle, textAlign: "right" }}>{t("prixColQuantite")}</th>
                  <th style={{ ...thStyle, textAlign: "right" }}>{t("prixColPuDevise")}</th>
                  <th style={{ ...thStyle, textAlign: "right" }}>{t("prixColOffert")}</th>
                  <th style={{ ...thStyle, textAlign: "right" }}>{t("prixColEngage")}</th>
                  <th style={{ ...thStyle, textAlign: "right" }}>{t("prixColPrixXof")}</th>
                  <th style={{ ...thStyle, textAlign: "right" }}>{t("prixColCoutRevient")}</th>
                  <th style={thStyle}>{t("prixColVariation")}</th>
                </tr>
              </thead>
              <tbody>
                {[...achats].reverse().map((a) => (
                  <tr key={a.ligne_id} style={{ borderTop: "1px solid var(--line-soft)" }}>
                    <td style={tdStyle}>{fmtDate(a.date)}</td>
                    <td className="mono" style={tdStyle}>{a.numero}{a.incoterm ? ` · ${a.incoterm}` : ""}</td>
                    <td style={tdStyle}>
                      <span aria-hidden="true" style={{ width: 8, height: 8, borderRadius: 4, background: couleurs.get(a.fournisseur_id), display: "inline-block", marginRight: 6 }} />
                      {a.fournisseur_nom}
                    </td>
                    <td className="mono" style={{ ...tdStyle, textAlign: "right" }}>{nf(a.quantite)}</td>
                    <td className="mono" style={{ ...tdStyle, textAlign: "right" }}>{nf(a.prix_unitaire_devise)} {a.devise}</td>
                    <td className="mono" style={{ ...tdStyle, textAlign: "right", color: "var(--sub)" }}>{a.offert_xof == null ? "—" : nf(a.offert_xof)}</td>
                    <td className="mono" style={{ ...tdStyle, textAlign: "right", color: "var(--sub)" }}>{a.engage_xof == null ? "—" : nf(a.engage_xof)}</td>
                    <td className="mono" style={{ ...tdStyle, textAlign: "right", fontWeight: 700 }}>{nf(a.prix_achat_xof)}</td>
                    <td className="mono" style={{ ...tdStyle, textAlign: "right" }}>{nf(a.cout_revient_xof)}</td>
                    <td style={tdStyle}>{a.variation_prix_pct === null ? <span style={{ color: "var(--sub)", fontSize: 11.5 }}>{t("prixPremierAchat")}</span> : <Variation pct={a.variation_prix_pct} seuil={Infinity} />}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        </>
      )}
    </>
  );
}

// Courbe SVG : un trait par fournisseur, une seule echelle (XOF), axe du temps
// proportionnel aux dates. Marqueurs >= 8 px avec anneau de surface ; derniere
// valeur de chaque fournisseur etiquetee en toutes lettres.
function Courbe({ achats, fournisseurs, couleurs, fmtDate, ariaLabel }) {
  const W = 760, H = 270, ML = 78, MR = 170, MT = 14, MB = 34;
  const ts = achats.map((a) => new Date(a.date).getTime());
  const tMin = Math.min(...ts), tMax = Math.max(...ts);
  const prix = achats.map((a) => a.prix_achat_xof);
  let yMin = Math.min(...prix), yMax = Math.max(...prix);
  if (yMin === yMax) {
    yMin = yMin * 0.9;
    yMax = yMax * 1.1 || 1;
  }
  const marge = (yMax - yMin) * 0.12;
  yMin = Math.max(0, yMin - marge);
  yMax = yMax + marge;
  const x = (tt) => (tMax === tMin ? ML + (W - ML - MR) / 2 : ML + ((tt - tMin) / (tMax - tMin)) * (W - ML - MR));
  const y = (v) => MT + (1 - (v - yMin) / (yMax - yMin)) * (H - MT - MB);
  const ticks = [0, 1, 2, 3, 4].map((i) => yMin + ((yMax - yMin) * i) / 4);
  const dates = [...new Set(ts)].sort((a, b) => a - b);
  const etiquettesDates = dates.length > 5 ? [dates[0], dates[Math.floor(dates.length / 2)], dates[dates.length - 1]] : dates;
  return (
    <div style={{ overflowX: "auto" }}>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={ariaLabel} style={{ width: "100%", minWidth: 560, height: "auto", display: "block" }}>
        {ticks.map((v, i) => (
          <g key={i}>
            <line x1={ML} x2={W - MR} y1={y(v)} y2={y(v)} stroke="#e6ebe9" strokeWidth="1" />
            <text x={ML - 8} y={y(v) + 4} textAnchor="end" fontSize="11" fill="#5B6A6C">{Math.round(v).toLocaleString()}</text>
          </g>
        ))}
        {etiquettesDates.map((tt) => (
          <text key={tt} x={x(tt)} y={H - 10} textAnchor="middle" fontSize="11" fill="#5B6A6C">{fmtDate(tt)}</text>
        ))}
        {fournisseurs.map((f) => {
          const pts = achats.filter((a) => a.fournisseur_id === f.fournisseur_id);
          const c = couleurs.get(f.fournisseur_id);
          const dernier = pts[pts.length - 1];
          return (
            <g key={f.fournisseur_id}>
              {pts.length > 1 && <polyline points={pts.map((a) => `${x(new Date(a.date).getTime())},${y(a.prix_achat_xof)}`).join(" ")} fill="none" stroke={c} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />}
              {pts.map((a) => (
                <circle key={a.ligne_id} cx={x(new Date(a.date).getTime())} cy={y(a.prix_achat_xof)} r="4.5" fill={c} stroke="#ffffff" strokeWidth="2">
                  <title>{`${f.fournisseur_nom} · ${fmtDate(a.date)} · ${a.numero} : ${Math.round(a.prix_achat_xof).toLocaleString()} XOF`}</title>
                </circle>
              ))}
              <text x={x(new Date(dernier.date).getTime()) + 9} y={y(dernier.prix_achat_xof) + 4} fontSize="11" fontWeight="600" fill="#14232A">
                {Math.round(dernier.prix_achat_xof).toLocaleString()} · {f.fournisseur_nom.length > 16 ? f.fournisseur_nom.slice(0, 15) + "…" : f.fournisseur_nom}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Comparaison d'une offre fournisseur (Excel) avec l'historique
// ---------------------------------------------------------------------------
function Comparer({ t }) {
  const { dict } = useLangue();
  const fichierRef = useRef(null);
  const [fournisseurs, setFournisseurs] = useState([]);
  const [fournisseurId, setFournisseurId] = useState("");
  const [devise, setDevise] = useState("XOF");
  const [cours, setCours] = useState("1");
  const [seuil, setSeuil] = useState(5);
  const [resultat, setResultat] = useState(null);
  const [erreur, setErreur] = useState("");
  const [enCours, setEnCours] = useState(false);

  useEffect(() => {
    api.getFournisseursReception().then(setFournisseurs).catch(() => {});
  }, []);

  async function handleFichier(e) {
    const fichier = e.target.files && e.target.files[0];
    e.target.value = "";
    if (!fichier) return;
    if (!fournisseurId) {
      setErreur(t("prixFournisseurRequis"));
      return;
    }
    setErreur("");
    setEnCours(true);
    try {
      const d = devise.trim().toUpperCase() || "XOF";
      setResultat(await api.comparerOffreExcel(fichier, fournisseurId, d, d === "XOF" ? "1" : String(cours).replace(",", ".")));
    } catch (err) {
      setResultat(null);
      setErreur(err.message);
    } finally {
      setEnCours(false);
    }
  }

  const r = resultat;
  return (
    <>
      <p style={{ fontSize: 12, color: "var(--sub)", marginBottom: 12, maxWidth: 780 }}>{t("prixComparerAide")}</p>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "flex-end", marginBottom: 14 }}>
        <div>
          <label style={labelStyle}>{t("prixColFournisseur")}</label>
          <select value={fournisseurId} onChange={(e) => setFournisseurId(e.target.value)} style={{ ...inputStyle, width: 220 }}>
            <option value="">{t("prixChoisirFournisseur")}</option>
            {fournisseurs.map((f) => (
              <option key={f.id} value={f.id}>
                {f.nom}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label style={labelStyle}>{t("prixDevise")}</label>
          <input list="devises-prix" value={devise} onChange={(e) => setDevise(e.target.value.toUpperCase())} style={{ ...inputStyle, width: 100 }} />
          <datalist id="devises-prix">
            {["XOF", "EUR", "USD", "CNY", "GBP", "AED"].map((d) => (
              <option key={d} value={d} />
            ))}
          </datalist>
        </div>
        <div>
          <label style={labelStyle}>{t("prixCours")}</label>
          <input disabled={devise.trim().toUpperCase() === "XOF"} inputMode="decimal" value={devise.trim().toUpperCase() === "XOF" ? "1" : cours} onChange={(e) => setCours(e.target.value)} style={{ ...inputStyle, width: 120 }} />
        </div>
        <div>
          <label style={labelStyle}>{t("prixSeuilLabel")} %</label>
          <input type="number" min="0" value={seuil} onChange={(e) => setSeuil(Math.max(0, Number(e.target.value) || 0))} style={{ ...inputStyle, width: 80 }} />
        </div>
        <input ref={fichierRef} type="file" accept=".xlsx,.xls,.csv" onChange={handleFichier} style={{ display: "none" }} />
        <button type="button" disabled={enCours} onClick={() => fichierRef.current && fichierRef.current.click()} style={boutonPrincipalStyle}>
          {t("prixChargerOffre")}
        </button>
      </div>
      {erreur && <p style={{ color: "var(--brique)", fontSize: 12.5, marginBottom: 12 }}>{erreur}</p>}
      {r && (
        <>
          <p style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>
            {t("prixResumeComparaison")
              .replace("{n}", r.resume.nb_lignes)
              .replace("{r}", r.resume.nb_reconnues)
              .replace("{h}", r.resume.nb_hausses)
              .replace("{b}", r.resume.nb_baisses)
              .replace("{m}", r.resume.ecart_moyen_pct === null ? "—" : nf(r.resume.ecart_moyen_pct))}
          </p>
          {(r.avertissements || []).length > 0 && (
            <div style={{ fontSize: 12, color: "var(--brique)", marginBottom: 8 }}>
              {r.avertissements.map((a, i) => (
                <div key={i}>{a}</div>
              ))}
            </div>
          )}
          <div className="card" style={{ overflowX: "auto", padding: 0 }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5, minWidth: 1000 }}>
              <thead>
                <tr>
                  <th style={thStyle}>{t("prixColRefFournisseur")}</th>
                  <th style={thStyle}>{t("prixColDesignation")}</th>
                  <th style={{ ...thStyle, textAlign: "right" }}>{t("prixColPrixOffre")}</th>
                  <th style={thStyle}>{t("prixColArticleInterne")}</th>
                  <th style={{ ...thStyle, textAlign: "right" }}>{t("prixColDernierAchat")}</th>
                  <th style={thStyle}>{t("prixColEcart")}</th>
                  <th style={{ ...thStyle, textAlign: "right" }}>{t("prixColMeilleurAutre")}</th>
                  <th style={thStyle}>{t("prixColEcart")}</th>
                </tr>
              </thead>
              <tbody>
                {r.lignes.map((l) => {
                  const alerte = l.ecart_dernier_pct !== null && Math.abs(l.ecart_dernier_pct) >= seuil;
                  return (
                    <tr key={l.index} style={{ borderTop: "1px solid var(--line-soft)", background: alerte && l.ecart_dernier_pct > 0 ? "var(--brique-bg)" : "transparent" }}>
                      <td className="mono" style={tdStyle}>{l.reference_fournisseur || "—"}</td>
                      <td style={{ ...tdStyle, fontWeight: 600 }}>{l.designation}</td>
                      <td className="mono" style={{ ...tdStyle, textAlign: "right", fontWeight: 700 }}>{nf(l.prix_offre_xof)}</td>
                      <td style={tdStyle}>
                        {l.article ? (
                          <>
                            <span className="mono">{l.article.reference}</span>
                            <div style={{ fontSize: 11, color: "var(--sub)" }}>{t(l.correspondance === "REFERENCE" ? "prixReconnuRef" : "prixReconnuDes")}</div>
                          </>
                        ) : (
                          <span style={{ color: "var(--sub)" }}>{t("prixNonReconnu")}</span>
                        )}
                      </td>
                      <td className="mono" style={{ ...tdStyle, textAlign: "right" }}>
                        {l.dernier_achat ? (
                          <>
                            {nf(l.dernier_achat.prix_achat_xof)}
                            <div style={{ fontSize: 10.5, color: "var(--sub)" }}>{new Date(l.dernier_achat.date).toLocaleDateString(dict.dateLocale)} · {l.dernier_achat.numero}</div>
                          </>
                        ) : l.article ? (
                          <span style={{ color: "var(--sub)", fontFamily: "inherit", fontSize: 11.5 }}>{t("prixPasDAchat")}</span>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td style={tdStyle}><Variation pct={l.ecart_dernier_pct} seuil={seuil} /></td>
                      <td className="mono" style={{ ...tdStyle, textAlign: "right" }}>
                        {l.meilleur_autre ? (
                          <>
                            {nf(l.meilleur_autre.prix_achat_xof)}
                            <div style={{ fontSize: 10.5, color: "var(--sub)", fontFamily: "inherit" }}>{l.meilleur_autre.fournisseur_nom}</div>
                          </>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td style={tdStyle}><Variation pct={l.ecart_meilleur_autre_pct} seuil={seuil} /></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </>
  );
}

const labelStyle = { fontSize: 11.5, fontWeight: 600, display: "block", marginBottom: 5 };
const inputStyle = { width: "100%", padding: "8px 10px", border: "1px solid var(--line)", borderRadius: 8, fontSize: 13, fontFamily: "inherit" };
const boutonPrincipalStyle = { background: "var(--petrol)", color: "#fff", border: "none", borderRadius: 8, padding: "9px 18px", fontSize: 12.5, fontWeight: 600, cursor: "pointer" };
const boutonSecondaireStyle = { background: "transparent", color: "var(--petrol)", border: "1px solid var(--line)", borderRadius: 8, padding: "8px 14px", fontSize: 12, fontWeight: 600, cursor: "pointer" };
const lienStyle = { background: "transparent", border: "none", color: "var(--petrol)", fontSize: 12, fontWeight: 600, cursor: "pointer", padding: 0, textDecoration: "underline" };
const thStyle = { textAlign: "left", fontSize: 11, color: "var(--sub)", padding: "10px 12px", fontWeight: 600, whiteSpace: "nowrap" };
const tdStyle = { padding: "9px 12px", verticalAlign: "top" };
