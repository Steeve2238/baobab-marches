"use client";

import { useCallback, useEffect, useState } from "react";
import { superAdminApi } from "../superAdminApi";
import { api as apiEntreprise } from "../api";
import { useLangue } from "../i18n/LanguageContext";
import { inputStyle, labelStyle, boutonPrincipalStyle, boutonSecondaireStyle, boutonDangerStyle } from "../comptaUi";

const fmtDateHeure = (d, langue) => (d ? new Date(d).toLocaleString(langue === "en" ? "en-GB" : "fr-FR", { dateStyle: "short", timeStyle: "short" }) : "");
const COULEURS = {
  ACTIF: { color: "#9A6A00", background: "rgba(200,140,0,0.13)" },
  SIGNE: { color: "#2E7D5B", background: "rgba(46,125,91,0.12)" },
  EXPIRE: { color: "var(--sub)", background: "rgba(91,106,108,0.1)" },
  REVOQUE: { color: "var(--brique)", background: "rgba(196,74,58,0.1)" },
  BLOQUE: { color: "var(--brique)", background: "rgba(196,74,58,0.1)" },
};
export const pastilleEtat = (statut) => ({ fontSize: 10.5, fontWeight: 700, padding: "3px 8px", borderRadius: 20, whiteSpace: "nowrap", ...(COULEURS[statut] || COULEURS.EXPIRE) });

/** Numero WhatsApp international : 9 chiffres (Senegal) => prefixe 221. */
export function numeroWhatsApp(tel) {
  let d = String(tel || "").replace(/\D/g, "");
  if (d.startsWith("00")) d = d.slice(2);
  if (d.length === 9) d = `221${d}`;
  return d;
}

/** Passerelles vers l'API : Super Admin (offres, contrats) ou entreprise (factures, devis). */
const PASSERELLE_EDITEUR = {
  lister: (type, id) => superAdminApi.getPartages(`?type=${type}&document=${id}`),
  creer: (type, id, f) => (type === "OFFRE" ? superAdminApi.creerPartageOffre(id, f) : superAdminApi.creerPartageContrat(id, f)),
  renouveler: (id, d) => superAdminApi.renouvelerPartage(id, d),
  revoquer: (id) => superAdminApi.revoquerPartage(id),
  detail: (id) => superAdminApi.getPartage(id),
  telecharger: (id) => superAdminApi.telechargerPartage(id),
};
export const PASSERELLE_ENTREPRISE = {
  lister: (type, id) => apiEntreprise.getPartagesVente(`?type=${type}&document=${id}`),
  creer: (type, id, f) => apiEntreprise.creerPartageVente(type === "FACTURE" ? "factures" : "devis", id, f),
  renouveler: (id, d) => apiEntreprise.renouvelerPartageVente(id, d),
  revoquer: (id) => apiEntreprise.revoquerPartageVente(id),
  detail: (id) => apiEntreprise.getPartageVente(id),
  telecharger: (id) => apiEntreprise.telechargerPartageVente(id),
};
const TYPE_CLE = { OFFRE: "prtTypeOffre", CONTRAT: "prtTypeContrat", FACTURE: "prtTypeFacture", DEVIS: "prtTypeDevis" };
export const cleTypeDocument = (type) => TYPE_CLE[type] || "prtTypeContrat";

/** Les cinq etapes suivies, avec la date quand elles sont atteintes. */
export function EtapesPartage({ p, t, langue }) {
  const etapes = [
    ["prtEtapeCree", p.date_creation],
    ...(p.destinataire_email ? [["prtEtapeEnvoye", p.date_envoi_email]] : []),
    ["prtEtapeOuvert", p.premiere_ouverture],
    ["prtEtapeConsulte", p.date_consultation],
    ["prtEtapeTelecharge", p.date_telechargement],
    ...(p.signature_requise !== false ? [["prtEtapeSigne", p.date_signature]] : []),
  ];
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
      {etapes.map(([cle, date]) => (
        <span
          key={cle}
          title={date ? fmtDateHeure(date, langue) : ""}
          style={{ fontSize: 11, padding: "3px 9px", borderRadius: 20, border: "1px solid var(--line)", background: date ? "rgba(46,125,91,0.1)" : "transparent", color: date ? "#2E7D5B" : "var(--sub)", fontWeight: date ? 600 : 400 }}
        >
          {date ? "✓ " : "○ "}
          {t(cle)}
          {date ? ` · ${fmtDateHeure(date, langue)}` : ""}
        </span>
      ))}
    </div>
  );
}

