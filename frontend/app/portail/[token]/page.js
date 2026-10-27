"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import { portailApi } from "../../../lib/portailApi";
import { useLangue } from "../../../lib/i18n/LanguageContext";
import LanguageSwitcher from "../../../lib/i18n/LanguageSwitcher";
import SignaturePad from "../../../lib/components/SignaturePad";
import { inputStyle, labelStyle, boutonPrincipalStyle, boutonSecondaireStyle } from "../../../lib/comptaUi";

const fmtDateHeure = (d, langue) => (d ? new Date(d).toLocaleString(langue === "en" ? "en-GB" : "fr-FR", { dateStyle: "long", timeStyle: "short" }) : "");
const cleSession = (token) => `baobab_portail_${token.slice(0, 12)}`;

function lireSession(token) {
  try {
    return window.sessionStorage.getItem(cleSession(token)) || "";
  } catch (e) {
    return "";
  }
}
function ecrireSession(token, valeur) {
  try {
    if (valeur) window.sessionStorage.setItem(cleSession(token), valeur);
    else window.sessionStorage.removeItem(cleSession(token));
  } catch (e) {
    /* stockage indisponible : la session reste en memoire */
  }
}

const carte = { background: "var(--panel)", border: "1px solid var(--line)", borderRadius: 14, padding: "22px 24px", maxWidth: 880, width: "100%", margin: "0 auto 18px" };

