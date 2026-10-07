"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { api } from "../../../lib/api";
import { useLangue } from "../../../lib/i18n/LanguageContext";
import AppShell from "../../../lib/components/AppShell";
import FiscaliteSousNav from "../../../lib/components/FiscaliteSousNav";
import { thStyle, tdStyle, boutonSecondaireStyle, STYLE_STATUT, pastilleStyle, formaterXof } from "../../../lib/fiscaliteUi";

export default function FiscaliteCelListePage() {
  const { t } = useLangue();
  const locale = t("dateLocale");
  const [data, setData] = useState(null);
  const [erreur, setErreur] = useState("");

  useEffect(() => {
    api.fiscaliteCel().then(setData).catch((e) => setErreur(e.message));
  }, []);

  const courante = new Date().getFullYear();
  const annees = [courante + 1, courante, courante - 1, courante - 2];
  const parAnnee = new Map((data?.annees || []).map((a) => [a.annee, a]));
  for (const a of data?.annees || []) if (!annees.includes(a.annee)) annees.push(a.annee);
  annees.sort((a, b) => b - a);

  return (
    <AppShell title={t("fiscCelTitre")} subNav={<FiscaliteSousNav />}>
      {erreur && <p style={{ color: "var(--brique)", fontSize: 12.5, marginBottom: 12 }}>{erreur}</p>}
      <p style={{ fontSize: 12, color: "var(--sub)", marginBottom: 12, maxWidth: 820, lineHeight: 1.5 }}>{t("fiscCelAide")}</p>
      <div className="card" style={{ padding: 0, overflowX: "auto", marginBottom: 18 }}>
        <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 640 }}>
          <thead>
            <tr>
              <th style={thStyle}>{t("fiscCelAnneeImposition")}</th>
              <th style={thStyle}>{t("fiscCelEcheances")}</th>
              <th style={thStyle}>{t("fiscStatut")}</th>
              <th style={{ ...thStyle, textAlign: "right" }}>{t("fiscCelTotal")}</th>
              <th style={thStyle}></th>
            </tr>
          </thead>
          <tbody>
            {!data && <tr><td style={tdStyle} colSpan={5}>{t("loading")}</td></tr>}
            {data && annees.map((a) => {
              const d = parAnnee.get(a);
              return (
                <tr key={a}>
                  <td style={{ ...tdStyle, fontWeight: 700 }}>{a}</td>
                  <td style={{ ...tdStyle, fontSize: 12, color: "var(--sub)" }}>{t("fiscCelEcheancesTexte").split("{annee}").join(String(a))}</td>
                  <td style={tdStyle}>
                    {!d || d.statut === "BROUILLON" ? <span style={{ color: "var(--sub)", fontSize: 12 }}>{t("fiscNonPreparee")}</span> : <span style={pastilleStyle(STYLE_STATUT[d.statut])}>{t(`fiscStatut_${d.statut}`)}</span>}
                  </td>
                  <td style={{ ...tdStyle, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{d && d.montant_du !== null ? formaterXof(d.montant_du, locale) : ""}</td>
                  <td style={{ ...tdStyle, textAlign: "right" }}>
                    <Link href={`/fiscalite/cel/${a}`}><span style={boutonSecondaireStyle}>{t("fiscOuvrir")}</span></Link>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p style={{ fontSize: 12, color: "var(--sub)", maxWidth: 820, lineHeight: 1.5 }}>
        {t("fiscCelLocauxResume").split("{nombre}").join(String(data ? data.locaux.length : 0))}
      </p>
    </AppShell>
  );
}
