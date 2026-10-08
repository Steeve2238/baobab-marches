"use client";

import { useState } from "react";
import { api } from "../api";
import { boutonLeger, boutonPrincipal, inputStyle, labelStyle, Section } from "./rhUi";

function lireFichier(f) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve({ nom: f.name, base64: String(r.result).replace(/^data:[^,]*,/, "") });
    r.onerror = () => reject(new Error("read"));
    r.readAsDataURL(f);
  });
}

const aujourdhui = () => new Date().toISOString().slice(0, 10);

/** Circuit de signature d'un contrat valide : envoi, signature salarie, Inspection du travail, visa. */
export default function CircuitContrat({ contrat, t, onChange, onErreur, onMessage }) {
  const [enCours, setEnCours] = useState(false);
  const [dateTransmission, setDateTransmission] = useState(aujourdhui());
  const [visa, setVisa] = useState({ numero_visa: "", date_visa: aujourdhui(), commentaire: "" });
  const [fichier, setFichier] = useState(null);
  const id = contrat.id;
  const sal = contrat.signature_salarie;

  async function agir(fn, msg) {
    setEnCours(true);
    onErreur("");
    onMessage("");
    try {
      const r = await fn();
      onChange(r);
      if (msg) onMessage(msg);
    } catch (e) {
      onErreur(e.message);
    } finally {
      setEnCours(false);
    }
  }

  async function choisirFichier(e) {
    const f = e.target.files && e.target.files[0];
    e.target.value = "";
    if (!f) return;
    if (f.size > 8 * 1024 * 1024) {
      onErreur(t("rhcFichierTropGros"));
      return;
    }
    onErreur("");
    setFichier(await lireFichier(f));
  }

  const statut = contrat.statut;
  const bloc = { display: "grid", gap: 10, paddingTop: 12, borderTop: "1px solid var(--line)" };

  return (
    <Section titre={t("rhcCircuit")}>
      <div style={{ display: "grid", gap: 12, fontSize: 12.5 }}>
        <div style={{ display: "grid", gap: 3 }}>
          {contrat.date_signature_employeur && <div>{t("rhcSigneLe")} {String(contrat.date_signature_employeur).slice(0, 10)}</div>}
          {sal && (
            <div>
              {t("rhcSigneParSalarie")} {String(sal.date).replace("T", " ").slice(0, 16)}
              <span style={{ color: "var(--sub)" }}> · {t("rhcSignatureAdresse")} {sal.ip || "—"} · {t("rhcCodeEnvoyeA")} {sal.code_envoye_a}</span>
            </div>
          )}
          {contrat.empreinte && <div style={{ color: "var(--sub)" }}>{t("rhcEmpreinte")} : <span className="mono" style={{ fontSize: 11, wordBreak: "break-all" }}>{contrat.empreinte}</span></div>}
        </div>

        {statut === "SIGNE_EMPLOYEUR" && (
          <div style={bloc}>
            <div style={{ fontWeight: 700 }}>{t("rhcEtapeEnvoyer")}</div>
            <p style={{ margin: 0, color: "var(--sub)", fontSize: 12 }}>{contrat.employe.a_compte ? t("rhcEtapeEnvoyerAide") : t("rhcSansCompte")}</p>
            <div>
              <button type="button" disabled={enCours || !contrat.employe.a_compte} style={{ ...boutonPrincipal, opacity: contrat.employe.a_compte ? 1 : 0.5 }}
                onClick={() => { if (window.confirm(t("rhcEnvoyerConfirm"))) agir(() => api.envoyerContratSalarie(id), t("rhcEnvoyeOk")); }}>
                {t("rhcEtapeEnvoyer")}
              </button>
            </div>
          </div>
        )}

        {statut === "ENVOYE_SALARIE" && (
          <div style={bloc}>
            <div className="chip" style={{ justifySelf: "start" }}>{t("rhcAttenteSalarie")}</div>
            {contrat.date_envoi_salarie && <div style={{ color: "var(--sub)" }}>{String(contrat.date_envoi_salarie).slice(0, 10)}</div>}
          </div>
        )}

        {statut === "SIGNE_SALARIE" && (
          <div style={bloc}>
            <div style={{ fontWeight: 700 }}>{t("rhcEtapeTransmettre")}</div>
            <p style={{ margin: 0, color: "var(--sub)", fontSize: 12 }}>{t("rhcEtapeTransmettreAide")}</p>
            <div style={{ display: "flex", gap: 10, alignItems: "flex-end", flexWrap: "wrap" }}>
              <div>
                <label style={labelStyle}>{t("rhcDateTransmission")}</label>
                <input type="date" value={dateTransmission} onChange={(e) => setDateTransmission(e.target.value)} style={{ ...inputStyle, width: 180 }} />
              </div>
              <button type="button" disabled={enCours} style={boutonPrincipal} onClick={() => agir(() => api.transmettreContratInspection(id, dateTransmission))}>
                {t("rhcTransmettre")}
              </button>
              <button type="button" style={boutonLeger} onClick={() => api.telechargerPdfRH(`/rh/contrats/${id}/pdf`, `${contrat.numero}.pdf`).catch((e) => onErreur(e.message))}>{t("rhcTelechargerPdf")}</button>
            </div>
          </div>
        )}

        {statut === "TRANSMIS_INSPECTION" && (
          <div style={bloc}>
            <div style={{ fontWeight: 700 }}>{t("rhcEtapeViser")}</div>
            <p style={{ margin: 0, color: "var(--sub)", fontSize: 12 }}>
              {t("rhcEtapeViserAide")} {contrat.date_transmission_inspection ? `(${t("rhcDateTransmission")} : ${String(contrat.date_transmission_inspection).slice(0, 10)})` : ""}
            </p>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 12 }}>
              <div>
                <label style={labelStyle}>{t("rhcNumeroVisa")} *</label>
                <input value={visa.numero_visa} onChange={(e) => setVisa({ ...visa, numero_visa: e.target.value })} style={inputStyle} />
              </div>
              <div>
                <label style={labelStyle}>{t("rhcDateVisa")} *</label>
                <input type="date" value={visa.date_visa} onChange={(e) => setVisa({ ...visa, date_visa: e.target.value })} style={inputStyle} />
              </div>
              <div style={{ gridColumn: "1 / -1" }}>
                <label style={labelStyle}>{t("rhcCommentaireInsp")}</label>
                <input value={visa.commentaire} onChange={(e) => setVisa({ ...visa, commentaire: e.target.value })} style={inputStyle} />
              </div>
              <div style={{ gridColumn: "1 / -1" }}>
                <label style={labelStyle}>{t("rhcFichierVise")}</label>
                <input type="file" accept="application/pdf,image/png,image/jpeg" onChange={choisirFichier} style={{ fontSize: 12 }} />
                {fichier && <span style={{ fontSize: 11.5, color: "var(--sub)", marginLeft: 8 }}>{fichier.nom}</span>}
              </div>
            </div>
            <div>
              <button type="button" disabled={enCours || !visa.numero_visa.trim() || !visa.date_visa} style={{ ...boutonPrincipal, opacity: visa.numero_visa.trim() ? 1 : 0.5 }}
                onClick={() => agir(() => api.viserContrat(id, { ...visa, ...(fichier ? { fichier } : {}) }), t("rhcViseOk"))}>
                {t("rhcVisaBouton")}
              </button>
            </div>
          </div>
        )}

        {statut === "VISE" && (
          <div style={bloc}>
            <div className="chip ok" style={{ justifySelf: "start" }}>{t("rhcCircuitTermine")}</div>
            <div>{t("rhcNumeroVisa")} : <strong>{contrat.numero_visa}</strong> · {t("rhcDateVisa")} : {String(contrat.date_visa).slice(0, 10)}</div>
            {contrat.commentaire_inspection && <div style={{ color: "var(--sub)" }}>{contrat.commentaire_inspection}</div>}
          </div>
        )}

        {statut !== "ANNULE" && (
          <div style={bloc}>
            <div style={{ fontWeight: 700 }}>{t("rhcExemplaire")}</div>
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
              {contrat.a_fichier_signe && (
                <button type="button" style={boutonLeger} onClick={() => api.ouvrirPdfRH(`/rh/contrats/${id}/scan`).catch((e) => onErreur(e.message))}>{t("rhcExemplaireVoir")}</button>
              )}
              <label style={{ ...boutonLeger, cursor: "pointer" }}>
                {t("rhcExemplaireAjouter")}
                <input type="file" accept="application/pdf,image/png,image/jpeg" style={{ display: "none" }}
                  onChange={async (e) => {
                    const f = e.target.files && e.target.files[0];
                    e.target.value = "";
                    if (!f) return;
                    if (f.size > 8 * 1024 * 1024) return onErreur(t("rhcFichierTropGros"));
                    agir(async () => api.putScanContrat(id, await lireFichier(f)));
                  }} />
              </label>
            </div>
          </div>
        )}

        {(contrat.evenements || []).length > 0 && (
          <div style={bloc}>
            <div style={{ fontWeight: 700 }}>{t("rhcHistorique")}</div>
            {contrat.evenements.map((e, i) => (
              <div key={i} style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
                <span className="mono" style={{ color: "var(--sub)", fontSize: 11.5 }}>{String(e.date_evenement).replace("T", " ").slice(0, 16)}</span>
                <span>{t(`rhcEvt_${e.evenement}`)}</span>
                {(e.prenom || e.nom) && <span style={{ color: "var(--sub)" }}>{[e.prenom, e.nom].filter(Boolean).join(" ")}</span>}
                {e.ip && <span style={{ color: "var(--sub)" }} className="mono">{e.ip}</span>}
              </div>
            ))}
          </div>
        )}
      </div>
    </Section>
  );
}
