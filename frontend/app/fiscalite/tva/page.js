"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { api } from "../../../lib/api";
import { useLangue } from "../../../lib/i18n/LanguageContext";
import AppShell from "../../../lib/components/AppShell";
import FiscaliteSousNav from "../../../lib/components/FiscaliteSousNav";
import { inputStyle, labelStyle, thStyle, tdStyle, boutonPrincipalStyle, boutonSecondaireStyle, STYLE_STATUT, pastilleStyle, formaterXof, dateCourte, nomMois } from "../../../lib/fiscaliteUi";

export default function FiscaliteTvaListePage() {
  const { t } = useLangue();
  const locale = t("dateLocale");
  const [annee, setAnnee] = useState(new Date().getFullYear());
  const [lignes, setLignes] = useState(null);
  const [erreur, setErreur] = useState("");
  const moisCourant = new Date().getMonth() + 1;
  const anneeCourante = new Date().getFullYear();

  useEffect(() => {
    setLignes(null);
    api.fiscaliteTvaAnnee(annee).then(setLignes).catch((e) => setErreur(e.message));
  }, [annee]);

  const tot = (lignes || []).reduce(
    (a, l) => {
      if (l.declaration) {
        a.solde += l.declaration.solde_a_payer;
        a.nb += 1;
      }
      return a;
    },
    { solde: 0, nb: 0 }
  );

  return (
    <AppShell title={t("fiscTvaTitre")} subNav={<FiscaliteSousNav />}>
      {erreur && <p style={{ color: "var(--brique)", fontSize: 12.5, marginBottom: 12 }}>{erreur}</p>}
      <p style={{ fontSize: 12, color: "var(--sub)", marginBottom: 12, maxWidth: 800, lineHeight: 1.5 }}>{t("fiscTvaAide")}</p>
      <div className="card" style={{ marginBottom: 14, display: "flex", gap: 10, alignItems: "flex-end", flexWrap: "wrap" }}>
        <div>
          <label style={labelStyle}>{t("fiscAnnee")}</label>
          <select value={annee} onChange={(e) => setAnnee(Number(e.target.value))} style={{ ...inputStyle, width: 110 }}>
            {[anneeCourante + 1, anneeCourante, anneeCourante - 1, anneeCourante - 2, anneeCourante - 3].map((a) => <option key={a} value={a}>{a}</option>)}
          </select>
        </div>
        {lignes && (
          <div style={{ fontSize: 12.5, color: "var(--sub)" }}>
            {tot.nb} {t("fiscDeclarationsPreparees")} · {t("fiscTotalSolde")} <strong style={{ color: "var(--ink)" }}>{formaterXof(tot.solde, locale)} XOF</strong>
          </div>
        )}
      </div>

      <div className="card" style={{ padding: 0, overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 760 }}>
          <thead>
            <tr>
              <th style={thStyle}>{t("fiscPeriode")}</th>
              <th style={thStyle}>{t("fiscLimite")}</th>
              <th style={thStyle}>{t("fiscStatut")}</th>
              <th style={{ ...thStyle, textAlign: "right" }}>{t("fiscSoldeAPayer")}</th>
              <th style={{ ...thStyle, textAlign: "right" }}>{t("fiscCreditAReporter")}</th>
              <th style={thStyle}></th>
            </tr>
          </thead>
          <tbody>
            {(lignes || []).map((l) => {
              const d = l.declaration;
              const futur = annee > anneeCourante || (annee === anneeCourante && l.mois > moisCourant);
              return (
                <tr key={l.mois} style={futur && !d ? { color: "var(--sub)" } : {}}>
                  <td style={{ ...tdStyle, fontWeight: 600 }}>{nomMois(l.mois, locale)} {annee}</td>
                  <td style={{ ...tdStyle, whiteSpace: "nowrap" }}>{dateCourte(l.date_limite, locale)}</td>
                  <td style={tdStyle}>
                    {d ? <span style={pastilleStyle(STYLE_STATUT[d.statut])}>{t(`fiscStatut_${d.statut}`)}</span> : <span style={{ color: "var(--sub)", fontSize: 12 }}>{futur ? t("fiscPeriodeEnCours") : t("fiscNonPreparee")}</span>}
                  </td>
                  <td style={{ ...tdStyle, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{d ? formaterXof(d.solde_a_payer, locale) : ""}</td>
                  <td style={{ ...tdStyle, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{d && d.credit_a_reporter > 0 ? formaterXof(d.credit_a_reporter, locale) : ""}</td>
                  <td style={{ ...tdStyle, textAlign: "right" }}>
                    <Link href={`/fiscalite/tva/${annee}/${l.mois}`}>
                      <span style={boutonSecondaireStyle}>{d ? t("fiscOuvrir") : t("fiscPreparer")}</span>
                    </Link>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </AppShell>
  );
}
