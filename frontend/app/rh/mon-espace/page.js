"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { api } from "../../../lib/api";
import { useLangue } from "../../../lib/i18n/LanguageContext";
import AppShell from "../../../lib/components/AppShell";
import SignaturePad from "../../../lib/components/SignaturePad";
import CodeConfirmation from "../../../lib/components/CodeConfirmation";
import { boutonLeger, Section } from "../../../lib/components/rhUi";

export default function MonEspaceRHPage() {
  const { t } = useLangue();
  const [moi, setMoi] = useState(null);
  const [contrats, setContrats] = useState([]);
  const [courriers, setCourriers] = useState([]);
  const [bulletins, setBulletins] = useState([]);
  const [apercu, setApercu] = useState(null);
  const [edition, setEdition] = useState(false);
  const [signature, setSignature] = useState(null);
  const [erreur, setErreur] = useState("");
  const [message, setMessage] = useState("");
  const [introuvable, setIntrouvable] = useState(false);

  function charger() {
    api.getEspaceMoi().then((m) => {
      setMoi(m);
      if (m.signature.enregistree) api.getEspaceSignature().then(setApercu).catch(() => {});
      else setEdition(true);
    }).catch((e) => (e.status === 404 ? setIntrouvable(true) : setErreur(e.message)));
    api.getEspaceContrats().then(setContrats).catch(() => {});
    api.getEspaceCourriers().then(setCourriers).catch(() => {});
    api.getEspaceBulletins().then(setBulletins).catch(() => {});
  }
  useEffect(charger, []);

  if (introuvable) {
    return <AppShell title={t("rheTitre")}><p style={{ fontSize: 13, color: "var(--sub)", maxWidth: 560 }}>{t("rheSansFiche")}</p></AppShell>;
  }
  if (!moi) {
    return <AppShell title={t("rheTitre")}>{erreur ? <p style={{ color: "var(--brique)", fontSize: 12.5 }}>{erreur}</p> : <p style={{ fontSize: 12.5, color: "var(--sub)" }}>{t("loading")}</p>}</AppShell>;
  }

  return (
    <AppShell title={t("rheTitre")}>
      <p style={{ fontSize: 12.5, color: "var(--sub)", marginTop: -6, marginBottom: 16 }}>
        {moi.employe.prenom} {moi.employe.nom}{moi.employe.matricule ? ` · ${moi.employe.matricule}` : ""}{moi.employe.poste ? ` · ${moi.employe.poste}` : ""}
      </p>
      {erreur && <p style={{ color: "var(--brique)", fontSize: 12.5, marginBottom: 14 }}>{erreur}</p>}
      {message && <p style={{ color: "var(--petrol)", fontSize: 12.5, marginBottom: 14 }}>{message}</p>}

      <div style={{ maxWidth: 900, display: "grid", gap: 16 }}>
        {moi.contrats.a_signer > 0 && (
          <div className="card" style={{ borderLeft: "3px solid var(--accent, #C8742B)", fontSize: 13 }}>
            <strong>{moi.contrats.a_signer}</strong> {t("rheContratsASigner")}
          </div>
        )}

        <Section titre={t("rheContrats")}>
          {contrats.length === 0 ? (
            <p style={{ fontSize: 12.5, color: "var(--sub)", margin: 0 }}>{t("rheContratsAucun")}</p>
          ) : (
            <div style={{ display: "grid", gap: 8 }}>
              {contrats.map((c) => (
                <Link key={c.id} href={`/rh/mon-espace/contrats/${c.id}`} style={{ display: "flex", gap: 14, alignItems: "center", flexWrap: "wrap", textDecoration: "none", color: "inherit", borderTop: "1px solid var(--line)", paddingTop: 8 }}>
                  <span className="mono" style={{ fontWeight: 600, fontSize: 12.5 }}>{c.numero}</span>
                  <span style={{ fontSize: 12.5 }}>{t(`rhcType_${c.type}`)}</span>
                  <span style={{ fontSize: 12, color: "var(--sub)" }}>{String(c.date_effet).slice(0, 10)}</span>
                  <span className={c.a_signer ? "chip risk" : "chip ok"} style={{ marginLeft: "auto" }}>{c.a_signer ? t("rheASigner") : t(`rhcStatut_${c.statut}`)}</span>
                </Link>
              ))}
            </div>
          )}
        </Section>

        {moi.bulletins && moi.bulletins.non_consultes > 0 && (
          <div className="card" style={{ borderLeft: "3px solid var(--accent, #C8742B)", fontSize: 13 }}>
            <strong>{moi.bulletins.non_consultes}</strong> {t("rheBulletinsNonConsultes")}
          </div>
        )}

        <Section titre={t("rheBulletins")} aide={t("rheBulletinsAide")}>
          {bulletins.length === 0 ? (
            <p style={{ fontSize: 12.5, color: "var(--sub)", margin: 0 }}>{t("rheBulletinsAucun")}</p>
          ) : (
            <div style={{ display: "grid", gap: 8 }}>
              {bulletins.map((b) => (
                <div key={b.periode_id} style={{ display: "flex", gap: 14, alignItems: "center", flexWrap: "wrap", borderTop: "1px solid var(--line)", paddingTop: 8 }}>
                  <span style={{ fontWeight: 600, fontSize: 12.5, minWidth: 120 }}>{t(`paieMoisNom_${b.mois}`)} {b.annee}</span>
                  <span style={{ fontSize: 12, color: "var(--sub)" }}>{t("rheBulletinNet")} : <b style={{ color: "inherit" }}>{Number(b.net_a_payer).toLocaleString("fr-FR")} F</b></span>
                  {!b.date_consultation && <span className="chip risk">{t("rheNouveau")}</span>}
                  <span style={{ marginLeft: "auto", display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                    {b.date_accuse && <span className="chip ok">{t("rheBulletinAccuse")} {String(b.date_accuse).slice(0, 10)}</span>}
                    <button type="button" style={boutonLeger} onClick={() => api.ouvrirBulletinPaie(b.periode_id).then(charger).catch((e) => setErreur(e.message))}>{t("rheBulletinOuvrir")}</button>
                    <button type="button" style={boutonLeger} onClick={() => api.telechargerBulletinPaie(b.periode_id, `bulletin_${b.annee}-${String(b.mois).padStart(2, "0")}.pdf`).then(charger).catch((e) => setErreur(e.message))}>{t("rheBulletinTelecharger")}</button>
                    {!b.date_accuse && <button type="button" style={boutonLeger} onClick={() => api.accuserBulletinPaie(b.periode_id).then(charger).catch((e) => setErreur(e.message))}>{t("rheBulletinAccuser")}</button>}
                  </span>
                </div>
              ))}
            </div>
          )}
        </Section>

        {moi.courriers && moi.courriers.non_lus > 0 && (
          <div className="card" style={{ borderLeft: "3px solid var(--accent, #C8742B)", fontSize: 13 }}>
            <strong>{moi.courriers.non_lus}</strong> {t("rheCourriersNonLus")}
          </div>
        )}

        <Section titre={t("rheCourriers")}>
          {courriers.length === 0 ? (
            <p style={{ fontSize: 12.5, color: "var(--sub)", margin: 0 }}>{t("rheCourriersAucun")}</p>
          ) : (
            <div style={{ display: "grid", gap: 8 }}>
              {courriers.map((c) => (
                <Link key={c.id} href={`/rh/mon-espace/courriers/${c.id}`} style={{ display: "flex", gap: 14, alignItems: "center", flexWrap: "wrap", textDecoration: "none", color: "inherit", borderTop: "1px solid var(--line)", paddingTop: 8 }}>
                  <span className="mono" style={{ fontWeight: 600, fontSize: 12.5 }}>{c.numero}</span>
                  <span style={{ fontSize: 12.5 }}>{t(`rhkType_${c.type}`)}</span>
                  <span style={{ fontSize: 12, color: "var(--sub)" }}>{String(c.date_courrier).slice(0, 10)}</span>
                  {!c.date_lecture && <span className="chip risk" style={{ marginLeft: "auto" }}>{t("rheNouveau")}</span>}
                </Link>
              ))}
            </div>
          )}
        </Section>

        <Section titre={t("rheSignature")} aide={t("rheSignatureAide")}>
          {apercu && apercu.enregistree && !edition && (
            <div style={{ display: "grid", gap: 10 }}>
              <img src={`data:${apercu.type_mime};base64,${apercu.image_base64}`} alt="" style={{ maxWidth: 320, maxHeight: 130, border: "1px solid var(--line)", borderRadius: 8, background: "#fff" }} />
              <div style={{ fontSize: 12, color: "var(--sub)" }}>{t("rheSignatureOk")} {String(apercu.date_enregistrement).slice(0, 10)}</div>
              <div><button type="button" style={boutonLeger} onClick={() => { setEdition(true); setMessage(""); }}>{t("rheSignatureModifier")}</button></div>
            </div>
          )}
          {edition && (
            <div style={{ display: "grid", gap: 14 }}>
              {!moi.signature.enregistree && <p style={{ fontSize: 12.5, color: "var(--sub)", margin: 0 }}>{t("rheSignatureAucune")}</p>}
              <SignaturePad t={t} onChange={setSignature} />
              <CodeConfirmation
                t={t}
                desactive={!signature}
                onErreur={setErreur}
                demanderCode={api.demanderCodeSignature}
                libelleValider={t("rheSignatureEnregistrer")}
                valider={async (code) => {
                  if (!signature) throw new Error(t("rheSignatureVide"));
                  await api.enregistrerSignature({ image: signature.image, mode: signature.mode, code });
                  setMessage(t("rheSignatureEnregistree"));
                  setEdition(false);
                  setSignature(null);
                  charger();
                }}
              />
              {moi.signature.enregistree && <div><button type="button" style={boutonLeger} onClick={() => { setEdition(false); setErreur(""); }}>{t("rheAnnuler")}</button></div>}
            </div>
          )}
        </Section>

        <Section titre={t("rheMaFiche")} aide={t("rheMaFicheAide")}>
          <Link href={`/rh/personnel/${moi.employe.id}`} style={boutonLeger}>{t("rheOuvrirFiche")}</Link>
        </Section>
      </div>
    </AppShell>
  );
}
