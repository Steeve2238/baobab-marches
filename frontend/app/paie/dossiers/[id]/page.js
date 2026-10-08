"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { api } from "../../../../lib/api";
import { useLangue } from "../../../../lib/i18n/LanguageContext";
import AppShell from "../../../../lib/components/AppShell";
import PaieSousNav from "../../../../lib/components/PaieSousNav";
import { Champ, Section, grille, inputStyle, boutonPrincipal, boutonLeger, boutonDanger, cellule, enteteCellule, droite, fmt, fmtDec, Pastille, useStatut, Statut, aujourdhui } from "../../../../lib/components/paieUi";

export default function DossierPaiePage() {
  const { t } = useLangue();
  const { id } = useParams();
  const [data, setData] = useState(null);
  const [rubs, setRubs] = useState([]);
  const [f, setF] = useState(null);
  const [el, setEl] = useState({ rubrique_code: "", montant: "", quantite: "", date_debut: aujourdhui(), date_fin: "" });
  const sd = useStatut();
  const se = useStatut();

  const charger = () =>
    api.paieDossier(id).then((d) => {
      setData(d);
      const x = d.dossier || {};
      setF({
        convention_id: x.convention_id || "", categorie_code: x.categorie_code || "", salaire_base_manuel: x.salaire_base_manuel ?? "", sursalaire: x.sursalaire ?? 0,
        regime_rc: x.regime_rc == null ? "" : x.regime_rc ? "1" : "0", date_anciennete: x.date_anciennete || "", actif_paie: x.actif_paie !== false, notes: x.notes || "",
      });
    }).catch(sd.ko);
  useEffect(() => { charger(); api.paieRubriques().then(setRubs).catch(() => {}); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [id]);

  if (!data || !f) return <AppShell title={t("paieDossierTitre")} subNav={<PaieSousNav />}><p style={{ fontSize: 12.5, color: "var(--sub)" }}>{sd.erreur || t("loading")}</p></AppShell>;
  const { employe, parts } = data;
  const grilleConv = f.convention_id ? data.grilles[f.convention_id] || [] : [];
  const cat = grilleConv.find((g) => g.code === f.categorie_code);
  const maj = (k) => (e) => setF({ ...f, [k]: e.target.type === "checkbox" ? e.target.checked : e.target.value });
  const libRub = (code) => (rubs.find((r) => r.code === code) || {}).libelle || code;

  async function enregistrer() {
    try {
      await api.paieEnregistrerDossier(id, { ...f, convention_id: f.convention_id || null, categorie_code: f.categorie_code || null, regime_rc: f.regime_rc === "" ? null : f.regime_rc === "1", date_anciennete: f.date_anciennete || null });
      sd.ok(t("paieEnregistre")); charger();
    } catch (e) { sd.ko(e); }
  }
  async function ajouter() {
    try {
      await api.paieAjouterElement(id, el);
      se.ok(t("paieEnregistre")); setEl({ rubrique_code: "", montant: "", quantite: "", date_debut: aujourdhui(), date_fin: "" }); charger();
    } catch (e) { se.ko(e); }
  }
  async function terminer(x) {
    try { await api.paieModifierElement(x.id, { date_fin: aujourdhui() }); se.ok(t("paieEnregistre")); charger(); } catch (e) { se.ko(e); }
  }
  async function supprimer(x) {
    if (!window.confirm(t("paieConfirmSuppr"))) return;
    try { await api.paieSupprimerElement(x.id); se.ok(t("paieSupprime")); charger(); } catch (e) { se.ko(e); }
  }
  const rubChoisie = rubs.find((r) => r.code === el.rubrique_code);
  const rubsProposees = rubs.filter((r) => r.actif && r.mode !== "VARIABLE");

  return (
    <AppShell title={`${employe.nom || ""} ${employe.prenom || ""}`.trim()} subNav={<PaieSousNav />} backHref="/paie/dossiers" backLabelKey="paieNavDossiers">
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center", marginBottom: 14, fontSize: 12.5 }}>
        <span className="mono">{employe.matricule}</span>
        <span style={{ color: "var(--sub)" }}>{employe.poste || ""}</span>
        <span style={{ color: "var(--sub)" }}>{t("paieEmbauche")} {employe.date_embauche || "—"}</span>
        <span style={{ flex: 1 }} />
        <Link href={`/paie/simulateur?employe=${id}`} style={boutonLeger}>{t("paieSimulerSalarie")}</Link>
        <Link href={`/rh/personnel/${id}`} style={boutonLeger}>{t("paieVoirFiche")}</Link>
      </div>

      <div style={{ display: "grid", gap: 14 }}>
        <Section titre={t("paieRemunTitre")} aide={t("paieRemunAide")}>
          <Statut s={sd} />
          <div style={grille}>
            <Champ label={t("paieConvention")}>
              <select style={inputStyle} value={f.convention_id} onChange={(e) => setF({ ...f, convention_id: e.target.value, categorie_code: "" })}>
                <option value="">—</option>
                {data.conventions.map((c) => <option key={c.id} value={c.id}>{c.libelle}</option>)}
              </select>
            </Champ>
            <Champ label={t("paieCategorie")}>
              <select style={inputStyle} value={f.categorie_code} onChange={maj("categorie_code")} disabled={!f.convention_id}>
                <option value="">—</option>
                {grilleConv.map((g) => <option key={g.code} value={g.code}>{g.libelle} — {fmt(g.salaire_base)} F</option>)}
              </select>
            </Champ>
            <Champ label={t("paieSalaireGrille")}><input style={{ ...inputStyle, background: "var(--line-soft)" }} value={cat ? `${fmt(cat.salaire_base)} F (${t(`paieClassif_${cat.classification}`)})` : "—"} disabled /></Champ>
            <Champ label={t("paieSalaireManuel")}><input type="number" style={inputStyle} value={f.salaire_base_manuel} onChange={maj("salaire_base_manuel")} placeholder={t("paieSalaireManuelAide")} /></Champ>
            <Champ label={t("paieSursalaire")}><input type="number" style={inputStyle} value={f.sursalaire} onChange={maj("sursalaire")} /></Champ>
            <Champ label={t("paieRegimeRc")}>
              <select style={inputStyle} value={f.regime_rc} onChange={maj("regime_rc")}>
                <option value="">{t("paieRcAuto")}</option>
                <option value="1">{t("paieRcOui")}</option>
                <option value="0">{t("paieRcNon")}</option>
              </select>
            </Champ>
            <Champ label={t("paieDateAnciennete")}><input type="date" style={inputStyle} value={f.date_anciennete} onChange={maj("date_anciennete")} /></Champ>
          </div>
          <label style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 12.5, marginTop: 12 }}><input type="checkbox" checked={f.actif_paie} onChange={maj("actif_paie")} />{t("paieActifPaie")}</label>
          <div style={{ marginTop: 12 }}><button style={boutonPrincipal} onClick={enregistrer}>{t("paieEnregistrer")}</button></div>
        </Section>

        <Section titre={t("paiePartsTitre")} aide={t("paiePartsAide")}>
          <div style={{ display: "flex", gap: 24, flexWrap: "wrap", fontSize: 13 }}>
            <div><div style={{ fontSize: 11, color: "var(--sub)" }}>{t("paiePartsIr")}</div><b style={{ fontSize: 18 }}>{fmtDec(parts.parts_ir, 1)}</b>{parts.manuel_ir && <> <Pastille ton="alerte">{t("paieManuel")}</Pastille></>}</div>
            <div><div style={{ fontSize: 11, color: "var(--sub)" }}>{t("paiePartsTrimf")}</div><b style={{ fontSize: 18 }}>{fmtDec(parts.parts_trimf, 1)}</b>{parts.manuel_trimf && <> <Pastille ton="alerte">{t("paieManuel")}</Pastille></>}</div>
            <div><div style={{ fontSize: 11, color: "var(--sub)" }}>{t("paieEnfantsCharge")}</div><b style={{ fontSize: 18 }}>{parts.enfants_a_charge}</b></div>
          </div>
        </Section>

        <Section titre={t("paieElementsTitre")} aide={t("paieElementsAide")}>
          <Statut s={se} />
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 620 }}>
              <thead><tr><th style={enteteCellule}>{t("paieRubrique")}</th><th style={{ ...enteteCellule, ...droite }}>{t("paieMontant")}</th><th style={{ ...enteteCellule, ...droite }}>{t("paieQuantite")}</th><th style={enteteCellule}>{t("paieDebut")}</th><th style={enteteCellule}>{t("paieFin")}</th><th style={enteteCellule}></th></tr></thead>
              <tbody>
                {data.elements.map((x) => (
                  <tr key={x.id}>
                    <td style={cellule}>{libRub(x.rubrique_code)}</td>
                    <td style={{ ...cellule, ...droite }}>{fmt(x.montant)}</td>
                    <td style={{ ...cellule, ...droite }}>{x.quantite == null ? "—" : fmtDec(x.quantite)}</td>
                    <td style={cellule}>{String(x.date_debut).slice(0, 10)}</td>
                    <td style={cellule}>{x.date_fin ? String(x.date_fin).slice(0, 10) : <Pastille ton="ok">{t("paieEnCours")}</Pastille>}</td>
                    <td style={{ ...cellule, whiteSpace: "nowrap" }}>{!x.date_fin && <button style={boutonLeger} onClick={() => terminer(x)}>{t("paieTerminer")}</button>} <button style={boutonDanger} onClick={() => supprimer(x)}>{t("paieSupprimer")}</button></td>
                  </tr>
                ))}
                {data.elements.length === 0 && <tr><td colSpan={6} style={{ ...cellule, color: "var(--sub)" }}>{t("paieAucunElement")}</td></tr>}
              </tbody>
            </table>
          </div>
          <div style={{ borderTop: "1px solid var(--line-soft)", marginTop: 14, paddingTop: 14 }}>
            <h4 style={{ fontSize: 12.5, margin: "0 0 8px" }}>{t("paieAjouterElement")}</h4>
            <div style={grille}>
              <Champ label={t("paieRubrique")}>
                <select style={inputStyle} value={el.rubrique_code} onChange={(e) => { const r = rubs.find((x) => x.code === e.target.value); setEl({ ...el, rubrique_code: e.target.value, montant: r && r.montant_defaut != null ? String(r.montant_defaut) : el.montant }); }}>
                  <option value="">—</option>
                  {rubsProposees.map((r) => <option key={r.code} value={r.code}>{r.libelle} ({t(`paieRubSens_${r.sens}`)})</option>)}
                </select>
              </Champ>
              <Champ label={rubChoisie && rubChoisie.mode === "QUANTITE" ? t("paieMontantUnitaire") : t("paieMontant")}><input type="number" style={inputStyle} value={el.montant} onChange={(e) => setEl({ ...el, montant: e.target.value })} /></Champ>
              <Champ label={t("paieQuantite")}><input type="number" step="0.01" style={inputStyle} value={el.quantite} onChange={(e) => setEl({ ...el, quantite: e.target.value })} placeholder={rubChoisie && rubChoisie.mode === "QUANTITE" ? t("paieQuantiteAide") : ""} /></Champ>
              <Champ label={t("paieDebut")}><input type="date" style={inputStyle} value={el.date_debut} onChange={(e) => setEl({ ...el, date_debut: e.target.value })} /></Champ>
              <Champ label={t("paieFin")}><input type="date" style={inputStyle} value={el.date_fin} onChange={(e) => setEl({ ...el, date_fin: e.target.value })} /></Champ>
            </div>
            <div style={{ marginTop: 12 }}><button style={boutonPrincipal} onClick={ajouter}>{t("paieAjouter")}</button></div>
          </div>
        </Section>
      </div>
    </AppShell>
  );
}
