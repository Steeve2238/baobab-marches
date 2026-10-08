"use client";

import { useEffect, useState } from "react";
import { api } from "../../api";
import { useLangue } from "../../i18n/LanguageContext";
import BulletinVue from "./BulletinVue";
import { Champ, Section, inputStyle, boutonPrincipal, boutonLeger, boutonDanger, cellule, enteteCellule, droite, fmt, useStatut, Statut, MOIS_FR } from "../paieUi";

const SITUATIONS = ["CELIBATAIRE", "MARIE", "DIVORCE", "VEUF"];

export default function SimulationInverse() {
  const { t } = useLangue();
  const maintenant = new Date();
  const [convs, setConvs] = useState([]);
  const [grille, setGrille] = useState([]);
  const [rubs, setRubs] = useState([]);
  const [f, setF] = useState({
    net_cible: "1500000", annee: String(maintenant.getFullYear()), mois: String(maintenant.getMonth() + 1),
    situation_familiale: "CELIBATAIRE", nb_enfants: "0", conjoint_a_revenus: false, resident_senegal: true, invalidite_40: false,
    parts_ir: "", parts_trimf: "", convention_id: "", categorie_code: "", salaire_base: "", sursalaire: "", annees_anciennete: "0", regime_rc: "",
    ajust_type: "SURSALAIRE", ajust_rubrique: "", part_base_pct: "70",
  });
  const [fixes, setFixes] = useState([]);
  const [res, setRes] = useState(null);
  const [netMini, setNetMini] = useState(null);
  const [enCours, setEnCours] = useState(false);
  const s = useStatut();

  useEffect(() => {
    api.paieConventions().then(setConvs).catch(() => {});
    api.paieRubriques().then(setRubs).catch(() => {});
  }, []);
  useEffect(() => {
    if (!f.convention_id) { setGrille([]); return; }
    api.paieGrille(f.convention_id).then((g) => setGrille(g.grille)).catch(() => setGrille([]));
  }, [f.convention_id]);

  const gains = rubs.filter((r) => r.actif && r.sens !== "RETENUE" && r.sens !== "REMBOURSEMENT");
  const maj = (k) => (e) => setF({ ...f, [k]: e.target.type === "checkbox" ? e.target.checked : e.target.value });
  const majFixe = (i, k, v) => setFixes(fixes.map((l, j) => (j === i ? { ...l, [k]: v } : l)));

  async function calculer() {
    s.raz(); setNetMini(null); setEnCours(true);
    try {
      const ajustement = f.ajust_type === "RUBRIQUE" ? { type: "RUBRIQUE", rubrique_code: f.ajust_rubrique || (gains[0] && gains[0].code) }
        : f.ajust_type === "REPARTITION" ? { type: "REPARTITION", part_base_pct: f.part_base_pct } : { type: f.ajust_type };
      const corps = {
        net_cible: f.net_cible, annee: f.annee, mois: f.mois, situation_familiale: f.situation_familiale, nb_enfants: f.nb_enfants,
        conjoint_a_revenus: f.situation_familiale === "MARIE" && f.conjoint_a_revenus, resident_senegal: f.resident_senegal, invalidite_40: f.invalidite_40,
        parts_ir: f.parts_ir, parts_trimf: f.parts_trimf,
        convention_id: f.convention_id || null, categorie_code: f.categorie_code || null, salaire_base: f.salaire_base === "" ? null : f.salaire_base,
        sursalaire: f.sursalaire === "" ? 0 : f.sursalaire, annees_anciennete: f.annees_anciennete, regime_rc: f.regime_rc === "" ? null : f.regime_rc === "1",
        ajustement, elements: fixes.filter((x) => x.rubrique_code && x.montant !== ""),
      };
      setRes(await api.paieSimulerInverse(corps));
    } catch (e) {
      s.ko(e); setRes(null);
      if (e.data && e.data.net_minimum != null) setNetMini(e.data.net_minimum);
    } finally { setEnCours(false); }
  }

  const inv = res && res.inverse;
  const b = res && res.bulletin;
  const carte = (libelle, valeur, fort) => (
    <div className="card" style={{ padding: "12px 14px", flex: "1 1 170px" }}>
      <div style={{ fontSize: 11, color: "var(--sub)", textTransform: "uppercase", letterSpacing: 0.3 }}>{libelle}</div>
      <div style={{ fontSize: fort ? 21 : 17, fontWeight: 700, marginTop: 4, fontVariantNumeric: "tabular-nums" }}>{valeur} F</div>
    </div>
  );
  const ligneStyle = { display: "flex", gap: 8, alignItems: "center", marginBottom: 6, flexWrap: "wrap" };
  const radio = (valeur, libelle) => (
    <label style={{ display: "flex", gap: 8, alignItems: "flex-start", fontSize: 12.5, marginBottom: 6, cursor: "pointer" }}>
      <input type="radio" name="ajust" checked={f.ajust_type === valeur} onChange={() => setF({ ...f, ajust_type: valeur })} style={{ marginTop: 3 }} />
      <span>{libelle}</span>
    </label>
  );

  return (
    <>
      <p style={{ fontSize: 12.5, color: "var(--sub)", marginBottom: 14, maxWidth: 780, lineHeight: 1.5 }}>{t("paieInvAide")}</p>
      <Statut s={s} />
      {netMini != null && <p style={{ fontSize: 12.5, margin: "0 0 10px" }}>{t("paieInvNetMini")} <b>{fmt(netMini)} F</b></p>}
      <div style={{ display: "grid", gridTemplateColumns: "minmax(320px, 420px) 1fr", gap: 14, alignItems: "start" }} className="paie-inv">
        <div style={{ display: "grid", gap: 12 }}>
          <Section titre={t("paieInvNet")}>
            <div style={{ display: "grid", gap: 10 }}>
              <input type="number" style={{ ...inputStyle, fontSize: 18, fontWeight: 700 }} value={f.net_cible} onChange={maj("net_cible")} />
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                <Champ label={t("paieMois")}>
                  <select style={inputStyle} value={f.mois} onChange={maj("mois")}>{MOIS_FR.slice(1).map((m, i) => <option key={m} value={i + 1}>{m}</option>)}</select>
                </Champ>
                <Champ label={t("paieAnnee")}><input type="number" style={inputStyle} value={f.annee} onChange={maj("annee")} /></Champ>
              </div>
            </div>
          </Section>

          <Section titre={t("paieInvFamille")}>
            <div style={{ display: "grid", gap: 10 }}>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                <Champ label={t("rhd_situation_familiale")}>
                  <select style={inputStyle} value={f.situation_familiale} onChange={maj("situation_familiale")}>{SITUATIONS.map((x) => <option key={x} value={x}>{t(`rhdOpt_${x}`)}</option>)}</select>
                </Champ>
                <Champ label={t("paieInvEnfants")}><input type="number" min="0" style={inputStyle} value={f.nb_enfants} onChange={maj("nb_enfants")} /></Champ>
              </div>
              {f.situation_familiale === "MARIE" && <label style={{ fontSize: 12.5 }}><input type="checkbox" checked={f.conjoint_a_revenus} onChange={maj("conjoint_a_revenus")} /> {t("paieInvConjoint")}</label>}
              <label style={{ fontSize: 12.5 }}><input type="checkbox" checked={f.resident_senegal} onChange={maj("resident_senegal")} /> {t("paieInvResident")}</label>
              <label style={{ fontSize: 12.5 }}><input type="checkbox" checked={f.invalidite_40} onChange={maj("invalidite_40")} /> {t("paieInvInvalidite")}</label>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                <Champ label={`${t("paiePartsIr")} — ${t("paieInvPartsForcer")}`}><input type="number" step="0.5" style={inputStyle} value={f.parts_ir} onChange={maj("parts_ir")} /></Champ>
                <Champ label={`${t("paiePartsTrimf")} — ${t("paieInvPartsForcer")}`}><input type="number" style={inputStyle} value={f.parts_trimf} onChange={maj("parts_trimf")} /></Champ>
              </div>
            </div>
          </Section>

          <Section titre={t("paieInvStructure")}>
            <div style={{ display: "grid", gap: 10 }}>
              <Champ label={t("paieConvention")}>
                <select style={inputStyle} value={f.convention_id} onChange={(e) => setF({ ...f, convention_id: e.target.value, categorie_code: "" })}>
                  <option value="">—</option>
                  {convs.filter((c) => c.actif).map((c) => <option key={c.id} value={c.id}>{c.libelle}</option>)}
                </select>
              </Champ>
              <Champ label={t("paieCategorie")}>
                <select style={inputStyle} value={f.categorie_code} onChange={maj("categorie_code")} disabled={!f.convention_id}>
                  <option value="">—</option>
                  {grille.map((g) => <option key={g.code} value={g.code}>{g.libelle} — {fmt(g.salaire_base)} F</option>)}
                </select>
              </Champ>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                <Champ label={t("paieSalaireManuel")}><input type="number" style={inputStyle} value={f.salaire_base} onChange={maj("salaire_base")} /></Champ>
                <Champ label={t("paieSursalaire")}><input type="number" style={inputStyle} value={f.sursalaire} onChange={maj("sursalaire")} /></Champ>
                <Champ label={t("paieAnneesAnciennete")}><input type="number" style={inputStyle} value={f.annees_anciennete} onChange={maj("annees_anciennete")} /></Champ>
                <Champ label={t("paieRegimeRc")}>
                  <select style={inputStyle} value={f.regime_rc} onChange={maj("regime_rc")}><option value="">{t("paieRcAuto")}</option><option value="1">{t("paieRcOui")}</option><option value="0">{t("paieRcNon")}</option></select>
                </Champ>
              </div>
              <div>
                <h4 style={{ fontSize: 12, margin: "4px 0 6px" }}>{t("paieInvFixes")}</h4>
                {fixes.map((l, i) => (
                  <div key={i} style={ligneStyle}>
                    <select style={{ ...inputStyle, flex: "1 1 180px", minWidth: 0 }} value={l.rubrique_code} onChange={(e) => majFixe(i, "rubrique_code", e.target.value)}>{gains.map((r) => <option key={r.code} value={r.code}>{r.libelle}</option>)}</select>
                    <input type="number" style={{ ...inputStyle, width: 110 }} value={l.montant} onChange={(e) => majFixe(i, "montant", e.target.value)} placeholder={t("paieMontant")} />
                    <button style={boutonDanger} onClick={() => setFixes(fixes.filter((_, j) => j !== i))}>×</button>
                  </div>
                ))}
                <button style={boutonLeger} onClick={() => setFixes([...fixes, { rubrique_code: gains[0] ? gains[0].code : "", montant: gains[0] && gains[0].montant_defaut != null ? String(gains[0].montant_defaut) : "" }])}>+ {t("paieInvAjouter")}</button>
              </div>
            </div>
          </Section>

          <Section titre={t("paieInvAjust")}>
            {radio("SURSALAIRE", t("paieInvAjSursalaire"))}
            {radio("SALAIRE_BASE", t("paieInvAjBase"))}
            {radio("REPARTITION", t("paieInvAjRepartition"))}
            {radio("RUBRIQUE", t("paieInvAjRubrique"))}
            {f.ajust_type === "REPARTITION" && <Champ label={t("paieInvPartBase")}><input type="number" min="1" max="100" style={{ ...inputStyle, width: 120 }} value={f.part_base_pct} onChange={maj("part_base_pct")} /></Champ>}
            {f.ajust_type === "RUBRIQUE" && (
              <Champ label={t("paieInvRubrique")}>
                <select style={inputStyle} value={f.ajust_rubrique || (gains[0] && gains[0].code) || ""} onChange={maj("ajust_rubrique")}>{gains.map((r) => <option key={r.code} value={r.code}>{r.libelle}</option>)}</select>
              </Champ>
            )}
          </Section>

          <button style={{ ...boutonPrincipal, padding: "11px 16px", fontSize: 13.5, opacity: enCours ? 0.6 : 1 }} disabled={enCours} onClick={calculer}>{enCours ? t("paieInvCalcul") : t("paieInvCalculer")}</button>
        </div>

        <div style={{ minWidth: 0 }}>
          {!b ? <div className="card"><p style={{ fontSize: 12.5, color: "var(--sub)", margin: 0 }}>{t("paieInvVide")}</p></div> : (
            <div style={{ display: "grid", gap: 12 }}>
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                {carte(t("paieInvBrut"), fmt(inv.synthese.brut), true)}
                {carte(t("paieInvNetAtteint"), fmt(inv.net_atteint), true)}
                {carte(t("paieInvCout"), fmt(inv.synthese.cout_employeur))}
              </div>
              {inv.ecart !== 0 && <p style={{ fontSize: 12, color: "var(--sub)", margin: 0 }}>{inv.ecart > 0 ? "+" : ""}{fmt(inv.ecart)} F {t("paieInvEcart")}</p>}
              <p style={{ fontSize: 12, color: "var(--sub)", margin: 0 }}>
                {t("paieInvParts").replace("{ir}", inv.parts.parts_ir).replace("{trimf}", inv.parts.parts_trimf).replace("{enf}", inv.parts.enfants_a_charge)}
              </p>
              <div className="card">
                <div style={{ fontWeight: 700, fontSize: 13.5, marginBottom: 6 }}>{t("paieInvDecomposition")}</div>
                <table style={{ borderCollapse: "collapse", width: "100%" }}>
                  <tbody>
                    {b.lignes.filter((l) => Number(l.montant) !== 0).map((l, i) => (
                      <tr key={i}><td style={cellule}>{l.libelle}</td><td style={{ ...cellule, ...droite }}>{fmt(l.montant)}</td></tr>
                    ))}
                    <tr><td style={{ ...cellule, fontWeight: 700 }}>{t("paieInvTotalBrut")}</td><td style={{ ...cellule, ...droite, fontWeight: 700 }}>{fmt(inv.synthese.brut)}</td></tr>
                    <tr><td style={{ ...cellule, color: "var(--sub)" }}>{t("paieInvRetenues")}</td><td style={{ ...cellule, ...droite, color: "var(--sub)" }}>− {fmt(inv.synthese.total_retenues)}</td></tr>
                    <tr><td style={{ ...cellule, fontWeight: 700 }}>{t("paieInvNetAtteint")}</td><td style={{ ...cellule, ...droite, fontWeight: 700 }}>{fmt(inv.net_atteint)}</td></tr>
                    <tr><td style={{ ...cellule, color: "var(--sub)" }}>{t("paieInvCharges")}</td><td style={{ ...cellule, ...droite, color: "var(--sub)" }}>{fmt(inv.synthese.charges_patronales)}</td></tr>
                  </tbody>
                </table>
              </div>
              <div style={{ fontWeight: 700, fontSize: 13.5 }}>{t("paieInvDetail")}</div>
              <BulletinVue b={{ ...b, avertissements: (b.avertissements || []).filter((a) => a.code !== "SANS_CATEGORIE") }} t={t} />
            </div>
          )}
        </div>
      </div>
      <style>{`@media (max-width: 900px) { .paie-inv { grid-template-columns: 1fr !important; } }`}</style>
    </>
  );
}
