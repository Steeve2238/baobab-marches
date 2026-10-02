"use client";

import { useEffect, useState } from "react";
import { api } from "../api";
import { useLangue } from "../i18n/LanguageContext";

/**
 * Section "Courriers" partagee entre la fiche d'un dossier Appel d'Offres
 * (/dossiers/[id]) et la fiche d'une consultation restreinte
 * (/marches/consultation-restreinte/consultations/[id]) - chantier du
 * 02/10/2026, demande de Steeve : "le client veut avoir la possibilite de
 * faire les courriers comme avec les appels d'offres". Extraite de la fiche
 * dossier AO (ou elle vivait en dur depuis le Module 6) pour eviter de
 * dupliquer toute cette logique une deuxieme fois sur la fiche consultation.
 *
 * Consomme UNIQUEMENT les nouvelles routes unifiees et persistees
 * (POST /courriers/generer, GET /courriers/historique,
 * PATCH /courriers/generes/:id/statut - voir routes/courriers.js) plutot que
 * les anciennes routes /courriers/dossiers/:dossierId/generer (conservees
 * cote backend pour compatibilite mais plus appelees par le frontend a
 * partir de ce chantier).
 *
 * Props :
 *   - dossierType : "AO" | "CONSULTATION"
 *   - dossierId : id du dossier_ao ou de la consultation
 *   - valeursConnues : objet optionnel { cle: valeur } pour pre-remplir les
 *     variables personnalisees deductibles d'autres ecrans (ex. simulation de
 *     financement retenue sur un dossier AO) - voir deduireValeursConnues()
 *     anciennement dans app/dossiers/[id]/page.js.
 *   - afficherSuggestions : si true, charge et affiche les suggestions
 *     automatiques (heuristiques chronogramme AO) - n'a de sens que pour un
 *     dossier AO, jamais pour une consultation.
 */
