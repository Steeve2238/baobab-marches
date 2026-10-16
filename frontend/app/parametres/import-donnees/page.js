"use client";

import { useEffect, useState } from "react";
import { api } from "../../../lib/api";
import { useLangue } from "../../../lib/i18n/LanguageContext";
import AppShell from "../../../lib/components/AppShell";
import { labelStyle, inputStyle, boutonPrincipalStyle, boutonSecondaireStyle, thStyle, tdStyle, numStyle, formaterMontant } from "../../../lib/comptaUi";

const sub = (txt, vars) => String(txt).replace(/\{(\w+)\}/g, (_, k) => (vars && vars[k] !== undefined ? vars[k] : `{${k}}`));
const DEFAUTS = {
  clients: ["CLI_COMMANDE", "CLI_LIVRAISON", "CLI_FACTURE_30", "CLI_FACTURE_60"],
  fournisseurs: ["FOU_COMMANDE", "FOU_FACTURE_30", "FOU_FACTURE_60", "FOU_ARRIVEE_30"],
};
const COULEUR = { CREER: "var(--vert)", MAJ: "var(--bleu, #2f5d8a)", IGNORE: "var(--sub)", ERREUR: "var(--brique)" };

// Import Excel de reprise (sortie d'Odoo ou d'un autre logiciel) : produits + stock d'ouverture, clients, fournisseurs.
// Verification (apercu) puis import ; toute erreur annule l'import complet. Back : routes/importDonnees.js.
export default function ImportDonneesPage() {
  const { t } = useLangue();
  const loc = t("dateLocale");
  const [type, setType] = useState("produits");
  const [fichier, setFichier] = useState(null);
  const [cleFichier, setCleFichier] = useState(0);
  const [mettreAJour, setMettreAJour] = useState(false);
  const [dateStock, setDateStock] = useState("");
  const [defaut, setDefaut] = useState("");
  const [rapport, setRapport] = useState(null);
  const [erreur, setErreur] = useState("");
  const [info, setInfo] = useState("");
  const [occupe, setOccupe] = useState(false);
  const [lots, setLots] = useState([]);

  const chargerLots = () => api.importDonneesHistorique().then((r) => setLots(r.lots || [])).catch(() => {});
  useEffect(() => { chargerLots(); }, []);

  function changerType(tp) {
    setType(tp); setFichier(null); setRapport(null); setErreur(""); setInfo(""); setDefaut(""); setCleFichier((c) => c + 1);
  }
  function formulaire() {
    const fd = new FormData();
    fd.append("fichier", fichier);
    fd.append("mettre_a_jour", mettreAJour ? "1" : "0");
    if (type === "produits" && dateStock) fd.append("date_stock", dateStock);
    if (type !== "produits" && defaut) fd.append("echeancier_code", defaut);
    return fd;
  }
  async function verifier() {
    setErreur(""); setInfo(""); setOccupe(true);
    try { setRapport(await api.importDonneesApercu(type, formulaire())); } catch (e) { setRapport(null); setErreur(e.message); } finally { setOccupe(false); }
  }
  async function importer() {
    if (!window.confirm(t("impConfirmer"))) return;
    setErreur(""); setInfo(""); setOccupe(true);
    try {
      const r = await api.importDonnees(type, formulaire());
      setRapport(r);
      if (r.importe) { setInfo(t("impBilanOk")); setFichier(null); setCleFichier((c) => c + 1); chargerLots(); }
      else setErreur(t("impBilanKo"));
    } catch (e) { setErreur(e.message); } finally { setOccupe(false); }
  }

  const onglet = (actif) => ({ padding: "7px 16px", borderRadius: 20, fontSize: 12.5, fontWeight: actif ? 700 : 500, border: actif ? "none" : "1px solid var(--line)", background: actif ? "var(--vert)" : "transparent", color: actif ? "#fff" : "var(--ink)", cursor: "pointer" });
  const st = rapport?.stats;
  const apercuFait = rapport && !rapport.importe;
  const importable = apercuFait && rapport.ok && (st.CREER > 0 || st.MAJ > 0);

  return (
    <AppShell title={t("impTitre")}>
      <p style={{ fontSize: 12.5, color: "var(--sub)", margin: "0 0 14px", maxWidth: 780 }}>{t("impAide")}</p>
      <div style={{ display: "flex", gap: 8, marginBottom: 14, flexWrap: "wrap" }}>
        {["produits", "clients", "fournisseurs"].map((k) => (
          <button key={k} type="button" onClick={() => changerType(k)} style={onglet(type === k)}>{t(`impType${k[0].toUpperCase()}${k.slice(1)}`)}</button>
        ))}
      </div>
      {erreur && <p style={{ color: "var(--brique)", fontSize: 12.5 }}>{erreur}</p>}
      {info && <p style={{ color: "var(--vert)", fontSize: 12.5 }}>{info}</p>}

      <div className="card" style={{ padding: 16, marginBottom: 16, display: "grid", gap: 12, maxWidth: 780 }}>
        <div>
          <button type="button" onClick={() => api.importDonneesModele(type).catch((e) => setErreur(e.message))} style={boutonSecondaireStyle}>{t("impModele")}</button>
          <p style={{ fontSize: 11.5, color: "var(--sub)", margin: "8px 0 0" }}>{t("impAstuceOdoo")}</p>
        </div>
        <div>
          <label style={labelStyle}>{t("impFichier")}</label>
          <input key={cleFichier} type="file" accept=".xlsx,.xls" onChange={(e) => { setFichier(e.target.files?.[0] || null); setRapport(null); setInfo(""); setErreur(""); }} />
        </div>
        {type === "produits" && (
          <div>
            <label style={labelStyle}>{t("impDateStock")}</label>
            <input type="date" value={dateStock} onChange={(e) => setDateStock(e.target.value)} style={{ ...inputStyle, width: 170 }} />
            <p style={{ fontSize: 11.5, color: "var(--sub)", margin: "6px 0 0" }}>{t("impDateStockAide")}</p>
          </div>
        )}
        {type !== "produits" && (
          <div>
            <label style={labelStyle}>{t("impEcheanceDefaut")}</label>
            <select value={defaut} onChange={(e) => setDefaut(e.target.value)} style={{ ...inputStyle, maxWidth: 360 }}>
              <option value="">{t(`impDef_${DEFAUTS[type][0]}`)}</option>
              {DEFAUTS[type].slice(1).map((c) => <option key={c} value={c}>{t(`impDef_${c}`)}</option>)}
            </select>
            <p style={{ fontSize: 11.5, color: "var(--sub)", margin: "6px 0 0" }}>{t("impEcheanceAide")}</p>
          </div>
        )}
        <label style={{ fontSize: 12.5, display: "flex", gap: 8, alignItems: "flex-start" }}>
          <input type="checkbox" checked={mettreAJour} onChange={(e) => setMettreAJour(e.target.checked)} style={{ marginTop: 3 }} />
          <span>{t("impMettreAJour")}</span>
        </label>
        <div style={{ display: "flex", gap: 10 }}>
          <button type="button" disabled={!fichier || occupe} onClick={verifier} style={{ ...boutonSecondaireStyle, opacity: !fichier || occupe ? 0.5 : 1 }}>{t("impVerifier")}</button>
          <button type="button" disabled={!importable || occupe} onClick={importer} style={{ ...boutonPrincipalStyle, opacity: !importable || occupe ? 0.5 : 1 }}>{t("impImporter")}</button>
        </div>
      </div>

      {rapport && (
        <div className="card" style={{ padding: 16, marginBottom: 18 }}>
          {rapport.deja_importe && !rapport.importe && <p style={{ color: "var(--brique)", fontSize: 12.5, margin: "0 0 8px" }}>{t("impDejaImporte")}</p>}
          <div style={{ display: "flex", gap: 16, flexWrap: "wrap", fontSize: 13, fontWeight: 600 }}>
            <span>{sub(t("impResumeLus"), { n: st.lus })}</span>
            <span style={{ color: COULEUR.CREER }}>{sub(t("impResumeCreer"), { n: st.CREER })}</span>
            {st.MAJ > 0 && <span style={{ color: COULEUR.MAJ }}>{sub(t("impResumeMaj"), { n: st.MAJ })}</span>}
            <span style={{ color: COULEUR.IGNORE }}>{sub(t("impResumeIgnore"), { n: st.IGNORE })}</span>
            {st.ERREUR > 0 && <span style={{ color: COULEUR.ERREUR }}>{sub(t("impResumeErreur"), { n: st.ERREUR })}</span>}
          </div>
          {rapport.type === "produits" && st.stock_lignes > 0 && <p style={{ fontSize: 12.5, margin: "8px 0 0" }}>{sub(t("impResumeStock"), { n: st.stock_lignes, v: formaterMontant(st.stock_valeur, loc) })}</p>}
          <p style={{ fontSize: 11.5, color: "var(--sub)", margin: "8px 0" }}>
            {sub(t("impColonnesLues"), { c: (rapport.colonnes || []).map((c) => t(`impCol_${c}`)).join(", ") })}
            {apercuFait ? ` — ${t("impSimulation")}` : ""}
          </p>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 560 }}>
              <thead><tr><th style={thStyle}>{t("impColLigne")}</th><th style={thStyle}>{t("impColNom")}</th><th style={thStyle}>{t("impColStatut")}</th><th style={thStyle}>{t("impColRemarque")}</th></tr></thead>
              <tbody>
                {rapport.lignes.map((l, i) => (
                  <tr key={i}>
                    <td style={{ ...tdStyle, ...numStyle }}>{l.ligne}</td>
                    <td style={tdStyle}>{l.nom || ""}{l.reference ? <span style={{ color: "var(--sub)" }}> · {l.reference}</span> : null}</td>
                    <td style={{ ...tdStyle, color: COULEUR[l.statut], fontWeight: 600 }}>{t(`impSt_${l.statut}`)}</td>
                    <td style={tdStyle}>{l.code ? t(`impDiag_${l.code}`) : ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {rapport.lignes_tronquees && <p style={{ fontSize: 11.5, color: "var(--sub)" }}>{t("impTronque")}</p>}
        </div>
      )}

      <p style={{ fontSize: 12, color: "var(--sub)", maxWidth: 780 }}>{t("impNote")}</p>

      <h3 style={{ fontSize: 14, margin: "18px 0 8px" }}>{t("impHistorique")}</h3>
      <div className="card" style={{ padding: 0, overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 620 }}>
          <thead><tr><th style={thStyle}>{t("impHistDate")}</th><th style={thStyle}>{t("impHistType")}</th><th style={thStyle}>{t("impHistFichier")}</th><th style={thStyle}>{t("impHistPar")}</th><th style={thStyle}>{t("impHistResultat")}</th></tr></thead>
          <tbody>
            {lots.length === 0 && <tr><td style={tdStyle} colSpan={5}>{t("impHistVide")}</td></tr>}
            {lots.map((l) => (
              <tr key={l.id}>
                <td style={tdStyle}>{new Date(l.date_creation).toLocaleString(loc)}</td>
                <td style={tdStyle}>{t(`impType${l.type[0]}${l.type.slice(1).toLowerCase()}`)}</td>
                <td style={tdStyle}>{l.nom_fichier}</td>
                <td style={tdStyle}>{l.par}</td>
                <td style={tdStyle}>{sub(t("impResumeCreer"), { n: l.stats_json.CREER || 0 })}, {sub(t("impResumeIgnore"), { n: l.stats_json.IGNORE || 0 })}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </AppShell>
  );
}
