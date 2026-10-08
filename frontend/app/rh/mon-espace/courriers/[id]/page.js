"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { api } from "../../../../../lib/api";
import { useLangue } from "../../../../../lib/i18n/LanguageContext";
import AppShell from "../../../../../lib/components/AppShell";
import { boutonPrincipal, boutonLeger, inputStyle, Section, fmtMontant } from "../../../../../lib/components/rhUi";

const jour = (d) => (d ? String(d).slice(0, 10) : "");

export default function MonCourrierPage() {
  const { id } = useParams();
  const { t } = useLangue();
  const [c, setC] = useState(null);
  const [reponse, setReponse] = useState("");
  const [erreur, setErreur] = useState("");
  const [message, setMessage] = useState("");

  useEffect(() => { api.getEspaceCourrier(id).then(setC).catch((e) => setErreur(e.message)); }, [id]);

  async function accuser() {
    setErreur(""); setMessage("");
    try { await api.accuserCourrier(id); setC(await api.getEspaceCourrier(id)); setMessage(t("rheAccuseOk")); } catch (e) { setErreur(e.message); }
  }
  async function repondre() {
    setErreur(""); setMessage("");
    try { await api.repondreCourrier(id, reponse); setC(await api.getEspaceCourrier(id)); setMessage(t("rheReponseOk")); } catch (e) { setErreur(e.message); }
  }

  if (!c) {
    return <AppShell title={t("rheTitre")}>{erreur ? <p style={{ color: "var(--brique)", fontSize: 12.5 }}>{erreur}</p> : <p style={{ fontSize: 12.5, color: "var(--sub)" }}>{t("loading")}</p>}</AppShell>;
  }
  const k = c.contenu;

  return (
    <AppShell title={c.numero}>
      <Link href="/rh/mon-espace" style={{ fontSize: 12, color: "var(--petrol)", display: "inline-block", marginBottom: 12 }}>{t("rheRetour")}</Link>
      {erreur && <p style={{ color: "var(--brique)", fontSize: 12.5, marginBottom: 14 }}>{erreur}</p>}
      {message && <p style={{ color: "var(--petrol)", fontSize: 12.5, marginBottom: 14 }}>{message}</p>}

      <div style={{ maxWidth: 900, display: "grid", gap: 16 }}>
        <div className="card" style={{ display: "flex", gap: 16, flexWrap: "wrap", alignItems: "center" }}>
          <div>
            <div style={{ fontWeight: 700, fontSize: 16 }}>{t(`rhkType_${c.type}`)}</div>
            <div style={{ fontSize: 12, color: "var(--sub)" }}>{c.numero} · {t("rheLettreRecue")} {jour(c.date_publication || c.date_courrier)}</div>
          </div>
          <div style={{ marginLeft: "auto", display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button type="button" style={boutonLeger} onClick={() => api.ouvrirPdfRH(`/rh/espace/courriers/${id}/pdf`).catch((e) => setErreur(e.message))}>{t("rhkApercuPdf")}</button>
            <button type="button" style={boutonLeger} onClick={() => api.telechargerPdfRH(`/rh/espace/courriers/${id}/pdf`, `${c.numero}.pdf`).catch((e) => setErreur(e.message))}>{t("rhkTelechargerPdf")}</button>
          </div>
        </div>

        <Section titre={k.objet}>
          <div style={{ fontSize: 13, lineHeight: 1.55, display: "grid", gap: 8 }}>
            {k.paragraphes.map((p, i) => <p key={i} style={{ margin: 0 }}>{p}</p>)}
            {k.lignes && k.lignes.length > 0 && (
              <table style={{ borderCollapse: "collapse", fontSize: 12.5 }}>
                <tbody>
                  {k.lignes.map((l, i) => (
                    <tr key={i}><td style={{ padding: "3px 14px 3px 0" }}>{l.libelle}</td><td style={{ textAlign: "right" }}>{fmtMontant(l.montant)} F CFA</td></tr>
                  ))}
                  <tr><td style={{ padding: "6px 14px 0 0", fontWeight: 700 }}>{t("rhkTotal")}</td><td style={{ textAlign: "right", fontWeight: 700 }}>{fmtMontant(k.total)} F CFA</td></tr>
                </tbody>
              </table>
            )}
          </div>
        </Section>

        {c.accuse_requis && (
          <Section titre={t("rhkAccuse")} aide={t("rheAccuseAide")}>
            {c.date_accuse ? (
              <div style={{ fontSize: 12.5 }}>{t("rhkAccuseLe")} {jour(c.date_accuse)}</div>
            ) : (
              <button type="button" style={boutonPrincipal} onClick={accuser}>{t("rheAccuserReception")}</button>
            )}
          </Section>
        )}

        {c.reponse_prevue && (
          <Section titre={t("rheMaReponse")} aide={c.reponse_texte ? undefined : t("rheReponseAide")}>
            {c.date_limite && <p style={{ fontSize: 12, color: "var(--sub)", margin: "0 0 8px" }}>{t("rheReponseLimite")} {jour(c.date_limite)}</p>}
            {c.reponse_texte ? (
              <div style={{ fontSize: 13, lineHeight: 1.5 }}>
                <div style={{ fontSize: 11.5, color: "var(--sub)", marginBottom: 6 }}>{t("rheReponseEnvoyee")} {jour(c.date_reponse)}</div>
                <div style={{ whiteSpace: "pre-wrap" }}>{c.reponse_texte}</div>
              </div>
            ) : (
              <div style={{ display: "grid", gap: 10 }}>
                <textarea rows={7} value={reponse} onChange={(e) => setReponse(e.target.value)} style={{ ...inputStyle, resize: "vertical", lineHeight: 1.45 }} />
                <div><button type="button" disabled={!reponse.trim()} style={{ ...boutonPrincipal, opacity: reponse.trim() ? 1 : 0.5 }} onClick={repondre}>{t("rheReponseEnvoyer")}</button></div>
              </div>
            )}
          </Section>
        )}
      </div>
    </AppShell>
  );
}
