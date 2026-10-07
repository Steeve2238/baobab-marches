"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { superAdminApi } from "../../../../lib/superAdminApi";
import { useLangue } from "../../../../lib/i18n/LanguageContext";
import SuperAdminShell from "../../../../lib/components/SuperAdminShell";
import OffreFormulaire from "../../../../lib/components/OffreFormulaire";
import { inputStyle, labelStyle, boutonPrincipalStyle, boutonSecondaireStyle, boutonDangerStyle, thStyle, tdStyle } from "../../../../lib/comptaUi";
import { STYLE_STATUT_OFFRE } from "../page";

const mm = (n) => Math.round(Number(n) || 0).toLocaleString("fr-FR");
const fmtDate = (d) => (d ? String(d).slice(0, 10).split("-").reverse().join("/") : "");
const aujourdhui = () => new Date().toISOString().slice(0, 10);
const STYLE_STATUT_CONTRAT = {
  PREPARE: { color: "#9A6A00", background: "rgba(200,140,0,0.13)" },
  ENVOYE: { color: "#9A6A00", background: "rgba(200,140,0,0.13)" },
  SIGNE: { color: "#2E7D5B", background: "rgba(46,125,91,0.12)" },
  RESILIE: { color: "var(--brique)", background: "rgba(196,74,58,0.1)" },
};
const pastille = (style) => ({ fontSize: 10.5, fontWeight: 700, padding: "3px 8px", borderRadius: 20, whiteSpace: "nowrap", ...style });

