"use client";

import { useEffect, useState } from "react";
import { api } from "../../../lib/api";
import { useLangue } from "../../../lib/i18n/LanguageContext";
import AppShell from "../../../lib/components/AppShell";
import { labelStyle, inputStyle, boutonPrincipalStyle, boutonSecondaireStyle, boutonDangerStyle, thStyle, tdStyle } from "../../../lib/comptaUi";

const VIDE = { id: null, code: "", libelle: "", type_mode: "AUTRE", sens: "LES_DEUX", journal_id: "", compte_tresorerie: "", compte_attente: "", commission_pct: "0", compte_commission: "", actif: true };

// Parametrage des modes de reglement : journal / compte de tresorerie, compte d'attente, commission.
export default function ModesReglementPage() {
  const { t } = useLangue();
  const [modes, setModes] = useState([]);
  const [types, setTypes] = useState([]);
  const [sens, setSens] = useState([]);
  const [peut, setPeut] = useState(false);
  const [journaux, setJournaux] = useState([]);
  const [form, setForm] = useState(null);
  const [erreur, setErreur] = useState("");
  const [info, setInfo] = useState("");
  const [envoi, setEnvoi] = useState(false);

  function charger() {
    api.modesReglement().then((r) => {
      setModes(r.modes || []);
      setTypes(r.types || []);
      setSens(r.sens || []);
      setPeut(!!r.peut_parametrer);
    }).catch((e) => setErreur(e.message));
  }
  useEffect(() => {
    charger();
    // Les journaux viennent de la comptabilite : sans ce module, le choix reste automatique.
    api.comptaTresorerieComptes().then((c) => setJournaux((c || []).filter((x) => x.actif))).catch(() => {});
  }, []);

  function editer(m) {
    setErreur(""); setInfo("");
    setForm({ ...VIDE, ...m, journal_id: m.journal_id || "", compte_tresorerie: m.compte_tresorerie || "", compte_attente: m.compte_attente || "", compte_commission: m.compte_commission || "", commission_pct: String(Number(m.commission_pct || 0)) });
  }

  async function enregistrer(e) {
    e.preventDefault();
    setErreur(""); setInfo(""); setEnvoi(true);
    try {
      const corps = { ...form, commission_pct: Number(String(form.commission_pct).replace(",", ".")) || 0, journal_id: form.journal_id || null };
      if (form.id) await api.modifierModeReglement(form.id, corps);
      else await api.creerModeReglement({ ...corps, code: corps.code || corps.libelle });
      setInfo(t("mdrEnregistre"));
      setForm(null);
      charger();
    } catch (err) {
      setErreur(err.message);
    } finally {
      setEnvoi(false);
    }
  }

  async function supprimer(m) {
    if (!window.confirm(t("mdrSupprimerConfirm"))) return;
    setErreur(""); setInfo("");
    try {
      const r = await api.supprimerModeReglement(m.id);
      setInfo(r.desactive ? t("mdrDesactive") : t("mdrSupprime"));
      charger();
    } catch (err) {
      setErreur(err.message);
    }
  }

  const champ = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  return (
    <AppShell title={t("mdrTitre")}>
      <p style={{ fontSize: 12.5, color: "var(--sub)", maxWidth: 780, marginTop: 0 }}>{t("mdrAide")}</p>
      {!peut && <p style={{ fontSize: 12.5, color: "var(--brique)" }}>{t("mdrLecturePour")}</p>}
      {erreur && <p style={{ color: "var(--brique)", fontSize: 13 }}>{erreur}</p>}
      {info && <p style={{ color: "var(--petrol)", fontSize: 13 }}>{info}</p>}

      {peut && !form && (
        <div style={{ marginBottom: 12 }}>
          <button type="button" style={boutonPrincipalStyle} onClick={() => editer({ ...VIDE })}>+ {t("mdrNouveau")}</button>
        </div>
      )}

      {form && (
        <form className="card" onSubmit={enregistrer} style={{ marginBottom: 16 }}>
          <strong style={{ fontSize: 13.5 }}>{form.id ? t("mdrModifier") : t("mdrNouveau")}</strong>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))", gap: 12, marginTop: 12 }}>
            <div>
              <label style={labelStyle}>{t("mdrLibelle")}</label>
              <input required value={form.libelle} onChange={champ("libelle")} style={inputStyle} />
            </div>
            {!form.id && (
              <div>
                <label style={labelStyle}>{t("mdrCode")}</label>
                <input value={form.code} onChange={champ("code")} placeholder="ORANGE_MONEY" style={inputStyle} />
              </div>
            )}
            <div>
              <label style={labelStyle}>{t("mdrType")}</label>
              <select value={form.type_mode} onChange={champ("type_mode")} style={inputStyle}>
                {types.map((x) => <option key={x} value={x}>{t(`mdrType_${x}`)}</option>)}
              </select>
            </div>
            <div>
              <label style={labelStyle}>{t("mdrSens")}</label>
              <select value={form.sens} onChange={champ("sens")} style={inputStyle}>
                {sens.map((x) => <option key={x} value={x}>{t(`mdrSens_${x}`)}</option>)}
              </select>
            </div>
            {journaux.length > 0 && (
              <div>
                <label style={labelStyle}>{t("mdrJournal")}</label>
                <select value={form.journal_id} onChange={champ("journal_id")} style={inputStyle}>
                  <option value="">{t("mdrJournalAuto")}</option>
                  {journaux.map((j) => <option key={j.id} value={j.id}>{j.code} — {j.libelle}</option>)}
                </select>
              </div>
            )}
            <div>
              <label style={labelStyle}>{t("mdrCompteTreso")}</label>
              <input value={form.compte_tresorerie} onChange={champ("compte_tresorerie")} style={inputStyle} />
              <div style={{ fontSize: 11, color: "var(--sub)", marginTop: 3 }}>{t("mdrCompteTresoAide")}</div>
            </div>
            <div>
              <label style={labelStyle}>{t("mdrCompteAttente")}</label>
              <input value={form.compte_attente} onChange={champ("compte_attente")} style={inputStyle} />
              <div style={{ fontSize: 11, color: "var(--sub)", marginTop: 3 }}>{t("mdrCompteAttenteAide")}</div>
            </div>
            <div>
              <label style={labelStyle}>{t("mdrCommission")}</label>
              <input inputMode="decimal" value={form.commission_pct} onChange={champ("commission_pct")} style={{ ...inputStyle, textAlign: "right" }} />
            </div>
            <div>
              <label style={labelStyle}>{t("mdrCompteCommission")}</label>
              <input value={form.compte_commission} onChange={champ("compte_commission")} style={inputStyle} />
            </div>
            <div style={{ display: "flex", alignItems: "flex-end" }}>
              <label style={{ fontSize: 13, display: "flex", gap: 8, alignItems: "center" }}>
                <input type="checkbox" checked={!!form.actif} onChange={(e) => setForm((f) => ({ ...f, actif: e.target.checked }))} />
                {t("mdrActif")}
              </label>
            </div>
          </div>
          <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
            <button type="submit" disabled={envoi} style={boutonPrincipalStyle}>{t("mdrEnregistrer")}</button>
            <button type="button" style={boutonSecondaireStyle} onClick={() => setForm(null)}>{t("mdrAnnuler")}</button>
          </div>
        </form>
      )}

      <div className="card" style={{ padding: 0, overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 760 }}>
          <thead>
            <tr>
              <th style={thStyle}>{t("mdrLibelle")}</th>
              <th style={thStyle}>{t("mdrType")}</th>
              <th style={thStyle}>{t("mdrSens")}</th>
              <th style={thStyle}>{t("mdrJournal")}</th>
              <th style={thStyle}>{t("mdrCompteTreso")}</th>
              <th style={thStyle}>{t("mdrCompteAttente")}</th>
              <th style={{ ...thStyle, textAlign: "right" }}>{t("mdrCommission")}</th>
              <th style={thStyle}></th>
            </tr>
          </thead>
          <tbody>
            {modes.length === 0 && (
              <tr><td style={tdStyle} colSpan={8}>{t("mdrAucun")}</td></tr>
            )}
            {modes.map((m) => (
              <tr key={m.id} style={{ opacity: m.actif ? 1 : 0.5 }}>
                <td style={tdStyle}><strong>{m.libelle}</strong> <span style={{ color: "var(--sub)", fontSize: 11 }}>{m.code}</span></td>
                <td style={tdStyle}>{t(`mdrType_${m.type_mode}`)}</td>
                <td style={tdStyle}>{t(`mdrSens_${m.sens}`)}</td>
                <td style={tdStyle}>{m.journal_code || "—"}</td>
                <td style={tdStyle}>{m.compte_tresorerie || "—"}</td>
                <td style={tdStyle}>{m.compte_attente || "—"}</td>
                <td style={{ ...tdStyle, textAlign: "right" }}>{Number(m.commission_pct) > 0 ? `${Number(m.commission_pct)} %` : "—"}</td>
                <td style={{ ...tdStyle, whiteSpace: "nowrap" }}>
                  {peut && (
                    <>
                      <button type="button" style={{ ...boutonSecondaireStyle, padding: "3px 10px" }} onClick={() => editer(m)}>{t("mdrModifier")}</button>{" "}
                      <button type="button" style={{ ...boutonDangerStyle, padding: "3px 10px" }} onClick={() => supprimer(m)}>{t("mdrSupprimer")}</button>
                    </>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </AppShell>
  );
}
