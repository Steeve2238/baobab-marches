"use client";

import { useEffect, useState } from "react";
import { api } from "../../../lib/api";
import { useLangue } from "../../../lib/i18n/LanguageContext";
import AppShell from "../../../lib/components/AppShell";
import PaieSousNav from "../../../lib/components/PaieSousNav";
import { Champ, Pastille, inputStyle, boutonPrincipal, boutonLeger, boutonDanger, cellule, enteteCellule, droite, fmt, fmtDec, useStatut, Statut } from "../../../lib/components/paieUi";

function finMoisPrecedent() {
  const d = new Date();
  return new Date(Date.UTC(d.getFullYear(), d.getMonth(), 0)).toISOString().slice(0, 10);
}
const dfr = (d) => (d ? `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}` : "");
const num = (v) => (v === "" || v == null ? null : Number(v));
const mini = { ...inputStyle, padding: "3px 6px", fontSize: 12, textAlign: "right" };

function Ligne({ l, arrete, droit, t, onSave, onDelete }) {
  const [v, setV] = useState({ brut: l.brut_source === "SAISI" ? String(l.brut_12m) : "", mois: l.nb_mois_saisi ? String(l.nb_mois) : "", client: l.indemnite_client == null ? "" : String(l.indemnite_client) });
  useEffect(() => setV({ brut: l.brut_source === "SAISI" ? String(l.brut_12m) : "", mois: l.nb_mois_saisi ? String(l.nb_mois) : "", client: l.indemnite_client == null ? "" : String(l.indemnite_client) }), [l]);
  const sauver = () => onSave({ date_arrete: arrete, employe_id: l.employe_id || undefined, id: l.ligne_id || undefined, matricule: l.matricule, nom: l.nom, date_entree: l.date_entree, brut_12m: num(v.brut), nb_mois: num(v.mois), indemnite_client: num(v.client) });
  const edite = (k, ph) => <input type="number" disabled={!droit} style={{ ...mini, width: k === "mois" ? 56 : 108 }} value={v[k]} placeholder={ph} onChange={(e) => setV({ ...v, [k]: e.target.value })} onBlur={sauver} />;
  return (
    <tr>
      <td style={cellule}>{l.matricule}</td>
      <td style={cellule}>{dfr(l.date_entree)}</td>
      <td style={{ ...cellule, whiteSpace: "nowrap" }}>{l.nom}{l.source === "LIBRE" && <span style={{ color: "var(--sub)", fontSize: 11 }}> (hors paie)</span>}{l.alertes.length > 0 && <span title={l.alertes.map((a) => t(`paieProvAlerte_${a}`)).join(" ")} style={{ color: "var(--ocre)", marginLeft: 6, cursor: "help" }}>⚠</span>}</td>
      <td style={{ ...cellule, ...droite }}>{edite("brut", l.brut_12m == null ? "" : fmt(l.brut_12m))}</td>
      <td style={{ ...cellule, ...droite }}>{edite("mois", fmtDec(l.nb_mois_auto, 2))}</td>
      <td style={{ ...cellule, ...droite }}>{l.base_mensuelle == null ? "" : fmt(l.base_mensuelle)}</td>
      <td style={{ ...cellule, ...droite }}>{l.anciennete_jours}</td>
      <td style={{ ...cellule, ...droite }}>{fmtDec(l.anciennete_ans, 2)}</td>
      {l.tranches.map((x, i) => <td key={i} style={{ ...cellule, ...droite, color: x.annees ? undefined : "var(--sub)" }}>{x.annees ? fmtDec(x.annees, 2) : ""}</td>)}
      <td style={{ ...cellule, ...droite, fontWeight: 700 }}>{l.indemnite == null ? "" : fmt(l.indemnite)}</td>
      <td style={{ ...cellule, ...droite }}>{edite("client", "")}</td>
      <td style={{ ...cellule, ...droite, color: l.ecart ? "var(--brique)" : undefined }}>{l.ecart == null ? "" : fmt(l.ecart)}</td>
      <td style={cellule}>{droit && l.ligne_id && <button style={{ ...boutonDanger, padding: "2px 8px" }} title={l.source === "LIBRE" ? "" : t("paieProvReinit")} onClick={() => onDelete(l.ligne_id)}>×</button>}</td>
    </tr>
  );
}

