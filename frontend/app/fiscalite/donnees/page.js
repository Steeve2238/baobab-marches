"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "../../../lib/api";
import { useLangue } from "../../../lib/i18n/LanguageContext";
import AppShell from "../../../lib/components/AppShell";
import FiscaliteSousNav from "../../../lib/components/FiscaliteSousNav";
import { inputStyle, labelStyle, thStyle, tdStyle, numStyle, boutonPrincipalStyle, boutonSecondaireStyle, pastilleStyle, formaterXof, dateCourte, texteAlerte } from "../../../lib/fiscaliteUi";

const TYPES = [
  { cle: "balance", role: "EXERCICE", libelle: "fiscDonBalanceN" },
  { cle: "balance", role: "PRECEDENT", libelle: "fiscDonBalanceN1" },
  { cle: "grand-livre", role: "EXERCICE", libelle: "fiscDonGrandLivre" },
];

export default function FiscaliteDonneesPage() {
  const { t } = useLangue();
  const locale = t("dateLocale");
  const anneeCourante = new Date().getFullYear();
  const [annee, setAnnee] = useState(anneeCourante - 1);
  const [choix, setChoix] = useState(0);
  const [debut, setDebut] = useState(`${anneeCourante - 1}-01-01`);
  const [fin, setFin] = useState(`${anneeCourante - 1}-12-31`);
  const [fichier, setFichier] = useState(null);
  const [apercu, setApercu] = useState(null);
  const [jeux, setJeux] = useState(null);
  const [erreur, setErreur] = useState("");
  const [info, setInfo] = useState("");
  const [occupe, setOccupe] = useState(false);

  const charger = useCallback(async () => {
    try {
      setJeux((await api.fiscaliteImports()).jeux);
    } catch (e) {
      setErreur(e.message);
    }
  }, []);
  useEffect(() => {
    charger();
  }, [charger]);

  function changerAnnee(a) {
    setAnnee(a);
    setDebut(`${a}-01-01`);
    setFin(`${a}-12-31`);
    setApercu(null);
  }

  function formulaire() {
    const fd = new FormData();
    fd.append("fichier", fichier);
    fd.append("annee", String(annee));
    fd.append("role", TYPES[choix].role);
    fd.append("date_debut", debut);
    fd.append("date_fin", fin);
    return fd;
  }

  async function lancerApercu() {
    setErreur("");
    setInfo("");
    setApercu(null);
    if (!fichier) return setErreur(t("fiscDonFichierRequis"));
    setOccupe(true);
    try {
      setApercu(await api.fiscaliteImportApercu(TYPES[choix].cle, formulaire()));
    } catch (e) {
      setErreur(e.message);
    } finally {
      setOccupe(false);
    }
  }

  async function lancerImport() {
    setErreur("");
    setOccupe(true);
    try {
      await api.fiscaliteImporter(TYPES[choix].cle, formulaire());
      setInfo(t("fiscDonInfoImporte"));
      setApercu(null);
      setFichier(null);
      await charger();
    } catch (e) {
      setErreur(e.message);
    } finally {
      setOccupe(false);
    }
  }

  async function supprimer(j) {
    if (!window.confirm(t("fiscDonConfirmerSuppr"))) return;
    setErreur("");
    try {
      await api.fiscaliteImportSupprimer(j.id);
      await charger();
    } catch (e) {
      setErreur(e.message);
    }
  }

  const libelleJeu = (j) => (j.nature === "GRAND_LIVRE" ? t("fiscDonGrandLivre") : j.role === "PRECEDENT" ? t("fiscDonBalanceN1") : t("fiscDonBalanceN"));
  const mm = (v) => formaterXof(v, locale);
  const estGl = TYPES[choix].cle === "grand-livre";

  return (
    <AppShell title={t("fiscDonTitre")} subNav={<FiscaliteSousNav />}>
      {erreur && <p style={{ color: "var(--brique)", fontSize: 12.5, marginBottom: 12 }}>{erreur}</p>}
      {info && <p style={{ color: "#2E7D5B", fontSize: 12.5, marginBottom: 12 }}>{info}</p>}
      <p style={{ fontSize: 12.5, color: "var(--sub)", marginBottom: 12, maxWidth: 860, lineHeight: 1.55 }}>{t("fiscDonAide")}</p>

      <div className="card" style={{ marginBottom: 16, maxWidth: 940 }}>
        <h3 style={{ fontSize: 13.5, color: "var(--petrol)", marginBottom: 10 }}>{t("fiscDonNouvelImport")}</h3>
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "flex-end" }}>
          <div>
            <label style={labelStyle}>{t("fiscDonExercice")}</label>
            <select value={annee} onChange={(e) => changerAnnee(Number(e.target.value))} style={{ ...inputStyle, width: 110 }}>
              {[anneeCourante + 1, anneeCourante, anneeCourante - 1, anneeCourante - 2, anneeCourante - 3, anneeCourante - 4].map((a) => <option key={a} value={a}>{a}</option>)}
            </select>
          </div>
          <div>
            <label style={labelStyle}>{t("fiscDonNature")}</label>
            <select value={choix} onChange={(e) => { setChoix(Number(e.target.value)); setApercu(null); }} style={{ ...inputStyle, width: 280 }}>
              {TYPES.map((x, i) => <option key={i} value={i}>{t(x.libelle)}</option>)}
            </select>
          </div>
          <div>
            <label style={labelStyle}>{t("fiscDonDu")}</label>
            <input type="date" value={debut} onChange={(e) => setDebut(e.target.value)} style={{ ...inputStyle, width: 150 }} />
          </div>
          <div>
            <label style={labelStyle}>{t("fiscDonAu")}</label>
            <input type="date" value={fin} onChange={(e) => setFin(e.target.value)} style={{ ...inputStyle, width: 150 }} />
          </div>
        </div>
        <p style={{ fontSize: 11.5, color: "var(--sub)", margin: "8px 0 10px", lineHeight: 1.5 }}>{estGl ? t("fiscDonAideGl") : TYPES[choix].role === "PRECEDENT" ? t("fiscDonAideN1") : t("fiscDonAideBalance")}</p>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          <input type="file" accept=".xlsx,.xls,.csv" onChange={(e) => { setFichier(e.target.files?.[0] || null); setApercu(null); }} style={{ fontSize: 12.5 }} />
          <button style={boutonSecondaireStyle} disabled={occupe} onClick={lancerApercu}>{t("fiscDonApercu")}</button>
          {!estGl && <button style={boutonSecondaireStyle} onClick={() => api.fiscaliteImportModele("balance").catch((e) => setErreur(e.message))}>{t("fiscDonModele")}</button>}
        </div>

        {apercu && (
          <div style={{ marginTop: 14 }}>
            <div style={{ fontSize: 12.5, marginBottom: 6 }}>
              <strong>{apercu.nb_lignes}</strong> {t("fiscDonLignes")} · {t("fiscDonFormat")} : {apercu.format || "—"} · {t("fiscDonTotalDebit")} {mm(apercu.total_debit)} · {t("fiscDonTotalCredit")} {mm(apercu.total_credit)}
            </div>
            {(apercu.avertissements || []).map((a, i) => (
              <div key={i} style={{ fontSize: 12, color: "#8A6200", marginBottom: 3 }}>⚠ {texteAlerte(t, "fiscDonAv_", a, locale)}</div>
            ))}
            {(apercu.erreurs || []).slice(0, 5).map((a, i) => (
              <div key={i} style={{ fontSize: 12, color: "var(--brique)", marginBottom: 3 }}>{t("fiscDonErreurLigne").replace("{ligne}", String(a.ligne))}</div>
            ))}
            <div style={{ overflowX: "auto", margin: "8px 0" }}>
              <table style={{ borderCollapse: "collapse", fontSize: 12 }}>
                <thead>
                  <tr>
                    <th style={thStyle}>{t("fiscDonCompte")}</th>
                    {estGl ? (<><th style={thStyle}>{t("fiscDonDate")}</th><th style={thStyle}>{t("fiscDonPiece")}</th><th style={thStyle}>{t("fiscDonTiers")}</th></>) : <th style={thStyle}>{t("fiscDonLibelle")}</th>}
                    {!estGl && <th style={{ ...thStyle, textAlign: "right" }}>{t("fiscDonAn")}</th>}
                    <th style={{ ...thStyle, textAlign: "right" }}>{t("fiscDonDebit")}</th>
                    <th style={{ ...thStyle, textAlign: "right" }}>{t("fiscDonCredit")}</th>
                    {!estGl && <th style={{ ...thStyle, textAlign: "right" }}>{t("fiscDonSolde")}</th>}
                  </tr>
                </thead>
                <tbody>
                  {apercu.echantillon.map((l, i) => (
                    <tr key={i}>
                      <td style={tdStyle}>{l.compte}</td>
                      {estGl ? (<><td style={tdStyle}>{l.date}</td><td style={tdStyle}>{l.piece}</td><td style={tdStyle}>{l.tiers}</td></>) : <td style={tdStyle}>{l.libelle}</td>}
                      {!estGl && <td style={{ ...tdStyle, ...numStyle }}>{mm(l.an)}</td>}
                      <td style={{ ...tdStyle, ...numStyle }}>{mm(l.debit)}</td>
                      <td style={{ ...tdStyle, ...numStyle }}>{mm(l.credit)}</td>
                      {!estGl && <td style={{ ...tdStyle, ...numStyle }}>{mm(l.solde)}</td>}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <button style={boutonPrincipalStyle} disabled={occupe || (apercu.erreurs || []).length > 0 && apercu.nb_lignes === 0} onClick={lancerImport}>{t("fiscDonImporter")}</button>
            <span style={{ fontSize: 11.5, color: "var(--sub)", marginLeft: 10 }}>{t("fiscDonRemplace")}</span>
          </div>
        )}
      </div>

      <h3 style={{ fontSize: 13.5, color: "var(--petrol)", marginBottom: 8 }}>{t("fiscDonHistorique")}</h3>
      <div className="card" style={{ overflowX: "auto", maxWidth: 1100 }}>
        {!jeux ? <p style={{ fontSize: 12.5, color: "var(--sub)" }}>{t("loading")}</p> : jeux.length === 0 ? <p style={{ fontSize: 12.5, color: "var(--sub)" }}>{t("fiscDonAucun")}</p> : (
          <table style={{ borderCollapse: "collapse", fontSize: 12.5, width: "100%" }}>
            <thead>
              <tr>
                <th style={thStyle}>{t("fiscDonExercice")}</th>
                <th style={thStyle}>{t("fiscDonNature")}</th>
                <th style={thStyle}>{t("fiscDonPeriode")}</th>
                <th style={thStyle}>{t("fiscDonFichier")}</th>
                <th style={{ ...thStyle, textAlign: "right" }}>{t("fiscDonLignes")}</th>
                <th style={thStyle}>{t("fiscDonEtat")}</th>
                <th style={thStyle}></th>
              </tr>
            </thead>
            <tbody>
              {jeux.map((j) => (
                <tr key={j.id}>
                  <td style={tdStyle}>{j.annee}</td>
                  <td style={tdStyle}>{libelleJeu(j)}</td>
                  <td style={tdStyle}>{dateCourte(j.date_debut, locale)} → {dateCourte(j.date_fin, locale)}</td>
                  <td style={tdStyle}>{j.nom_fichier || "—"}{j.par ? <span style={{ color: "var(--sub)" }}> · {j.par}</span> : null}</td>
                  <td style={{ ...tdStyle, ...numStyle }}>{j.nb_lignes}</td>
                  <td style={tdStyle}>
                    <span style={pastilleStyle(j.actif ? { color: "#2E7D5B", background: "rgba(46,125,91,0.12)" } : { color: "var(--sub)", background: "rgba(91,106,108,0.1)" })}>{j.actif ? t("fiscDonActif") : t("fiscDonArchive")}</span>
                  </td>
                  <td style={tdStyle}><button style={boutonSecondaireStyle} onClick={() => supprimer(j)}>{t("fiscSupprimer")}</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </AppShell>
  );
}