export function JournalPartage({ evenements, t, langue }) {
  return (
    <div style={{ marginTop: 8, border: "1px solid var(--line)", borderRadius: 8, overflow: "hidden" }}>
      {evenements.map((e, i) => (
        <div key={i} style={{ display: "grid", gridTemplateColumns: "130px 1fr 110px", gap: 8, padding: "6px 10px", fontSize: 12, borderTop: i ? "1px solid var(--line-soft)" : "none" }}>
          <span style={{ color: "var(--sub)" }}>{fmtDateHeure(e.date_evenement, langue)}</span>
          <span>{t(`prtEvt_${e.evenement}`)}</span>
          <span style={{ color: "var(--sub)", textAlign: "right" }}>{e.ip || ""}</span>
        </div>
      ))}
    </div>
  );
}

/**
 * Carte « Remise securisee et signature en ligne » d'une offre ou d'un contrat (Super Admin).
 * @param type "OFFRE" | "CONTRAT" | "FACTURE" | "DEVIS"  @param peutCreer le document est encore dans un etat ou l'on peut l'envoyer
 * @param passerelle PASSERELLE_ENTREPRISE pour une facture/un devis ; par defaut Super Admin (offres, contrats)
 * @param contact { email, telephone, nom } du client, pour pre-remplir l'envoi
 * @param optionSignature affiche « Demander la signature du client » (factures, devis) ; signatureDefaut = valeur initiale
 */
