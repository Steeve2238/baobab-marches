"use client";

import { useEffect, useState } from "react";
import { api } from "../../../lib/api";
import { useLangue } from "../../../lib/i18n/LanguageContext";
import AppShell from "../../../lib/components/AppShell";

const RESULTATS = ["GAGNE", "PERDU", "INFRUCTUEUX"];
const NIVEAUX_RISQUE = ["FAIBLE", "MOYEN", "ELEVE"];

export default function ConcurrencePage() {
  const { t, resultatConcurrentLabel, niveauRisqueLabel, dict } = useLangue();

  const [maitresOuvrage, setMaitresOuvrage] = useState([]);
  const [historique, setHistorique] = useState([]);
  const [clausesRisque, setClausesRisque] = useState([]);
  const [erreur, setErreur] = useState("");

  const [afficherNouveauMo, setAfficherNouveauMo] = useState(false);
  const [formMo, setFormMo] = useState({ nom: "", categorie: "" });

  const [formHistorique, setFormHistorique] = useState({
    maitre_ouvrage_id: "",
    dossier_ao_reference: "",
    concurrent_nom: "",
    montant_offre: "",
    resultat: "",
    motif_echec: "",
    date_observation: "",
  });

  const [formClauseRisque, setFormClauseRisque] = useState({
    maitre_ouvrage_id: "",
    pattern_description: "",
    niveau_risque: "MOYEN",
  });

  const [filtreClauseMo, setFiltreClauseMo] = useState("");

  useEffect(() => {
    api.getMaitresOuvrage().then(setMaitresOuvrage).catch((err) => setErreur(err.message));
    api.getHistoriqueConcurrent().then(setHistorique).catch((err) => setErreur(err.message));
    api.getClausesRisque().then(setClausesRisque).catch((err) => setErreur(err.message));
  }, []);

  async function handleCreerMaitreOuvrage(e) {
    e.preventDefault();
    try {
      const nouveau = await api.createMaitreOuvrage(formMo);
      setMaitresOuvrage((prev) => [...prev, nouveau].sort((a, b) => a.nom.localeCompare(b.nom)));
      setFormMo({ nom: "", categorie: "" });
      setAfficherNouveauMo(false);
    } catch (err) {
      setErreur(err.message);
    }
  }

  async function handleAjouterHistorique(e) {
    e.preventDefault();
    try {
      const nouveau = await api.createHistoriqueConcurrent({
        ...formHistorique,
        maitre_ouvrage_id: formHistorique.maitre_ouvrage_id || null,
        montant_offre: formHistorique.montant_offre || null,
        date_observation: formHistorique.date_observation || null,
      });
      setHistorique((prev) => [nouveau, ...prev]);
      setFormHistorique({
        maitre_ouvrage_id: "",
        dossier_ao_reference: "",
        concurrent_nom: "",
        montant_offre: "",
        resultat: "",
        motif_echec: "",
        date_observation: "",
      });
    } catch (err) {
      setErreur(err.message);
    }
  }

  async function handleSupprimerHistorique(id) {
    if (!window.confirm(t("deleteHistoriqueConfirm"))) return;
    try {
      await api.supprimerHistoriqueConcurrent(id);
      setHistorique((prev) => prev.filter((h) => h.id !== id));
    } catch (err) {
      setErreur(err.message);
    }
  }

  async function handleAjouterClauseRisque(e) {
    e.preventDefault();
    try {
      const nouvelle = await api.createClauseRisque({
        ...formClauseRisque,
        maitre_ouvrage_id: formClauseRisque.maitre_ouvrage_id || null,
      });
      setClausesRisque((prev) => [nouvelle, ...prev]);
      setFormClauseRisque({ maitre_ouvrage_id: "", pattern_description: "", niveau_risque: "MOYEN" });
    } catch (err) {
      setErreur(err.message);
    }
  }

  async function handleIncrementerOccurrence(clause) {
    try {
      const misAJour = await api.patchClauseRisque(clause.id, { occurrences: clause.occurrences + 1 });
      setClausesRisque((prev) => prev.map((c) => (c.id === clause.id ? { ...c, ...misAJour } : c)));
    } catch (err) {
      setErreur(err.message);
    }
  }

  async function handleSupprimerClauseRisque(id) {
    if (!window.confirm(t("deleteClauseRisqueConfirm"))) return;
    try {
      await api.supprimerClauseRisque(id);
      setClausesRisque((prev) => prev.filter((c) => c.id !== id));
    } catch (err) {
      setErreur(err.message);
    }
  }

  const clausesAffichees = filtreClauseMo
    ? clausesRisque.filter((c) => c.maitre_ouvrage_id === filtreClauseMo)
    : clausesRisque;

  function nomMaitreOuvrage(id) {
    return maitresOuvrage.find((m) => m.id === id)?.nom || t("noMaitreOuvrage");
  }

  return (
    <AppShell title={t("concurrencePageTitle")} backHref="/marches" backLabelKey="backToMarches">
      <p style={{ fontSize: 12.5, color: "var(--sub)", marginTop: -6, marginBottom: 16 }}>
        {t("concurrencePageSubtitle")}
      </p>

      {erreur && <p style={{ color: "var(--brique)", fontSize: 12.5, marginBottom: 14 }}>{erreur}</p>}

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20, alignItems: "start" }}>
        {/* Historique des offres concurrentes */}
        <div>
          <h2 style={colTitleStyle}>{t("historiqueSection")}</h2>

          <form onSubmit={handleAjouterHistorique} className="card" style={{ marginBottom: 12 }}>
            <label style={labelStyle}>{t("maitreOuvrageLabel")}</label>
            <SelectMaitreOuvrage
              value={formHistorique.maitre_ouvrage_id}
              onChange={(id) => setFormHistorique((f) => ({ ...f, maitre_ouvrage_id: id }))}
              maitresOuvrage={maitresOuvrage}
              t={t}
            />
            <BoutonNouveauMaitreOuvrage
              afficher={afficherNouveauMo}
              setAfficher={setAfficherNouveauMo}
              formMo={formMo}
              setFormMo={setFormMo}
              onCreer={handleCreerMaitreOuvrage}
              t={t}
            />

            <label style={{ ...labelStyle, marginTop: 10 }}>{t("dossierReferenceLabel")}</label>
            <input
              value={formHistorique.dossier_ao_reference}
              onChange={(e) => setFormHistorique((f) => ({ ...f, dossier_ao_reference: e.target.value }))}
              style={inputStyle}
            />

            <label style={{ ...labelStyle, marginTop: 10 }}>{t("concurrentNameLabel")}</label>
            <input
              required
              value={formHistorique.concurrent_nom}
              onChange={(e) => setFormHistorique((f) => ({ ...f, concurrent_nom: e.target.value }))}
              style={inputStyle}
            />

            <label style={{ ...labelStyle, marginTop: 10 }}>{t("montantOffreLabel")}</label>
            <input
              type="number"
              step="0.01"
              value={formHistorique.montant_offre}
              onChange={(e) => setFormHistorique((f) => ({ ...f, montant_offre: e.target.value }))}
              style={inputStyle}
            />

            <label style={{ ...labelStyle, marginTop: 10 }}>{t("resultatLabel")}</label>
            <select
              value={formHistorique.resultat}
              onChange={(e) => setFormHistorique((f) => ({ ...f, resultat: e.target.value }))}
              style={inputStyle}
            >
              <option value="">{t("selectResultat")}</option>
              {RESULTATS.map((r) => (
                <option key={r} value={r}>
                  {resultatConcurrentLabel(r)}
                </option>
              ))}
            </select>

            <label style={{ ...labelStyle, marginTop: 10 }}>{t("motifEchecLabel")}</label>
            <input
              value={formHistorique.motif_echec}
              onChange={(e) => setFormHistorique((f) => ({ ...f, motif_echec: e.target.value }))}
              style={inputStyle}
            />

            <label style={{ ...labelStyle, marginTop: 10 }}>{t("dateObservationLabel")}</label>
            <input
              type="date"
              value={formHistorique.date_observation}
              onChange={(e) => setFormHistorique((f) => ({ ...f, date_observation: e.target.value }))}
              style={inputStyle}
            />

            <button type="submit" style={{ ...boutonPrincipalStyle, marginTop: 12, width: "100%" }}>
              {t("addHistoriqueButton")}
            </button>
          </form>

          {historique.length === 0 ? (
            <p style={{ fontSize: 12.5, color: "var(--sub)" }}>{t("noHistorique")}</p>
          ) : (
            <div style={{ display: "grid", gap: 8 }}>
              {historique.map((h) => (
                <div key={h.id} className="card" style={{ fontSize: 12.5 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "start" }}>
                    <div style={{ fontWeight: 700, fontSize: 13.5 }}>{h.concurrent_nom}</div>
                    <button onClick={() => handleSupprimerHistorique(h.id)} style={boutonSupprimerStyle}>
                      &times;
                    </button>
                  </div>
                  <div style={{ color: "var(--sub)", marginTop: 2 }}>
                    {h.maitre_ouvrage_nom || t("noMaitreOuvrage")}
                    {h.dossier_ao_reference ? ` · ${h.dossier_ao_reference}` : ""}
                  </div>
                  <div style={{ display: "flex", gap: 12, marginTop: 6, flexWrap: "wrap" }}>
                    {h.montant_offre != null && (
                      <span className="mono">{Number(h.montant_offre).toLocaleString(dict.dateLocale)}</span>
                    )}
                    {h.resultat && (
                      <span
                        style={{
                          fontWeight: 700,
                          color:
                            h.resultat === "GAGNE"
                              ? "var(--vert, #1a7f4b)"
                              : h.resultat === "PERDU"
                              ? "var(--brique)"
                              : "var(--sub)",
                        }}
                      >
                        {resultatConcurrentLabel(h.resultat)}
                      </span>
                    )}
                    {h.date_observation && (
                      <span style={{ color: "var(--sub)" }}>
                        {new Date(h.date_observation).toLocaleDateString(dict.dateLocale)}
                      </span>
                    )}
                  </div>
                  {h.motif_echec && (
                    <div style={{ color: "var(--sub)", marginTop: 4, fontStyle: "italic" }}>{h.motif_echec}</div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Bibliotheque de clauses a risque */}
        <div>
          <h2 style={colTitleStyle}>{t("clauseRisqueSection")}</h2>

          <form onSubmit={handleAjouterClauseRisque} className="card" style={{ marginBottom: 12 }}>
            <label style={labelStyle}>{t("maitreOuvrageLabel")}</label>
            <SelectMaitreOuvrage
              value={formClauseRisque.maitre_ouvrage_id}
              onChange={(id) => setFormClauseRisque((f) => ({ ...f, maitre_ouvrage_id: id }))}
              maitresOuvrage={maitresOuvrage}
              t={t}
            />

            <label style={{ ...labelStyle, marginTop: 10 }}>{t("patternDescriptionLabel")}</label>
            <input
              required
              value={formClauseRisque.pattern_description}
              onChange={(e) => setFormClauseRisque((f) => ({ ...f, pattern_description: e.target.value }))}
              style={inputStyle}
            />

            <label style={{ ...labelStyle, marginTop: 10 }}>{t("niveauRisqueLabel2")}</label>
            <select
              value={formClauseRisque.niveau_risque}
              onChange={(e) => setFormClauseRisque((f) => ({ ...f, niveau_risque: e.target.value }))}
              style={inputStyle}
            >
              {NIVEAUX_RISQUE.map((n) => (
                <option key={n} value={n}>
                  {niveauRisqueLabel(n)}
                </option>
              ))}
            </select>

            <button type="submit" style={{ ...boutonPrincipalStyle, marginTop: 12, width: "100%" }}>
              {t("addClauseRisqueButton")}
            </button>
          </form>

          {maitresOuvrage.length > 0 && (
            <div style={{ marginBottom: 10 }}>
              <label style={labelStyle}>{t("filterByMaitreOuvrage")}</label>
              <select
                value={filtreClauseMo}
                onChange={(e) => setFiltreClauseMo(e.target.value)}
                style={inputStyle}
              >
                <option value="">{t("allMaitresOuvrage")}</option>
                {maitresOuvrage.map((mo) => (
                  <option key={mo.id} value={mo.id}>
                    {mo.nom}
                  </option>
                ))}
              </select>
            </div>
          )}

          {clausesAffichees.length === 0 ? (
            <p style={{ fontSize: 12.5, color: "var(--sub)" }}>{t("noClauseRisque")}</p>
          ) : (
            <div style={{ display: "grid", gap: 8 }}>
              {clausesAffichees.map((c) => (
                <div key={c.id} className="card" style={{ fontSize: 12.5 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "start" }}>
                    <div style={{ fontWeight: 600, fontSize: 13, flex: 1 }}>{c.pattern_description}</div>
                    <button onClick={() => handleSupprimerClauseRisque(c.id)} style={boutonSupprimerStyle}>
                      &times;
                    </button>
                  </div>
                  <div style={{ color: "var(--sub)", marginTop: 2 }}>{c.maitre_ouvrage_nom || t("noMaitreOuvrage")}</div>
                  <div style={{ display: "flex", gap: 10, marginTop: 8, alignItems: "center" }}>
                    <span
                      style={{
                        fontWeight: 700,
                        padding: "2px 8px",
                        borderRadius: 6,
                        fontSize: 11,
                        background:
                          c.niveau_risque === "ELEVE"
                            ? "rgba(178,58,46,0.12)"
                            : c.niveau_risque === "FAIBLE"
                            ? "rgba(26,127,75,0.12)"
                            : "rgba(184,134,11,0.12)",
                        color:
                          c.niveau_risque === "ELEVE"
                            ? "var(--brique)"
                            : c.niveau_risque === "FAIBLE"
                            ? "#1a7f4b"
                            : "#b8860b",
                      }}
                    >
                      {niveauRisqueLabel(c.niveau_risque)}
                    </span>
                    <span className="mono" style={{ fontSize: 12, color: "var(--sub)" }}>
                      {t("occurrencesLabel")} : {c.occurrences}
                    </span>
                    <button onClick={() => handleIncrementerOccurrence(c)} style={boutonMiniStyle}>
                      {t("incrementOccurrence")}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </AppShell>
  );
}

function SelectMaitreOuvrage({ value, onChange, maitresOuvrage, t }) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} style={inputStyle}>
      <option value="">{t("selectMaitreOuvrage")}</option>
      {maitresOuvrage.map((mo) => (
        <option key={mo.id} value={mo.id}>
          {mo.nom}
        </option>
      ))}
    </select>
  );
}

function BoutonNouveauMaitreOuvrage({ afficher, setAfficher, formMo, setFormMo, onCreer, t }) {
  if (!afficher) {
    return (
      <button
        type="button"
        onClick={() => setAfficher(true)}
        style={{ ...boutonMiniStyle, marginTop: 6 }}
      >
        {t("newMaitreOuvrage")}
      </button>
    );
  }
  return (
    <div style={{ border: "1px dashed var(--line)", borderRadius: 8, padding: 10, marginTop: 6 }}>
      <label style={labelStyle}>{t("maitreOuvrageNameLabel")}</label>
      <input
        value={formMo.nom}
        onChange={(e) => setFormMo((f) => ({ ...f, nom: e.target.value }))}
        style={inputStyle}
      />
      <label style={{ ...labelStyle, marginTop: 8 }}>{t("maitreOuvrageCategorieLabel")}</label>
      <input
        value={formMo.categorie}
        onChange={(e) => setFormMo((f) => ({ ...f, categorie: e.target.value }))}
        style={inputStyle}
      />
      <button
        type="button"
        onClick={onCreer}
        disabled={!formMo.nom}
        style={{ ...boutonPrincipalStyle, marginTop: 8, width: "100%" }}
      >
        {t("createMaitreOuvrageButton")}
      </button>
    </div>
  );
}

const colTitleStyle = { fontSize: 13.5, color: "var(--petrol)", marginBottom: 10, fontWeight: 700 };
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
const boutonMiniStyle = {
  background: "transparent",
  color: "var(--petrol)",
  border: "1px solid var(--petrol)",
  borderRadius: 6,
  padding: "4px 10px",
  fontSize: 11.5,
  fontWeight: 600,
  cursor: "pointer",
};
const boutonSupprimerStyle = {
  background: "transparent",
  border: "none",
  color: "var(--sub)",
  fontSize: 16,
  cursor: "pointer",
  lineHeight: 1,
  padding: "0 4px",
};