export default function ProvisionRetraitePage() {
  const { t, langue } = useLangue();
  const [q, setQ] = useState({ date_arrete: finMoisPrecedent(), base: "IMPOSABLE", bareme_id: "", prepare_par: "" });
  const [e, setE] = useState(null);
  const [baremes, setBaremes] = useState(null);
  const [nouveau, setNouveau] = useState(null);
  const s = useStatut();

  const params = () => Object.fromEntries(Object.entries(q).filter(([, v]) => v));
  const charger = () => {
    s.raz();
    api.paieBaremesRetraite().then((r) => setBaremes(r)).catch(s.ko);
    api.paieProvision(params()).then(setE).catch((err) => { setE(null); s.ko(err); });
  };
  useEffect(charger, [q.date_arrete, q.base, q.bareme_id]); // eslint-disable-line react-hooks/exhaustive-deps

  const droit = baremes ? baremes.droit_validation : false;
  async function sauver(d) { try { await api.paieSauverProvisionLigne(d); charger(); } catch (err) { s.ko(err); } }
  async function supprimer(id) { try { await api.paieSupprimerProvisionLigne(id); charger(); } catch (err) { s.ko(err); } }
  async function modele() { try { await api.paieModeleBaremeRetraite(); charger(); } catch (err) { s.ko(err); } }
  const tr = e ? e.bareme.tranches : [];

  return (
    <AppShell title={t("paieProvTitre")} subNav={<PaieSousNav />}>
      <p style={{ fontSize: 12.5, color: "var(--sub)", marginBottom: 14, maxWidth: 860, lineHeight: 1.5 }}>{t("paieProvAide")}</p>
      <Statut s={s} />
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "end", marginBottom: 14 }}>
        <Champ label={t("paieProvArrete")}><input type="date" style={inputStyle} value={q.date_arrete} onChange={(x) => setQ({ ...q, date_arrete: x.target.value })} /></Champ>
        <Champ label={t("paieProvBase")}>
          <select style={inputStyle} value={q.base} onChange={(x) => setQ({ ...q, base: x.target.value })}>
            <option value="IMPOSABLE">{t("paieProvBaseImposable")}</option>
            <option value="BRUT">{t("paieProvBaseBrut")}</option>
          </select>
        </Champ>
        <Champ label={t("paieRetraiteBareme")}>
          <select style={inputStyle} value={q.bareme_id} onChange={(x) => setQ({ ...q, bareme_id: x.target.value })}>
            <option value="">{t("paieRetraiteBaremeAuto")}</option>
            {(baremes ? baremes.baremes : []).map((b) => <option key={b.id} value={b.id}>{b.libelle}</option>)}
          </select>
        </Champ>
        <Champ label={t("paieProvPrepare")}><input style={inputStyle} value={q.prepare_par} onChange={(x) => setQ({ ...q, prepare_par: x.target.value })} /></Champ>
        <button style={boutonLeger} onClick={charger}>{t("paieProvCalculer")}</button>
        {e && <button style={boutonLeger} onClick={() => api.paieOuvrirProvisionPdf(params()).catch(s.ko)}>{t("paieEtatsPdf")}</button>}
        {e && <button style={boutonPrincipal} onClick={() => api.paieExporterProvision(params(), langue).catch(s.ko)}>{t("paieExporterEtats")}</button>}
      </div>

      {baremes && baremes.baremes.length === 0 && droit && (
        <div className="card" style={{ marginBottom: 14 }}>
          <p style={{ fontSize: 12.5, margin: "0 0 8px" }}>{t("paieProvModeleAide")}</p>
          <button style={boutonPrincipal} onClick={modele}>{t("paieProvModele")}</button>
        </div>
      )}

      {e && (
        <>
          <p style={{ fontSize: 12, color: "var(--sub)", margin: "0 0 8px" }}>{e.bareme.libelle} — {tr.map((x) => `${x.de_annees}→${x.a_annees == null ? "∞" : x.a_annees} : ${x.pourcentage_par_an} %`).join("  ·  ")}{e.bareme.plafond_mois != null ? `  ·  ${t("paieRetraitePlafond")} ${e.bareme.plafond_mois} ${t("paieRetraiteMois")}` : ""}</p>
          <div className="card" style={{ padding: 0, overflowX: "auto" }}>
            <table style={{ borderCollapse: "collapse", width: "100%", minWidth: 1280 }}>
              <thead>
                <tr>
                  <th style={enteteCellule}>{t("paieProvMle")}</th><th style={enteteCellule}>{t("paieProvEntree")}</th><th style={enteteCellule}>{t("paieSalarie")}</th>
                  <th style={{ ...enteteCellule, ...droite }}>{t("paieProvBrut12")}</th><th style={{ ...enteteCellule, ...droite }}>{t("paieProvMois")}</th><th style={{ ...enteteCellule, ...droite }}>{t("paieProvMensuel")}</th>
                  <th style={{ ...enteteCellule, ...droite }}>{t("paieProvJours")}</th><th style={{ ...enteteCellule, ...droite }}>{t("paieProvAns")}</th>
                  {tr.map((x, i) => <th key={i} style={{ ...enteteCellule, ...droite }}>T{i + 1} ({x.pourcentage_par_an} %)</th>)}
                  <th style={{ ...enteteCellule, ...droite }}>{t("paieProvIndemnite")}</th><th style={{ ...enteteCellule, ...droite }}>{t("paieProvClient")}</th><th style={{ ...enteteCellule, ...droite }}>{t("paieProvEcart")}</th><th style={enteteCellule}></th>
                </tr>
              </thead>
              <tbody>
                {e.lignes.length === 0 && <tr><td colSpan={12 + tr.length} style={{ ...cellule, color: "var(--sub)" }}>{t("paieProvAucun")}</td></tr>}
                {e.lignes.map((l) => <Ligne key={(l.employe_id || l.ligne_id) + e.date_arrete} l={l} arrete={e.date_arrete} droit={droit} t={t} onSave={sauver} onDelete={supprimer} />)}
                <tr style={{ fontWeight: 700 }}>
                  <td style={cellule} colSpan={3}>{t("paieProvTotal")} ({e.totaux.nb})</td><td style={{ ...cellule, ...droite }}>{fmt(e.totaux.brut_12m)}</td>
                  <td style={cellule} colSpan={4 + tr.length}></td>
                  <td style={{ ...cellule, ...droite }}>{fmt(e.totaux.indemnite)}</td><td style={{ ...cellule, ...droite }}>{e.totaux.indemnite_client ? fmt(e.totaux.indemnite_client) : ""}</td>
                  <td style={{ ...cellule, ...droite }}>{e.totaux.ecart == null ? "" : fmt(e.totaux.ecart)}</td><td style={cellule}></td>
                </tr>
              </tbody>
            </table>
          </div>
          {e.lignes.some((l) => l.alertes.length > 0) && <div style={{ fontSize: 12, color: "var(--ocre)", margin: "10px 0" }}>{e.lignes.filter((l) => l.alertes.length > 0).map((l) => <div key={(l.ligne_id || l.employe_id || l.matricule) + "a"}>⚠ {l.matricule} {l.nom} : {l.alertes.map((a) => t(`paieProvAlerte_${a}`)).join(" ")}</div>)}</div>}
          <p style={{ fontSize: 11.5, color: "var(--sub)", margin: "10px 0", maxWidth: 900, lineHeight: 1.5 }}>{t("paieProvMethode")}</p>
          {droit && !nouveau && <button style={boutonLeger} onClick={() => setNouveau({ matricule: "", nom: "", date_entree: "", brut_12m: "", indemnite_client: "" })}>{t("paieProvAjouter")}</button>}
          {droit && nouveau && (
            <div className="card" style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "end", marginTop: 8 }}>
              <Champ label={t("paieProvMle")}><input style={{ ...inputStyle, width: 90 }} value={nouveau.matricule} onChange={(x) => setNouveau({ ...nouveau, matricule: x.target.value })} /></Champ>
              <Champ label={t("paieSalarie")}><input style={inputStyle} value={nouveau.nom} onChange={(x) => setNouveau({ ...nouveau, nom: x.target.value })} /></Champ>
              <Champ label={t("paieProvEntree")}><input type="date" style={inputStyle} value={nouveau.date_entree} onChange={(x) => setNouveau({ ...nouveau, date_entree: x.target.value })} /></Champ>
              <Champ label={t("paieProvBrut12")}><input type="number" style={{ ...inputStyle, width: 130 }} value={nouveau.brut_12m} onChange={(x) => setNouveau({ ...nouveau, brut_12m: x.target.value })} /></Champ>
              <Champ label={t("paieProvClient")}><input type="number" style={{ ...inputStyle, width: 130 }} value={nouveau.indemnite_client} onChange={(x) => setNouveau({ ...nouveau, indemnite_client: x.target.value })} /></Champ>
              <button style={boutonPrincipal} onClick={async () => { await sauver({ ...nouveau, date_arrete: e.date_arrete, brut_12m: num(nouveau.brut_12m), indemnite_client: num(nouveau.indemnite_client) }); setNouveau(null); }}>{t("paieEnregistrer")}</button>
              <button style={boutonLeger} onClick={() => setNouveau(null)}>{t("paieAnnuler")}</button>
            </div>
          )}
        </>
      )}
    </AppShell>
  );
}