export default function CourrierSection({ dossierType, dossierId, valeursConnues = {}, afficherSuggestions = false }) {
  const { t, typeCourrierLabel, dict } = useLangue();

  const [modelesCourrier, setModelesCourrier] = useState([]);
  const [suggestionsCourrier, setSuggestionsCourrier] = useState([]);
  const [entete, setEntete] = useState(null);
  const [historique, setHistorique] = useState([]);
  const [chargement, setChargement] = useState(true);
  const [erreur, setErreur] = useState("");

  const [modeleSelectionne, setModeleSelectionne] = useState("");
  const [courrierGenere, setCourrierGenere] = useState(null);
  const [generationEnCours, setGenerationEnCours] = useState(false);
  const [copieConfirmee, setCopieConfirmee] = useState(false);
  const [variablesDetectees, setVariablesDetectees] = useState([]);
  const [variablesPersonnalisees, setVariablesPersonnalisees] = useState({});
  const [envoiEnCoursId, setEnvoiEnCoursId] = useState(null);

  useEffect(() => {
    if (!dossierId) return;
    let annule = false;
    async function charger() {
      setChargement(true);
      try {
        const appels = [
          api.getModelesCourrier(),
          api.getEntete(),
          api.getHistoriqueCourriers({ dossierType, dossierId }),
        ];
        if (afficherSuggestions) {
          appels.push(api.getSuggestionsCourrier(dossierId));
        }
        const resultats = await Promise.all(appels);
        if (annule) return;
        setModelesCourrier(resultats[0]);
        setEntete(resultats[1]);
        setHistorique(resultats[2]);
        if (afficherSuggestions) setSuggestionsCourrier(resultats[3] || []);
      } catch (err) {
        if (!annule) setErreur(err.message || t("defaultLoadError"));
      } finally {
        if (!annule) setChargement(false);
      }
    }
    charger();
    return () => {
      annule = true;
    };
  }, [dossierType, dossierId, afficherSuggestions, t]);

  /**
   * Extrait les noms de variables {{xxx}} d'un modele, en excluant celles
   * deja couvertes automatiquement par le contexte dossier ({{dossier.*}}
   * et {{date_jour}}).
   */
  function extraireVariablesPersonnalisees(modele) {
    const texte = `${modele.titre} ${modele.corps_template}`;
    const trouvees = new Set();
    const regex = /\{\{\s*([\w.]+)\s*\}\}/g;
    let m;
    while ((m = regex.exec(texte)) !== null) {
      const cle = m[1];
      if (!cle.startsWith("dossier.") && cle !== "date_jour") {
        trouvees.add(cle);
      }
    }
    return [...trouvees];
  }

  function handleSelectionModele(modeleId) {
    setModeleSelectionne(modeleId);
    setCourrierGenere(null);
    const modele = modelesCourrier.find((m) => m.id === modeleId);
    if (!modele) {
      setVariablesDetectees([]);
      setVariablesPersonnalisees({});
      return;
    }
    const detectees = extraireVariablesPersonnalisees(modele);
    setVariablesDetectees(detectees);
    setVariablesPersonnalisees(
      Object.fromEntries(detectees.map((cle) => [cle, valeursConnues[cle] !== undefined ? valeursConnues[cle] : ""]))
    );
  }

  async function handleGenererCourrier() {
    if (!modeleSelectionne) return;
    setGenerationEnCours(true);
    setCopieConfirmee(false);
    try {
      const resultat = await api.genererCourrierUnifie({
        dossier_type: dossierType,
        dossier_id: dossierId,
        modele_id: modeleSelectionne,
        variables: variablesPersonnalisees,
      });
      setCourrierGenere(resultat);
      // Reinsertion en tete de l'historique sans tout recharger - le serveur
      // fait deja foi pour le numero/statut, inutile de refaire un aller-retour.
      setHistorique((prev) => [
        {
          id: resultat.id,
          numero: resultat.numero,
          titre_rendu: resultat.titre,
          contenu_final: resultat.corps,
          statut: resultat.statut,
          date_generation: resultat.date_generation,
          type_courrier: resultat.type_courrier,
        },
        ...prev,
      ]);
    } catch (err) {
      setErreur(err.message);
    } finally {
      setGenerationEnCours(false);
    }
  }

  function handleCopierCourrier() {
    if (!courrierGenere) return;
    navigator.clipboard.writeText(`${courrierGenere.titre}\n\n${courrierGenere.corps}`).then(() => {
      setCopieConfirmee(true);
      setTimeout(() => setCopieConfirmee(false), 2000);
    });
  }

  async function handleMarquerEnvoye(courrierId) {
    setEnvoiEnCoursId(courrierId);
    try {
      const maj = await api.marquerCourrierEnvoye(courrierId);
      setHistorique((prev) => prev.map((c) => (c.id === courrierId ? { ...c, statut: maj.statut } : c)));
    } catch (err) {
      setErreur(err.message);
    } finally {
      setEnvoiEnCoursId(null);
    }
  }

  return (
    <section>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
        <h2 style={{ fontSize: 15.5, color: "var(--petrol)" }}>{t("lettersSection")}</h2>
      </div>

      {erreur && <p style={{ color: "var(--brique)", fontSize: 12.5, marginBottom: 14 }}>{erreur}</p>}

      {suggestionsCourrier.length > 0 && (
        <div style={{ marginBottom: 14 }}>
          <h3 style={{ fontSize: 12.5, color: "var(--sub)", marginBottom: 8, fontWeight: 600 }}>
            {t("suggestedLetters")}
          </h3>
          <div style={{ display: "grid", gap: 6 }}>
            {suggestionsCourrier.map((s) => (
              <div
                key={s.id}
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  padding: "8px 10px",
                  borderRadius: 8,
                  background: "var(--ocre-bg, #FFF3E0)",
                  fontSize: 12.5,
                }}
              >
                <div>
                  <span style={{ fontWeight: 600 }}>{s.titre}</span>
                  <div style={{ fontSize: 11, color: "var(--sub)", marginTop: 2 }}>{s.raison}</div>
                </div>
                <button onClick={() => handleSelectionModele(s.id)} style={boutonSecondaireStyle}>
                  {t("useSuggestion")}
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="card" style={{ marginBottom: 14 }}>
        <label style={labelStyle}>{t("selectTemplate")}</label>
        <div style={{ display: "flex", gap: 10 }}>
          <select
            value={modeleSelectionne}
            onChange={(e) => handleSelectionModele(e.target.value)}
            style={{ ...inputStyle, flex: 1 }}
          >
            <option value="">—</option>
            {modelesCourrier.map((m) => (
              <option key={m.id} value={m.id}>
                {m.titre} ({typeCourrierLabel(m.type_courrier)})
              </option>
            ))}
          </select>
        </div>

        {variablesDetectees.length > 0 && (
          <div style={{ marginTop: 14, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            {variablesDetectees.map((cle) => (
              <div key={cle}>
                <label style={labelStyle}>{`{{${cle}}}`}</label>
                <input
                  value={variablesPersonnalisees[cle] ?? ""}
                  onChange={(e) => setVariablesPersonnalisees((prev) => ({ ...prev, [cle]: e.target.value }))}
                  style={inputStyle}
                />
              </div>
            ))}
          </div>
        )}

        <button
          onClick={handleGenererCourrier}
          disabled={!modeleSelectionne || generationEnCours}
          style={{ ...boutonPrincipalStyle, marginTop: 14 }}
        >
          {t("generateLetter")}
        </button>
      </div>

      {courrierGenere && (
        <div style={{ marginBottom: 20 }}>
          <div className="no-print" style={{ display: "flex", justifyContent: "flex-end", marginBottom: 10, gap: 10 }}>
            <span className="mono" style={{ fontSize: 11, color: "var(--sub)", alignSelf: "center", marginRight: "auto" }}>
              {courrierGenere.numero}
            </span>
            <button onClick={handleCopierCourrier} style={boutonSecondaireStyle}>
              {copieConfirmee ? t("copied") : t("copyText")}
            </button>
            <button onClick={() => window.print()} style={boutonPrincipalStyle}>
              {t("print")}
            </button>
          </div>

          {courrierGenere.variables_manquantes.length > 0 && (
            <p className="no-print" style={{ fontSize: 11.5, color: "var(--brique)", marginBottom: 8 }}>
              {t("missingVariables")} : {courrierGenere.variables_manquantes.join(", ")}
            </p>
          )}

          <div className="card print-letter" style={{ padding: "28px 32px" }}>
            {/* En-tete structure */}
            <div style={{ borderBottom: "2px solid var(--petrol)", paddingBottom: 14, marginBottom: 24 }}>
              <div style={{ fontFamily: "Space Grotesk", fontWeight: 700, fontSize: 15, color: "var(--petrol)" }}>
                {entete?.raison_sociale || "—"}
              </div>
              <div style={{ fontSize: 11, color: "var(--sub)", marginTop: 3, lineHeight: 1.5 }}>
                {entete?.adresse && <div>{entete.adresse}</div>}
                <div>
                  {entete?.telephone ? `Tél : ${entete.telephone}` : ""}
                  {entete?.telephone && entete?.email ? "  ·  " : ""}
                  {entete?.email ? `${entete.email}` : ""}
                </div>
              </div>
            </div>

            {/* Titre du courrier */}
            <div style={{ fontWeight: 700, fontSize: 13.5, marginBottom: 18 }}>{courrierGenere.titre}</div>

            {/* Corps */}
            <pre style={{ whiteSpace: "pre-wrap", fontFamily: "inherit", fontSize: 12.8, lineHeight: 1.7, margin: 0 }}>
              {courrierGenere.corps}
            </pre>

            {/* Signature */}
            <div style={{ marginTop: 48, textAlign: "right" }}>
              <div style={{ fontSize: 12.5 }}>{entete?.signataire_titre || ""}</div>
              <div style={{ fontWeight: 700, fontSize: 13, marginTop: 40 }}>{entete?.signataire_nom || ""}</div>
            </div>
          </div>
        </div>
      )}

      {/* ---------------- HISTORIQUE NUMEROTE ---------------- */}
      <div className="no-print">
        <h3 style={{ fontSize: 12.5, color: "var(--sub)", marginBottom: 8, fontWeight: 600 }}>
          {t("historiqueCourriersSection")}
        </h3>
        {chargement ? (
          <p style={{ fontSize: 12.5, color: "var(--sub)" }}>{t("loading")}</p>
        ) : historique.length === 0 ? (
          <p className="card" style={{ fontSize: 13, color: "var(--sub)" }}>
            {t("aucunCourrierGenere")}
          </p>
        ) : (
          <div style={{ display: "grid", gap: 6 }}>
            {historique.map((c) => (
              <div
                key={c.id}
                className="card"
                style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 12px" }}
              >
                <div>
                  <span className="mono" style={{ fontWeight: 600, fontSize: 12.5 }}>
                    {c.numero}
                  </span>
                  <span style={{ fontSize: 12, marginLeft: 8 }}>{c.titre_rendu}</span>
                  <div style={{ fontSize: 10.5, color: "var(--sub)", marginTop: 2 }}>
                    {c.date_generation ? new Date(c.date_generation).toLocaleDateString(dict.dateLocale) : "—"}
                  </div>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
                  <span className={`chip ${c.statut === "ENVOYE" ? "ok" : "warn"}`}>
                    {t(`letterStatus${c.statut}`)}
                  </span>
                  {c.statut !== "ENVOYE" && (
                    <button
                      onClick={() => handleMarquerEnvoye(c.id)}
                      disabled={envoiEnCoursId === c.id}
                      style={boutonSecondaireStyle}
                    >
                      {t("markLetterAsSent")}
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

const labelStyle = { fontSize: 11.5, fontWeight: 600, display: "block", marginBottom: 5 };
const inputStyle = {
  width: "100%",
  padding: "8px 10px",
  border: "1px solid var(--line)",
  borderRadius: 8,
  fontSize: 13,
  fontFamily: "inherit",
};
const boutonPrincipalStyle = {
  background: "var(--petrol)",
  color: "#fff",
  border: "none",
  borderRadius: 8,
  padding: "8px 16px",
  fontSize: 12.5,
  fontWeight: 600,
};
const boutonSecondaireStyle = {
  background: "none",
  border: "1px solid var(--line)",
  borderRadius: 6,
  padding: "4px 10px",
  fontSize: 11.5,
  whiteSpace: "nowrap",
};
