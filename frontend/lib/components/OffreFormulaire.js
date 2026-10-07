"use client";

import { useEffect, useMemo, useState } from "react";
import { superAdminApi } from "../superAdminApi";
import { useLangue } from "../i18n/LanguageContext";
import { inputStyle, labelStyle, boutonPrincipalStyle, boutonSecondaireStyle, boutonDangerStyle } from "../comptaUi";

const MODULES = ["COMPTABILITE", "FISCALITE", "PAIE"];
const nombre = (v) => Number(String(v).replace(/\s/g, "").replace(",", ".")) || 0;
const mm = (n) => Math.round(Number(n) || 0).toLocaleString("fr-FR");

/**
 * Formulaire commun de creation / modification d'une offre commerciale (Super Admin).
 * Les prix sont recalcules par le serveur ; l'apercu des totaux ici suit la meme regle.
 */
export default function OffreFormulaire({ initial, clients, formules, clientImpose, onSubmit, onAnnuler, libelleBouton }) {
  const { t } = useLangue();
  const [f, setF] = useState(() => ({
    tenant_id: initial?.tenant_id || "",
    mode_hebergement: initial?.mode_hebergement || "HEBERGE",
    formule_abonnement_id: initial?.formule_abonnement_id || "",
    modules: initial?.modules || [],
    duree_mois: initial?.duree_mois || 12,
    lignes: (initial?.lignes || []).map((l) => ({ ...l })),
    remise_pct: initial ? Number(initial.remise_pct) : 0,
    tva_pct: initial ? Number(initial.tva_pct) : 0,
    validite_jours: initial?.validite_jours || 30,
    conditions_paiement: initial?.conditions_paiement || "",
    notes: initial?.notes || "",
    client_forme_juridique: initial?.client_forme_juridique || "",
    client_adresse: initial?.client_adresse || "",
    client_ninea: initial?.client_ninea || "",
    client_rccm: initial?.client_rccm || "",
    representant_nom: initial?.representant_nom || "",
    representant_fonction: initial?.representant_fonction || "",
    destinataire_email: initial?.destinataire_email || "",
  }));
  const [erreur, setErreur] = useState("");
  const [info, setInfo] = useState("");
  const [occupe, setOccupe] = useState(false);

  useEffect(() => {
    if (clientImpose && !f.tenant_id) setF((x) => ({ ...x, tenant_id: clientImpose }));
  }, [clientImpose]); // eslint-disable-line react-hooks/exhaustive-deps

  const maj = (k, v) => setF((x) => ({ ...x, [k]: v }));
  const majLigne = (i, k, v) => setF((x) => ({ ...x, lignes: x.lignes.map((l, j) => (j === i ? { ...l, [k]: v } : l)) }));
  const basculeModule = (m) => setF((x) => ({ ...x, modules: x.modules.includes(m) ? x.modules.filter((y) => y !== m) : [...x.modules, m] }));

  const totaux = useMemo(() => {
    const sous = f.lignes.reduce((s, l) => s + Math.round(nombre(l.quantite) * nombre(l.prix_unitaire)), 0);
    const remise = Math.round((sous * nombre(f.remise_pct)) / 100);
    const ht = sous - remise;
    const tva = Math.round((ht * nombre(f.tva_pct)) / 100);
    return { sous, remise, ht, tva, ttc: ht + tva };
  }, [f.lignes, f.remise_pct, f.tva_pct]);

  async function proposer() {
    setErreur("");
    setInfo("");
    if (!f.tenant_id) return setErreur(t("saOffChoisirClient"));
    setOccupe(true);
    try {
      const q = new URLSearchParams({ client: f.tenant_id, mode: f.mode_hebergement, modules: f.modules.join(","), duree: String(f.duree_mois || 12) });
      if (f.formule_abonnement_id) q.set("formule", f.formule_abonnement_id);
      const r = await superAdminApi.proposerLignesOffre(q.toString());
      setF((x) => ({
        ...x,
        formule_abonnement_id: x.formule_abonnement_id || r.formule.id,
        lignes: r.lignes,
        client_adresse: x.client_adresse || r.client.client_adresse || "",
        client_ninea: x.client_ninea || r.client.client_ninea || "",
        client_rccm: x.client_rccm || r.client.client_rccm || "",
        destinataire_email: x.destinataire_email || r.client.destinataire_email || "",
        representant_nom: x.representant_nom || r.client.representant_nom || "",
        representant_fonction: x.representant_fonction || r.client.representant_fonction || "",
      }));
      setInfo(t("saOffLignesProposees"));
    } catch (e) {
      setErreur(e.message);
    } finally {
      setOccupe(false);
    }
  }

  async function soumettre(e) {
    e.preventDefault();
    setErreur("");
    setOccupe(true);
    try {
      await onSubmit({
        ...f,
        formule_abonnement_id: f.formule_abonnement_id || null,
        lignes: f.lignes.map((l) => ({ ...l, quantite: nombre(l.quantite), prix_unitaire: nombre(l.prix_unitaire) })),
        remise_pct: nombre(f.remise_pct),
        tva_pct: nombre(f.tva_pct),
        duree_mois: Number(f.duree_mois) || 12,
        validite_jours: Number(f.validite_jours) || 30,
      });
    } catch (err) {
      setErreur(err.message);
    } finally {
      setOccupe(false);
    }
  }

  const champ = (libelle, cle, options = {}) => (
    <div style={{ flex: options.flex || "1 1 200px" }}>
      <label style={labelStyle}>{libelle}</label>
      <input type={options.type || "text"} value={f[cle]} onChange={(e) => maj(cle, e.target.value)} style={inputStyle} />
    </div>
  );

  return (
    <form onSubmit={soumettre}>
      {erreur && <p style={{ color: "var(--brique)", fontSize: 12.5, marginBottom: 12 }}>{erreur}</p>}
      {info && <p style={{ color: "#2E7D5B", fontSize: 12.5, marginBottom: 12 }}>{info}</p>}

      <div className="card" style={{ marginBottom: 16 }}>
        <h3 style={{ fontSize: 13.5, color: "var(--petrol)", marginBottom: 12 }}>{t("saOffSectionOffre")}</h3>
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 12 }}>
          <div style={{ flex: "1 1 260px" }}>
            <label style={labelStyle}>{t("saOffClient")}</label>
            <select value={f.tenant_id} onChange={(e) => maj("tenant_id", e.target.value)} disabled={!!initial} style={inputStyle}>
              <option value="">{t("saOffChoisirClient")}</option>
              {clients.map((c) => <option key={c.id} value={c.id}>{c.raison_sociale}</option>)}
            </select>
          </div>
          <div style={{ flex: "1 1 200px" }}>
            <label style={labelStyle}>{t("saOffMode")}</label>
            <select value={f.mode_hebergement} onChange={(e) => maj("mode_hebergement", e.target.value)} style={inputStyle}>
              <option value="HEBERGE">{t("saOffModeHEBERGE")}</option>
              <option value="LOCAL">{t("saOffModeLOCAL")}</option>
            </select>
          </div>
          <div style={{ flex: "1 1 200px" }}>
            <label style={labelStyle}>{t("saOffFormule")}</label>
            <select value={f.formule_abonnement_id} onChange={(e) => maj("formule_abonnement_id", e.target.value)} style={inputStyle}>
              <option value="">{t("saOffFormuleClient")}</option>
              {formules.filter((x) => x.actif || x.id === f.formule_abonnement_id).map((x) => <option key={x.id} value={x.id}>{x.nom}</option>)}
            </select>
          </div>
          <div style={{ flex: "0 1 130px" }}>
            <label style={labelStyle}>{t("saOffDuree")}</label>
            <input type="number" min="1" max="120" value={f.duree_mois} onChange={(e) => maj("duree_mois", e.target.value)} style={inputStyle} />
          </div>
        </div>
        <div style={{ display: "flex", gap: 16, alignItems: "center", flexWrap: "wrap" }}>
          <span style={{ fontSize: 12, fontWeight: 600 }}>{t("saOffModules")}</span>
          {MODULES.map((m) => (
            <label key={m} style={{ fontSize: 12.5, display: "flex", gap: 6, alignItems: "center" }}>
              <input type="checkbox" checked={f.modules.includes(m)} onChange={() => basculeModule(m)} /> {t(`saOffModule_${m}`)}
            </label>
          ))}
          <button type="button" onClick={proposer} disabled={occupe} style={boutonSecondaireStyle}>{t("saOffProposer")}</button>
        </div>
        <p style={{ fontSize: 11.5, color: "var(--sub)", marginTop: 8 }}>{t("saOffProposerAide")}</p>
      </div>

      <div className="card" style={{ marginBottom: 16, overflowX: "auto" }}>
        <h3 style={{ fontSize: 13.5, color: "var(--petrol)", marginBottom: 12 }}>{t("saOffSectionLignes")}</h3>
        <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 760 }}>
          <thead>
            <tr style={{ fontSize: 11, textAlign: "left", color: "var(--sub)" }}>
              <th style={{ padding: "4px 6px" }}>{t("saOffColDesignation")}</th>
              <th style={{ padding: "4px 6px", width: 80 }}>{t("saOffColQte")}</th>
              <th style={{ padding: "4px 6px", width: 90 }}>{t("saOffColUnite")}</th>
              <th style={{ padding: "4px 6px", width: 120 }}>{t("saOffColPrix")}</th>
              <th style={{ padding: "4px 6px", width: 110, textAlign: "right" }}>{t("saOffColMontant")}</th>
              <th style={{ width: 40 }}></th>
            </tr>
          </thead>
          <tbody>
            {f.lignes.length === 0 && <tr><td colSpan={6} style={{ padding: 8, fontSize: 12.5, color: "var(--sub)" }}>{t("saOffAucuneLigne")}</td></tr>}
            {f.lignes.map((l, i) => (
              <tr key={i} style={{ borderTop: "1px solid var(--line)", verticalAlign: "top" }}>
                <td style={{ padding: "6px" }}>
                  <input value={l.libelle} onChange={(e) => majLigne(i, "libelle", e.target.value)} style={inputStyle} />
                  <input value={l.description || ""} onChange={(e) => majLigne(i, "description", e.target.value)} placeholder={t("saOffDescription")} style={{ ...inputStyle, marginTop: 4, fontSize: 11.5 }} />
                </td>
                <td style={{ padding: "6px" }}><input value={l.quantite} onChange={(e) => majLigne(i, "quantite", e.target.value)} style={inputStyle} /></td>
                <td style={{ padding: "6px" }}><input value={l.unite || ""} onChange={(e) => majLigne(i, "unite", e.target.value)} style={inputStyle} /></td>
                <td style={{ padding: "6px" }}><input value={l.prix_unitaire} onChange={(e) => majLigne(i, "prix_unitaire", e.target.value)} style={inputStyle} /></td>
                <td style={{ padding: "6px", textAlign: "right", fontWeight: 700, fontVariantNumeric: "tabular-nums", paddingTop: 14 }}>{mm(nombre(l.quantite) * nombre(l.prix_unitaire))}</td>
                <td style={{ padding: "6px" }}><button type="button" style={boutonDangerStyle} onClick={() => setF((x) => ({ ...x, lignes: x.lignes.filter((_, j) => j !== i) }))} aria-label={t("saOffRetirerLigne")}>×</button></td>
              </tr>
            ))}
          </tbody>
        </table>
        <button type="button" style={{ ...boutonSecondaireStyle, marginTop: 10 }} onClick={() => setF((x) => ({ ...x, lignes: [...x.lignes, { libelle: "", description: "", quantite: 1, unite: "", prix_unitaire: 0 }] }))}>{t("saOffAjouterLigne")}</button>
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginTop: 16, alignItems: "flex-end" }}>
          <div style={{ width: 130 }}>
            <label style={labelStyle}>{t("saOffRemisePct")}</label>
            <input value={f.remise_pct} onChange={(e) => maj("remise_pct", e.target.value)} style={inputStyle} />
          </div>
          <div style={{ width: 130 }}>
            <label style={labelStyle}>{t("saOffTva")}</label>
            <input value={f.tva_pct} onChange={(e) => maj("tva_pct", e.target.value)} style={inputStyle} />
          </div>
          <div style={{ marginLeft: "auto", textAlign: "right", fontSize: 12.5, lineHeight: 1.7 }}>
            {(totaux.remise > 0 || nombre(f.tva_pct) > 0) && <div>{t("saOffSousTotal")} : {mm(totaux.sous)} XOF</div>}
            {totaux.remise > 0 && <div>{t("saOffRemise")} : - {mm(totaux.remise)} XOF</div>}
            {nombre(f.tva_pct) > 0 && <div>{t("saOffTotalHt")} : {mm(totaux.ht)} XOF · {t("saOffTva")} : {mm(totaux.tva)} XOF</div>}
            <div style={{ fontSize: 15, fontWeight: 700, color: "var(--petrol)" }}>{nombre(f.tva_pct) > 0 ? t("saOffTotalTtc") : t("saOffTotalNet")} : {mm(totaux.ttc)} XOF</div>
          </div>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <h3 style={{ fontSize: 13.5, color: "var(--petrol)", marginBottom: 4 }}>{t("saOffSectionClient")}</h3>
        <p style={{ fontSize: 11.5, color: "var(--sub)", marginBottom: 12 }}>{t("saOffSectionClientAide")}</p>
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 12 }}>
          {champ(t("saOffFormeJuridique"), "client_forme_juridique", { flex: "0 1 160px" })}
          {champ(t("saOffAdresse"), "client_adresse", { flex: "2 1 300px" })}
          {champ("NINEA", "client_ninea", { flex: "1 1 150px" })}
          {champ("RCCM", "client_rccm", { flex: "1 1 170px" })}
        </div>
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
          {champ(t("saOffRepresentant"), "representant_nom")}
          {champ(t("saOffFonction"), "representant_fonction")}
          {champ(t("saOffEmailDestinataire"), "destinataire_email", { type: "email" })}
        </div>
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <h3 style={{ fontSize: 13.5, color: "var(--petrol)", marginBottom: 12 }}>{t("saOffSectionConditions")}</h3>
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 12 }}>
          <div style={{ width: 150 }}>
            <label style={labelStyle}>{t("saOffValidite")}</label>
            <input type="number" min="1" max="365" value={f.validite_jours} onChange={(e) => maj("validite_jours", e.target.value)} style={inputStyle} />
          </div>
          <div style={{ flex: "1 1 360px" }}>
            <label style={labelStyle}>{t("saOffConditionsPaiement")}</label>
            <textarea value={f.conditions_paiement} onChange={(e) => maj("conditions_paiement", e.target.value)} rows={2} style={{ ...inputStyle, resize: "vertical" }} placeholder={t("saOffConditionsPaiementPlaceholder")} />
          </div>
        </div>
        <label style={labelStyle}>{t("saOffNotes")}</label>
        <textarea value={f.notes} onChange={(e) => maj("notes", e.target.value)} rows={2} style={{ ...inputStyle, resize: "vertical" }} />
      </div>

      <div style={{ display: "flex", gap: 8 }}>
        <button type="submit" disabled={occupe} style={boutonPrincipalStyle}>{libelleBouton}</button>
        {onAnnuler && <button type="button" onClick={onAnnuler} style={boutonSecondaireStyle}>{t("cancel")}</button>}
      </div>
    </form>
  );
}
