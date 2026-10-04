"use client";

import { Fragment, useState } from "react";
import { api } from "../../../lib/api";
import { useLangue } from "../../../lib/i18n/LanguageContext";
import AppShell from "../../../lib/components/AppShell";
import ComptaSousNav from "../../../lib/components/ComptaSousNav";
import ComptaEtatFiltres from "../../../lib/components/ComptaEtatFiltres";
import { thStyle, tdStyle, numStyle, formaterMontant } from "../../../lib/comptaUi";

// Balance generale a 3 blocs (ouverture / mouvements / soldes) avec
// sous-totaux par famille de comptes, comme les editions Sage.
export default function BalancePage() {
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
      setData(await api.comptaBalance(p));
    } catch (e) {
      setErreur(e.message);
      setData(null);
    } finally {
      setChargement(false);
    }
  }

  const m = (v) => formaterMontant(v, locale, true);
  const cellules = (l, style) => (
    <>
      <td style={{ ...tdStyle, ...numStyle, ...style }}>{m(l.ouverture_debit)}</td>
      <td style={{ ...tdStyle, ...numStyle, ...style }}>{m(l.ouverture_credit)}</td>
      <td style={{ ...tdStyle, ...numStyle, ...style }}>{m(l.mouvement_debit)}</td>
      <td style={{ ...tdStyle, ...numStyle, ...style }}>{m(l.mouvement_credit)}</td>
      <td style={{ ...tdStyle, ...numStyle, ...style }}>{m(l.solde_debit)}</td>
      <td style={{ ...tdStyle, ...numStyle, ...style }}>{m(l.solde_credit)}</td>
    </>
  );

  return (
    <AppShell title={t("comptaNavBalance")} subNav={<ComptaSousNav />}>
      {erreur && <p style={{ color: "var(--brique)", fontSize: 12.5, marginBottom: 12 }}>{erreur}</p>}
      <ComptaEtatFiltres etat="balance" filtres={filtres} setFiltres={setFiltres} exercices={exercices} setExercices={setExercices} onAfficher={afficher} onErreur={setErreur} />
      {chargement && <p style={{ fontSize: 12.5, color: "var(--sub)" }}>{t("loading")}</p>}
      {!data && !chargement && <p style={{ fontSize: 12.5, color: "var(--sub)" }}>{t("comptaEtatAide")}</p>}
      {data && (
        <div className="card" style={{ padding: 0, overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 980 }}>
            <thead>
              <tr>
                <th style={thStyle} rowSpan={2}>
                  {t("comptaNumero")}
                </th>
                <th style={thStyle} rowSpan={2}>
                  {t("comptaIntitule")}
                </th>
                <th style={{ ...thStyle, textAlign: "center" }} colSpan={2}>
                  {t("comptaBalOuverture")} {data.periode.debut}
                </th>
                <th style={{ ...thStyle, textAlign: "center" }} colSpan={2}>
                  {t("comptaBalMouvements")}
                </th>
                <th style={{ ...thStyle, textAlign: "center" }} colSpan={2}>
                  {t("comptaBalSoldes")}
                </th>
              </tr>
              <tr>
                {[0, 1, 2].map((i) => (
                  <Fragment key={i}>
                    <th style={{ ...thStyle, textAlign: "right" }}>
                      {t("comptaDebit")}
                    </th>
                    <th style={{ ...thStyle, textAlign: "right" }}>
                      {t("comptaCredit")}
                    </th>
                  </Fragment>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.lignes.map((l, i) =>
                l.type === "compte" ? (
                  <tr key={i}>
                    <td style={{ ...tdStyle, fontFamily: "IBM Plex Mono, monospace" }}>{l.numero}</td>
                    <td style={tdStyle}>{l.libelle}</td>
                    {cellules(l)}
                  </tr>
                ) : (
                  <tr key={i} style={{ background: l.niveau === 1 ? "var(--line)" : "var(--line-soft)" }}>
                    <td style={{ ...tdStyle, fontWeight: 700, fontFamily: "IBM Plex Mono, monospace" }}>{l.prefixe}</td>
                    <td style={{ ...tdStyle, fontWeight: 700 }}>
                      {"*".repeat(4 - l.niveau)} {l.libelle}
                    </td>
                    {cellules(l, { fontWeight: 700 })}
                  </tr>
                )
              )}
              <tr style={{ background: "var(--petrol)", color: "#fff" }}>
                <td style={{ ...tdStyle, color: "#fff", fontWeight: 700 }} colSpan={2}>
                  {t("comptaTotalGeneral")} ({data.nombre_comptes} {t("comptaComptesMot")})
                </td>
                {cellules(data.totaux, { color: "#fff", fontWeight: 700 })}
              </tr>
            </tbody>
          </table>
        </div>
      )}
    </AppShell>
  );
}
