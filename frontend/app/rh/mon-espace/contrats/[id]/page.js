"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { api } from "../../../../../lib/api";
import { useLangue } from "../../../../../lib/i18n/LanguageContext";
import AppShell from "../../../../../lib/components/AppShell";
import CodeConfirmation from "../../../../../lib/components/CodeConfirmation";
import { boutonLeger, Section, fmtMontant } from "../../../../../lib/components/rhUi";

export default function MonContratPage() {
  const { id } = useParams();
  const { t } = useLangue();
  const [contrat, setContrat] = useState(null);
  const [aSignature, setASignature] = useState(true);
  const [accepte, setAccepte] = useState(false);
  const [erreur, setErreur] = useState("");
  const [message, setMessage] = useState("");

  function charger() {
    api.getEspaceContrat(id).then(setContrat).catch((e) => setErreur(e.message));
  }
  useEffect(() => {
    charger();
    api.getEspaceMoi().then((m) => setASignature(m.signature.enregistree)).catch(() => {});
  }, [id]);

  if (!contrat) {
    return <AppShell title={t("rheTitre")}>{erreur ? <p style={{ color: "var(--brique)", fontSize: 12.5 }}>{erreur}</p> : <p style={{ fontSize: 12.5, color: "var(--sub)" }}>{t("loading")}</p>}</AppShell>;
  }
  const contenu = contrat.contenu;
  const sal = contrat.signature_salarie;

  return (
    <AppShell title={contrat.numero}>
      <Link href="/rh/mon-espace" style={{ fontSize: 12, color: "var(--petrol)", display: "inline-block", marginBottom: 12 }}>{t("rheRetour")}</Link>
      {erreur && <p style={{ color: "var(--brique)", fontSize: 12.5, marginBottom: 14 }}>{erreur}</p>}
      {message && <p style={{ color: "var(--petrol)", fontSize: 12.5, marginBottom: 14 }}>{message}</p>}

      <div style={{ maxWidth: 900, display: "grid", gap: 16 }}>
        <div className="card" style={{ display: "flex", gap: 16, flexWrap: "wrap", alignItems: "center" }}>
          <div>
            <div style={{ fontWeight: 700, fontSize: 16 }}>{t(`rhcType_${contrat.type}`)}</div>
            <div style={{ fontSize: 12, color: "var(--sub)" }}>
              {contrat.numero} · {t("rheContratEffet")} {String(contrat.date_effet).slice(0, 10)}{contrat.poste ? ` · ${contrat.poste}` : ""}
            </div>
          </div>
          <span className={contrat.a_signer ? "chip risk" : "chip ok"}>{contrat.a_signer ? t("rheASigner") : t(`rhcStatut_${contrat.statut}`)}</span>
          <div style={{ marginLeft: "auto", display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button type="button" style={boutonLeger} onClick={() => api.ouvrirPdfRH(`/rh/espace/contrats/${id}/pdf`).catch((e) => setErreur(e.message))}>{t("rhePdf")}</button>
            <button type="button" style={boutonLeger} onClick={() => api.telechargerPdfRH(`/rh/espace/contrats/${id}/pdf`, `${contrat.numero}.pdf`).catch((e) => setErreur(e.message))}>{t("rhePdfTelecharger")}</button>
            {contrat.a_fichier_signe && (
              <button type="button" style={boutonLeger} onClick={() => api.ouvrirPdfRH(`/rh/espace/contrats/${id}/scan`).catch((e) => setErreur(e.message))}>{t("rheScan")}</button>
            )}
          </div>
        </div>

        {contrat.a_signer && (
          <Section titre={t("rheSignerTitre")} aide={t("rheSignerAide")}>
            {!aSignature ? (
              <div style={{ display: "grid", gap: 10 }}>
                <p style={{ fontSize: 12.5, margin: 0 }}>{t("rheSignatureRequise")}</p>
                <div><Link href="/rh/mon-espace" style={boutonLeger}>{t("rheAllerSignature")}</Link></div>
              </div>
            ) : (
              <div style={{ display: "grid", gap: 14 }}>
                <label style={{ display: "flex", gap: 8, alignItems: "flex-start", fontSize: 13 }}>
                  <input type="checkbox" checked={accepte} onChange={(e) => setAccepte(e.target.checked)} style={{ marginTop: 3 }} />
                  <span>{t("rheAccepte")}</span>
                </label>
                <CodeConfirmation
                  t={t}
                  desactive={!accepte}
                  onErreur={setErreur}
                  demanderCode={() => api.demanderCodeContrat(id)}
                  libelleValider={t("rheSignerBouton")}
                  valider={async (code) => {
                    await api.signerContrat(id, { code, accepte: true });
                    setMessage(t("rheSigneOk"));
                    setAccepte(false);
                    charger();
                  }}
                />
              </div>
            )}
          </Section>
        )}

        <Section titre={t("rheSuivi")}>
          <div style={{ display: "grid", gap: 6, fontSize: 12.5 }}>
            {(contrat.evenements || []).map((e, i) => (
              <div key={i} style={{ display: "flex", gap: 12 }}>
                <span className="mono" style={{ color: "var(--sub)", fontSize: 11.5 }}>{String(e.date_evenement).replace("T", " ").slice(0, 16)}</span>
                <span>{t(`rhcEvt_${e.evenement}`)}</span>
              </div>
            ))}
            {sal && <div style={{ color: "var(--sub)", fontSize: 11.5 }}>{t("rheSigneLe")} {String(sal.date).replace("T", " ").slice(0, 16)}</div>}
            {contrat.numero_visa && <div>{t("rheVise")} : {contrat.numero_visa} ({String(contrat.date_visa).slice(0, 10)})</div>}
          </div>
        </Section>

        <Section titre={t("rheTexte")}>
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
                {a.paragraphes.map((p, i) => (<p key={i} style={{ margin: "0 0 5px" }}>{p}</p>))}
                {a.remuneration && (
                  <div style={{ margin: "4px 0 6px" }}>
                    {a.remuneration.lignes.map((l, i) => (
                      <div key={i} style={{ display: "flex", justifyContent: "space-between", maxWidth: 480, borderBottom: "1px solid var(--line)", padding: "2px 0" }}>
                        <span>{l.libelle}{l.essai === false ? " *" : ""}</span>
                        <span className="mono">{fmtMontant(l.montant)} F CFA</span>
                      </div>
                    ))}
                    <div style={{ display: "flex", justifyContent: "space-between", maxWidth: 480, fontWeight: 700, padding: "3px 0" }}>
                      <span>{a.remuneration.libelle_total}</span>
                      <span className="mono">{fmtMontant(a.remuneration.total)} F CFA</span>
                    </div>
                    <div style={{ color: "var(--sub)", fontStyle: "italic" }}>Soit : {a.remuneration.total_lettres}.</div>
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
