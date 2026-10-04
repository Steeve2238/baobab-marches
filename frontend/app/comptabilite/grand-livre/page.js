"use client";

import { useState } from "react";
import Link from "next/link";
import { api } from "../../../lib/api";
import { useLangue } from "../../../lib/i18n/LanguageContext";
import AppShell from "../../../lib/components/AppShell";
import ComptaSousNav from "../../../lib/components/ComptaSousNav";
import ComptaEtatFiltres from "../../../lib/components/ComptaEtatFiltres";
import { thStyle, tdStyle, numStyle, formaterMontant } from "../../../lib/comptaUi";

// Grand livre : par compte, mouvements de la periode avec solde progressif
// (negatif = solde crediteur, comme Sage). Un clic sur un libelle ouvre l'ecriture.
export default function GrandLivrePage() {
  const { t } = useLangue();
  const locale = t("dateLocale");
  const [filtres, setFiltres] = useState({ exercice_id: "", date_debut: "", date_fin: "", compte_de: "", compte_a: "", inclure_instance: false });
  const [exercices, setExercices] = useState([]);
  const [data, setData] = useState(null);
  const [erreur, setErreur] = useState("");
  const [chargement, setChargement] = useState(false);

  async function afficher() {
    setErreur("");
    setChargement(true);
    try {
      const p = {};
      for (const [k, v] of Object.entries(filtres)) if (v) p[k] = v === true ? "1" : v;
      setData(await api.comptaGrandLivre(p));
    } catch (e) {
      setErreur(e.message);
      setData(null);
    } finally {
      setChargement(false);
    }
  }

  const m = (v) => formaterMontant(v, locale, true);

  return (
    <AppShell title={t("comptaNavGrandLivre")} subNav={<ComptaSousNav />}>
      {erreur && <p style={{ color: "var(--brique)", fontSize: 12.5, marginBottom: 12 }}>{erreur}</p>}
      <ComptaEtatFiltres etat="grand-livre" filtres={filtres} setFiltres={setFiltres} exercices={exercices} setExercices={setExercices} onAfficher={afficher} onErreur={setErreur} />
      {chargement && <p style={{ fontSize: 12.5, color: "var(--sub)" }}>{t("loading")}</p>}
      {!data && !chargement && <p style={{ fontSize: 12.5, color: "var(--sub)" }}>{t("comptaEtatAide")}</p>}
      {data && data.comptes.length === 0 && <p style={{ fontSize: 12.5, color: "var(--sub)" }}>{t("comptaAucuneEcriture")}</p>}
      {data &&
        data.comptes.map((c) => (
          <div key={c.numero} className="card" style={{ marginBottom: 12, padding: 0, overflowX: "auto" }}>
            <div style={{ padding: "10px 12px", borderBottom: "1px solid var(--line)", display: "flex", gap: 12 }}>
              <strong style={{ fontFamily: "IBM Plex Mono, monospace" }}>{c.numero}</strong>
              <strong>{c.libelle}</strong>
            </div>
            <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 760 }}>
              <thead>
                <tr>
                  <th style={thStyle}>{t("comptaDate")}</th>
                  <th style={thStyle}>{t("comptaJournal")}</th>
                  <th style={thStyle}>{t("comptaPiece")}</th>
                  <th style={thStyle}>{t("comptaLibelle")}</th>
                  <th style={thStyle}>{t("comptaTiers")}</th>
                  <th style={{ ...thStyle, textAlign: "right" }}>{t("comptaDebit")}</th>
                  <th style={{ ...thStyle, textAlign: "right" }}>{t("comptaCredit")}</th>
                  <th style={{ ...thStyle, textAlign: "right" }}>{t("comptaSoldeProgressif")}</th>
                </tr>
              </thead>
              <tbody>
                {(c.report.debit !== 0 || c.report.credit !== 0) && (
                  <tr style={{ background: "var(--line-soft)" }}>
                    <td style={tdStyle} colSpan={5}>
                      {t("comptaReport")}
                    </td>
                    <td style={{ ...tdStyle, ...numStyle }}>{m(c.report.debit)}</td>
                    <td style={{ ...tdStyle, ...numStyle }}>{m(c.report.credit)}</td>
                    <td style={{ ...tdStyle, ...numStyle }}>{formaterMontant(c.report.solde, locale)}</td>
                  </tr>
                )}
                {c.lignes.map((l, i) => (
                  <tr key={i}>
                    <td style={{ ...tdStyle, whiteSpace: "nowrap" }}>{l.date}</td>
                    <td style={tdStyle}>{l.journal}</td>
                    <td style={tdStyle}>{l.numero_piece || l.numero_ecriture || ""}</td>
                    <td style={tdStyle}>
                      <Link href={`/comptabilite/ecritures/${l.ecriture_id}`} style={{ color: "var(--petrol)" }}>
                        {l.libelle}
                      </Link>
                      {l.statut !== "VALIDEE" && <span style={{ marginLeft: 6, fontSize: 10.5, color: "var(--ocre)" }}>({t("comptaStatutEnInstance")})</span>}
                    </td>
                    <td style={tdStyle}>{l.tiers_code || ""}</td>
                    <td style={{ ...tdStyle, ...numStyle }}>{m(l.debit)}</td>
                    <td style={{ ...tdStyle, ...numStyle }}>{m(l.credit)}</td>
                    <td style={{ ...tdStyle, ...numStyle }}>{formaterMontant(l.solde_progressif, locale)}</td>
                  </tr>
                ))}
                <tr style={{ background: "var(--line)", fontWeight: 700 }}>
                  <td style={tdStyle} colSpan={5}>
                    {t("comptaTotalCompte")} {c.numero}
                  </td>
                  <td style={{ ...tdStyle, ...numStyle }}>{m(c.total_debit)}</td>
                  <td style={{ ...tdStyle, ...numStyle }}>{m(c.total_credit)}</td>
                  <td style={{ ...tdStyle, ...numStyle }}>{formaterMontant(c.solde, locale)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        ))}
      {data && data.comptes.length > 0 && (
        <p style={{ fontSize: 12.5, fontWeight: 700, textAlign: "right" }}>
          {t("comptaTotalGeneral")} : {t("comptaDebit")} {formaterMontant(data.total.debit, locale)} — {t("comptaCredit")} {formaterMontant(data.total.credit, locale)}
        </p>
      )}
    </AppShell>
  );
}
