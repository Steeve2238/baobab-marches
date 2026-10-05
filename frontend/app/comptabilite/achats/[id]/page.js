"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import { api } from "../../../../lib/api";
import { useLangue } from "../../../../lib/i18n/LanguageContext";
import AppShell from "../../../../lib/components/AppShell";
import ComptaSousNav from "../../../../lib/components/ComptaSousNav";
import { useComptaStatut, boutonPrincipalStyle, boutonDangerStyle, thStyle, tdStyle, numStyle, formaterMontant, STATUT_COULEURS, statutLibelleCle } from "../../../../lib/comptaUi";

const jour = (d) => String(d || "").slice(0, 10);

export default function FactureFournisseurDetailPage() {
  const { t } = useLangue();
  const locale = t("dateLocale");
  const { id } = useParams();
  const cree = useSearchParams().get("cree") === "1";
  const { statut } = useComptaStatut();
  const [f, setF] = useState(null);
  const [erreur, setErreur] = useState("");
  const [info, setInfo] = useState(cree ? t("comptaAchatsEnregistree") : "");

  function charger() {
    api.comptaAchatsFacture(id).then(setF).catch((e) => setErreur(e.message));
  }
  useEffect(charger, [id]); // eslint-disable-line react-hooks/exhaustive-deps

  async function annuler() {
    if (!window.confirm(t("comptaAchatsAnnulerConfirm"))) return;
    setErreur("");
    try {
      await api.comptaAchatsAnnulerFacture(id);
      setInfo("");
      charger();
    } catch (e) {
      setErreur(e.message);
    }
  }

  const m = (v) => formaterMontant(v, locale);
  const peutEcrire = !!statut?.droits?.ecriture;
  return (
    <AppShell title={f ? `${t("comptaAchatsTitre")} — ${f.numero}` : t("comptaAchatsTitre")} subNav={<ComptaSousNav />}>
      <p style={{ marginBottom: 12, fontSize: 12.5 }}>
        <Link href="/comptabilite/achats" style={{ color: "var(--petrol)", fontWeight: 600 }}>← {t("comptaAchatsTitre")}</Link>
      </p>
      {erreur && <p style={{ color: "var(--brique)", fontSize: 12.5, marginBottom: 12 }}>{erreur}</p>}
      {info && <p style={{ color: "var(--vert)", fontSize: 12.5, marginBottom: 12 }}>{info}</p>}
      {f && (
        <>
          <div className="card" style={{ marginBottom: 14 }}>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))", gap: 12, fontSize: 13 }}>
              <div><div style={{ fontSize: 11, color: "var(--sub)" }}>{t("comptaAchatsFournisseur")}</div><strong>{f.tiers_nom}</strong> <span style={{ fontFamily: "IBM Plex Mono, monospace", fontSize: 11.5, color: "var(--sub)" }}>{f.tiers_code}</span></div>
              <div><div style={{ fontSize: 11, color: "var(--sub)" }}>{t("comptaAchatsReference")}</div>{f.reference_fournisseur}</div>
              <div><div style={{ fontSize: 11, color: "var(--sub)" }}>{t("comptaAchatsDateFacture")}</div>{jour(f.date_facture)}</div>
              <div><div style={{ fontSize: 11, color: "var(--sub)" }}>{t("comptaAchatsEcheance")}</div><span style={{ color: f.en_retard ? "var(--brique)" : undefined, fontWeight: f.en_retard ? 700 : 400 }}>{jour(f.date_echeance)}</span></div>
              <div>
                <div style={{ fontSize: 11, color: "var(--sub)" }}>{t("comptaAchatsEcritureEtat")}</div>
                {f.statut === "ANNULEE" ? (
                  <strong>{t("comptaAchatsAnnulee")}</strong>
                ) : f.ecriture_id ? (
                  <>
                    <span style={{ fontSize: 10.5, fontWeight: 700, padding: "3px 8px", borderRadius: 20, ...STATUT_COULEURS[f.ecriture_statut] }}>{t(statutLibelleCle(f.ecriture_statut))}</span>{" "}
                    <Link href={`/comptabilite/ecritures/${f.ecriture_id}`} style={{ fontSize: 12, color: "var(--petrol)", fontWeight: 600 }}>{t("comptaAchatsVoirEcriture")}</Link>
                  </>
                ) : "—"}
              </div>
            </div>
            {f.libelle && <p style={{ fontSize: 12.5, color: "var(--sub)", margin: "10px 0 0" }}>{f.libelle}</p>}
          </div>
          <div className="card" style={{ padding: 0, overflowX: "auto", marginBottom: 14 }}>
            <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 640 }}>
              <thead>
                <tr>
                  <th style={thStyle}>{t("comptaAchatsLigneLibelle")}</th>
                  <th style={thStyle}>{t("comptaAchatsLigneCompte")}</th>
                  {f.lignes.some((l) => l.section_code) && <th style={thStyle}>{t("comptaAnaDossier")}</th>}
                  <th style={{ ...thStyle, textAlign: "right" }}>{t("comptaAchatsLigneHt")}</th>
                  <th style={{ ...thStyle, textAlign: "right" }}>{t("comptaAchatsLigneTva")}</th>
                  <th style={{ ...thStyle, textAlign: "right" }}>{t("comptaAchatsTva")}</th>
                </tr>
              </thead>
              <tbody>
                {f.lignes.map((l) => (
                  <tr key={l.id}>
                    <td style={tdStyle}>{l.libelle}</td>
                    <td style={tdStyle}><span style={{ fontFamily: "IBM Plex Mono, monospace" }}>{l.compte_numero}</span><div style={{ fontSize: 11, color: "var(--sub)" }}>{l.compte_libelle}</div></td>
                    {f.lignes.some((x) => x.section_code) && <td style={tdStyle}>{l.section_code ? <><span style={{ fontFamily: "IBM Plex Mono, monospace" }}>{l.section_code}</span><div style={{ fontSize: 11, color: "var(--sub)" }}>{l.section_libelle}</div></> : ""}</td>}
                    <td style={{ ...tdStyle, ...numStyle }}>{m(l.montant_ht)}</td>
                    <td style={{ ...tdStyle, ...numStyle }}>{Number(l.taux_tva)}</td>
                    <td style={{ ...tdStyle, ...numStyle }}>{m(l.montant_tva)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div style={{ padding: 12, display: "flex", justifyContent: "flex-end" }}>
              <div style={{ display: "grid", gridTemplateColumns: "auto auto", gap: "4px 24px", fontSize: 13 }}>
                <span style={{ color: "var(--sub)" }}>{t("comptaAchatsHt")}</span><span style={numStyle}>{m(f.montant_ht)}</span>
                <span style={{ color: "var(--sub)" }}>{t("comptaAchatsTva")}</span><span style={numStyle}>{m(f.montant_tva)}</span>
                <strong>{t("comptaAchatsTtc")}</strong><strong style={numStyle}>{m(f.montant_ttc)}</strong>
                <span style={{ color: "var(--sub)" }}>{t("comptaAchatsRegle")}</span><span style={numStyle}>{m(f.montant_regle)}</span>
                <strong>{t("comptaAchatsSolde")}</strong><strong style={{ ...numStyle, color: Number(f.solde) > 0 ? "var(--ocre)" : "var(--vert)" }}>{f.statut === "ANNULEE" ? "—" : m(f.solde)}</strong>
              </div>
            </div>
          </div>
          {f.reglements.length > 0 && (
            <div className="card" style={{ padding: 0, overflowX: "auto", marginBottom: 14 }}>
              <div style={{ padding: "10px 12px", borderBottom: "1px solid var(--line)", fontWeight: 700, fontSize: 13 }}>{t("comptaAchatsReglementsFacture")}</div>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <tbody>
                  {f.reglements.map((r) => (
                    <tr key={r.reglement_id} style={{ opacity: r.statut === "ANNULE" ? 0.5 : 1 }}>
                      <td style={tdStyle}>{jour(r.date_reglement)}</td>
                      <td style={{ ...tdStyle, fontFamily: "IBM Plex Mono, monospace" }}>{r.numero}</td>
                      <td style={tdStyle}>{r.mode_paiement} {r.reference}</td>
                      <td style={{ ...tdStyle, ...numStyle }}>{m(r.montant)}</td>
                      <td style={tdStyle}>{r.statut === "ANNULE" ? t("comptaAchatsAnnulee") : ""}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {f.statut === "ENREGISTREE" && peutEcrire && (
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              {Number(f.solde) > 0 && (
                <Link href={`/comptabilite/reglements?tiers=${f.tiers_id}&facture=${f.id}`} style={{ ...boutonPrincipalStyle, textDecoration: "none", display: "inline-block" }}>{t("comptaAchatsRegler")}</Link>
              )}
              <button style={boutonDangerStyle} onClick={annuler}>{t("comptaAchatsAnnulerFacture")}</button>
            </div>
          )}
        </>
      )}
    </AppShell>
  );
}
