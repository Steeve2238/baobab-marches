"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { api } from "../../../lib/api";
import { useLangue } from "../../../lib/i18n/LanguageContext";
import AppShell from "../../../lib/components/AppShell";
import PaieSousNav from "../../../lib/components/PaieSousNav";
import BulletinVue from "../../../lib/components/paie/BulletinVue";
import { Champ, Section, inputStyle, boutonPrincipal, boutonLeger, boutonDanger, libelleHs, cellule, enteteCellule, droite, fmt, fmtDec, Pastille, useStatut, Statut, MOIS_FR } from "../../../lib/components/paieUi";

function Contenu() {
  const { t } = useLangue();
  const params = useSearchParams();
  const maintenant = new Date();
  const [salaries, setSalaries] = useState([]);
  const [convs, setConvs] = useState([]);
  const [grille, setGrille] = useState([]);
  const [rubs, setRubs] = useState([]);
  const [abs, setAbs] = useState([]);
  const [majs, setMajs] = useState([]);
  const [f, setF] = useState({
    employe_id: params.get("employe") || "", annee: String(maintenant.getFullYear()), mois: String(maintenant.getMonth() + 1), convention_id: "", categorie_code: "",
    salaire_base: "", sursalaire: "0", parts_ir: "1", parts_trimf: "1", annees_anciennete: "0", regime_rc: "", mode_ir: "BAREME", arrondi_net: "1",
  });
  const [hs, setHs] = useState([]);
  const [absences, setAbsences] = useState([]);
  const [gains, setGains] = useState([]);
  const [retenues, setRetenues] = useState([]);
  const [res, setRes] = useState(null);
  const s = useStatut();

  useEffect(() => {
    api.paieDossiers().then(setSalaries).catch(() => {});
    api.paieConventions().then(setConvs).catch(() => {});
    api.paieRubriques().then(setRubs).catch(() => {});
    api.paieTypesAbsence().then(setAbs).catch(() => {});
    api.paieReglages().then((r) => setF((x) => ({ ...x, mode_ir: r.mode_ir === "FORMULE" ? "FORMULE" : "BAREME", arrondi_net: String(r.arrondi_net) }))).catch(() => {});
  }, []);

  // Salarie choisi : on reprend sa convention, sa categorie et ses parts comme valeurs de depart.
  useEffect(() => {
    if (!f.employe_id) return;
    api.paieDossier(f.employe_id).then((d) => {
      const x = d.dossier || {};
      setF((c) => ({ ...c, convention_id: x.convention_id || "", categorie_code: x.categorie_code || "", salaire_base: x.salaire_base_manuel ?? "", sursalaire: String(x.sursalaire ?? 0), parts_ir: String(d.parts.parts_ir), parts_trimf: String(d.parts.parts_trimf), regime_rc: x.regime_rc == null ? "" : x.regime_rc ? "1" : "0" }));
    }).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [f.employe_id]);

  useEffect(() => {
    if (!f.convention_id) { setGrille([]); setMajs([]); return; }
    api.paieGrille(f.convention_id).then((g) => setGrille(g.grille)).catch(() => setGrille([]));
    const c = convs.find((x) => x.id === f.convention_id);
    setMajs(c ? c.majorations : []);
  }, [f.convention_id, convs]);

  const maj = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const majLigne = (liste, setListe, i, k, v) => setListe(liste.map((l, j) => (j === i ? { ...l, [k]: v } : l)));

  async function simuler() {
    s.raz();
    try {
      const corps = {
        employe_id: f.employe_id || undefined, annee: f.annee, mois: f.mois,
        convention_id: f.convention_id || null, categorie_code: f.categorie_code || null, salaire_base: f.salaire_base === "" ? null : f.salaire_base, sursalaire: f.sursalaire || 0,
        parts_ir: f.parts_ir, parts_trimf: f.parts_trimf, regime_rc: f.regime_rc === "" ? null : f.regime_rc === "1", mode_ir: f.mode_ir, arrondi_net: f.arrondi_net,
        variables: { heures_sup: hs, absences, gains, retenues },
      };
      if (!f.employe_id) corps.annees_anciennete = f.annees_anciennete;
      setRes(await api.paieSimuler(corps));
    } catch (e) { s.ko(e); setRes(null); }
  }

  const b = res && res.bulletin;
  const rubGains = rubs.filter((r) => r.actif && r.sens !== "RETENUE");
  const rubRetenues = rubs.filter((r) => r.actif && r.sens === "RETENUE");
  const bouton = (libelle, fn) => <button style={boutonLeger} onClick={fn}>{libelle}</button>;
  const ligneStyle = { display: "flex", gap: 8, alignItems: "center", marginBottom: 6, flexWrap: "wrap" };

  return (
    <AppShell title={t("paieSimTitre")} subNav={<PaieSousNav />}>
      <p style={{ fontSize: 12.5, color: "var(--sub)", marginBottom: 14, maxWidth: 780, lineHeight: 1.5 }}>{t("paieSimAide")}</p>
      <Statut s={s} />
      <div style={{ display: "grid", gridTemplateColumns: "minmax(320px, 420px) 1fr", gap: 14, alignItems: "start" }} className="paie-sim">
        <div style={{ display: "grid", gap: 12 }}>
          <Section titre={t("paieSimSalarie")}>
            <div style={{ display: "grid", gap: 10 }}>
              <Champ label={t("paieSalarie")}>
                <select style={inputStyle} value={f.employe_id} onChange={maj("employe_id")}>
                  <option value="">{t("paieSimLibre")}</option>
                  {salaries.map((x) => <option key={x.id} value={x.id}>{x.nom} {x.prenom}</option>)}
                </select>
              </Champ>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                <Champ label={t("paieMois")}>
                  <select style={inputStyle} value={f.mois} onChange={maj("mois")}>{MOIS_FR.slice(1).map((m, i) => <option key={m} value={i + 1}>{m}</option>)}</select>
                </Champ>
                <Champ label={t("paieAnnee")}><input type="number" style={inputStyle} value={f.annee} onChange={maj("annee")} /></Champ>
              </div>
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
                <Champ label={t("paiePartsIr")}>
                  <select style={inputStyle} value={f.parts_ir} onChange={maj("parts_ir")}>{[1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5].map((p) => <option key={p} value={p}>{p}</option>)}</select>
                </Champ>
                <Champ label={t("paiePartsTrimf")}>
                  <select style={inputStyle} value={f.parts_trimf} onChange={maj("parts_trimf")}>{[1, 2, 3, 4, 5, 6].map((p) => <option key={p} value={p}>{p}</option>)}</select>
                </Champ>
                {!f.employe_id && <Champ label={t("paieAnneesAnciennete")}><input type="number" style={inputStyle} value={f.annees_anciennete} onChange={maj("annees_anciennete")} /></Champ>}
                <Champ label={t("paieRegimeRc")}>
                  <select style={inputStyle} value={f.regime_rc} onChange={maj("regime_rc")}><option value="">{t("paieRcAuto")}</option><option value="1">{t("paieRcOui")}</option><option value="0">{t("paieRcNon")}</option></select>
                </Champ>
                <Champ label={t("paieGenModeIr")}>
                  <select style={inputStyle} value={f.mode_ir} onChange={maj("mode_ir")}><option value="BAREME">{t("paieGenIrBareme")}</option><option value="FORMULE">{t("paieGenIrFormule")}</option></select>
                </Champ>
              </div>
            </div>
          </Section>

          <Section titre={t("paieSimVariables")} aide={t("paieSimVariablesAide")}>
            <h4 style={{ fontSize: 12, margin: "0 0 6px" }}>{t("paieSimHs")}</h4>
            {hs.map((l, i) => (
              <div key={i} style={ligneStyle}>
                <select style={{ ...inputStyle, flex: "1 1 200px", minWidth: 0 }} value={l.code} onChange={(e) => majLigne(hs, setHs, i, "code", e.target.value)}>{majs.map((m) => <option key={m.code} value={m.code}>{libelleHs(m)}</option>)}</select>
                <input type="number" step="0.01" style={{ ...inputStyle, width: 90 }} value={l.heures} onChange={(e) => majLigne(hs, setHs, i, "heures", e.target.value)} placeholder={t("paieHeures")} />
                <button style={boutonDanger} onClick={() => setHs(hs.filter((_, j) => j !== i))}>×</button>
              </div>
            ))}
            {bouton(`+ ${t("paieSimAjouterHs")}`, () => setHs([...hs, { code: majs[0] ? majs[0].code : "", heures: "" }]))}
            <h4 style={{ fontSize: 12, margin: "14px 0 6px" }}>{t("paieSimAbsences")}</h4>
            {absences.map((l, i) => (
              <div key={i} style={ligneStyle}>
                <select style={{ ...inputStyle, width: 170 }} value={l.type} onChange={(e) => majLigne(absences, setAbsences, i, "type", e.target.value)}>{abs.filter((a) => a.actif).map((a) => <option key={a.code} value={a.code}>{a.libelle}</option>)}</select>
                <input type="number" step="0.5" style={{ ...inputStyle, width: 90 }} value={l.jours} onChange={(e) => majLigne(absences, setAbsences, i, "jours", e.target.value)} placeholder={t("paieJours")} />
                <button style={boutonDanger} onClick={() => setAbsences(absences.filter((_, j) => j !== i))}>×</button>
              </div>
            ))}
            {bouton(`+ ${t("paieSimAjouterAbsence")}`, () => setAbsences([...absences, { type: abs[0] ? abs[0].code : "", jours: "" }]))}
            <h4 style={{ fontSize: 12, margin: "14px 0 6px" }}>{t("paieSimGains")}</h4>
            {gains.map((l, i) => (
              <div key={i} style={ligneStyle}>
                <select style={{ ...inputStyle, width: 170 }} value={l.rubrique_code} onChange={(e) => { const r = rubs.find((x) => x.code === e.target.value); setGains(gains.map((g, j) => (j === i ? { ...g, rubrique_code: e.target.value, montant: r && r.montant_defaut != null ? String(r.montant_defaut) : g.montant } : g))); }}>
                  {rubGains.map((r) => <option key={r.code} value={r.code}>{r.libelle}</option>)}
                </select>
                <input type="number" style={{ ...inputStyle, width: 100 }} value={l.montant} onChange={(e) => majLigne(gains, setGains, i, "montant", e.target.value)} placeholder={t("paieMontant")} />
                <input type="number" step="0.01" style={{ ...inputStyle, width: 80 }} value={l.quantite} onChange={(e) => majLigne(gains, setGains, i, "quantite", e.target.value)} placeholder={t("paieQuantite")} />
                <button style={boutonDanger} onClick={() => setGains(gains.filter((_, j) => j !== i))}>×</button>
              </div>
            ))}
            {bouton(`+ ${t("paieSimAjouterGain")}`, () => setGains([...gains, { rubrique_code: rubGains[0] ? rubGains[0].code : "", montant: rubGains[0] && rubGains[0].montant_defaut != null ? String(rubGains[0].montant_defaut) : "", quantite: "" }]))}
            <h4 style={{ fontSize: 12, margin: "14px 0 6px" }}>{t("paieSimRetenues")}</h4>
            {retenues.map((l, i) => (
              <div key={i} style={ligneStyle}>
                <select style={{ ...inputStyle, width: 170 }} value={l.rubrique_code} onChange={(e) => majLigne(retenues, setRetenues, i, "rubrique_code", e.target.value)}>{rubRetenues.map((r) => <option key={r.code} value={r.code}>{r.libelle}</option>)}</select>
                <input type="number" style={{ ...inputStyle, width: 100 }} value={l.montant} onChange={(e) => majLigne(retenues, setRetenues, i, "montant", e.target.value)} placeholder={t("paieMontant")} />
                <button style={boutonDanger} onClick={() => setRetenues(retenues.filter((_, j) => j !== i))}>×</button>
              </div>
            ))}
            {bouton(`+ ${t("paieSimAjouterRetenue")}`, () => setRetenues([...retenues, { rubrique_code: rubRetenues[0] ? rubRetenues[0].code : "", montant: "" }]))}
          </Section>
          <button style={{ ...boutonPrincipal, padding: "11px 16px", fontSize: 13.5 }} onClick={simuler}>{t("paieSimCalculer")}</button>
        </div>

        <div style={{ minWidth: 0 }}>
          {!b ? <div className="card"><p style={{ fontSize: 12.5, color: "var(--sub)", margin: 0 }}>{t("paieSimVide")}</p></div> : <BulletinVue b={b} t={t} />}
        </div>
      </div>
      <style>{`@media (max-width: 900px) { .paie-sim { grid-template-columns: 1fr !important; } }`}</style>
    </AppShell>
  );
}

export default function SimulateurPaiePage() {
  return (
    <Suspense fallback={null}>
      <Contenu />
    </Suspense>
  );
}