// Page publique du client : acces par lien + identifiant + code, consultation du document, telechargement et signature en ligne.
export default function PortailPage() {
  const { token } = useParams();
  const { t, langue } = useLangue();
  const [info, setInfo] = useState(null);
  const [erreurLien, setErreurLien] = useState("");
  const [session, setSession] = useState("");
  const [doc, setDoc] = useState(null);
  const [ident, setIdent] = useState("");
  const [code, setCode] = useState("");
  const [erreur, setErreur] = useState("");
  const [restantes, setRestantes] = useState(null);
  const [occupe, setOccupe] = useState(false);
  const [pdfUrl, setPdfUrl] = useState("");
  const [nom, setNom] = useState("");
  const [qualite, setQualite] = useState("");
  const [lu, setLu] = useState(false);
  const [signature, setSignature] = useState(null);
  const urlRef = useRef("");

  const libelleType = (type) => ({ OFFRE: t("prtpOffre"), CONTRAT: t("prtpContrat"), FACTURE: t("prtpFacture"), FACTURE_ABO: t("prtpFacture"), DEVIS: t("prtpDevis") }[type] || t("prtpContrat"));

  const chargerPdf = useCallback(async (sess) => {
    try {
      const blob = await portailApi.pdf(token, sess, false);
      if (urlRef.current) window.URL.revokeObjectURL(urlRef.current);
      urlRef.current = window.URL.createObjectURL(blob);
      setPdfUrl(urlRef.current);
    } catch (e) {
      setErreur(e.message);
    }
  }, [token]);

  const chargerDocument = useCallback(async (sess) => {
    try {
      const d = await portailApi.document(token, sess);
      setDoc(d);
      setSession(sess);
      await chargerPdf(sess);
      return true;
    } catch (e) {
      if (e.status === 401) {
        ecrireSession(token, "");
        setSession("");
        setDoc(null);
        return false;
      }
      setErreur(e.message);
      return false;
    }
  }, [token, chargerPdf]);

  useEffect(() => {
    let annule = false;
    (async () => {
      try {
        const i = await portailApi.info(token);
        if (annule) return;
        setInfo(i);
        const s = lireSession(token);
        if (s && (i.statut === "ACTIF" || i.statut === "SIGNE")) await chargerDocument(s);
      } catch (e) {
        if (!annule) setErreurLien(e.message);
      }
    })();
    return () => {
      annule = true;
      if (urlRef.current) window.URL.revokeObjectURL(urlRef.current);
    };
  }, [token, chargerDocument]);

  async function acceder(e) {
    e.preventDefault();
    setErreur("");
    setOccupe(true);
    try {
      const r = await portailApi.acces(token, ident, code);
      ecrireSession(token, r.session);
      setRestantes(null);
      setCode("");
      await chargerDocument(r.session);
    } catch (err) {
      setErreur(err.message);
      setRestantes(err.details && err.details.restantes != null ? err.details.restantes : null);
      if (err.status === 429) setInfo((i) => ({ ...i, statut: "BLOQUE" }));
      if (err.status === 410) setInfo((i) => ({ ...i, statut: err.code === "PORTAIL_LIEN_EXPIRE" ? "EXPIRE" : "REVOQUE" }));
    } finally {
      setOccupe(false);
    }
  }

  async function telecharger() {
    setErreur("");
    try {
      const blob = await portailApi.pdf(token, session, true);
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${info.numero_document}${doc && doc.signature ? "-signe" : ""}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
    } catch (e) {
      setErreur(e.message);
    }
  }

  async function signer(e) {
    e.preventDefault();
    setErreur("");
    setOccupe(true);
    try {
      await portailApi.signer(token, session, doc.mode_reponse === "ACCEPTATION" ? { nom, qualite, lu_approuve: lu } : { nom, qualite, lu_approuve: lu, signature: signature && signature.image, mode: signature && signature.mode });
      setInfo((i) => ({ ...i, statut: "SIGNE" }));
      await chargerDocument(session);
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (err) {
      setErreur(err.message);
      if (err.status === 401) {
        ecrireSession(token, "");
        setSession("");
        setDoc(null);
        setErreur(t("prtpSessionExpiree"));
      }
    } finally {
      setOccupe(false);
    }
  }

  const bloqueEtat = info && ["REVOQUE", "EXPIRE", "BLOQUE"].includes(info.statut) && !doc;

  return (
    <main style={{ minHeight: "100vh", background: "var(--bg)", padding: "20px 16px 60px" }}>
      <div style={{ maxWidth: 880, margin: "0 auto 14px", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
        <div style={{ fontFamily: "'Space Grotesk', sans-serif", fontWeight: 700, color: "var(--petrol)", fontSize: 18 }}>
          Baobab Marchés
        </div>
        <LanguageSwitcher />
      </div>

      {erreurLien && (
        <div style={carte}>
          <p style={{ color: "var(--brique)", fontSize: 14 }}>{erreurLien}</p>
        </div>
      )}

      {!info && !erreurLien && <div style={carte}><p style={{ color: "var(--sub)" }}>{t("prtpChargement")}</p></div>}

      {info && (
        <div style={{ ...carte, paddingBottom: 18 }}>
          <div style={{ fontSize: 11.5, fontWeight: 700, letterSpacing: "0.04em", textTransform: "uppercase", color: "var(--sub)" }}>{t(info.signature_requise === false ? "prtpTitreSimple" : info.mode_reponse === "ACCEPTATION" ? "prtpTitreAccepter" : "prtpTitre")}</div>
          <h1 style={{ fontSize: 22, color: "var(--petrol)", margin: "4px 0" }}>{libelleType(info.type_document)} {info.numero_document}</h1>
          <p style={{ fontSize: 13, color: "var(--sub)" }}>{t("prtpDe").replace("{emetteur}", info.emetteur)}</p>
        </div>
      )}

      {bloqueEtat && (
        <div style={carte}>
          <p style={{ color: "var(--brique)", fontSize: 14 }}>{t(`prtpEtat_${info.statut}`)}</p>
        </div>
      )}

      {info && !bloqueEtat && !doc && (
        <div style={carte}>
          <h2 style={{ fontSize: 16, color: "var(--petrol)", marginBottom: 10 }}>{t("prtpAccueilTitre")}</h2>
          <ol style={{ margin: "0 0 10px 20px", padding: 0, fontSize: 13.5, display: "grid", gap: 6 }}>
            <li>{t("prtpEtape1")}</li>
            <li>{t("prtpEtape2")}</li>
            <li>{t(`prtpEtape3_${info.mode_reponse || (info.signature_requise === false ? "CONSULTATION" : "SIGNATURE")}`)}</li>
          </ol>
          <p style={{ fontSize: 12, color: "var(--sub)", maxWidth: 640 }}>{t("prtpTracabilite")}</p>
        </div>
      )}

      {info && !bloqueEtat && !doc && (
        <form onSubmit={acceder} style={carte}>
          <h2 style={{ fontSize: 16, color: "var(--petrol)", marginBottom: 6 }}>{t("prtpIdentTitre")}</h2>
          <p style={{ fontSize: 13, color: "var(--sub)", marginBottom: 14, maxWidth: 560 }}>{t("prtpIdentAide")}</p>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 14, maxWidth: 640 }}>
            <div>
              <label htmlFor="portail-ident" style={labelStyle}>{t("prtpIdentifiant")}</label>
              <input id="portail-ident" style={inputStyle} value={ident} autoComplete="username" onChange={(e) => setIdent(e.target.value)} required />
            </div>
            <div>
              <label htmlFor="portail-code" style={labelStyle}>{t("prtpCode")}</label>
              <input id="portail-code" style={{ ...inputStyle, letterSpacing: 4, fontWeight: 700 }} value={code} inputMode="numeric" autoComplete="one-time-code" maxLength={8} onChange={(e) => setCode(e.target.value)} required />
            </div>
          </div>
          {erreur && <p role="alert" style={{ color: "var(--brique)", fontSize: 13, marginTop: 12 }}>{erreur}{restantes != null ? ` ${t("prtpRestantes").replace("{n}", String(restantes))}` : ""}</p>}
          <button type="submit" disabled={occupe} style={{ ...boutonPrincipalStyle, marginTop: 16 }}>{t("prtpAcceder")}</button>
        </form>
      )}

      {doc && (
        <>
          {doc.signature && (
            <div style={{ ...carte, borderColor: "#2E7D5B", background: "rgba(46,125,91,0.06)" }}>
              <h2 style={{ fontSize: 16, color: "#2E7D5B", marginBottom: 6 }}>✓ {t(doc.signature.mode === "ACCEPTATION" ? "prtpAccepteTitre" : "prtpSigneTitre")}</h2>
              <p style={{ fontSize: 13.5 }}>{t(doc.signature.mode === "ACCEPTATION" ? "prtpAccepteLe" : "prtpSigneLe").replace("{date}", fmtDateHeure(doc.signature.date_signature, langue)).replace("{nom}", doc.signature.nom_signataire)}</p>
              <p style={{ fontSize: 12.5, color: "var(--sub)", marginTop: 4 }}>{t(doc.signature.mode === "ACCEPTATION" ? "prtpCopieAcceptee" : "prtpCopieEmail")}</p>
              <button style={{ ...boutonPrincipalStyle, marginTop: 12 }} onClick={telecharger}>{t(doc.signature.mode === "ACCEPTATION" ? "prtpTelechargerAccepte" : "prtpTelechargerSigne")}</button>
            </div>
          )}

          {doc.resume && (doc.resume.montant != null || doc.resume.date || doc.resume.objet) && (
            <div style={carte}>
              <h2 style={{ fontSize: 16, color: "var(--petrol)", marginBottom: 10 }}>{t("prtpResumeTitre")}</h2>
              <dl style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: "10px 20px", margin: 0 }}>
                {doc.resume.objet && (
                  <div><dt style={{ fontSize: 11.5, color: "var(--sub)" }}>{t("prtpResumeObjet")}</dt><dd style={{ margin: 0, fontSize: 14, fontWeight: 600 }}>{doc.resume.objet}</dd></div>
                )}
                {doc.resume.montant != null && (
                  <div><dt style={{ fontSize: 11.5, color: "var(--sub)" }}>{t("prtpResumeMontant")}</dt><dd className="mono" style={{ margin: 0, fontSize: 16, fontWeight: 700, color: "var(--petrol)" }}>{Math.round(doc.resume.montant).toLocaleString(langue === "en" ? "en-GB" : "fr-FR")} XOF</dd></div>
                )}
                {doc.resume.date && (
                  <div><dt style={{ fontSize: 11.5, color: "var(--sub)" }}>{t("prtpResumeDate")}</dt><dd style={{ margin: 0, fontSize: 14, fontWeight: 600 }}>{doc.resume.date.split("-").reverse().join("/")}</dd></div>
                )}
                {doc.resume.echeance && (
                  <div><dt style={{ fontSize: 11.5, color: "var(--sub)" }}>{t("prtpResumeEcheance")}</dt><dd style={{ margin: 0, fontSize: 14, fontWeight: 600 }}>{doc.resume.echeance.split("-").reverse().join("/")}</dd></div>
                )}
                {doc.resume.validite && (
                  <div><dt style={{ fontSize: 11.5, color: "var(--sub)" }}>{t("prtpResumeValidite")}</dt><dd style={{ margin: 0, fontSize: 14, fontWeight: 600 }}>{doc.resume.validite}</dd></div>
                )}
              </dl>
              {doc.a_signer && <p style={{ fontSize: 12.5, color: "var(--sub)", marginTop: 10 }}>{t("prtpOuvrirDoc")}</p>}
            </div>
          )}

          <div style={carte}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 12 }}>
              <h2 style={{ fontSize: 16, color: "var(--petrol)" }}>{t("prtpDocument")}</h2>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                {pdfUrl && <a href={pdfUrl} target="_blank" rel="noopener noreferrer" style={{ ...boutonSecondaireStyle, textDecoration: "none", display: "inline-block" }}>{t("prtpOuvrirOnglet")}</a>}
                {!doc.signature && <button style={boutonSecondaireStyle} onClick={telecharger}>{t("prtpTelecharger")}</button>}
              </div>
            </div>
            {pdfUrl ? (
              <iframe title={`${info.numero_document}`} src={pdfUrl} style={{ width: "100%", height: 640, border: "1px solid var(--line)", borderRadius: 8, background: "#fff" }} />
            ) : (
              <p style={{ color: "var(--sub)" }}>{t("prtpChargement")}</p>
            )}
            <p style={{ fontSize: 11.5, color: "var(--sub)", marginTop: 8 }}>{t("prtpApercuAide")}</p>
            {!doc.signature && <p style={{ fontSize: 11.5, color: "var(--sub)", marginTop: 4 }}>{t("prtpExpire")} {fmtDateHeure(doc.expire_le, langue)}</p>}
          </div>

          {doc.a_signer && doc.mode_reponse === "ACCEPTATION" && (
            <form onSubmit={signer} style={carte}>
              <h2 style={{ fontSize: 16, color: "var(--petrol)", marginBottom: 6 }}>{t("prtpAccepterTitre")}</h2>
              <p style={{ fontSize: 12.5, color: "var(--sub)", marginBottom: 12, maxWidth: 620 }}>{t("prtpAccepterAide")}</p>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 14, maxWidth: 640, marginBottom: 14 }}>
                <div>
                  <label htmlFor="portail-nom" style={labelStyle}>{t("prtpNomAccepte")}</label>
                  <input id="portail-nom" style={inputStyle} value={nom} onChange={(e) => setNom(e.target.value)} required />
                </div>
                <div>
                  <label htmlFor="portail-qualite" style={labelStyle}>{t("prtpQualite")}</label>
                  <input id="portail-qualite" style={inputStyle} value={qualite} onChange={(e) => setQualite(e.target.value)} />
                </div>
              </div>
              <label htmlFor="portail-lu" style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 13.5, fontWeight: 600, margin: "4px 0 12px" }}>
                <input id="portail-lu" type="checkbox" checked={lu} onChange={(e) => setLu(e.target.checked)} /> {t("prtpLuAccepte")}
              </label>
              {erreur && <p role="alert" style={{ color: "var(--brique)", fontSize: 13, marginBottom: 10 }}>{erreur}</p>}
              <button type="submit" disabled={occupe || !lu || nom.trim().length < 3} style={boutonPrincipalStyle}>{t("prtpAccepter")}</button>
            </form>
          )}

          {doc.a_signer && doc.mode_reponse !== "ACCEPTATION" && (
            <form onSubmit={signer} style={carte}>
              <h2 style={{ fontSize: 16, color: "var(--petrol)", marginBottom: 12 }}>{t("prtpSignerTitre")}</h2>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 14, maxWidth: 640, marginBottom: 14 }}>
                <div>
                  <label htmlFor="portail-nom" style={labelStyle}>{t("prtpNom")}</label>
                  <input id="portail-nom" style={inputStyle} value={nom} onChange={(e) => setNom(e.target.value)} required />
                </div>
                <div>
                  <label htmlFor="portail-qualite" style={labelStyle}>{t("prtpQualite")}</label>
                  <input id="portail-qualite" style={inputStyle} value={qualite} onChange={(e) => setQualite(e.target.value)} />
                </div>
              </div>
              <label style={{ ...labelStyle, marginBottom: 6 }}>{t("prtpSignatureAide")}</label>
              <SignaturePad t={t} onChange={setSignature} />
              <label style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 13.5, fontWeight: 600, margin: "16px 0 8px" }}>
                <input type="checkbox" checked={lu} onChange={(e) => setLu(e.target.checked)} /> {t("prtpLu")}
              </label>
              <p style={{ fontSize: 12, color: "var(--sub)", marginBottom: 12, maxWidth: 620 }}>{t("prtpSignatureInfo")}</p>
              {erreur && <p role="alert" style={{ color: "var(--brique)", fontSize: 13, marginBottom: 10 }}>{erreur}</p>}
              <button type="submit" disabled={occupe || !signature || !lu || nom.trim().length < 3} style={boutonPrincipalStyle}>{t("prtpSigner")}</button>
            </form>
          )}
          {!doc.a_signer && erreur && <p role="alert" style={{ color: "var(--brique)", fontSize: 13, textAlign: "center" }}>{erreur}</p>}
        </>
      )}
    </main>
  );
}