export default function PartageDocument({ type, documentId, numero, emailParDefaut, contact, peutCreer, onChange, passerelle = PASSERELLE_EDITEUR, optionSignature = false, signatureDefaut = false }) {
  const vente = passerelle !== PASSERELLE_EDITEUR;
  const { t, langue } = useLangue();
  const [liste, setListe] = useState([]);
  const [detail, setDetail] = useState(null);
  const [formOuvert, setFormOuvert] = useState(false);
  const [form, setForm] = useState({ email: (contact && contact.email) || emailParDefaut || "", telephone: (contact && contact.telephone) || "", nom: (contact && contact.nom) || "", jours: 30, envoyer_email: true, message: "", signature_requise: signatureDefaut });
  const [renvoyerMail, setRenvoyerMail] = useState(false);
  const [resultat, setResultat] = useState(null);
  const [copie, setCopie] = useState("");
  const [erreur, setErreur] = useState("");
  const [occupe, setOccupe] = useState(false);

  const charger = useCallback(async () => {
    try {
      const l = await passerelle.lister(type, documentId);
      setListe(l);
      if (l[0]) setDetail((d) => (d && d.id === l[0].id ? d : null));
    } catch (e) {
      setErreur(e.message);
    }
  }, [type, documentId, passerelle]);

  useEffect(() => {
    charger();
  }, [charger]);

  useEffect(() => {
    setForm((f) => ({ ...f, email: f.email || (contact && contact.email) || emailParDefaut || "", telephone: f.telephone || (contact && contact.telephone) || "", nom: f.nom || (contact && contact.nom) || "" }));
  }, [emailParDefaut, contact && contact.email, contact && contact.telephone, contact && contact.nom]);

  const courant = liste[0] || null;
  const actif = courant && courant.statut !== "SIGNE" && courant.statut !== "REVOQUE";

  async function agir(fn) {
    setErreur("");
    setOccupe(true);
    try {
      const r = await fn();
      await charger();
      if (onChange) onChange();
      return r;
    } catch (e) {
      setErreur(e.message);
    } finally {
      setOccupe(false);
    }
  }

  async function creer() {
    const r = await agir(() => passerelle.creer(type, documentId, form));
    if (r) {
      setResultat({ ...r, tel: form.telephone, email: form.email });
      setFormOuvert(false);
    }
  }

  async function renouveler() {
    const r = await agir(() => passerelle.renouveler(courant.id, { envoyer_email: renvoyerMail }));
    if (r) setResultat({ ...r, tel: courant.destinataire_tel, email: courant.destinataire_email });
  }

  async function copier(texte, cle) {
    try {
      await navigator.clipboard.writeText(texte);
      setCopie(cle);
      setTimeout(() => setCopie(""), 1500);
    } catch (e) {
      /* presse-papiers indisponible : l'utilisateur peut selectionner le texte */
    }
  }

  async function voirDetail() {
    if (detail) return setDetail(null);
    try {
      setDetail(await passerelle.detail(courant.id));
    } catch (e) {
      setErreur(e.message);
    }
  }

  const libelleDoc = `${t(cleTypeDocument(type))} ${numero}`;
  const lienComplet = (lien) => (lien && lien.startsWith("/") && typeof window !== "undefined" ? `${window.location.origin}${lien}` : lien);

  function lienWhatsApp(r) {
    const num = numeroWhatsApp(r.tel);
    const lien = lienComplet(r.lien);
    const simple = r.partage && r.partage.signature_requise === false;
    const modele = r.email_envoye ? (simple ? "prtWaCodeSimple" : "prtWaCode") : simple ? "prtWaLienCodeSimple" : "prtWaLienCode";
    const texte = t(modele).replace("{document}", libelleDoc).replace("{lien}", lien).replace("{code}", r.code);
    return `https://wa.me/${num}?text=${encodeURIComponent(texte)}`;
  }

  return (
    <div style={{ border: "1px solid var(--line)", borderRadius: 10, padding: 16, marginTop: 14, background: "#fff" }}>
      <h3 style={{ fontSize: 14, color: "var(--petrol)" }}>{t(vente ? "prtCarteTitreVente" : "prtCarteTitre")}</h3>
      <p style={{ fontSize: 12, color: "var(--sub)", margin: "4px 0 12px", maxWidth: 680 }}>{t(vente ? "prtCarteAideVente" : "prtCarteAide")}</p>
      {erreur && <p style={{ color: "var(--brique)", fontSize: 12.5, marginBottom: 8 }}>{erreur}</p>}

      {resultat && (
        <div style={{ border: "1px solid #2E7D5B", background: "rgba(46,125,91,0.06)", borderRadius: 10, padding: 14, marginBottom: 12 }}>
          <strong style={{ fontSize: 13, color: "#2E7D5B" }}>{t("prtLienEtCode")}</strong>
          <p style={{ fontSize: 12.5, margin: "6px 0" }}>
            {resultat.email_envoye ? t("prtEmailEnvoye").replace("{email}", resultat.email || "") : t("prtEmailNonEnvoye")}
          </p>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "stretch", margin: "8px 0" }}>
            <div style={{ border: "1px solid var(--line)", borderRadius: 8, padding: "8px 14px", background: "#fff" }}>
              <div style={{ fontSize: 11, color: "var(--sub)" }}>{t("prtCode")}</div>
              <div className="mono" style={{ fontSize: 26, fontWeight: 700, letterSpacing: 4, color: "var(--petrol)" }}>{resultat.code}</div>
            </div>
            <div style={{ flex: 1, minWidth: 260, border: "1px solid var(--line)", borderRadius: 8, padding: "8px 14px", background: "#fff" }}>
              <div style={{ fontSize: 11, color: "var(--sub)" }}>{t("prtLien")}</div>
              <div style={{ fontSize: 12, wordBreak: "break-all", userSelect: "all" }}>{lienComplet(resultat.lien)}</div>
            </div>
          </div>
          <p style={{ fontSize: 12, color: "#9A6A00", margin: "6px 0 10px" }}>{t("prtCodeAvertissement")}</p>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button style={boutonSecondaireStyle} onClick={() => copier(resultat.code, "code")}>{copie === "code" ? t("prtCopie") : `${t("prtCopier")} ${t("prtCode").toLowerCase()}`}</button>
            <button style={boutonSecondaireStyle} onClick={() => copier(lienComplet(resultat.lien), "lien")}>{copie === "lien" ? t("prtCopie") : `${t("prtCopier")} ${t("prtLien").toLowerCase()}`}</button>
            {resultat.tel && (
              <a href={lienWhatsApp(resultat)} target="_blank" rel="noopener noreferrer" style={{ ...boutonPrincipalStyle, textDecoration: "none", display: "inline-block" }}>
                {resultat.email_envoye ? t("prtWhatsAppCode") : t("prtWhatsAppLienCode")}
              </a>
            )}
            <button style={boutonSecondaireStyle} onClick={() => setResultat(null)}>{t("prtFermer")}</button>
          </div>
        </div>
      )}

      {courant && (
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 8 }}>
            <span style={pastilleEtat(courant.statut)}>{t(`prtStatut_${courant.statut}`)}</span>
            <span style={{ fontSize: 12, color: "var(--sub)" }}>
              {courant.destinataire_email || courant.destinataire_tel}
              {courant.destinataire_nom ? ` · ${courant.destinataire_nom}` : ""} · {t("prtCreeLe")} {fmtDateHeure(courant.date_creation, langue)}
              {courant.statut !== "SIGNE" ? ` · ${t("prtExpire")} ${fmtDateHeure(courant.expire_le, langue)}` : ""}
            </span>
          </div>
          <EtapesPartage p={courant} t={t} langue={langue} />
          {courant.statut === "SIGNE" && (
            <p style={{ fontSize: 12.5, color: "#2E7D5B", marginTop: 8 }}>
              {t("prtSigneLe").replace("{date}", fmtDateHeure(courant.date_signature, langue)).replace("{nom}", courant.signataire || "")}
            </p>
          )}
          {courant.statut === "SIGNE" && type === "DEVIS" && <p style={{ fontSize: 12, color: "var(--sub)", marginTop: 4 }}>{t("prtDevisSigneAide")}</p>}
          {courant.signature_requise === false && <p style={{ fontSize: 11.5, color: "var(--sub)", marginTop: 6 }}>{t("prtSansSignature")}</p>}
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 12, alignItems: "center" }}>
            <button style={boutonSecondaireStyle} disabled={occupe} onClick={() => agir(() => passerelle.telecharger(courant.id))}>
              {courant.statut === "SIGNE" ? t("prtTelechargerSigne") : t("prtTelechargerEnvoye")}
            </button>
            {courant.statut !== "SIGNE" && courant.statut !== "REVOQUE" && (
              <>
                <button style={boutonSecondaireStyle} disabled={occupe} onClick={renouveler}>{t("prtRenouveler")}</button>
                {courant.destinataire_email && (
                  <label style={{ fontSize: 12, display: "flex", gap: 5, alignItems: "center" }}>
                    <input type="checkbox" checked={renvoyerMail} onChange={(e) => setRenvoyerMail(e.target.checked)} /> {t("prtRenouvelerEmail")}
                  </label>
                )}
                <button style={boutonDangerStyle} disabled={occupe} onClick={() => { if (window.confirm(t("prtRevoquerConfirm"))) agir(() => passerelle.revoquer(courant.id)); }}>{t("prtRevoquer")}</button>
              </>
            )}
            <button style={{ ...boutonSecondaireStyle, marginLeft: "auto" }} onClick={voirDetail}>{detail ? t("prtMasquer") : t("prtDetail")}</button>
          </div>
          {detail && <JournalPartage evenements={detail.evenements} t={t} langue={langue} />}
          {detail && detail.empreinte_document && (
            <p style={{ fontSize: 11, color: "var(--sub)", marginTop: 6, wordBreak: "break-all" }}>{t("prtEmpreinte")} (SHA-256) : {detail.empreinte_document}</p>
          )}
        </div>
      )}

      {!courant && !formOuvert && <p style={{ fontSize: 12.5, color: "var(--sub)", marginBottom: 8 }}>{t(vente ? "prtAucunEnvoi" : "prtAucunPartage")}</p>}

      {peutCreer && !actif && !formOuvert && !(courant && courant.statut === "SIGNE" && vente) && (
        <div style={{ marginTop: courant ? 12 : 0 }}>
          <button style={boutonPrincipalStyle} onClick={() => { setFormOuvert(true); setResultat(null); }}>{t(vente ? "prtCreerVente" : "prtCreer")}</button>
        </div>
      )}

      {formOuvert && (
        <div style={{ borderTop: courant ? "1px solid var(--line-soft)" : "none", paddingTop: courant ? 12 : 0, marginTop: courant ? 12 : 0 }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 12 }}>
            <div>
              <label htmlFor={`prt-${type}-email`} style={labelStyle}>{t("prtChampEmail")}</label>
              <input style={inputStyle} type="email" id={`prt-${type}-email`} value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
            </div>
            <div>
              <label htmlFor={`prt-${type}-tel`} style={labelStyle}>{t("prtChampTel")}</label>
              <input style={inputStyle} value={form.telephone} id={`prt-${type}-tel`} placeholder="+221 77 000 00 00" onChange={(e) => setForm({ ...form, telephone: e.target.value })} />
            </div>
            <div>
              <label htmlFor={`prt-${type}-nom`} style={labelStyle}>{t("prtChampNom")}</label>
              <input style={inputStyle} value={form.nom} id={`prt-${type}-nom`} onChange={(e) => setForm({ ...form, nom: e.target.value })} />
            </div>
            <div>
              <label htmlFor={`prt-${type}-jours`} style={labelStyle}>{t("prtChampJours")}</label>
              <input style={inputStyle} type="number" id={`prt-${type}-jours`} min="1" max="180" value={form.jours} onChange={(e) => setForm({ ...form, jours: e.target.value })} />
            </div>
          </div>
          <p style={{ fontSize: 11.5, color: "var(--sub)", margin: "6px 0 10px" }}>{t("prtDestinataireAide")}</p>
          {optionSignature && (
            <div style={{ marginBottom: 10 }}>
              <label htmlFor={`prt-${type}-signature`} style={{ fontSize: 12.5, display: "flex", gap: 6, alignItems: "center" }}>
                <input id={`prt-${type}-signature`} type="checkbox" checked={!!form.signature_requise} onChange={(e) => setForm({ ...form, signature_requise: e.target.checked })} /> {t("prtSignatureDemander")}
              </label>
              <p style={{ fontSize: 11.5, color: "var(--sub)", marginTop: 3 }}>{t(type === "FACTURE" ? "prtSignatureAideFacture" : "prtSignatureAideDevis")}</p>
            </div>
          )}
          <label style={{ fontSize: 12.5, display: "flex", gap: 6, alignItems: "center", marginBottom: 8 }}>
            <input type="checkbox" checked={form.envoyer_email} disabled={!form.email} onChange={(e) => setForm({ ...form, envoyer_email: e.target.checked })} /> {t("prtEnvoyerEmail")}
          </label>
          {form.envoyer_email && form.email && (
            <div style={{ marginBottom: 10 }}>
              <label style={labelStyle}>{t("prtMessage")}</label>
              <textarea style={{ ...inputStyle, minHeight: 70 }} value={form.message} onChange={(e) => setForm({ ...form, message: e.target.value })} />
              <p style={{ fontSize: 11.5, color: "var(--sub)", marginTop: 3 }}>{t("prtMessageAide")}</p>
            </div>
          )}
          <div style={{ display: "flex", gap: 8 }}>
            <button style={boutonPrincipalStyle} disabled={occupe || (!form.email && !form.telephone)} onClick={creer}>{t("prtGenerer")}</button>
            <button style={boutonSecondaireStyle} onClick={() => setFormOuvert(false)}>{t("prtAnnuler")}</button>
          </div>
        </div>
      )}
    </div>
  );
}
