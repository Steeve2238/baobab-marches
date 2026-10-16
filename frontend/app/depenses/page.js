"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "../../lib/api";
import { useLangue } from "../../lib/i18n/LanguageContext";
import AppShell from "../../lib/components/AppShell";
import ModeReglementSelect from "../../lib/components/ModeReglementSelect";
import { labelStyle, inputStyle, boutonPrincipalStyle, boutonDangerStyle, thStyle, tdStyle, numStyle } from "../../lib/comptaUi";

const fmt = (n) => Math.round(Number(n) || 0).toLocaleString("fr-FR").replace(/[  ]/g, " ");
const sub = (txt, vars) => String(txt).replace(/\{(\w+)\}/g, (_, k) => (vars && vars[k] !== undefined ? vars[k] : `{${k}}`));
const aujourdhui = () => new Date().toISOString().slice(0, 10);
const debutMois = () => aujourdhui().slice(0, 8) + "01";

export default function DepensesPage() {
  const { t } = useLangue();
  const [categories, setCategories] = useState([]);
  const [tauxTva, setTauxTva] = useState(18);
  const [form, setForm] = useState({ date_depense: aujourdhui(), categorie_id: "", libelle: "", beneficiaire: "", montant_ttc: "", avec_tva: false, mode_reglement_id: "", reference: "" });
  const [liste, setListe] = useState({ depenses: [], total_ttc: 0, total_ht: 0 });
  const [filtre, setFiltre] = useState({ du: debutMois(), au: aujourdhui(), categorie_id: "" });
  const [erreur, setErreur] = useState("");
  const [info, setInfo] = useState("");
  const [envoi, setEnvoi] = useState(false);

  const charger = useCallback(() => {
    const p = { du: filtre.du, au: filtre.au };
    if (filtre.categorie_id) p.categorie_id = filtre.categorie_id;
    api.depenses(p).then(setListe).catch((e) => setErreur(e.message));
  }, [filtre]);
  useEffect(() => { charger(); }, [charger]);
  useEffect(() => {
    api.depenseCategories(true).then((r) => setCategories(r.categories || [])).catch((e) => setErreur(e.message));
    api.getEntete().then((e) => { if (e && e.taux_tva_pourcentage != null) setTauxTva(Number(e.taux_tva_pourcentage)); }).catch(() => {});
  }, []);

  async function enregistrer(e) {
    e.preventDefault();
    setErreur(""); setInfo(""); setEnvoi(true);
    try {
      const d = await api.depenseCreer({
        date_depense: form.date_depense, categorie_id: form.categorie_id, libelle: form.libelle, beneficiaire: form.beneficiaire,
        montant_ttc: Number(String(form.montant_ttc).replace(/\s/g, "").replace(",", ".")),
        taux_tva_pourcentage: form.avec_tva ? tauxTva : 0, mode_reglement_id: form.mode_reglement_id, reference: form.reference,
      });
      setInfo(sub(t("depEnregistree"), { n: d.numero }));
      setForm((f) => ({ ...f, libelle: "", beneficiaire: "", montant_ttc: "", reference: "" }));
      charger();
    } catch (err) {
      setErreur(err.message);
    } finally {
      setEnvoi(false);
    }
  }

  async function annuler(d) {
    if (!window.confirm(t("depAnnulerConfirm"))) return;
    try { await api.depenseAnnuler(d.id); charger(); } catch (err) { setErreur(err.message); }
  }

  return (
    <AppShell title={t("depTitre")}>
      <p style={{ fontSize: 12.5, color: "var(--sub)", margin: "0 0 14px", maxWidth: 760 }}>{t("depAide")}</p>
      {erreur && <p style={{ color: "var(--brique)", fontSize: 12.5 }}>{erreur}</p>}
      {info && <p style={{ color: "var(--vert)", fontSize: 12.5 }}>{info}</p>}

      <form onSubmit={enregistrer} className="card" style={{ marginBottom: 18 }}>
        <h2 style={{ fontSize: 14.5, color: "var(--petrol)", margin: "0 0 12px" }}>{t("depNouvelle")}</h2>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))", gap: 12 }}>
          <div><label style={labelStyle}>{t("depDate")}</label><input type="date" required value={form.date_depense} onChange={(e) => setForm({ ...form, date_depense: e.target.value })} style={inputStyle} /></div>
          <div>
            <label style={labelStyle}>{t("depCategorie")}</label>
            <select required value={form.categorie_id} onChange={(e) => setForm({ ...form, categorie_id: e.target.value })} style={inputStyle}>
              <option value="">—</option>
              {categories.map((c) => <option key={c.id} value={c.id}>{c.libelle}</option>)}
            </select>
          </div>
          <div style={{ gridColumn: "span 2" }}><label style={labelStyle}>{t("depMotif")}</label><input required value={form.libelle} onChange={(e) => setForm({ ...form, libelle: e.target.value })} style={inputStyle} /></div>
          <div><label style={labelStyle}>{t("depBeneficiaire")}</label><input value={form.beneficiaire} onChange={(e) => setForm({ ...form, beneficiaire: e.target.value })} style={inputStyle} /></div>
          <div><label style={labelStyle}>{t("depMontantTtc")}</label><input required inputMode="decimal" value={form.montant_ttc} onChange={(e) => setForm({ ...form, montant_ttc: e.target.value })} style={{ ...inputStyle, textAlign: "right", fontWeight: 600 }} /></div>
          <div>
            <label style={labelStyle}>{t("depTva")}</label>
            <select value={form.avec_tva ? "1" : "0"} onChange={(e) => setForm({ ...form, avec_tva: e.target.value === "1" })} style={inputStyle}>
              <option value="0">{t("depTva0")}</option>
              <option value="1">{tauxTva} %</option>
            </select>
          </div>
          <div>
            <label style={labelStyle}>{t("depMode")}</label>
            <ModeReglementSelect sens="DECAISSEMENT" value={form.mode_reglement_id} vide={false} onChange={(id) => setForm((f) => ({ ...f, mode_reglement_id: id }))} style={inputStyle} />
          </div>
          <div><label style={labelStyle}>{t("depReference")}</label><input value={form.reference} onChange={(e) => setForm({ ...form, reference: e.target.value })} style={inputStyle} /></div>
        </div>
        <button type="submit" disabled={envoi || !form.mode_reglement_id} style={{ ...boutonPrincipalStyle, marginTop: 14 }}>{t("depEnregistrer")}</button>
      </form>

      <div style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "flex-end", marginBottom: 12 }}>
        <div><label style={labelStyle}>{t("depDu")}</label><input type="date" value={filtre.du} onChange={(e) => setFiltre({ ...filtre, du: e.target.value })} style={{ ...inputStyle, width: 160 }} /></div>
        <div><label style={labelStyle}>{t("depAu")}</label><input type="date" value={filtre.au} onChange={(e) => setFiltre({ ...filtre, au: e.target.value })} style={{ ...inputStyle, width: 160 }} /></div>
        <div>
          <label style={labelStyle}>{t("depCategorie")}</label>
          <select value={filtre.categorie_id} onChange={(e) => setFiltre({ ...filtre, categorie_id: e.target.value })} style={{ ...inputStyle, width: 240 }}>
            <option value="">{t("depToutes")}</option>
            {categories.map((c) => <option key={c.id} value={c.id}>{c.libelle}</option>)}
          </select>
        </div>
        <div style={{ marginLeft: "auto", textAlign: "right" }}>
          <div style={{ fontSize: 11, color: "var(--sub)", textTransform: "uppercase", fontWeight: 700 }}>{t("depTotal")}</div>
          <div style={{ fontFamily: "Space Grotesk", fontWeight: 700, fontSize: 22 }}>{fmt(liste.total_ttc)} F</div>
          <div style={{ fontSize: 11.5, color: "var(--sub)" }}>{t("depTotalHt")} {fmt(liste.total_ht)} F</div>
        </div>
      </div>

      <div className="card" style={{ padding: 0, overflowX: "auto" }}>
        {liste.depenses.length === 0 ? <p style={{ padding: 16, margin: 0, fontSize: 12.5, color: "var(--sub)" }}>{t("depAucune")}</p> : (
          <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 760 }}>
            <thead><tr>
              <th style={thStyle}>{t("depColNumero")}</th><th style={thStyle}>{t("depColDate")}</th><th style={thStyle}>{t("depColCategorie")}</th><th style={thStyle}>{t("depColMotif")}</th>
              <th style={thStyle}>{t("depColMode")}</th><th style={{ ...thStyle, textAlign: "right" }}>{t("depColMontant")}</th><th style={thStyle}>{t("depColCompta")}</th><th style={thStyle} />
            </tr></thead>
            <tbody>
              {liste.depenses.map((d) => (
                <tr key={d.id} style={{ opacity: d.statut === "ANNULEE" ? 0.5 : 1 }}>
                  <td style={tdStyle}>{d.numero}</td>
                  <td style={tdStyle}>{String(d.date_depense).slice(0, 10).split("-").reverse().join("/")}</td>
                  <td style={tdStyle}>{d.categorie_libelle}</td>
                  <td style={tdStyle}>{d.libelle}{d.beneficiaire ? <span style={{ color: "var(--sub)" }}> · {d.beneficiaire}</span> : null}</td>
                  <td style={tdStyle}>{d.mode_libelle}</td>
                  <td style={{ ...tdStyle, ...numStyle, textDecoration: d.statut === "ANNULEE" ? "line-through" : "none" }}>{fmt(d.montant_ttc)}</td>
                  <td style={tdStyle}>{d.statut === "ANNULEE" ? t("depAnnulee") : d.ecriture_statut === "EN_INSTANCE" ? t("depEcritureInstance") : d.ecriture_statut === "VALIDEE" ? t("depEcritureValidee") : "—"}</td>
                  <td style={tdStyle}>{d.statut === "ENREGISTREE" && <button type="button" onClick={() => annuler(d)} style={{ ...boutonDangerStyle, padding: "3px 10px", fontSize: 11.5 }}>{t("depAnnuler")}</button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </AppShell>
  );
}