export default function SuperAdminOffreDetailPage() {
  const router = useRouter();
  const params = useParams();
  const { t } = useLangue();
  const [offre, setOffre] = useState(null);
  const [contrat, setContrat] = useState(null);
  const [clients, setClients] = useState([]);
  const [formules, setFormules] = useState([]);
  const [edition, setEdition] = useState(false);
  const [erreur, setErreur] = useState("");
  const [info, setInfo] = useState("");
  const [occupe, setOccupe] = useState(false);
  const [panneau, setPanneau] = useState(""); // "offre-mail" | "accepter" | "refuser" | "contrat-mail"
  const [mail, setMail] = useState({ destinataire: "", sujet: "", message: "" });
  const [acc, setAcc] = useState({ date_acceptation: aujourdhui(), note: "" });
  const [motif, setMotif] = useState("");
  const [signe, setSigne] = useState({ date: aujourdhui(), fichier: null });
  const inputFichier = useRef(null);

  const charger = useCallback(async () => {
    try {
      const o = await superAdminApi.getOffre(params.id);
      setOffre(o);
      setContrat(o.contrat_id ? await superAdminApi.getContrat(o.contrat_id) : null);
    } catch (err) {
      if (err.status === 401) return router.push("/super-admin/login");
      setErreur(err.message);
    }
  }, [params.id, router]);

  useEffect(() => {
    charger();
    Promise.all([superAdminApi.getClients(), superAdminApi.getFormules()]).then(([c, f]) => {
      setClients(c);
      setFormules(f);
    }).catch(() => {});
  }, [charger]);

  async function agir(fn, messageOk) {
    setErreur("");
    setInfo("");
    setOccupe(true);
    try {
      await fn();
      if (messageOk) setInfo(messageOk);
      setPanneau("");
      await charger();
    } catch (err) {
      setErreur(err.message);
    } finally {
      setOccupe(false);
    }
  }

  if (!offre) {
    return (
      <SuperAdminShell title={t("saOffTitre")} backHref="/super-admin/offres" backLabelKey="saOffRetourListe">
        {erreur ? <p style={{ color: "var(--brique)", fontSize: 12.5 }}>{erreur}</p> : <p style={{ fontSize: 12.5, color: "var(--sub)" }}>{t("loading")}</p>}
      </SuperAdminShell>
    );
  }

  const modifiable = ["BROUILLON", "ENVOYEE"].includes(offre.statut);
  const ouvrirMailOffre = () => {
    setMail({
      destinataire: offre.destinataire_email || "",
      sujet: `${t("saOffMailSujet")} ${offre.numero}`,
      message: t("saOffMailCorps").replace("{numero}", offre.numero).replace("{client}", offre.client_raison_sociale),
    });
    setPanneau("offre-mail");
  };
  const ouvrirMailContrat = () => {
    setMail({
      destinataire: offre.destinataire_email || contrat?.envoye_a || "",
      sujet: `${t("saCtrMailSujet")} ${contrat.numero}`,
      message: t("saCtrMailCorps").replace("{numero}", contrat.numero).replace("{client}", offre.client_raison_sociale),
    });
    setPanneau("contrat-mail");
  };

  const blocMail = (envoyer) => (
    <div className="card" style={{ background: "var(--line-soft)", marginTop: 12 }}>
      <label style={labelStyle}>{t("saOffMailA")}</label>
      <input type="email" value={mail.destinataire} onChange={(e) => setMail({ ...mail, destinataire: e.target.value })} style={{ ...inputStyle, marginBottom: 10 }} />
      <label style={labelStyle}>{t("saOffMailSujetLabel")}</label>
      <input value={mail.sujet} onChange={(e) => setMail({ ...mail, sujet: e.target.value })} style={{ ...inputStyle, marginBottom: 10 }} />
      <label style={labelStyle}>{t("saOffMailMessage")}</label>
      <textarea rows={9} value={mail.message} onChange={(e) => setMail({ ...mail, message: e.target.value })} style={{ ...inputStyle, resize: "vertical", marginBottom: 10 }} />
      <p style={{ fontSize: 11.5, color: "var(--sub)", marginBottom: 10 }}>{t("saOffMailAide")}</p>
      <div style={{ display: "flex", gap: 8 }}>
        <button disabled={occupe} style={boutonPrincipalStyle} onClick={envoyer}>{t("saOffEnvoyer")}</button>
        <button style={boutonSecondaireStyle} onClick={() => setPanneau("")}>{t("cancel")}</button>
      </div>
    </div>
  );

  return (
    <SuperAdminShell title={`${t("saOffOffre")} ${offre.numero}`} backHref="/super-admin/offres" backLabelKey="saOffRetourListe">
      {erreur && <p style={{ color: "var(--brique)", fontSize: 12.5, marginBottom: 12 }}>{erreur}</p>}
      {info && <p style={{ color: "#2E7D5B", fontSize: 12.5, marginBottom: 12 }}>{info}</p>}

      {edition ? (
        <OffreFormulaire
          initial={offre}
          clients={clients}
          formules={formules}
          libelleBouton={t("saOffEnregistrer")}
          onAnnuler={() => setEdition(false)}
          onSubmit={async (data) => {
            await superAdminApi.modifierOffre(offre.id, data);
            setEdition(false);
            setInfo(t("saOffModifiee"));
            await charger();
          }}
        />
      ) : (
        <>
          <div className="card" style={{ marginBottom: 16 }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", marginBottom: 10 }}>
              <div>
                <div style={{ fontSize: 15, fontWeight: 700 }}>{offre.client_raison_sociale}</div>
                <div style={{ fontSize: 12, color: "var(--sub)", marginTop: 2 }}>
                  {offre.formule_nom || "-"} · {t(`saOffMode${offre.mode_hebergement}`)} · {offre.duree_mois} {t("saOffMois")} · {t("saOffValableJusquau")} {fmtDate(offre.date_validite)}
                </div>
              </div>
              <div>
                <span style={pastille(STYLE_STATUT_OFFRE[offre.statut])}>{t(`saOffStatut_${offre.statut}`)}</span>
                {offre.expiree && <span style={{ fontSize: 11, color: "var(--brique)", marginLeft: 6 }}>{t("saOffExpiree")}</span>}
              </div>
            </div>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead><tr><th style={thStyle}>{t("saOffColDesignation")}</th><th style={{ ...thStyle, textAlign: "right" }}>{t("saOffColQte")}</th><th style={{ ...thStyle, textAlign: "right" }}>{t("saOffColPrix")}</th><th style={{ ...thStyle, textAlign: "right" }}>{t("saOffColMontant")}</th></tr></thead>
              <tbody>
                {offre.lignes.map((l, i) => (
                  <tr key={i}>
                    <td style={tdStyle}><div style={{ fontWeight: 600 }}>{l.libelle}</div>{l.description && <div style={{ fontSize: 11, color: "var(--sub)" }}>{l.description}</div>}</td>
                    <td style={{ ...tdStyle, textAlign: "right" }}>{String(l.quantite).replace(".", ",")} {l.unite}</td>
                    <td style={{ ...tdStyle, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{mm(l.prix_unitaire)}</td>
                    <td style={{ ...tdStyle, textAlign: "right", fontVariantNumeric: "tabular-nums", fontWeight: 700 }}>{mm(l.montant)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div style={{ textAlign: "right", marginTop: 10, fontSize: 12.5, lineHeight: 1.7 }}>
              {Number(offre.remise_pct) > 0 && <div>{t("saOffRemise")} : {String(offre.remise_pct).replace(".", ",")} %</div>}
              {Number(offre.tva_pct) > 0 && <div>{t("saOffTotalHt")} : {mm(offre.totaux.total_ht)} XOF · {t("saOffTva")} : {mm(offre.totaux.total_tva)} XOF</div>}
              <div style={{ fontSize: 15, fontWeight: 700, color: "var(--petrol)" }}>{Number(offre.tva_pct) > 0 ? t("saOffTotalTtc") : t("saOffTotalNet")} : {mm(offre.totaux.total_ttc)} XOF</div>
            </div>
            {offre.date_envoi && <p style={{ fontSize: 11.5, color: "var(--sub)", marginTop: 10 }}>{t("saOffEnvoyeA")} {offre.envoye_a} · {new Date(offre.date_envoi).toLocaleDateString("fr-FR")}</p>}
            {offre.statut === "ACCEPTEE" && <p style={{ fontSize: 11.5, color: "#2E7D5B", marginTop: 6 }}>{t("saOffAccepteeLe")} {fmtDate(offre.date_acceptation)}{offre.note_acceptation ? ` · ${offre.note_acceptation}` : ""}</p>}
            {offre.statut === "REFUSEE" && offre.motif_refus && <p style={{ fontSize: 11.5, color: "var(--brique)", marginTop: 6 }}>{t("saOffMotifRefus")} : {offre.motif_refus}</p>}
          </div>

          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 6 }}>
            <button style={boutonSecondaireStyle} onClick={() => agir(() => superAdminApi.telechargerOffre(offre.id))}>{t("saOffTelechargerPdf")}</button>
            {modifiable && <button style={boutonSecondaireStyle} onClick={() => setEdition(true)}>{t("saOffModifier")}</button>}
            {modifiable && <button style={boutonPrincipalStyle} onClick={ouvrirMailOffre}>{t("saOffEnvoyerMail")}</button>}
            {modifiable && <button style={{ ...boutonPrincipalStyle, background: "#2E7D5B" }} onClick={() => setPanneau("accepter")}>{t("saOffMarquerAcceptee")}</button>}
            {modifiable && <button style={boutonDangerStyle} onClick={() => setPanneau("refuser")}>{t("saOffMarquerRefusee")}</button>}
            {modifiable && <button style={boutonDangerStyle} onClick={() => agir(() => superAdminApi.annulerOffre(offre.id), t("saOffAnnulee"))}>{t("saOffAnnuler")}</button>}
            <Link href={`/super-admin/clients/${offre.tenant_id}`} style={{ ...boutonSecondaireStyle, textDecoration: "none", display: "inline-block" }}>{t("saOffVoirClient")}</Link>
          </div>

          {panneau === "offre-mail" && blocMail(() => agir(() => superAdminApi.envoyerOffre(offre.id, mail), t("saOffEnvoyee")))}
          {panneau === "accepter" && (
            <div className="card" style={{ background: "var(--line-soft)", marginTop: 12, maxWidth: 520 }}>
              <p style={{ fontSize: 12.5, marginBottom: 10 }}>{t("saOffAccepterAide")}</p>
              <label style={labelStyle}>{t("saOffDateAcceptation")}</label>
              <input type="date" value={acc.date_acceptation} onChange={(e) => setAcc({ ...acc, date_acceptation: e.target.value })} style={{ ...inputStyle, marginBottom: 10, maxWidth: 200 }} />
              <label style={labelStyle}>{t("saOffNoteAcceptation")}</label>
              <input value={acc.note} onChange={(e) => setAcc({ ...acc, note: e.target.value })} style={{ ...inputStyle, marginBottom: 10 }} />
              <div style={{ display: "flex", gap: 8 }}>
                <button disabled={occupe} style={boutonPrincipalStyle} onClick={() => agir(() => superAdminApi.accepterOffre(offre.id, acc), t("saOffAcceptee"))}>{t("saOffConfirmerAcceptation")}</button>
                <button style={boutonSecondaireStyle} onClick={() => setPanneau("")}>{t("cancel")}</button>
              </div>
            </div>
          )}
          {panneau === "refuser" && (
            <div className="card" style={{ background: "var(--line-soft)", marginTop: 12, maxWidth: 520 }}>
              <label style={labelStyle}>{t("saOffMotifRefus")}</label>
              <input value={motif} onChange={(e) => setMotif(e.target.value)} style={{ ...inputStyle, marginBottom: 10 }} />
              <div style={{ display: "flex", gap: 8 }}>
                <button disabled={occupe} style={boutonDangerStyle} onClick={() => agir(() => superAdminApi.refuserOffre(offre.id, { motif }), t("saOffRefusee"))}>{t("saOffMarquerRefusee")}</button>
                <button style={boutonSecondaireStyle} onClick={() => setPanneau("")}>{t("cancel")}</button>
              </div>
            </div>
          )}

          {contrat && (
            <div className="card" style={{ marginTop: 20 }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", marginBottom: 8 }}>
                <h3 style={{ fontSize: 14, color: "var(--petrol)" }}>{t("saCtrTitre")} {contrat.numero}</h3>
                <span style={pastille(STYLE_STATUT_CONTRAT[contrat.statut])}>{t(`saCtrStatut_${contrat.statut}`)}</span>
              </div>
              <p style={{ fontSize: 12, color: "var(--sub)", marginBottom: 10 }}>
                {t("saCtrEffet")} {fmtDate(contrat.date_effet)} → {fmtDate(contrat.date_fin)} · {t(`saOffMode${contrat.variante}`)}
              </p>
              {contrat.avertissements.length > 0 && contrat.statut === "PREPARE" && (
                <div style={{ border: "1px solid rgba(200,140,0,0.4)", background: "rgba(200,140,0,0.08)", borderRadius: 8, padding: "8px 12px", marginBottom: 12, fontSize: 12 }}>
                  <strong>{t("saCtrAvertissements")}</strong>
                  <ul style={{ margin: "6px 0 0 18px" }}>{contrat.avertissements.map((a) => <li key={a}>{t(`saCtrWarn_${a}`)}</li>)}</ul>
                </div>
              )}
              <p style={{ fontSize: 11.5, color: "var(--sub)", marginBottom: 10 }}>{t("saCtrAide")}</p>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <button style={boutonSecondaireStyle} onClick={() => agir(() => superAdminApi.telechargerContrat(contrat.id))}>{t("saCtrTelecharger")}</button>
                {contrat.statut === "PREPARE" && <button style={boutonSecondaireStyle} onClick={() => agir(() => superAdminApi.regenererContrat(contrat.id), t("saCtrRegenere"))}>{t("saCtrRegenerer")}</button>}
                {["PREPARE", "ENVOYE"].includes(contrat.statut) && <button style={boutonPrincipalStyle} onClick={ouvrirMailContrat}>{t("saCtrEnvoyer")}</button>}
                {contrat.a_un_fichier_signe && <button style={boutonSecondaireStyle} onClick={() => agir(() => superAdminApi.telechargerContratSigne(contrat.id))}>{t("saCtrTelechargerSigne")}</button>}
              </div>
              {contrat.date_envoi && <p style={{ fontSize: 11.5, color: "var(--sub)", marginTop: 10 }}>{t("saOffEnvoyeA")} {contrat.envoye_a} · {new Date(contrat.date_envoi).toLocaleDateString("fr-FR")}</p>}
              {panneau === "contrat-mail" && blocMail(() => agir(() => superAdminApi.envoyerContrat(contrat.id, mail), t("saCtrEnvoye")))}

              {contrat.statut !== "RESILIE" && (
                <div style={{ marginTop: 16, paddingTop: 14, borderTop: "1px solid var(--line)" }}>
                  <h4 style={{ fontSize: 12.5, color: "var(--petrol)", marginBottom: 6 }}>{contrat.statut === "SIGNE" ? t("saCtrSigneRemplacer") : t("saCtrDeposerSigne")}</h4>
                  {contrat.statut === "SIGNE" && <p style={{ fontSize: 12, color: "#2E7D5B", marginBottom: 8 }}>{t("saCtrSigneLe")} {fmtDate(contrat.date_signature_client)} · {contrat.signe_nom_fichier}</p>}
                  <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end" }}>
                    <div>
                      <label style={labelStyle}>{t("saCtrDateSignature")}</label>
                      <input type="date" value={signe.date} onChange={(e) => setSigne({ ...signe, date: e.target.value })} style={{ ...inputStyle, width: 170 }} />
                    </div>
                    <div>
                      <label style={labelStyle}>{t("saCtrFichierSigne")}</label>
                      <input ref={inputFichier} type="file" accept="application/pdf,image/png,image/jpeg" onChange={(e) => setSigne({ ...signe, fichier: e.target.files?.[0] || null })} style={{ fontSize: 12 }} />
                    </div>
                    <button disabled={occupe || !signe.fichier} style={boutonPrincipalStyle} onClick={() => agir(async () => { await superAdminApi.deposerContratSigne(contrat.id, signe.fichier, signe.date); setSigne({ date: aujourdhui(), fichier: null }); if (inputFichier.current) inputFichier.current.value = ""; }, t("saCtrSigneDepose"))}>{t("saCtrDeposer")}</button>
                  </div>
                </div>
              )}
            </div>
          )}
        </>
      )}
    </SuperAdminShell>
  );
}
