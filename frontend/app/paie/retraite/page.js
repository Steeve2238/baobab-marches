"use client";

import { useEffect, useState } from "react";
import { api } from "../../../lib/api";
import { useLangue } from "../../../lib/i18n/LanguageContext";
import AppShell from "../../../lib/components/AppShell";
import PaieSousNav from "../../../lib/components/PaieSousNav";
import { Champ, inputStyle, boutonPrincipal, boutonLeger, boutonDanger, cellule, enteteCellule, droite, fmt, fmtDec, aujourdhui, useStatut, Statut } from "../../../lib/components/paieUi";

const vide = { id: null, libelle: "", date_effet: "", plafond_mois: "", tranches: [{ de_annees: 0, a_annees: "", pourcentage_par_an: "" }] };

export default function RetraitePage() {
  const { t } = useLangue();
  const [salaries, setSalaries] = useState([]);
  const [baremes, setBaremes] = useState([]);
  const [droit, setDroit] = useState(false);
  const [periode, setPeriode] = useState(null);
  const [f, setF] = useState({ employe_id: "", date_depart: aujourdhui(), salaire_reference: "", bareme_id: "" });
  const [res, setRes] = useState(null);
  const [edition, setEdition] = useState(null);
  const s = useStatut();

  const charger = () => {
    api.paieBaremesRetraite().then((r) => { setBaremes(r.baremes); setDroit(r.droit_validation); }).catch(s.ko);
    api.paieDossiers().then((l) => setSalaries(l.filter((x) => x.statut !== "SORTI"))).catch(() => {});
    api.paiePeriodes().then((r) => setPeriode(r.periodes.find((p) => p.statut === "OUVERTE") || null)).catch(() => {});
  };
  useEffect(charger, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function calculer() {
    s.raz(); setRes(null);
    try { setRes(await api.paieCalculRetraite({ ...f, salaire_reference: f.salaire_reference === "" ? null : Number(f.salaire_reference), bareme_id: f.bareme_id || undefined })); } catch (e) { s.ko(e); }
  }
  async function verser() {
    s.raz();
    try { await api.paieAppliquerRetraite({ employe_id: f.employe_id, periode_id: periode.id, montant: res.montant }); s.ok(t("paieRetraiteVerse")); } catch (e) { s.ko(e); }
  }
  async function sauver() {
    s.raz();
    try {
      await api.paieSauverBaremeRetraite({ ...edition, plafond_mois: edition.plafond_mois === "" ? null : Number(edition.plafond_mois),
        tranches: edition.tranches.map((x) => ({ de_annees: Number(x.de_annees), a_annees: x.a_annees === "" || x.a_annees == null ? null : Number(x.a_annees), pourcentage_par_an: Number(x.pourcentage_par_an) })) });
      setEdition(null); s.ok(t("paieEnregistre")); charger();
    } catch (e) { s.ko(e); }
  }
  async function supprimer(id) {
    if (!window.confirm(t("paieSupprimerConfirme"))) return;
    try { await api.paieSupprimerBaremeRetraite(id); charger(); } catch (e) { s.ko(e); }
  }
  const majT = (i, k, v) => setEdition({ ...edition, tranches: edition.tranches.map((x, j) => (j === i ? { ...x, [k]: v } : x)) });

  return (
    <AppShell title={t("paieRetraiteTitre")} subNav={<PaieSousNav />}>
      <p style={{ fontSize: 12.5, color: "var(--sub)", marginBottom: 14, maxWidth: 800, lineHeight: 1.5 }}>{t("paieRetraiteAide")}</p>
      <Statut s={s} />
      <div style={{ display: "grid", gap: 16, maxWidth: 900 }}>
        <div className="card">
          <h3 style={{ fontSize: 13.5, margin: "0 0 10px" }}>{t("paieRetraiteCalcul")}</h3>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))", gap: 12, marginBottom: 12 }}>
            <Champ label={t("paieSalarie")}>
              <select style={inputStyle} value={f.employe_id} onChange={(e) => setF({ ...f, employe_id: e.target.value })}>
                <option value="">—</option>
                {salaries.map((x) => <option key={x.id} value={x.id}>{x.nom} {x.prenom} ({x.matricule})</option>)}
              </select>
            </Champ>
            <Champ label={t("paieRetraiteDateDepart")}><input type="date" style={inputStyle} value={f.date_depart} onChange={(e) => setF({ ...f, date_depart: e.target.value })} /></Champ>
            <Champ label={t("paieRetraiteRefSaisie")}><input type="number" style={inputStyle} value={f.salaire_reference} placeholder={t("paieRetraiteRefAuto")} onChange={(e) => setF({ ...f, salaire_reference: e.target.value })} /></Champ>
            <Champ label={t("paieRetraiteBareme")}>
              <select style={inputStyle} value={f.bareme_id} onChange={(e) => setF({ ...f, bareme_id: e.target.value })}>
                <option value="">{t("paieRetraiteBaremeAuto")}</option>
                {baremes.map((b) => <option key={b.id} value={b.id}>{b.libelle}</option>)}
              </select>
            </Champ>
          </div>
          <button style={boutonPrincipal} disabled={!f.employe_id} onClick={calculer}>{t("paieRetraiteCalculer")}</button>
          {res && (
            <div style={{ marginTop: 14, paddingTop: 12, borderTop: "1px solid var(--line-soft)" }}>
              <div style={{ fontSize: 12.5, lineHeight: 1.7 }}>
                <b>{res.employe.nom}</b> — {t("paieRetraiteAnciennete")} : <b>{fmtDec(res.anciennete_annees, 2)} {t("paieRetraiteAns")}</b> ({t("paieRetraiteDepuis")} {res.anciennete_depuis})<br />
                {t("paieRetraiteRef")} : <b>{fmt(res.salaire_reference)} F</b> ({res.source_reference === "SAISI" ? t("paieRetraiteRefSaisi") : t("paieRetraiteRefMoyenne").replace("{n}", res.source_reference.replace(/\D/g, ""))}) — {t("paieRetraiteBareme")} : {res.bareme.libelle}
              </div>
              <table style={{ borderCollapse: "collapse", margin: "10px 0", minWidth: 480 }}>
                <thead><tr><th style={enteteCellule}>{t("paieRetraiteTranche")}</th><th style={{ ...enteteCellule, ...droite }}>{t("paieRetraiteAnnees")}</th><th style={{ ...enteteCellule, ...droite }}>% / {t("paieRetraiteAn")}</th><th style={{ ...enteteCellule, ...droite }}>{t("paieMontant")}</th></tr></thead>
                <tbody>{res.detail.map((d, i) => <tr key={i}><td style={cellule}>{d.de_annees} → {d.a_annees == null ? "∞" : d.a_annees}</td><td style={{ ...cellule, ...droite }}>{fmtDec(d.annees, 2)}</td><td style={{ ...cellule, ...droite }}>{d.pourcentage_par_an} %</td><td style={{ ...cellule, ...droite }}>{fmt(d.montant)}</td></tr>)}</tbody>
              </table>
              <div style={{ fontSize: 15, fontWeight: 700 }}>{t("paieRetraiteIndemnite")} : {fmt(res.montant)} F {res.plafonne && <span style={{ fontSize: 12, fontWeight: 400, color: "var(--sub)" }}>({t("paieRetraitePlafonne")})</span>}</div>
              {droit && periode && <div style={{ marginTop: 10 }}><button style={boutonLeger} onClick={verser}>{t("paieRetraiteVerser")} ({t(`paieMoisNom_${periode.mois}`)} {periode.annee})</button></div>}
              {droit && !periode && <p style={{ fontSize: 12, color: "var(--sub)", margin: "10px 0 0" }}>{t("paieRetraiteAucunePeriode")}</p>}
            </div>
          )}
        </div>

        <div className="card">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
            <h3 style={{ fontSize: 13.5, margin: 0 }}>{t("paieRetraiteBaremes")}</h3>
            {droit && !edition && <button style={boutonLeger} onClick={() => setEdition({ ...vide })}>{t("paieRetraiteNouveauBareme")}</button>}
          </div>
          <p style={{ fontSize: 12, color: "var(--sub)", margin: "0 0 10px", lineHeight: 1.5 }}>{t("paieRetraiteBaremeAide")}</p>
          {baremes.length === 0 && !edition && <p style={{ fontSize: 12.5, color: "var(--sub)", margin: 0 }}>{t("paieRetraiteAucunBareme")}</p>}
          {baremes.map((b) => (
            <div key={b.id} style={{ borderTop: "1px solid var(--line-soft)", padding: "8px 0", fontSize: 12.5 }}>
              <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                <b>{b.libelle}</b><span style={{ color: "var(--sub)" }}>{t("paieDateEffet")} {b.date_effet}</span>
                {b.plafond_mois != null && <span style={{ color: "var(--sub)" }}>{t("paieRetraitePlafond")} : {b.plafond_mois} {t("paieRetraiteMois")}</span>}
                <span style={{ flex: 1 }} />
                {droit && <button style={boutonLeger} onClick={() => setEdition({ ...b, plafond_mois: b.plafond_mois ?? "", tranches: b.tranches.map((x) => ({ ...x, a_annees: x.a_annees ?? "" })) })}>{t("paieModifier")}</button>}
                {droit && <button style={boutonDanger} onClick={() => supprimer(b.id)}>{t("paieSupprimer")}</button>}
              </div>
              <div style={{ color: "var(--sub)", marginTop: 4 }}>{b.tranches.map((x) => `${x.de_annees}→${x.a_annees == null ? "∞" : x.a_annees} ${t("paieRetraiteAns")} : ${x.pourcentage_par_an} %`).join("  ·  ")}</div>
            </div>
          ))}
          {edition && (
            <div style={{ borderTop: "1px solid var(--line-soft)", paddingTop: 12, marginTop: 8 }}>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))", gap: 12, marginBottom: 10 }}>
                <Champ label={t("paieRetraiteNomBareme")}><input style={inputStyle} value={edition.libelle} onChange={(e) => setEdition({ ...edition, libelle: e.target.value })} /></Champ>
                <Champ label={t("paieDateEffet")}><input type="date" style={inputStyle} value={edition.date_effet} onChange={(e) => setEdition({ ...edition, date_effet: e.target.value })} /></Champ>
                <Champ label={`${t("paieRetraitePlafond")} (${t("paieRetraiteMois")})`}><input type="number" style={inputStyle} value={edition.plafond_mois} onChange={(e) => setEdition({ ...edition, plafond_mois: e.target.value })} /></Champ>
              </div>
              {edition.tranches.map((x, i) => (
                <div key={i} style={{ display: "flex", gap: 10, alignItems: "flex-end", flexWrap: "wrap", marginBottom: 8 }}>
                  <Champ label={t("paieRetraiteDe")}><input type="number" style={{ ...inputStyle, width: 90 }} value={x.de_annees} onChange={(e) => majT(i, "de_annees", e.target.value)} /></Champ>
                  <Champ label={t("paieRetraiteA")}><input type="number" style={{ ...inputStyle, width: 90 }} value={x.a_annees} placeholder="∞" onChange={(e) => majT(i, "a_annees", e.target.value)} /></Champ>
                  <Champ label={`% / ${t("paieRetraiteAn")}`}><input type="number" style={{ ...inputStyle, width: 90 }} value={x.pourcentage_par_an} onChange={(e) => majT(i, "pourcentage_par_an", e.target.value)} /></Champ>
                  {edition.tranches.length > 1 && <button style={boutonDanger} onClick={() => setEdition({ ...edition, tranches: edition.tranches.filter((_, j) => j !== i) })}>×</button>}
                </div>
              ))}
              <div style={{ display: "flex", gap: 8, marginTop: 6 }}>
                <button style={boutonLeger} onClick={() => setEdition({ ...edition, tranches: [...edition.tranches, { de_annees: "", a_annees: "", pourcentage_par_an: "" }] })}>{t("paieRetraiteAjouterTranche")}</button>
                <button style={boutonPrincipal} onClick={sauver}>{t("paieEnregistrer")}</button>
                <button style={boutonLeger} onClick={() => setEdition(null)}>{t("paieAnnulerAction")}</button>
              </div>
            </div>
          )}
        </div>
      </div>
    </AppShell>
  );
}
