"use client";

import { useEffect, useMemo, useState } from "react";
import { api } from "../../../lib/api";
import { useLangue } from "../../../lib/i18n/LanguageContext";
import AppShell from "../../../lib/components/AppShell";
import ComptaSousNav from "../../../lib/components/ComptaSousNav";
import { labelStyle, inputStyle, boutonPrincipalStyle, boutonSecondaireStyle, boutonDangerStyle, thStyle, tdStyle, numStyle, formaterMontant, centimes } from "../../../lib/comptaUi";

const sub = (txt, vars) => String(txt).replace(/\{(\w+)\}/g, (_, k) => (vars && vars[k] !== undefined ? vars[k] : `{${k}}`));
const aujourdhui = () => new Date().toISOString().slice(0, 10);

// Remise de cheques en banque : portefeuille des cheques (compte d'attente) -> bordereau -> ecriture banque / attente.
export default function RemisesBanquePage() {
  const { t } = useLangue();
  const locale = t("dateLocale");
  const m = (v) => formaterMontant(v, locale);
  const [pf, setPf] = useState({ parametre: true, cheques: [], total: 0 });
  const [remises, setRemises] = useState([]);
  const [journaux, setJournaux] = useState([]);
  const [sel, setSel] = useState({});
  const [form, setForm] = useState({ date_remise: aujourdhui(), journal_id: "", reference: "" });
  const [erreur, setErreur] = useState("");
  const [info, setInfo] = useState("");
  const [envoi, setEnvoi] = useState(false);

  function charger() {
    api.comptaCheques().then(setPf).catch((e) => setErreur(e.message));
    api.comptaRemisesBanque().then((r) => setRemises(r.remises || [])).catch(() => {});
  }
  useEffect(() => {
    charger();
    api.comptaJournaux().then((j) => {
      const banques = (Array.isArray(j) ? j : j.journaux || []).filter((x) => x.type_journal === "BANQUE" && x.actif !== false);
      setJournaux(banques);
      if (banques[0]) setForm((f) => ({ ...f, journal_id: banques[0].id }));
    }).catch(() => {});
  }, []);

  const ids = Object.keys(sel).filter((k) => sel[k]);
  const totalSelC = useMemo(() => pf.cheques.filter((c) => sel[c.ligne_id]).reduce((s, c) => s + centimes(c.montant), 0), [pf, sel]);

  async function remettre() {
    if (!window.confirm(t("remConfirmer"))) return;
    setErreur(""); setInfo(""); setEnvoi(true);
    try {
      const r = await api.comptaCreerRemiseBanque({ ...form, ligne_ids: ids });
      setInfo(sub(t("remEnregistree"), { n: r.numero }));
      setSel({});
      setForm((f) => ({ ...f, reference: "" }));
      charger();
    } catch (e) { setErreur(e.message); } finally { setEnvoi(false); }
  }
  async function annuler(r) {
    if (!window.confirm(t("remAnnulerConfirm"))) return;
    setErreur(""); setInfo("");
    try { await api.comptaAnnulerRemiseBanque(r.id); setInfo(t("remAnnulee")); charger(); } catch (e) { setErreur(e.message); }
  }
  const toutCocher = (v) => setSel(v ? Object.fromEntries(pf.cheques.map((c) => [c.ligne_id, true])) : {});

  return (
    <AppShell title={t("remTitre")} subNav={<ComptaSousNav />}>
      <p style={{ fontSize: 12, color: "var(--sub)", marginBottom: 12, maxWidth: 780, lineHeight: 1.5 }}>{t("remAide")}</p>
      {erreur && <p style={{ color: "var(--brique)", fontSize: 12.5 }}>{erreur}</p>}
      {info && <p style={{ color: "var(--vert)", fontSize: 12.5 }}>{info}</p>}
      {!pf.parametre && <p style={{ color: "var(--brique)", fontSize: 12.5, maxWidth: 780 }}>{t("remNonParametre")}</p>}

      <h3 style={{ fontSize: 14, margin: "14px 0 8px" }}>{t("remPortefeuille")} — {m(pf.total)} XOF</h3>
      <div className="card" style={{ padding: 0, overflowX: "auto", marginBottom: 14 }}>
        <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 680 }}>
          <thead><tr>
            <th style={thStyle}><input type="checkbox" aria-label={t("remToutSelectionner")} checked={pf.cheques.length > 0 && ids.length === pf.cheques.length} onChange={(e) => toutCocher(e.target.checked)} /></th>
            <th style={thStyle}>{t("remColDate")}</th><th style={thStyle}>{t("remColLibelle")}</th><th style={thStyle}>{t("remColReference")}</th><th style={thStyle}>{t("remColCompte")}</th><th style={{ ...thStyle, textAlign: "right" }}>{t("remColMontant")}</th>
          </tr></thead>
          <tbody>
            {pf.cheques.length === 0 && <tr><td style={tdStyle} colSpan={6}>{t("remAucunCheque")}</td></tr>}
            {pf.cheques.map((c) => (
              <tr key={c.ligne_id}>
                <td style={tdStyle}><input type="checkbox" checked={!!sel[c.ligne_id]} onChange={(e) => setSel((s) => ({ ...s, [c.ligne_id]: e.target.checked }))} /></td>
                <td style={tdStyle}>{c.date}</td><td style={tdStyle}>{c.libelle}</td><td style={tdStyle}>{c.reference}</td><td style={tdStyle}>{c.compte}</td>
                <td style={{ ...tdStyle, ...numStyle }}>{m(c.montant)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {pf.cheques.length > 0 && (
        <div className="card" style={{ padding: 14, marginBottom: 20, display: "flex", gap: 14, flexWrap: "wrap", alignItems: "flex-end" }}>
          <div><label style={labelStyle}>{t("remDateRemise")}</label><input type="date" value={form.date_remise} onChange={(e) => setForm((f) => ({ ...f, date_remise: e.target.value }))} style={{ ...inputStyle, width: 160 }} /></div>
          <div><label style={labelStyle}>{t("remJournal")}</label>
            <select value={form.journal_id} onChange={(e) => setForm((f) => ({ ...f, journal_id: e.target.value }))} style={{ ...inputStyle, width: 220 }}>
              {journaux.map((j) => <option key={j.id} value={j.id}>{j.code} — {j.libelle}</option>)}
            </select></div>
          <div><label style={labelStyle}>{t("remReference")}</label><input value={form.reference} onChange={(e) => setForm((f) => ({ ...f, reference: e.target.value }))} style={{ ...inputStyle, width: 180 }} /></div>
          <div style={{ fontSize: 12.5, fontWeight: 600 }}>{sub(t("remSelection"), { n: ids.length, m: m(totalSelC / 100) })}</div>
          <button type="button" disabled={envoi || ids.length === 0 || !form.journal_id} onClick={remettre} style={{ ...boutonPrincipalStyle, opacity: envoi || ids.length === 0 ? 0.5 : 1 }}>{t("remRemettre")}</button>
        </div>
      )}

      <h3 style={{ fontSize: 14, margin: "6px 0 8px" }}>{t("remHistorique")}</h3>
      <div className="card" style={{ padding: 0, overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 680 }}>
          <thead><tr>
            <th style={thStyle}>{t("remColNumero")}</th><th style={thStyle}>{t("remColDate")}</th><th style={thStyle}>{t("remColReference")}</th><th style={thStyle}>{t("remColNb")}</th><th style={thStyle}>{t("remColBanque")}</th><th style={{ ...thStyle, textAlign: "right" }}>{t("remColMontant")}</th><th style={thStyle}>{t("remColStatut")}</th><th style={thStyle} />
          </tr></thead>
          <tbody>
            {remises.length === 0 && <tr><td style={tdStyle} colSpan={8}>{t("remAucune")}</td></tr>}
            {remises.map((r) => (
              <tr key={r.id} style={{ opacity: r.statut === "ANNULEE" ? 0.5 : 1 }}>
                <td style={tdStyle}>{r.numero}</td><td style={tdStyle}>{r.date_remise}</td><td style={tdStyle}>{r.reference}</td><td style={tdStyle}>{r.nb_cheques}</td><td style={tdStyle}>{r.compte_banque}</td>
                <td style={{ ...tdStyle, ...numStyle }}>{m(r.montant)}</td>
                <td style={tdStyle}>{t(r.statut === "ANNULEE" ? "remStAnnulee" : "remStEnregistree")}</td>
                <td style={tdStyle}>{r.statut === "ENREGISTREE" && r.ecriture_statut !== "VALIDEE" && <button type="button" onClick={() => annuler(r)} style={{ ...boutonDangerStyle, padding: "3px 10px", fontSize: 11.5 }}>{t("remAnnuler")}</button>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </AppShell>
  );
}
