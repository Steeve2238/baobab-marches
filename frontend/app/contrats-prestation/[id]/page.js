"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { api } from "../../../lib/api";
import { useLangue } from "../../../lib/i18n/LanguageContext";
import AppShell from "../../../lib/components/AppShell";
import PrestationForm, { prestationFormInitial, prestationFormVersCorps } from "../../../lib/components/PrestationForm";
import { boutonPrincipal, boutonLeger, inputStyle, labelStyle, Section, fmtMontant } from "../../../lib/components/rhUi";

function lireFichier(f) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve({ nom: f.name, base64: String(r.result).replace(/^data:[^,]*,/, "") });
    r.onerror = () => reject(new Error("lecture"));
    r.readAsDataURL(f);
  });
}
const jour = (v) => (v ? String(v).slice(0, 10) : "");
function classeStatut(s) {
  if (s === "ANNULE" || s === "RESILIE") return "chip risk";
  if (s === "SIGNE" || s === "TERMINE") return "chip ok";
  return "chip";
}

export default function ContratPrestationPage() {
  const { id } = useParams();
  const router = useRouter();
  const { t } = useLangue();
  const [contrat, setContrat] = useState(null);
  const [form, setForm] = useState(null);
  const [fournisseurs, setFournisseurs] = useState([]);
  const [erreur, setErreur] = useState("");
  const [message, setMessage] = useState("");
  const [enCours, setEnCours] = useState(false);
  const [dateSignature, setDateSignature] = useState(new Date().toISOString().slice(0, 10));
  const [dateFin, setDateFin] = useState(new Date().toISOString().slice(0, 10));
  const [motif, setMotif] = useState("");

  function appliquer(c) {
    setContrat(c);
    setForm(prestationFormInitial(c));
  }
  useEffect(() => {
    api.prestationLire(id).then(appliquer).catch((e) => setErreur(e.message));
    api.prestationFournisseurs().then(setFournisseurs).catch(() => {});
  }, [id]);

  const brouillon = contrat && contrat.statut === "BROUILLON";
  const actif = contrat && (contrat.statut === "VALIDE" || contrat.statut === "SIGNE");

  async function action(fn, msg) {
    setEnCours(true);
    setErreur("");
    setMessage("");
    try {
      const r = await fn();
      if (r) appliquer(r);
      if (msg) setMessage(msg);
    } catch (e) {
      setErreur(e.message);
    } finally {
      setEnCours(false);
    }
  }
  const enregistrer = (e) => {
    e.preventDefault();
    return action(() => api.prestationModifier(id, prestationFormVersCorps(form)), t("prsEnregistre"));
  };
  const valider = async () => {
    if (!window.confirm(t("prsValiderConfirm"))) return;
    await action(async () => {
      await api.prestationModifier(id, prestationFormVersCorps(form));
      return api.prestationValider(id);
    });
  };
  const supprimer = async () => {
    if (!window.confirm(t("prsSupprimerConfirm"))) return;
    try {
      await api.prestationSupprimer(id);
      router.push("/contrats-prestation");
    } catch (e) {
      setErreur(e.message);
    }
  };
  const annuler = async () => {
    if (!window.confirm(t("prsAnnulerConfirm"))) return;
    action(() => api.prestationAnnuler(id));
  };
  const apercu = async () => {
    try {
      if (brouillon) await api.prestationModifier(id, prestationFormVersCorps(form));
      await api.ouvrirPdfRH(`/contrats-prestation/${id}/pdf`);
    } catch (e) {
      setErreur(e.message);
    }
  };
  const joindre = async (e) => {
    const f = e.target.files && e.target.files[0];
    e.target.value = "";
    if (!f) return;
    await action(async () => {
      const fichier = await lireFichier(f);
      return api.prestationScan(id, { ...fichier, date_signature: dateSignature });
    }, t("prsScanOk"));
  };
  const terminer = () => action(() => api.prestationTerminer(id, { date: dateFin, motif: motif || null }));
  const resilier = async () => {
    if (!window.confirm(t("prsResilierConfirm"))) return;
    action(() => api.prestationResilier(id, { date: dateFin, motif }));
  };

  if (erreur && !contrat) {
    return <AppShell title={t("prsTitre")}><p style={{ color: "var(--brique)", fontSize: 12.5 }}>{erreur}</p></AppShell>;
  }
  if (!contrat || !form) {
    return <AppShell title={t("prsTitre")}><p style={{ fontSize: 12.5, color: "var(--sub)" }}>{t("loading")}</p></AppShell>;
  }

  const contenu = contrat.contenu;
  return (
    <AppShell title={contrat.numero}>
      <Link href="/contrats-prestation" style={{ fontSize: 12, color: "var(--petrol)", display: "inline-block", marginBottom: 12 }}>{t("prsRetour")}</Link>
      {erreur && <p style={{ color: "var(--brique)", fontSize: 12.5, marginBottom: 14 }}>{erreur}</p>}
      {message && <p style={{ color: "var(--petrol)", fontSize: 12.5, marginBottom: 14 }}>{message}</p>}

      <div style={{ maxWidth: 980, display: "grid", gap: 16 }}>
        <div className="card" style={{ display: "flex", gap: 16, flexWrap: "wrap", alignItems: "center" }}>
          <div>
            <div style={{ fontWeight: 700, fontSize: 16 }}>{contrat.prestataire_nom}</div>
            <div style={{ fontSize: 12, color: "var(--sub)" }}>{contrat.numero} · {t(`prsForme_${contrat.forme}`)}</div>
          </div>
          <span className={classeStatut(contrat.statut)}>{t(`prsStatut_${contrat.statut}`)}</span>
          {contrat.expire && <span className="chip risk">{t("prsExpire")}</span>}
          {contrat.fin_proche && <span className="chip">{t("prsFinProche")}</span>}
          {contrat.fige && (
            <div style={{ marginLeft: "auto", fontSize: 11.5, color: "var(--sub)", textAlign: "right" }}>
              {contrat.date_validation && <div>{t("prsValideLe")} {jour(contrat.date_validation)}</div>}
              {contrat.date_signature && <div>{t("prsSigneLe")} {jour(contrat.date_signature)}</div>}
              {contrat.empreinte && <div className="mono">{t("prsEmpreinte")} {String(contrat.empreinte).slice(0, 12)}…</div>}
            </div>
          )}
        </div>

        {brouillon && contrat.avertissements.length > 0 && (
          <Section titre={t("prsAvertissements")}>
            <div style={{ display: "grid", gap: 6 }}>
              {contrat.avertissements.map((a, i) => (
                <div key={i} style={{ display: "flex", gap: 8, alignItems: "flex-start", fontSize: 12.5 }}>
                  <span className={a.niveau === "BLOQUANT" ? "chip risk" : "chip"} style={{ flexShrink: 0 }}>{a.niveau === "BLOQUANT" ? t("prsBloquant") : t("prsAttention")}</span>
                  <span>{t(`prsAv_${a.code}`)}{a.valeur ? ` (${a.valeur})` : ""}</span>
                </div>
              ))}
            </div>
          </Section>
        )}

        <form onSubmit={enregistrer}>
          <PrestationForm form={form} setForm={setForm} t={t} lectureSeule={!brouillon} fournisseurs={fournisseurs} />
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 16 }}>
            {brouillon && <button type="submit" disabled={enCours} style={boutonPrincipal}>{enCours ? t("prsEnregistrement") : t("prsEnregistrer")}</button>}
            <button type="button" style={boutonLeger} onClick={apercu}>{t("prsApercuPdf")}</button>
            {!brouillon && (
              <button type="button" style={boutonLeger} onClick={() => api.telechargerPdfRH(`/contrats-prestation/${id}/pdf`, `${contrat.numero}.pdf`).catch((e) => setErreur(e.message))}>{t("prsTelechargerPdf")}</button>
            )}
            {brouillon && <button type="button" disabled={enCours} style={{ ...boutonPrincipal, background: "var(--accent, #C8742B)" }} onClick={valider}>{t("prsValider")}</button>}
            {brouillon && <button type="button" style={{ ...boutonLeger, color: "var(--brique)" }} onClick={supprimer}>{t("prsSupprimer")}</button>}
            {contrat.statut === "VALIDE" && <button type="button" style={{ ...boutonLeger, color: "var(--brique)" }} onClick={annuler}>{t("prsAnnuler")}</button>}
          </div>
        </form>

        {(contrat.statut === "VALIDE" || contrat.statut === "SIGNE") && (
          <Section titre={t("prsSignature")} aide={t("prsSignatureAide")}>
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end" }}>
              <div>
                <label style={labelStyle}>{t("prsDateSignature")}</label>
                <input type="date" style={{ ...inputStyle, width: "auto" }} value={dateSignature} onChange={(e) => setDateSignature(e.target.value)} />
              </div>
              <label style={{ ...boutonPrincipal, cursor: "pointer" }}>
                {contrat.a_fichier_signe ? t("prsRemplacerScan") : t("prsAjouterScan")}
                <input type="file" accept="application/pdf,image/png,image/jpeg" style={{ display: "none" }} onChange={joindre} disabled={enCours} />
              </label>
              {contrat.a_fichier_signe && (
                <button type="button" style={boutonLeger} onClick={() => api.ouvrirPdfRH(`/contrats-prestation/${id}/scan`).catch((e) => setErreur(e.message))}>{t("prsVoirScan")}</button>
              )}
            </div>
          </Section>
        )}

        {contrat.a_fichier_signe && !actif && (
          <div>
            <button type="button" style={boutonLeger} onClick={() => api.ouvrirPdfRH(`/contrats-prestation/${id}/scan`).catch((e) => setErreur(e.message))}>{t("prsVoirScan")}</button>
          </div>
        )}

        {actif && (
          <Section titre={t("prsFin")} aide={t("prsFinAide")}>
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end" }}>
              <div>
                <label style={labelStyle}>{t("prsDateFinReelle")}</label>
                <input type="date" style={{ ...inputStyle, width: "auto" }} value={dateFin} onChange={(e) => setDateFin(e.target.value)} />
              </div>
              <div style={{ flex: 1, minWidth: 220 }}>
                <label style={labelStyle}>{t("prsMotif")}</label>
                <input style={inputStyle} value={motif} onChange={(e) => setMotif(e.target.value)} />
              </div>
              <button type="button" style={boutonLeger} disabled={enCours} onClick={terminer}>{t("prsTerminer")}</button>
              <button type="button" style={{ ...boutonLeger, color: "var(--brique)", opacity: motif.trim() ? 1 : 0.5 }} disabled={enCours || !motif.trim()} onClick={resilier}>{t("prsResilier")}</button>
            </div>
          </Section>
        )}

        {(contrat.statut === "TERMINE" || contrat.statut === "RESILIE") && (
          <div className="card" style={{ fontSize: 12.5 }}>
            {t("prsFinReelleLu")} : <b>{jour(contrat.date_fin_reelle)}</b>
            {contrat.motif_fin ? <> · {t("prsMotifLu")} : {contrat.motif_fin}</> : null}
          </div>
        )}

        <Section titre={t("prsTexte")} aide={brouillon ? t("prsTexteAide") : t("prsFigeAide")}>
          <div style={{ fontSize: 12.5, lineHeight: 1.55, display: "grid", gap: 10 }}>
            {contenu.identite && (
              <div style={{ display: "grid", gap: 2 }}>
                {contenu.identite.map(([k, v]) => (
                  <div key={k} style={{ display: "grid", gridTemplateColumns: "220px 1fr", gap: 8 }}>
                    <span style={{ color: "var(--sub)", fontWeight: 600 }}>{k}</span>
                    <span>{v}</span>
                  </div>
                ))}
              </div>
            )}
            {contenu.articles.map((a) => (
              <div key={a.numero}>
                <div style={{ fontWeight: 700, color: "var(--petrol)", marginBottom: 3 }}>Article {a.numero} : {a.titre}</div>
                {a.paragraphes.map((p, i) => <p key={i} style={{ margin: "0 0 5px" }}>{p}</p>)}
                {a.echeancier && (
                  <div style={{ margin: "4px 0 6px" }}>
                    {a.echeancier.lignes.map((l, i) => (
                      <div key={i} style={{ display: "flex", justifyContent: "space-between", maxWidth: 520, borderBottom: "1px solid var(--line)", padding: "2px 0" }}>
                        <span>{l.libelle}{l.date ? ` (${jour(l.date)})` : ""}</span>
                        <span className="mono">{fmtMontant(l.montant)} {a.echeancier.devise}</span>
                      </div>
                    ))}
                    <div style={{ display: "flex", justifyContent: "space-between", maxWidth: 520, fontWeight: 700, padding: "3px 0" }}>
                      <span>{t("prsEchTotal")}</span>
                      <span className="mono">{fmtMontant(a.echeancier.total)} {a.echeancier.devise}</span>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        </Section>
      </div>
    </AppShell>
  );
}
