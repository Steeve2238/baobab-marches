"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { api } from "../../lib/api";
import { useLangue } from "../../lib/i18n/LanguageContext";
import AppShell from "../../lib/components/AppShell";
import ComptaSousNav from "../../lib/components/ComptaSousNav";
import { useComptaStatut, labelStyle, inputStyle, boutonPrincipalStyle } from "../../lib/comptaUi";

// Accueil du module Comptabilite : assistant d'initialisation (premiere
// utilisation, reserve au niveau "validation") puis tableau d'etat.
export default function ComptabiliteAccueilPage() {
  const { t } = useLangue();
  const { statut, erreur: erreurStatut, recharger } = useComptaStatut();
  const annee = new Date().getFullYear();
  const [form, setForm] = useState({ longueur_compte: 8, date_debut: `${annee}-01-01`, date_fin: `${annee}-12-31`, libelle_exercice: `Exercice ${annee}` });
  const [erreur, setErreur] = useState("");
  const [envoi, setEnvoi] = useState(false);
  const [exercices, setExercices] = useState([]);

  useEffect(() => {
    if (statut?.initialisee) api.comptaExercices().then(setExercices).catch(() => {});
  }, [statut?.initialisee]);

  async function initialiser(e) {
    e.preventDefault();
    setErreur("");
    setEnvoi(true);
    try {
      await api.comptaInitialiser({ ...form, longueur_compte: Number(form.longueur_compte) });
      recharger();
    } catch (err) {
      setErreur(err.message);
    } finally {
      setEnvoi(false);
    }
  }

  return (
    <AppShell title={t("comptaPageTitle")} subNav={<ComptaSousNav />}>
      {(erreur || erreurStatut) && <p style={{ color: "var(--brique)", fontSize: 12.5, marginBottom: 14 }}>{erreur || erreurStatut}</p>}
      {!statut ? (
        <p style={{ fontSize: 12.5, color: "var(--sub)" }}>{t("loading")}</p>
      ) : !statut.initialisee ? (
        <div className="card" style={{ maxWidth: 560 }}>
          <h2 style={{ fontSize: 15, color: "var(--petrol)", marginBottom: 8 }}>{t("comptaInitTitre")}</h2>
          <p style={{ fontSize: 12.5, color: "var(--sub)", lineHeight: 1.55 }}>{t("comptaInitIntro")}</p>
          {statut.droits.validation ? (
            <form onSubmit={initialiser} style={{ marginTop: 14, display: "grid", gap: 10 }}>
              <div>
                <label style={labelStyle}>{t("comptaInitLongueur")}</label>
                <select value={form.longueur_compte} onChange={(e) => setForm((f) => ({ ...f, longueur_compte: e.target.value }))} style={inputStyle}>
                  {[6, 7, 8, 9, 10].map((n) => (
                    <option key={n} value={n}>
                      {n} {t("comptaChiffres")}
                      {n === 8 ? ` (${t("comptaRecommande")})` : ""}
                    </option>
                  ))}
                </select>
                <p style={{ fontSize: 11.5, color: "var(--sub)", marginTop: 4 }}>{t("comptaInitLongueurAide")}</p>
              </div>
              <div>
                <label style={labelStyle}>{t("comptaExerciceLibelle")}</label>
                <input value={form.libelle_exercice} onChange={(e) => setForm((f) => ({ ...f, libelle_exercice: e.target.value }))} style={inputStyle} required />
              </div>
              <div style={{ display: "flex", gap: 10 }}>
                <div style={{ flex: 1 }}>
                  <label style={labelStyle}>{t("comptaExerciceDebut")}</label>
                  <input type="date" value={form.date_debut} onChange={(e) => setForm((f) => ({ ...f, date_debut: e.target.value }))} style={inputStyle} required />
                </div>
                <div style={{ flex: 1 }}>
                  <label style={labelStyle}>{t("comptaExerciceFin")}</label>
                  <input type="date" value={form.date_fin} onChange={(e) => setForm((f) => ({ ...f, date_fin: e.target.value }))} style={inputStyle} required />
                </div>
              </div>
              <button type="submit" disabled={envoi} style={{ ...boutonPrincipalStyle, justifySelf: "start" }}>
                {envoi ? t("comptaInitEnCours") : t("comptaInitBouton")}
              </button>
            </form>
          ) : (
            <p style={{ marginTop: 14, fontSize: 12.5, color: "var(--ocre)" }}>{t("comptaInitReserve")}</p>
          )}
        </div>
      ) : (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))", gap: 12, marginBottom: 18 }}>
            <Compteur titre={t("comptaCompteurBrouillons")} valeur={statut.en_attente.brouillons} href="/comptabilite/ecritures?statut=BROUILLON" />
            <Compteur titre={t("comptaCompteurInstance")} valeur={statut.en_attente.en_instance} href="/comptabilite/instance" alerte />
            <Compteur titre={t("comptaCompteurExercices")} valeur={exercices.filter((x) => x.statut === "OUVERT").length} href="/comptabilite/parametres" />
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 12 }}>
            <Raccourci href="/comptabilite/ecritures/nouvelle" titre={t("comptaRaccourciSaisie")} texte={t("comptaRaccourciSaisieTexte")} />
            <Raccourci href="/comptabilite/grand-livre" titre={t("comptaNavGrandLivre")} texte={t("comptaRaccourciGlTexte")} />
            <Raccourci href="/comptabilite/balance" titre={t("comptaNavBalance")} texte={t("comptaRaccourciBalanceTexte")} />
            <Raccourci href="/comptabilite/plan" titre={t("comptaNavPlan")} texte={t("comptaRaccourciPlanTexte")} />
            <Raccourci href="/comptabilite/importer" titre={t("comptaRaccourciImport")} texte={t("comptaRaccourciImportTexte")} />
          </div>
          {exercices.length > 0 && (
            <div className="card" style={{ marginTop: 18 }}>
              <h3 style={{ fontSize: 13.5, color: "var(--petrol)", marginBottom: 8 }}>{t("comptaExercicesTitre")}</h3>
              {exercices.map((x) => (
                <div key={x.id} style={{ display: "flex", gap: 14, fontSize: 12.5, padding: "5px 0", borderBottom: "1px solid var(--line-soft)", flexWrap: "wrap" }}>
                  <strong style={{ minWidth: 140 }}>{x.libelle}</strong>
                  <span style={{ color: "var(--sub)" }}>
                    {x.date_debut} → {x.date_fin}
                  </span>
                  <span>
                    {x.nb_ecritures} {t("comptaEcrituresMot")}
                    {x.nb_en_attente > 0 ? ` (${x.nb_en_attente} ${t("comptaEnAttenteMot")})` : ""}
                  </span>
                  <span style={{ color: x.statut === "OUVERT" ? "var(--vert)" : "var(--sub)", fontWeight: 600 }}>
                    {x.statut === "OUVERT" ? t("comptaExerciceOuvert") : t("comptaExerciceCloture")}
                  </span>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </AppShell>
  );
}

function Compteur({ titre, valeur, href, alerte }) {
  return (
    <Link href={href} className="card" style={{ display: "block" }}>
      <div style={{ fontSize: 11.5, color: "var(--sub)", fontWeight: 600 }}>{titre}</div>
      <div style={{ fontSize: 26, fontWeight: 700, fontFamily: "Space Grotesk", color: alerte && valeur > 0 ? "var(--ocre)" : "var(--petrol)", marginTop: 4 }}>{valeur}</div>
    </Link>
  );
}

function Raccourci({ href, titre, texte }) {
  return (
    <Link href={href} className="card" style={{ display: "block" }}>
      <div style={{ fontWeight: 700, fontSize: 13.5, color: "var(--petrol)" }}>{titre}</div>
      <div style={{ fontSize: 12, color: "var(--sub)", marginTop: 4, lineHeight: 1.5 }}>{texte}</div>
    </Link>
  );
}
