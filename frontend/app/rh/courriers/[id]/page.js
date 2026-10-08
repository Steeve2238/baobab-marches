"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { api } from "../../../../lib/api";
import { useLangue } from "../../../../lib/i18n/LanguageContext";
import AppShell from "../../../../lib/components/AppShell";
import CourrierForm, { courrierFormInitial, courrierFormVersCorps } from "../../../../lib/components/CourrierForm";
import { boutonPrincipal, boutonLeger, inputStyle, labelStyle, Section, fmtMontant } from "../../../../lib/components/rhUi";

const MODES = ["MAIN_PROPRE", "ESPACE_EMPLOYE", "EMAIL", "COURRIER_RECOMMANDE", "AUTRE"];
const jour = (d) => (d ? String(d).slice(0, 10) : "");

export default function CourrierRHDetailPage() {
  const { id } = useParams();
  const router = useRouter();
  const { t } = useLangue();
  const [c, setC] = useState(null);
  const [def, setDef] = useState(null);
  const [form, setForm] = useState(null);
  const [remise, setRemise] = useState({ mode_remise: "MAIN_PROPRE", date_remise: new Date().toISOString().slice(0, 10) });
  const [erreur, setErreur] = useState("");
  const [message, setMessage] = useState("");
  const [avert, setAvert] = useState([]);

  function appliquer(x) {
    setC(x);
    setAvert(x.avertissements || []);
    setForm(courrierFormInitial({ date_courrier: x.date_courrier, lieu: x.lieu, champs: x.champs_json, lignes: x.lignes_json, notes: x.notes }));
  }
  useEffect(() => {
    api.getCourrier(id).then((x) => {
      appliquer(x);
      api.getCourrierTypes().then((ts) => setDef(ts.find((d) => d.type === x.type))).catch(() => {});
    }).catch((e) => setErreur(e.message));
  }, [id]);

  async function agir(fn, ok) {
    setErreur("");
    setMessage("");
    try {
      const x = await fn();
      appliquer(x);
      if (ok) setMessage(t(ok));
    } catch (e) {
      setErreur(e.message);
      if (e.data && e.data.avertissements) setAvert(e.data.avertissements);
    }
  }

  if (!c || !form || !def) {
    return <AppShell title={t("rhkTitre")}>{erreur ? <p style={{ color: "var(--brique)", fontSize: 12.5 }}>{erreur}</p> : <p style={{ fontSize: 12.5, color: "var(--sub)" }}>{t("loading")}</p>}</AppShell>;
  }
  const brouillon = c.statut === "BROUILLON";
  const emis = c.statut === "EMIS";
  const contenu = c.contenu;
  const libelleAvert = (a) => (a.code === "CHAMP_REQUIS" ? `${t("rhkAv_CHAMP_REQUIS")} : ${t(`rhkChamp_${a.valeur}`)}` : `${t(`rhkAv_${a.code}`)}${a.valeur && a.code !== "CHAMP_REQUIS" ? ` (${a.valeur})` : ""}`);

  return (
    <AppShell title={c.numero}>
      <Link href="/rh/courriers" style={{ fontSize: 12, color: "var(--petrol)", display: "inline-block", marginBottom: 12 }}>{t("rhkRetour")}</Link>
      {erreur && <p style={{ color: "var(--brique)", fontSize: 12.5, marginBottom: 14 }}>{erreur}</p>}
      {message && <p style={{ color: "var(--petrol)", fontSize: 12.5, marginBottom: 14 }}>{message}</p>}

      <div style={{ maxWidth: 900, display: "grid", gap: 14 }}>
        <div className="card" style={{ display: "flex", gap: 14, flexWrap: "wrap", alignItems: "center" }}>
          <div>
            <div style={{ fontWeight: 700, fontSize: 16 }}>{t(`rhkType_${c.type}`)}</div>
            <div style={{ fontSize: 12, color: "var(--sub)" }}>
              {c.employe.prenom} {c.employe.nom}{c.employe.matricule ? ` · ${c.employe.matricule}` : ""} ·{" "}
              <Link href={`/rh/personnel/${c.employe.id}`} style={{ color: "var(--petrol)" }}>{t("rhkOuvrirFiche")}</Link>
            </div>
          </div>
          <span className={c.statut === "ANNULE" ? "chip risk" : brouillon ? "chip" : "chip ok"}>{t(`rhkStatut_${c.statut}`)}</span>
          <div style={{ marginLeft: "auto", display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button type="button" style={boutonLeger} onClick={() => api.ouvrirPdfRH(`/rh/courriers/${id}/pdf`).catch((e) => setErreur(e.message))}>{t("rhkApercuPdf")}</button>
            <button type="button" style={boutonLeger} onClick={() => api.telechargerPdfRH(`/rh/courriers/${id}/pdf`, `${c.numero}.pdf`).catch((e) => setErreur(e.message))}>{t("rhkTelechargerPdf")}</button>
          </div>
        </div>

        {brouillon && avert.length > 0 && (
          <Section titre={t("rhkAvertissements")}>
            <div style={{ display: "grid", gap: 6 }}>
              {avert.map((a, i) => (
                <div key={i} style={{ display: "flex", gap: 8, alignItems: "baseline", fontSize: 12.5 }}>
                  <span className={a.niveau === "BLOQUANT" ? "chip risk" : "chip"}>{a.niveau === "BLOQUANT" ? t("rhkBloquant") : t("rhkAttention")}</span>
                  <span>{libelleAvert(a)}</span>
                </div>
              ))}
            </div>
          </Section>
        )}

        {brouillon ? (
          <CourrierForm t={t} def={def} form={form} setForm={setForm} />
        ) : null}

        <Section titre={t("rhkTexte")} aide={brouillon ? t("rhkTexteAide") : undefined}>
          <div style={{ fontSize: 13, lineHeight: 1.55, display: "grid", gap: 8 }}>
            <div style={{ fontWeight: 700 }}>{contenu.objet}</div>
            {contenu.paragraphes.map((p, i) => <p key={i} style={{ margin: 0 }}>{p}</p>)}
            {contenu.lignes && contenu.lignes.length > 0 && (
              <table style={{ borderCollapse: "collapse", fontSize: 12.5 }}>
                <tbody>
                  {contenu.lignes.map((l, i) => (
                    <tr key={i}><td style={{ padding: "3px 14px 3px 0" }}>{l.libelle}</td><td style={{ textAlign: "right" }}>{fmtMontant(l.montant)} F CFA</td></tr>
                  ))}
                  <tr><td style={{ padding: "6px 14px 0 0", fontWeight: 700 }}>{t("rhkTotal")}</td><td style={{ textAlign: "right", fontWeight: 700 }}>{fmtMontant(contenu.total)} F CFA</td></tr>
                </tbody>
              </table>
            )}
          </div>
          {c.empreinte && <div style={{ fontSize: 10.5, color: "var(--sub)", marginTop: 10, wordBreak: "break-all" }}>{t("rhkEmpreinte")} : {c.empreinte}</div>}
        </Section>

        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          {brouillon && (
            <>
              <button type="button" style={boutonLeger} onClick={() => agir(() => api.patchCourrier(id, courrierFormVersCorps(form)), "rhkEnregistre")}>{t("rhkEnregistrer")}</button>
              <button type="button" style={boutonPrincipal} onClick={async () => {
                if (!window.confirm(t("rhkEmettreConfirm"))) return;
                await agir(async () => { await api.patchCourrier(id, courrierFormVersCorps(form)); return api.emettreCourrier(id); }, "rhkEmisOk");
              }}>{t("rhkEmettre")}</button>
              <button type="button" style={{ ...boutonLeger, color: "var(--brique)", marginLeft: "auto" }} onClick={async () => {
                if (!window.confirm(t("rhkSupprimerConfirm"))) return;
                try { await api.deleteCourrierRH(id); router.push("/rh/courriers"); } catch (e) { setErreur(e.message); }
              }}>{t("rhkSupprimer")}</button>
            </>
          )}
          {emis && (
            <button type="button" style={{ ...boutonLeger, color: "var(--brique)", marginLeft: "auto" }} onClick={() => window.confirm(t("rhkAnnulerConfirm")) && agir(() => api.annulerCourrierRH(id))}>{t("rhkAnnuler")}</button>
          )}
        </div>

        {emis && (
          <>
            <Section titre={t("rhkSuivi")}>
              <div style={{ display: "grid", gap: 10, fontSize: 12.5 }}>
                <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                  {!c.visible_employe ? (
                    <button type="button" style={boutonPrincipal} disabled={!c.employe.a_compte} onClick={() => agir(() => api.publierCourrier(id, true), "rhkPublieOk")}>{t("rhkPublier")}</button>
                  ) : (
                    <button type="button" style={boutonLeger} onClick={() => agir(() => api.publierCourrier(id, false))}>{t("rhkRetirerPublication")}</button>
                  )}
                  <span style={{ color: "var(--sub)", fontSize: 11.5 }}>{t("rhkPublierAide")}</span>
                </div>
                {c.visible_employe && (
                  <div style={{ display: "grid", gap: 4 }}>
                    <div>{t("rhkPublieLe")} {jour(c.date_publication)}</div>
                    <div>{c.date_lecture ? `${t("rhkLuLe")} ${jour(c.date_lecture)}` : t("rhkNonLu")}</div>
                    {c.accuse_requis && <div>{c.date_accuse ? `${t("rhkAccuseLe")} ${jour(c.date_accuse)}` : `${t("rhkAccuse")} : —`}</div>}
                  </div>
                )}
                {c.mode_remise && <div>{t("rhkModeRemise")} : <strong>{t(`rhkMode_${c.mode_remise}`)}</strong> · {jour(c.date_remise)}</div>}
              </div>
            </Section>

            <Section titre={t("rhkRemise")} aide={t("rhkRemiseAide")}>
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end" }}>
                <div>
                  <label style={labelStyle}>{t("rhkModeRemise")}</label>
                  <select value={remise.mode_remise} onChange={(e) => setRemise({ ...remise, mode_remise: e.target.value })} style={{ ...inputStyle, width: "auto" }}>
                    {MODES.map((m) => <option key={m} value={m}>{t(`rhkMode_${m}`)}</option>)}
                  </select>
                </div>
                <div>
                  <label style={labelStyle}>{t("rhkDateRemise")}</label>
                  <input type="date" value={remise.date_remise} onChange={(e) => setRemise({ ...remise, date_remise: e.target.value })} style={{ ...inputStyle, width: "auto" }} />
                </div>
                <button type="button" style={boutonLeger} onClick={() => agir(() => api.remiseCourrier(id, remise), "rhkEnregistre")}>{t("rhkEnregistrerRemise")}</button>
              </div>
            </Section>

            {c.reponse_prevue && (
              <Section titre={t("rhkReponse")}>
                {c.champs_json && c.champs_json.date_limite && <p style={{ fontSize: 12, color: "var(--sub)", margin: "0 0 8px" }}>{t("rhkReponseAttendue")} {jour(c.champs_json.date_limite)}</p>}
                {c.reponse_texte ? (
                  <div style={{ fontSize: 13, lineHeight: 1.5 }}>
                    <div style={{ fontSize: 11.5, color: "var(--sub)", marginBottom: 6 }}>{t("rhkReponseLe")} {jour(c.date_reponse)}</div>
                    <div style={{ whiteSpace: "pre-wrap" }}>{c.reponse_texte}</div>
                  </div>
                ) : (
                  <p style={{ fontSize: 12.5, color: "var(--sub)", margin: 0 }}>{t("rhkReponseAucune")}</p>
                )}
              </Section>
            )}

            {c.type === "SOLDE_TOUT_COMPTE" && (
              <Section titre={t("rhovCreerDepuisSolde")} aide={t("rhkCreerOrdreAide")}>
                <Link href={`/rh/ordres-virement/nouveau?courrier_id=${c.id}`} style={boutonPrincipal}>{t("rhkCreerOrdre")}</Link>
              </Section>
            )}
          </>
        )}
      </div>
    </AppShell>
  );
}
