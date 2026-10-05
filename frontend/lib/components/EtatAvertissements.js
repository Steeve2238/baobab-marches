"use client";

import { useLangue } from "../i18n/LanguageContext";
import { formaterMontant } from "../comptaUi";

/** Avertissements d'un etat financier (bilan, compte de resultat) : une ligne par code. */
export default function EtatAvertissements({ avertissements = [], nonClasses = [] }) {
  const { t } = useLangue();
  const locale = t("dateLocale");
  if (avertissements.length === 0 && nonClasses.length === 0) return null;
  return (
    <div className="card" style={{ marginTop: 14, borderColor: "var(--ocre)" }}>
      <div style={{ fontSize: 12.5, fontWeight: 700, color: "var(--ocre)", marginBottom: 6 }}>{t("comptaEtatPointsAttention")}</div>
      <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12.5, lineHeight: 1.6 }}>
        {avertissements.map((a) => (
          <li key={a.code}>
            {t(`comptaEtatAv_${a.code}`)}
            {a.nombre !== undefined ? ` (${a.nombre})` : ""}
            {a.ecart !== undefined ? ` : ${formaterMontant(a.ecart, locale)}` : ""}
          </li>
        ))}
      </ul>
      {nonClasses.length > 0 && (
        <table style={{ width: "100%", borderCollapse: "collapse", marginTop: 8, maxWidth: 760 }}>
          <thead>
            <tr>
              <th style={{ fontSize: 11, textAlign: "left", padding: "4px 8px" }}>{t("comptaEtatCompte")}</th>
              <th style={{ fontSize: 11, textAlign: "left", padding: "4px 8px" }}>{t("comptaEtatLibelle")}</th>
              <th style={{ fontSize: 11, textAlign: "right", padding: "4px 8px" }}>{t("comptaEtatSoldeDebit")}</th>
              <th style={{ fontSize: 11, textAlign: "right", padding: "4px 8px" }}>{t("comptaEtatSoldeCredit")}</th>
            </tr>
          </thead>
          <tbody>
            {nonClasses.map((c) => (
              <tr key={c.numero}>
                <td style={{ fontSize: 12, padding: "3px 8px", fontFamily: "IBM Plex Mono, monospace" }}>{c.numero}</td>
                <td style={{ fontSize: 12, padding: "3px 8px" }}>{c.libelle}</td>
                <td style={{ fontSize: 12, padding: "3px 8px", textAlign: "right" }}>{formaterMontant(c.solde_debit, locale, true)}</td>
                <td style={{ fontSize: 12, padding: "3px 8px", textAlign: "right" }}>{formaterMontant(c.solde_credit, locale, true)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
