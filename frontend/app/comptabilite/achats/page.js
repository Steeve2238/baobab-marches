"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { api } from "../../../lib/api";
import { useLangue } from "../../../lib/i18n/LanguageContext";
import AppShell from "../../../lib/components/AppShell";
import ComptaSousNav from "../../../lib/components/ComptaSousNav";
import { useComptaStatut, inputStyle, boutonPrincipalStyle, thStyle, tdStyle, numStyle, formaterMontant, STATUT_COULEURS, statutLibelleCle } from "../../../lib/comptaUi";

const ETATS = [
  { v: "", k: "comptaAchatsEtatTous" },
  { v: "IMPAYEES", k: "comptaAchatsEtatImpayees" },
  { v: "EN_RETARD", k: "comptaAchatsEtatEnRetard" },
  { v: "SOLDEES", k: "comptaAchatsEtatSoldees" },
  { v: "ANNULEES", k: "comptaAchatsEtatAnnulees" },
];
const TAILLE = 50;
const jour = (d) => String(d || "").slice(0, 10);

// Factures fournisseurs : liste, filtres par etat, acces a la saisie.
export default function ComptaAchatsPage() {
  const { t } = useLangue();
  const locale = t("dateLocale");
  const { statut } = useComptaStatut();
  const [donnees, setDonnees] = useState({ total: 0, factures: [] });
  const [etat, setEtat] = useState("IMPAYEES");
  const [q, setQ] = useState("");
  const [page, setPage] = useState(0);
  const [erreur, setErreur] = useState("");

  function charger() {
    const params = { limit: TAILLE, offset: page * TAILLE };
    if (etat) params.etat = etat;
    if (q) params.q = q;
    api.comptaAchatsFactures(params).then(setDonnees).catch((e) => setErreur(e.message));
  }
  useEffect(charger, [etat, page]); // eslint-disable-line react-hooks/exhaustive-deps

  const peutEcrire = !!statut?.droits?.ecriture && statut?.initialisee;
  const m = (v) => formaterMontant(v, locale);
  const pages = Math.max(1, Math.ceil(donnees.total / TAILLE));

  return (
    <AppShell title={t("comptaAchatsTitre")} subNav={<ComptaSousNav />}>
      {erreur && <p style={{ color: "var(--brique)", fontSize: 12.5, marginBottom: 12 }}>{erreur}</p>}
      <p style={{ fontSize: 12, color: "var(--sub)", marginBottom: 12, maxWidth: 760, lineHeight: 1.5 }}>{t("comptaAchatsAide")}</p>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 14, alignItems: "center" }}>
        <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
          {ETATS.map((e) => (
            <button
              key={e.v}
              onClick={() => { setPage(0); setEtat(e.v); }}
              style={{ padding: "5px 11px", borderRadius: 20, fontSize: 12, fontWeight: etat === e.v ? 700 : 500, border: "1px solid var(--line)", background: etat === e.v ? "var(--petrol)" : "transparent", color: etat === e.v ? "#fff" : "var(--petrol)" }}
            >
              {t(e.k)}
            </button>
          ))}
        </div>
        <input
          placeholder={t("comptaPlanRecherche")}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") { setPage(0); charger(); } }}
          style={{ ...inputStyle, width: 240 }}
        />
        <span style={{ flex: 1 }} />
        {peutEcrire && (
          <Link href="/comptabilite/achats/nouvelle" style={{ ...boutonPrincipalStyle, textDecoration: "none", display: "inline-block" }}>
            + {t("comptaAchatsNouvelle")}
          </Link>
        )}
      </div>
      <div className="card" style={{ padding: 0, overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 860 }}>
          <thead>
            <tr>
              <th style={thStyle}>{t("comptaDate")}</th>
              <th style={thStyle}>{t("comptaAchatsNumero")}</th>
              <th style={thStyle}>{t("comptaAchatsFournisseur")}</th>
              <th style={thStyle}>{t("comptaAchatsReference")}</th>
              <th style={thStyle}>{t("comptaAchatsEcheance")}</th>
              <th style={{ ...thStyle, textAlign: "right" }}>{t("comptaAchatsTtc")}</th>
              <th style={{ ...thStyle, textAlign: "right" }}>{t("comptaAchatsSolde")}</th>
              <th style={thStyle}></th>
            </tr>
          </thead>
          <tbody>
            {donnees.factures.map((f) => (
              <tr key={f.id} style={{ opacity: f.statut === "ANNULEE" ? 0.55 : 1 }}>
                <td style={tdStyle}>{jour(f.date_facture)}</td>
                <td style={{ ...tdStyle, fontFamily: "IBM Plex Mono, monospace" }}>
                  <Link href={`/comptabilite/achats/${f.id}`} style={{ color: "var(--petrol)", fontWeight: 700 }}>{f.numero}</Link>
                </td>
                <td style={tdStyle}>
                  {f.tiers_nom}
                  <div style={{ fontSize: 11, color: "var(--sub)", fontFamily: "IBM Plex Mono, monospace" }}>{f.tiers_code}</div>
                </td>
                <td style={tdStyle}>{f.reference_fournisseur}</td>
                <td style={{ ...tdStyle, color: f.en_retard ? "var(--brique)" : undefined, fontWeight: f.en_retard ? 700 : 400 }}>{jour(f.date_echeance)}</td>
                <td style={{ ...tdStyle, ...numStyle }}>{m(f.montant_ttc)}</td>
                <td style={{ ...tdStyle, ...numStyle, fontWeight: 700 }}>{f.statut === "ANNULEE" ? "—" : m(f.solde)}</td>
                <td style={{ ...tdStyle, whiteSpace: "nowrap" }}>
                  {f.statut === "ANNULEE" ? (
                    <span style={{ fontSize: 10.5, fontWeight: 700, padding: "3px 8px", borderRadius: 20, color: "var(--sub)", background: "rgba(91,106,108,0.12)" }}>{t("comptaAchatsAnnulee")}</span>
                  ) : (
                    <>
                      {f.en_retard && <span style={{ fontSize: 10.5, fontWeight: 700, padding: "3px 8px", borderRadius: 20, marginRight: 4, color: "var(--brique)", background: "rgba(176,58,46,0.1)" }}>{t("comptaAchatsRetard")}</span>}
                      {f.ecriture_statut && (
                        <span style={{ fontSize: 10.5, fontWeight: 700, padding: "3px 8px", borderRadius: 20, ...STATUT_COULEURS[f.ecriture_statut] }}>{t(statutLibelleCle(f.ecriture_statut))}</span>
                      )}
                    </>
                  )}
                </td>
              </tr>
            ))}
            {donnees.factures.length === 0 && (
              <tr>
                <td colSpan={8} style={{ ...tdStyle, color: "var(--sub)" }}>{t("comptaAchatsAucune")}</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {pages > 1 && (
        <div style={{ display: "flex", gap: 10, alignItems: "center", marginTop: 12, fontSize: 12.5 }}>
          <button disabled={page === 0} onClick={() => setPage((p) => p - 1)} style={{ ...inputStyle, width: "auto" }}>‹</button>
          <span>{page + 1} / {pages}</span>
          <button disabled={page + 1 >= pages} onClick={() => setPage((p) => p + 1)} style={{ ...inputStyle, width: "auto" }}>›</button>
        </div>
      )}
    </AppShell>
  );
}
