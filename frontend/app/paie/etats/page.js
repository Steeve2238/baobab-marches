"use client";

import { useEffect, useState } from "react";
import { api } from "../../../lib/api";
import { useLangue } from "../../../lib/i18n/LanguageContext";
import AppShell from "../../../lib/components/AppShell";
import PaieSousNav from "../../../lib/components/PaieSousNav";
import { Pastille, Champ, inputStyle, boutonPrincipal, boutonLeger, cellule, enteteCellule, droite, fmt, useStatut, Statut } from "../../../lib/components/paieUi";

const orgLabel = (t, section) => { const k = `paieOrg_${section}`; const v = t(k); return v === k ? section : v; };

export default function EtatsPeriodiquesPage() {
  const { t, langue } = useLangue();
  const [annee, setAnnee] = useState(new Date().getFullYear());
  const [trimestre, setTrimestre] = useState(0);
  const [e, setE] = useState(null);
  const [vue, setVue] = useState("salaries");
  const s = useStatut();

  useEffect(() => {
    setE(null);
    api.paieEtatPeriodique(annee, trimestre).then(setE).catch(s.ko);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [annee, trimestre]);

  const th = (txt, droit) => <th style={{ ...enteteCellule, ...(droit ? droite : {}) }}>{txt}</th>;
  const tot = { ...cellule, fontWeight: 700, background: "rgba(15,76,92,0.05)" };
  const cols = ["brut", "imposable", "cotis_salarie", "ir", "trimf", "autres_retenues", "net", "charges_patronales", "cout_employeur"];
  const entetes = [t("paieBullBrut"), t("paieBullImposable"), t("paieEtatCotSalarie"), "IR", "TRIMF", t("paieEtatAutresRet"), t("paieNetPaye"), t("paieBullTotalPatronales"), t("paieBullCoutEmployeur")];
  const org = e && vue.startsWith("org:") ? e.organismes.find((o) => `org:${o.section}` === vue) : null;
  const vues = e ? [["salaries", t("paieEtatsRecap")], ["mois", t("paieEtatsParMois")], ...e.organismes.map((o) => [`org:${o.section}`, orgLabel(t, o.section)]), ["synthese", t("paieEtatSynthese")]] : [];

  return (
    <AppShell title={t("paieEtatsTitre")} subNav={<PaieSousNav />}>
      <p style={{ fontSize: 12.5, color: "var(--sub)", marginBottom: 14, maxWidth: 780, lineHeight: 1.5 }}>{t("paieEtatsAide")}</p>
      <Statut s={s} />
      <div style={{ display: "flex", gap: 12, alignItems: "flex-end", flexWrap: "wrap", marginBottom: 14 }}>
        <Champ label={t("paieAnnee")}><input type="number" style={{ ...inputStyle, width: 100 }} value={annee} onChange={(x) => setAnnee(Number(x.target.value) || annee)} /></Champ>
        <Champ label={t("paieEtatsPeriode")}>
          <select style={{ ...inputStyle, width: 190 }} value={trimestre} onChange={(x) => setTrimestre(Number(x.target.value))}>
            <option value={0}>{t("paieEtatsAnnuel")}</option>
            {[1, 2, 3, 4].map((q) => <option key={q} value={q}>{t("paieEtatsTrimestre")} {q}</option>)}
          </select>
        </Champ>
        <span style={{ flex: 1 }} />
        {e && <button style={boutonLeger} onClick={() => api.paieOuvrirEtatPeriodiquePdf(annee, trimestre).catch(s.ko)}>{t("paieEtatsPdf")}</button>}
        {e && <button style={boutonPrincipal} onClick={() => api.paieExporterEtatPeriodique(annee, trimestre, langue).catch(s.ko)}>{t("paieExporterEtats")}</button>}
      </div>
      {!e ? <p style={{ fontSize: 12.5, color: "var(--sub)" }}>{t("loading")}</p> : (
        <>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12, alignItems: "center" }}>
            {e.mois.map((m) => <Pastille key={m.mois} ton={m.statut === "CLOTUREE" ? "ok" : m.statut ? "alerte" : "neutre"}>{t(`paieMoisNom_${m.mois}`).slice(0, 3)}</Pastille>)}
            <span style={{ fontSize: 12, color: "var(--sub)" }}>{e.complet ? t("paieEtatsComplet") : t("paieEtatsIncomplet")}</span>
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
            {vues.map(([k, l]) => <button key={k} onClick={() => setVue(k)} style={{ ...boutonLeger, ...(vue === k ? { background: "var(--petrol)", color: "#fff", borderColor: "var(--petrol)" } : {}) }}>{l}</button>)}
          </div>
          <div className="card" style={{ overflowX: "auto", padding: 0 }}>
            {e.salaries.length === 0 && <p style={{ fontSize: 12.5, color: "var(--sub)", padding: 14, margin: 0 }}>{t("paieEtatsVide")}</p>}
            {e.salaries.length > 0 && vue === "salaries" && (
              <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 980 }}>
                <thead><tr>{th(t("paieSalarie"))}{th(t("paieEtatsNbMois"), 1)}{entetes.map((h, i) => <th key={i} style={{ ...enteteCellule, ...droite }}>{h}</th>)}</tr></thead>
                <tbody>
                  {e.salaries.map((x) => <tr key={x.employe_id}><td style={cellule}>{x.nom}<div style={{ fontSize: 11, color: "var(--sub)" }}>{x.matricule}</div></td><td style={{ ...cellule, ...droite }}>{x.mois_travailles}</td>{cols.map((k) => <td key={k} style={{ ...cellule, ...droite, fontWeight: k === "net" ? 700 : 400 }}>{fmt(x[k])}</td>)}</tr>)}
                  <tr><td style={tot}>{t("paieTotal")}</td><td style={tot}></td>{cols.map((k) => <td key={k} style={{ ...tot, ...droite }}>{fmt(e.totaux[k])}</td>)}</tr>
                </tbody>
              </table>
            )}
            {e.salaries.length > 0 && vue === "mois" && (
              <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 900 }}>
                <thead><tr>{th(t("paieMois"))}{th(t("paieNbBulletins"), 1)}{entetes.map((h, i) => <th key={i} style={{ ...enteteCellule, ...droite }}>{h}</th>)}</tr></thead>
                <tbody>
                  {e.par_mois.map((x) => <tr key={x.mois}><td style={cellule}>{t(`paieMoisNom_${x.mois}`)}</td><td style={{ ...cellule, ...droite }}>{x.nb}</td>{cols.map((k) => <td key={k} style={{ ...cellule, ...droite }}>{fmt(x[k])}</td>)}</tr>)}
                  <tr><td style={tot}>{t("paieTotal")}</td><td style={tot}></td>{cols.map((k) => <td key={k} style={{ ...tot, ...droite }}>{fmt(e.totaux[k])}</td>)}</tr>
                </tbody>
              </table>
            )}
            {org && (
              <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 700 }}>
                <thead>
                  <tr><th style={enteteCellule} rowSpan={2}>{t("paieSalarie")}</th>{org.colonnes.map((c) => <th key={c.code} colSpan={3} style={{ ...enteteCellule, textAlign: "center" }} title={c.libelle}>{c.code}</th>)}</tr>
                  <tr>{org.colonnes.map((c) => [<th key={c.code + "b"} style={{ ...enteteCellule, ...droite }}>{t("paieBase")}</th>, <th key={c.code + "s"} style={{ ...enteteCellule, ...droite }}>{t("paieSalarieCol")}</th>, <th key={c.code + "p"} style={{ ...enteteCellule, ...droite }}>{t("paiePatronal")}</th>])}</tr>
                </thead>
                <tbody>
                  {org.salaries.map((x) => <tr key={x.employe_id}><td style={cellule}>{x.nom}</td>{org.colonnes.map((c) => [<td key={c.code + "b"} style={{ ...cellule, ...droite }}>{fmt(x.cotisations[c.code].base)}</td>, <td key={c.code + "s"} style={{ ...cellule, ...droite }}>{fmt(x.cotisations[c.code].salarie)}</td>, <td key={c.code + "p"} style={{ ...cellule, ...droite }}>{fmt(x.cotisations[c.code].patronal)}</td>])}</tr>)}
                  <tr><td style={tot}>{t("paieTotal")}</td>{org.colonnes.map((c) => [<td key={c.code + "b"} style={{ ...tot, ...droite }}>{fmt(org.totaux[c.code].base)}</td>, <td key={c.code + "s"} style={{ ...tot, ...droite }}>{fmt(org.totaux[c.code].salarie)}</td>, <td key={c.code + "p"} style={{ ...tot, ...droite }}>{fmt(org.totaux[c.code].patronal)}</td>])}</tr>
                </tbody>
              </table>
            )}
            {e.salaries.length > 0 && vue === "synthese" && (
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead><tr>{th(t("paieEtatOrganisme"))}{th(t("paieEtatAPayer"), 1)}</tr></thead>
                <tbody>{e.synthese.map((x) => <tr key={x.code}><td style={cellule}>{x.code === "IR" ? t("paieEtatIrRetenu") : x.code === "TRIMF" ? "TRIMF" : orgLabel(t, x.code)}</td><td style={{ ...cellule, ...droite, fontWeight: 700 }}>{fmt(x.a_payer)}</td></tr>)}</tbody>
              </table>
            )}
          </div>
        </>
      )}
    </AppShell>
  );
}
