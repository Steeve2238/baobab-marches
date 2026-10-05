"use client";

import { useEffect, useState } from "react";
import { api } from "../../../lib/api";
import { useLangue } from "../../../lib/i18n/LanguageContext";
import AppShell from "../../../lib/components/AppShell";
import ComptaSousNav from "../../../lib/components/ComptaSousNav";
import ComptaEtatFiltres from "../../../lib/components/ComptaEtatFiltres";
import EtatAvertissements from "../../../lib/components/EtatAvertissements";
import { thStyle, tdStyle, numStyle, formaterMontant } from "../../../lib/comptaUi";

// Bilan SYSCOHADA (systeme normal) : actif (brut / amortissements / net) et
// passif, colonne N-1 = exercice precedent s'il existe, controle actif = passif.
export default function BilanPage() {
  const { t } = useLangue();
  const locale = t("dateLocale");
  const [filtres, setFiltres] = useState({ exercice_id: "", date_fin: "", inclure_instance: false });
  const [exercices, setExercices] = useState([]);
  const [data, setData] = useState(null);
  const [erreur, setErreur] = useState("");
  const [chargement, setChargement] = useState(false);
  const [masquerZero, setMasquerZero] = useState(true);

  async function afficher() {
    setErreur("");
    setChargement(true);
    try {
      const p = {};
      for (const [k, v] of Object.entries(filtres)) if (v) p[k] = v === true ? "1" : v;
      setData(await api.comptaEtatBilan(p));
    } catch (e) {
      setErreur(e.message);
      setData(null);
    } finally {
      setChargement(false);
    }
  }

  // Premier affichage automatique quand l'exercice courant est connu.
  const [auto, setAuto] = useState(false);
  useEffect(() => {
    if (filtres.exercice_id && !auto) {
      setAuto(true);
      afficher();
    }
  }, [filtres.exercice_id]); // eslint-disable-line react-hooks/exhaustive-deps

  const m = (v) => formaterMontant(v, locale, true);
  const visible = (l, cles) => l.type === "titre" || l.type === "total" || !masquerZero || cles.some((c) => l[c]);
  const n1 = !!data?.exercice_n1;

  const cellLibelle = (l) => (
    <td style={{ ...tdStyle, paddingLeft: 8 + (l.retrait || 0) * 16, fontWeight: l.type === "total" || l.type === "titre" ? 700 : 400, color: l.nc ? "var(--ocre)" : undefined }}>{l.libelle}</td>
  );

  return (
    <AppShell title={t("comptaNavBilan")} subNav={<ComptaSousNav />}>
      <p style={{ fontSize: 12, color: "var(--sub)", marginBottom: 12, maxWidth: 820, lineHeight: 1.5 }}>{t("comptaBilanAide")}</p>
      <ComptaEtatFiltres
        etat="etats/bilan"
        filtres={filtres}
        setFiltres={setFiltres}
        exercices={exercices}
        setExercices={setExercices}
        onAfficher={afficher}
        onErreur={setErreur}
        sansComptes
        sansDebut
        libelleFin="comptaBilanArrete"
      />
      {erreur && <p style={{ color: "var(--brique)", fontSize: 12.5, marginBottom: 12 }}>{erreur}</p>}
      {chargement && <p style={{ fontSize: 12.5, color: "var(--sub)" }}>{t("loading")}</p>}
      {data && (
        <>
          <div style={{ display: "flex", gap: 16, flexWrap: "wrap", alignItems: "center", marginBottom: 12 }}>
            <span
              style={{
                padding: "4px 12px",
                borderRadius: 14,
                fontSize: 12.5,
                fontWeight: 700,
                color: "#fff",
                background: data.controles.equilibre ? "var(--vert)" : "var(--brique)",
              }}
            >
              {data.controles.equilibre ? t("comptaBilanEquilibre") : `${t("comptaBilanDesequilibre")} ${formaterMontant(data.controles.ecart, locale)}`}
            </span>
            <span style={{ fontSize: 13 }}>
              {t("comptaBilanResultatNet")} : <strong>{formaterMontant(data.resultat_net, locale)}</strong>
            </span>
            <label style={{ fontSize: 12, display: "flex", gap: 6, alignItems: "center" }}>
              <input type="checkbox" checked={masquerZero} onChange={(e) => setMasquerZero(e.target.checked)} />
              {t("comptaEtatMasquerZero")}
            </label>
            <span style={{ fontSize: 12, color: "var(--sub)" }}>
              {n1 ? `N-1 : ${data.exercice_n1.libelle}` : t("comptaEtatPasDeN1")}
            </span>
          </div>

          <div className="card" style={{ padding: 0, overflowX: "auto", marginBottom: 14 }}>
            <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 760 }}>
              <thead>
                <tr>
                  <th style={thStyle}>{t("comptaBilanActif")}</th>
                  <th style={{ ...thStyle, width: 50 }}>{t("comptaEtatRef")}</th>
                  <th style={{ ...thStyle, ...numStyle }}>{t("comptaBilanBrut")}</th>
                  <th style={{ ...thStyle, ...numStyle }}>{t("comptaBilanAmort")}</th>
                  <th style={{ ...thStyle, ...numStyle }}>{t("comptaBilanNetN")}</th>
                  <th style={{ ...thStyle, ...numStyle }}>{t("comptaBilanNetN1")}</th>
                </tr>
              </thead>
              <tbody>
                {data.actif.filter((l) => visible(l, ["brut", "amort", "net", "net_n1"])).map((l, i) => (
                  <tr key={`a${i}`} style={l.type === "total" && l.fort ? { background: "var(--line-soft)" } : undefined}>
                    {cellLibelle(l)}
                    <td style={{ ...tdStyle, fontSize: 11, color: "var(--sub)" }}>{l.code}</td>
                    <td style={{ ...tdStyle, ...numStyle, fontWeight: l.type === "total" ? 700 : 400 }}>{l.type === "titre" ? "" : m(l.brut)}</td>
                    <td style={{ ...tdStyle, ...numStyle, fontWeight: l.type === "total" ? 700 : 400 }}>{l.type === "titre" ? "" : m(l.amort)}</td>
                    <td style={{ ...tdStyle, ...numStyle, fontWeight: l.type === "total" ? 700 : 400 }}>{l.type === "titre" ? "" : m(l.net)}</td>
                    <td style={{ ...tdStyle, ...numStyle, fontWeight: l.type === "total" ? 700 : 400, color: "var(--sub)" }}>{l.type === "titre" || !n1 ? "" : m(l.net_n1)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="card" style={{ padding: 0, overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 760 }}>
              <thead>
                <tr>
                  <th style={thStyle}>{t("comptaBilanPassif")}</th>
                  <th style={{ ...thStyle, width: 50 }}>{t("comptaEtatRef")}</th>
                  <th style={{ ...thStyle, ...numStyle }}>{t("comptaBilanNetN")}</th>
                  <th style={{ ...thStyle, ...numStyle }}>{t("comptaBilanNetN1")}</th>
                </tr>
              </thead>
              <tbody>
                {data.passif.filter((l) => visible(l, ["net", "net_n1"])).map((l, i) => (
                  <tr key={`p${i}`} style={l.type === "total" && l.fort ? { background: "var(--line-soft)" } : undefined}>
                    {cellLibelle(l)}
                    <td style={{ ...tdStyle, fontSize: 11, color: "var(--sub)" }}>{l.code}</td>
                    <td style={{ ...tdStyle, ...numStyle, fontWeight: l.type === "total" ? 700 : 400 }}>{l.type === "titre" ? "" : m(l.net)}</td>
                    <td style={{ ...tdStyle, ...numStyle, fontWeight: l.type === "total" ? 700 : 400, color: "var(--sub)" }}>{l.type === "titre" || !n1 ? "" : m(l.net_n1)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <EtatAvertissements avertissements={data.avertissements} nonClasses={data.non_classes} />
        </>
      )}
    </AppShell>
  );
}
