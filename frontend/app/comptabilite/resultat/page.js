"use client";

import { useEffect, useState } from "react";
import { api } from "../../../lib/api";
import { useLangue } from "../../../lib/i18n/LanguageContext";
import AppShell from "../../../lib/components/AppShell";
import ComptaSousNav from "../../../lib/components/ComptaSousNav";
import ComptaEtatFiltres from "../../../lib/components/ComptaEtatFiltres";
import EtatAvertissements from "../../../lib/components/EtatAvertissements";
import { thStyle, tdStyle, numStyle, formaterMontant } from "../../../lib/comptaUi";

// Compte de resultat SYSCOHADA avec soldes intermediaires de gestion (marge
// commerciale, valeur ajoutee, EBE, resultat d'exploitation, ...). Produits en
// positif, charges en negatif ; N-1 = exercice precedent complet.
export default function ResultatPage() {
  const { t } = useLangue();
  const locale = t("dateLocale");
  const [filtres, setFiltres] = useState({ exercice_id: "", date_debut: "", date_fin: "", inclure_instance: false });
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
      setData(await api.comptaEtatResultat(p));
    } catch (e) {
      setErreur(e.message);
      setData(null);
    } finally {
      setChargement(false);
    }
  }

  const [auto, setAuto] = useState(false);
  useEffect(() => {
    if (filtres.exercice_id && !auto) {
      setAuto(true);
      afficher();
    }
  }, [filtres.exercice_id]); // eslint-disable-line react-hooks/exhaustive-deps

  const m = (v) => formaterMontant(v, locale, true);
  const mz = (v) => formaterMontant(v, locale, false);
  const n1 = !!data?.exercice_n1;

  return (
    <AppShell title={t("comptaNavResultat")} subNav={<ComptaSousNav />}>
      <p style={{ fontSize: 12, color: "var(--sub)", marginBottom: 12, maxWidth: 820, lineHeight: 1.5 }}>{t("comptaResultatAide")}</p>
      <ComptaEtatFiltres etat="etats/resultat" filtres={filtres} setFiltres={setFiltres} exercices={exercices} setExercices={setExercices} onAfficher={afficher} onErreur={setErreur} sansComptes />
      {erreur && <p style={{ color: "var(--brique)", fontSize: 12.5, marginBottom: 12 }}>{erreur}</p>}
      {chargement && <p style={{ fontSize: 12.5, color: "var(--sub)" }}>{t("loading")}</p>}
      {data && (
        <>
          <div style={{ display: "flex", gap: 16, flexWrap: "wrap", alignItems: "center", marginBottom: 12 }}>
            <span style={{ fontSize: 13 }}>
              {t("comptaBilanResultatNet")} : <strong style={{ color: data.resultat_net < 0 ? "var(--brique)" : "var(--vert)" }}>{formaterMontant(data.resultat_net, locale)}</strong>
            </span>
            <label style={{ fontSize: 12, display: "flex", gap: 6, alignItems: "center" }}>
              <input type="checkbox" checked={masquerZero} onChange={(e) => setMasquerZero(e.target.checked)} />
              {t("comptaEtatMasquerZero")}
            </label>
            <span style={{ fontSize: 12, color: "var(--sub)" }}>{n1 ? `N-1 : ${data.exercice_n1.libelle}` : t("comptaEtatPasDeN1")}</span>
          </div>
          <div className="card" style={{ padding: 0, overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 640 }}>
              <thead>
                <tr>
                  <th style={{ ...thStyle, width: 50 }}>{t("comptaEtatRef")}</th>
                  <th style={thStyle}>{t("comptaEtatLibelle")}</th>
                  <th style={{ ...thStyle, ...numStyle }}>{t("comptaResultatN")}</th>
                  <th style={{ ...thStyle, ...numStyle }}>{t("comptaResultatN1")}</th>
                </tr>
              </thead>
              <tbody>
                {data.lignes
                  .filter((l) => l.type === "solde" || !masquerZero || l.n || l.n1)
                  .map((l) => {
                    const solde = l.type === "solde";
                    return (
                      <tr key={l.code} style={solde ? { background: l.fort ? "var(--line-soft)" : "#f7f6f2" } : undefined}>
                        <td style={{ ...tdStyle, fontSize: 11, color: "var(--sub)" }}>{l.code}</td>
                        <td style={{ ...tdStyle, paddingLeft: solde ? 8 : 24, fontWeight: solde ? 700 : 400, color: l.nc ? "var(--ocre)" : undefined }}>{l.libelle}</td>
                        <td style={{ ...tdStyle, ...numStyle, fontWeight: solde ? 700 : 400 }}>{solde ? mz(l.n) : m(l.n)}</td>
                        <td style={{ ...tdStyle, ...numStyle, fontWeight: solde ? 700 : 400, color: "var(--sub)" }}>{!n1 ? "" : solde ? mz(l.n1) : m(l.n1)}</td>
                      </tr>
                    );
                  })}
              </tbody>
            </table>
          </div>
          <EtatAvertissements avertissements={data.avertissements} nonClasses={data.non_classes} />
        </>
      )}
    </AppShell>
  );
}
