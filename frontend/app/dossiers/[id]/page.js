"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { api } from "../../../lib/api";
import { useLangue } from "../../../lib/i18n/LanguageContext";
import AppShell from "../../../lib/components/AppShell";

const TYPE_BESOIN_CODES = ["CAUTION_SOUMISSION", "CAUTION_BONNE_EXECUTION", "AVANCE_DEMARRAGE", "LC"];

export default function DossierDetailPage() {
  const { id } = useParams();
  const { t, statutLabel, typeBesoinLabel, penaliteStatutLabel, typeCourrierLabel, typeFaciliteLabel, dict } =
    useLangue();

  const [dossier, setDossier] = useState(null);
  const [simulations, setSimulations] = useState([]);
  const [calculsMarge, setCalculsMarge] = useState([]);
  const [suivisLogistiques, setSuivisLogistiques] = useState([]);
  const [incoterms, setIncoterms] = useState([]);
  const [transitaires, setTransitaires] = useState([]);
  const [modelesCourrier, setModelesCourrier] = useState([]);
  const [suggestionsCourrier, setSuggestionsCourrier] = useState([]);
  const [entete, setEntete] = useState(null);
  const [fournisseurs, setFournisseurs] = useState([]);
  const [offres, setOffres] = useState([]);
  const [chargement, setChargement] = useState(true);
  const [erreur, setErreur] = useState("");

  const [formSimulationOuvert, setFormSimulationOuvert] = useState(false);
  const [formSimulation, setFormSimulation] = useState({
    type_besoin: TYPE_BESOIN_CODES[0],
    montant: "",
    duree_estimee_jours: "",
  });
  const [simulationEnCours, setSimulationEnCours] = useState(false);

  const [formMargeOuvert, setFormMargeOuvert] = useState(false);
  const [formMarge, setFormMarge] = useState({
    prix_achat_devise: "",
    taux_change: "",
    frais_douane_transit: "",
    frais_bancaires: "",
    frais_dao_caution: "",
    redevance_armp: "",
    marge_pct_visee: "",
    prix_final_ht_hd: "",
  });
  const [margeEnCours, setMargeEnCours] = useState(false);

  const [formSuiviOuvert, setFormSuiviOuvert] = useState(false);
  const [formSuivi, setFormSuivi] = useState({
    transitaire_id: "",
    incoterm_scenario_id: "",
    date_depart: "",
    date_arrivee_prevue: "",
    date_arrivee_reelle: "",
    montant_ttc: "",
  });
  const [suiviEnCours, setSuiviEnCours] = useState(false);

  const [modeleSelectionne, setModeleSelectionne] = useState("");
  const [courrierGenere, setCourrierGenere] = useState(null);
  const [generationEnCours, setGenerationEnCours] = useState(false);
  const [copieConfirmee, setCopieConfirmee] = useState(false);
  const [variablesDetectees, setVariablesDetectees] = useState([]);
  const [variablesPersonnalisees, setVariablesPersonnalisees] = useState({});

  const [formOffreOuvert, setFormOffreOuvert] = useState(false);
  const [formOffre, setFormOffre] = useState({
    fournisseur_id: "",
    prix_exw: "",
    delai_jours: "",
    incoterm_scenario_id: "",
  });
  const [offreEnCours, setOffreEnCours] = useState(false);

  useEffect(() => {
    async function charger() {
      try {
        const [
          dossierData,
          simulationsData,
          margeData,
          suivisData,
          incotermsData,
          transitairesData,
          modelesData,
          suggestionsData,
          enteteData,
          fournisseursData,
          offresData,
        ] = await Promise.all([
          api.getDossier(id),
          api.getSimulations(id),
          api.getCalculsMarge(id),
          api.getSuivisLogistiques(id),
          api.getIncoterms(),
          api.getTransitaires(),
          api.getModelesCourrier(),
          api.getSuggestionsCourrier(id),
          api.getEntete(),
          api.getFournisseurs(),
          api.getOffresFournisseur(id),
        ]);
        setDossier(dossierData);
        setSimulations(simulationsData);
        setCalculsMarge(margeData);
        setSuivisLogistiques(suivisData);
        setIncoterms(incotermsData);
        setTransitaires(transitairesData);
        setModelesCourrier(modelesData);
        setSuggestionsCourrier(suggestionsData);
        setEntete(enteteData);
        setFournisseurs(fournisseursData);
        setOffres(offresData);
      } catch (err) {
        setErreur(err.message || t("defaultLoadError"));
      } finally {
        setChargement(false);
      }
    }
    if (id) charger();
  }, [id, t]);

  async function handleLancerSimulation(e) {
    e.preventDefault();
    setSimulationEnCours(true);
    try {
      const nouvelle = await api.createSimulation(id, {
        type_besoin: formSimulation.type_besoin,
        montant: Number(formSimulation.montant),
        duree_estimee_jours: formSimulation.duree_estimee_jours
          ? Number(formSimulation.duree_estimee_jours)
          : null,
      });
      setSimulations((prev) => [nouvelle, ...prev]);
      setFormSimulationOuvert(false);
      setFormSimulation({ type_besoin: TYPE_BESOIN_CODES[0], montant: "", duree_estimee_jours: "" });
    } catch (err) {
      setErreur(err.message);
    } finally {
      setSimulationEnCours(false);
    }
  }

  async function handleRetenirOption(simulationId, ligneCreditTarifId) {
    try {
      const maj = await api.patchSimulationRetenue(simulationId, ligneCreditTarifId);
      setSimulations((prev) => prev.map((s) => (s.id === simulationId ? maj : s)));
    } catch (err) {
      setErreur(err.message);
    }
  }

  async function handleCalculerMarge(e) {
    e.preventDefault();
    setMargeEnCours(true);
    try {
      const payload = Object.fromEntries(
        Object.entries(formMarge).map(([k, v]) => [k, v === "" ? null : Number(v)])
      );
      const nouveau = await api.createCalculMarge(id, payload);
      setCalculsMarge((prev) => [nouveau, ...prev]);
      setFormMargeOuvert(false);
      setFormMarge({
        prix_achat_devise: "",
        taux_change: "",
        frais_douane_transit: "",
        frais_bancaires: "",
        frais_dao_caution: "",
        redevance_armp: "",
        marge_pct_visee: "",
        prix_final_ht_hd: "",
      });
    } catch (err) {
      setErreur(err.message);
    } finally {
      setMargeEnCours(false);
    }
  }

  async function handleCreerSuivi(e) {
    e.preventDefault();
    setSuiviEnCours(true);
    try {
      const payload = {
        transitaire_id: formSuivi.transitaire_id || null,
        incoterm_scenario_id: formSuivi.incoterm_scenario_id || null,
        date_depart: formSuivi.date_depart || null,
        date_arrivee_prevue: formSuivi.date_arrivee_prevue || null,
        date_arrivee_reelle: formSuivi.date_arrivee_reelle || null,
        montant_ttc: formSuivi.montant_ttc ? Number(formSuivi.montant_ttc) : null,
      };
      const nouveau = await api.createSuiviLogistique(id, payload);
      setSuivisLogistiques((prev) => [nouveau, ...prev]);
      setFormSuiviOuvert(false);
      setFormSuivi({
        transitaire_id: "",
        incoterm_scenario_id: "",
        date_depart: "",
        date_arrivee_prevue: "",
        date_arrivee_reelle: "",
        montant_ttc: "",
      });
    } catch (err) {
      setErreur(err.message);
    } finally {
      setSuiviEnCours(false);
    }
  }

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

  /**
   * Pre-remplit les variables deductibles de la simulation de financement
   * retenue sur ce dossier (montant, duree, type de facilite), pour eviter
   * toute ressaisie d'une information deja connue du systeme.
   */
  function deduireValeursConnues() {
    const simulationAvecOptionRetenue = simulations.find((s) => s.option_retenue_id);
    if (!simulationAvecOptionRetenue) return {};

    const optionRetenue = (simulationAvecOptionRetenue.resultat_json || []).find(
      (o) => o.ligne_credit_tarif_id === simulationAvecOptionRetenue.option_retenue_id
    );

    return {
      montant_demande: simulationAvecOptionRetenue.montant ?? "",
      duree_jours: simulationAvecOptionRetenue.duree_estimee_jours ?? "",
      type_facilite: optionRetenue ? typeFaciliteLabel(optionRetenue.type_facilite) : "",
    };
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
    const connues = deduireValeursConnues();
    setVariablesDetectees(detectees);
    setVariablesPersonnalisees(
      Object.fromEntries(detectees.map((cle) => [cle, connues[cle] !== undefined ? connues[cle] : ""]))
    );
  }

  async function handleGenererCourrier() {
    if (!modeleSelectionne) return;
    setGenerationEnCours(true);
    setCopieConfirmee(false);
    try {
      const resultat = await api.genererCourrier(id, {
        modele_id: modeleSelectionne,
        variables: variablesPersonnalisees,
      });
      setCourrierGenere(resultat);
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

  async function handleAjouterOffre(e) {
    e.preventDefault();
    setOffreEnCours(true);
    try {
      const payload = {
        fournisseur_id: formOffre.fournisseur_id,
        prix_exw: formOffre.prix_exw ? Number(formOffre.prix_exw) : null,
        delai_jours: formOffre.delai_jours ? Number(formOffre.delai_jours) : null,
        incoterm_scenario_id: formOffre.incoterm_scenario_id || null,
      };
      const nouvelle = await api.createOffreFournisseur(id, payload);
      setOffres((prev) => [...prev, nouvelle].sort((a, b) => (a.prix_exw ?? Infinity) - (b.prix_exw ?? Infinity)));
      setFormOffreOuvert(false);
      setFormOffre({ fournisseur_id: "", prix_exw: "", delai_jours: "", incoterm_scenario_id: "" });
    } catch (err) {
      setErreur(err.message);
    } finally {
      setOffreEnCours(false);
    }
  }

  async function handleRetenirOffre(offreId) {
    try {
      await api.retenirOffreFournisseur(offreId);
      setOffres((prev) => prev.map((o) => ({ ...o, retenue: o.id === offreId })));
    } catch (err) {
      setErreur(err.message);
    }
  }

  if (chargement) {
    return <div style={{ padding: 28 }}>{t("loading")}</div>;
  }

  if (erreur && !dossier) {
    return <div style={{ padding: 28, color: "var(--brique)" }}>{erreur}</div>;
  }

  return (
    <AppShell backHref="/dashboard">
      <div style={{ marginBottom: 20 }}>
        <h1 style={{ fontSize: 19, color: "var(--petrol)" }}>{dossier.intitule}</h1>
        <div className="mono" style={{ fontSize: 11.5, color: "var(--sub)", marginTop: 2 }}>
          {dossier.reference_externe} {dossier.maitre_ouvrage_nom ? `· ${dossier.maitre_ouvrage_nom}` : ""}
          {" · "}
          <span className={`chip ${statutClasse(dossier.statut)}`} style={{ marginLeft: 4 }}>
            {statutLabel(dossier.statut)}
          </span>
        </div>
      </div>

      {erreur && <p style={{ color: "var(--brique)", fontSize: 12.5, marginBottom: 14 }}>{erreur}</p>}

      {/* ---------------- FINANCEMENT ---------------- */}
      <section style={{ marginBottom: 30 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
          <h2 style={{ fontSize: 15.5, color: "var(--petrol)" }}>{t("financingSection")}</h2>
          <button
            onClick={() => setFormSimulationOuvert((v) => !v)}
            style={boutonPrincipalStyle}
          >
            {formSimulationOuvert ? t("cancel") : t("newSimulation")}
          </button>
        </div>

        {formSimulationOuvert && (
          <form onSubmit={handleLancerSimulation} className="card" style={{ marginBottom: 14 }}>
            <div style={{ display: "grid", gridTemplateColumns: "1.3fr 1fr 1fr", gap: 12 }}>
              <div>
                <label style={labelStyle}>{t("typeBesoinLabel")}</label>
                <select
                  value={formSimulation.type_besoin}
                  onChange={(e) => setFormSimulation((f) => ({ ...f, type_besoin: e.target.value }))}
                  style={inputStyle}
                >
                  {TYPE_BESOIN_CODES.map((code) => (
                    <option key={code} value={code}>
                      {typeBesoinLabel(code)}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label style={labelStyle}>{t("montantLabel")}</label>
                <input
                  type="number"
                  required
                  value={formSimulation.montant}
                  onChange={(e) => setFormSimulation((f) => ({ ...f, montant: e.target.value }))}
                  style={inputStyle}
                />
              </div>
              <div>
                <label style={labelStyle}>{t("dureeLabel")}</label>
                <input
                  type="number"
                  value={formSimulation.duree_estimee_jours}
                  onChange={(e) =>
                    setFormSimulation((f) => ({ ...f, duree_estimee_jours: e.target.value }))
                  }
                  style={inputStyle}
                />
              </div>
            </div>
            <button type="submit" disabled={simulationEnCours} style={{ ...boutonPrincipalStyle, marginTop: 14 }}>
              {t("launchSimulation")}
            </button>
          </form>
        )}

        <h3 style={{ fontSize: 12.5, color: "var(--sub)", marginBottom: 8, fontWeight: 600 }}>
          {t("simulationHistory")}
        </h3>
        {simulations.length === 0 ? (
          <p className="card" style={{ fontSize: 13, color: "var(--sub)" }}>{t("noSimulations")}</p>
        ) : (
          <div style={{ display: "grid", gap: 10 }}>
            {simulations.map((sim) => (
              <div key={sim.id} className="card">
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 10 }}>
                  <div style={{ fontWeight: 600, fontSize: 13.3 }}>
                    {typeBesoinLabel(sim.type_besoin)}
                  </div>
                  <div className="mono" style={{ fontSize: 12.5, color: "var(--sub)" }}>
                    {Number(sim.montant).toLocaleString(dict.dateLocale)} XOF
                    {sim.duree_estimee_jours ? ` · ${sim.duree_estimee_jours}j` : ""}
                  </div>
                </div>
                <div style={{ display: "grid", gap: 6 }}>
                  {(sim.resultat_json || []).map((option, idx) => {
                    const estRetenue = sim.option_retenue_id === option.ligne_credit_tarif_id;
                    const estRecommandee = sim.option_recommandee_id === option.ligne_credit_tarif_id;
                    return (
                      <div
                        key={option.ligne_credit_tarif_id || idx}
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                          alignItems: "center",
                          padding: "8px 10px",
                          borderRadius: 8,
                          background: estRetenue ? "var(--vert-bg)" : "var(--line-soft)",
                          fontSize: 12.5,
                        }}
                      >
                        <div>
                          <span style={{ fontWeight: 600 }}>{option.partenaire_nom}</span>
                          {estRecommandee && (
                            <span className="chip ok" style={{ marginLeft: 8 }}>
                              {t("recommendedOption")}
                            </span>
                          )}
                          {estRetenue && (
                            <span className="chip warn" style={{ marginLeft: 8 }}>
                              {t("retainedOption")}
                            </span>
                          )}
                          <div style={{ fontSize: 11, color: "var(--sub)", marginTop: 2 }}>
                            {option.erreur ? option.erreur : option.formule_utilisee}
                          </div>
                        </div>
                        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                          <span className="mono">
                            {option.cout_total != null
                              ? `${Number(option.cout_total).toLocaleString(dict.dateLocale)} XOF`
                              : t("invalidOption")}
                          </span>
                          {option.cout_total != null && !estRetenue && (
                            <button
                              onClick={() => handleRetenirOption(sim.id, option.ligne_credit_tarif_id)}
                              style={boutonSecondaireStyle}
                            >
                              {t("retainOption")}
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* ---------------- FOURNISSEURS ---------------- */}
      <section style={{ marginBottom: 30 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
          <h2 style={{ fontSize: 15.5, color: "var(--petrol)" }}>{t("suppliersSection")}</h2>
          <button onClick={() => setFormOffreOuvert((v) => !v)} style={boutonPrincipalStyle}>
            {formOffreOuvert ? t("cancel") : t("newOffer")}
          </button>
        </div>

        {formOffreOuvert && (
          <form onSubmit={handleAjouterOffre} className="card" style={{ marginBottom: 14 }}>
            <div style={{ display: "grid", gridTemplateColumns: "1.4fr 1fr 1fr 1fr", gap: 12 }}>
              <div>
                <label style={labelStyle}>{t("supplierLabel")}</label>
                <select
                  required
                  value={formOffre.fournisseur_id}
                  onChange={(e) => setFormOffre((f) => ({ ...f, fournisseur_id: e.target.value }))}
                  style={inputStyle}
                >
                  <option value="">—</option>
                  {fournisseurs.map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.nom}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label style={labelStyle}>{t("priceExwLabel")}</label>
                <input
                  type="number"
                  value={formOffre.prix_exw}
                  onChange={(e) => setFormOffre((f) => ({ ...f, prix_exw: e.target.value }))}
                  style={inputStyle}
                />
              </div>
              <div>
                <label style={labelStyle}>{t("deliveryDelayLabel")}</label>
                <input
                  type="number"
                  value={formOffre.delai_jours}
                  onChange={(e) => setFormOffre((f) => ({ ...f, delai_jours: e.target.value }))}
                  style={inputStyle}
                />
              </div>
              <div>
                <label style={labelStyle}>{t("incotermLabel")}</label>
                <select
                  value={formOffre.incoterm_scenario_id}
                  onChange={(e) => setFormOffre((f) => ({ ...f, incoterm_scenario_id: e.target.value }))}
                  style={inputStyle}
                >
                  <option value="">{t("none")}</option>
                  {incoterms.map((inc) => (
                    <option key={inc.id} value={inc.id}>
                      {inc.code}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <button type="submit" disabled={offreEnCours} style={{ ...boutonPrincipalStyle, marginTop: 14 }}>
              {t("save")}
            </button>
          </form>
        )}

        {offres.length === 0 ? (
          <p className="card" style={{ fontSize: 13, color: "var(--sub)" }}>{t("noOffers")}</p>
        ) : (
          <div style={{ display: "grid", gap: 8 }}>
            {offres.map((o) => (
              <div
                key={o.id}
                className="card"
                style={{
                  display: "grid",
                  gridTemplateColumns: "1.4fr 1fr 1fr 1fr 1fr",
                  gap: 10,
                  alignItems: "center",
                  background: o.retenue ? "var(--vert-bg)" : "#fff",
                }}
              >
                <div>
                  <div style={{ fontWeight: 600, fontSize: 13 }}>{o.fournisseur_nom}</div>
                  <div style={{ fontSize: 11, color: "var(--sub)" }}>{o.fournisseur_pays || "—"}</div>
                </div>
                <div>
                  <div style={miniLabelStyle}>{t("priceExwLabel")}</div>
                  <div className="mono" style={{ fontSize: 12.5 }}>
                    {o.prix_exw ? Number(o.prix_exw).toLocaleString(dict.dateLocale) : "—"}
                  </div>
                </div>
                <div>
                  <div style={miniLabelStyle}>{t("deliveryDelayLabel")}</div>
                  <div className="mono" style={{ fontSize: 12.5 }}>{o.delai_jours ?? "—"}</div>
                </div>
                <div>
                  <div style={miniLabelStyle}>{t("reliabilityScoreLabel")}</div>
                  <div className="mono" style={{ fontSize: 12.5 }}>
                    {o.score_fiabilite != null ? `${o.score_fiabilite}%` : "—"}
                  </div>
                </div>
                <div>
                  {o.retenue ? (
                    <span className="chip ok">{t("retainedOffer")}</span>
                  ) : (
                    <button onClick={() => handleRetenirOffre(o.id)} style={boutonSecondaireStyle}>
                      {t("retainOffer")}
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* ---------------- LOGISTIQUE ---------------- */}
      <section style={{ marginBottom: 30 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
          <h2 style={{ fontSize: 15.5, color: "var(--petrol)" }}>{t("logisticsSection")}</h2>
          <div style={{ display: "flex", gap: 10 }}>
            <button onClick={() => setFormSuiviOuvert((v) => !v)} style={boutonPrincipalStyle}>
              {formSuiviOuvert ? t("cancel") : t("newSuivi")}
            </button>
          </div>
        </div>

        {formSuiviOuvert && (
          <form onSubmit={handleCreerSuivi} className="card" style={{ marginBottom: 14 }}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr 1fr 1fr", gap: 12 }}>
              <div>
                <label style={labelStyle}>{t("transitaireLabel")}</label>
                <select
                  value={formSuivi.transitaire_id}
                  onChange={(e) => setFormSuivi((f) => ({ ...f, transitaire_id: e.target.value }))}
                  style={inputStyle}
                >
                  <option value="">{t("none")}</option>
                  {transitaires.map((tr) => (
                    <option key={tr.id} value={tr.id}>
                      {tr.nom}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label style={labelStyle}>{t("incotermLabel")}</label>
                <select
                  value={formSuivi.incoterm_scenario_id}
                  onChange={(e) => setFormSuivi((f) => ({ ...f, incoterm_scenario_id: e.target.value }))}
                  style={inputStyle}
                >
                  <option value="">{t("none")}</option>
                  {incoterms.map((inc) => (
                    <option key={inc.id} value={inc.id}>
                      {inc.code}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label style={labelStyle}>{t("departDateLabel")}</label>
                <input
                  type="date"
                  value={formSuivi.date_depart}
                  onChange={(e) => setFormSuivi((f) => ({ ...f, date_depart: e.target.value }))}
                  style={inputStyle}
                />
              </div>
              <div>
                <label style={labelStyle}>{t("expectedArrivalLabel")}</label>
                <input
                  type="date"
                  value={formSuivi.date_arrivee_prevue}
                  onChange={(e) => setFormSuivi((f) => ({ ...f, date_arrivee_prevue: e.target.value }))}
                  style={inputStyle}
                />
              </div>
              <div>
                <label style={labelStyle}>{t("actualArrivalLabel")}</label>
                <input
                  type="date"
                  value={formSuivi.date_arrivee_reelle}
                  onChange={(e) => setFormSuivi((f) => ({ ...f, date_arrivee_reelle: e.target.value }))}
                  style={inputStyle}
                />
              </div>
              <div>
                <label style={labelStyle}>{t("amountLabel")}</label>
                <input
                  type="number"
                  value={formSuivi.montant_ttc}
                  onChange={(e) => setFormSuivi((f) => ({ ...f, montant_ttc: e.target.value }))}
                  style={inputStyle}
                />
              </div>
            </div>
            <button type="submit" disabled={suiviEnCours} style={{ ...boutonPrincipalStyle, marginTop: 14 }}>
              {t("save")}
            </button>
          </form>
        )}

        {suivisLogistiques.length === 0 ? (
          <p className="card" style={{ fontSize: 13, color: "var(--sub)" }}>{t("noSuivis")}</p>
        ) : (
          <div style={{ display: "grid", gap: 8 }}>
            {suivisLogistiques.map((sl) => (
              <div
                key={sl.id}
                className="card"
                style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr 1fr", gap: 10, alignItems: "center" }}
              >
                <div style={{ fontWeight: 600, fontSize: 13 }}>
                  {sl.transitaire_nom || "—"} {sl.incoterm_code ? `· ${sl.incoterm_code}` : ""}
                </div>
                <div>
                  <div style={miniLabelStyle}>{t("expectedArrivalLabel")}</div>
                  <div className="mono" style={{ fontSize: 12.5 }}>
                    {sl.date_arrivee_prevue ? new Date(sl.date_arrivee_prevue).toLocaleDateString(dict.dateLocale) : "—"}
                  </div>
                </div>
                <div>
                  <div style={miniLabelStyle}>{t("actualArrivalLabel")}</div>
                  <div className="mono" style={{ fontSize: 12.5 }}>
                    {sl.date_arrivee_reelle ? new Date(sl.date_arrivee_reelle).toLocaleDateString(dict.dateLocale) : "—"}
                  </div>
                </div>
                <div>
                  <div style={miniLabelStyle}>{t("amountLabel")}</div>
                  <div className="mono" style={{ fontSize: 12.5 }}>
                    {sl.montant_ttc ? Number(sl.montant_ttc).toLocaleString(dict.dateLocale) : "—"}
                  </div>
                </div>
                <div>
                  <span
                    className={`chip ${
                      sl.statut_penalite === "ENCOURUE" ? "risk" : sl.statut_penalite === "RISQUE" ? "warn" : "ok"
                    }`}
                  >
                    {penaliteStatutLabel(sl.statut_penalite)}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* ---------------- MARGE ---------------- */}
      <section>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
          <h2 style={{ fontSize: 15.5, color: "var(--petrol)" }}>{t("marginSection")}</h2>
          <button onClick={() => setFormMargeOuvert((v) => !v)} style={boutonPrincipalStyle}>
            {formMargeOuvert ? t("cancel") : t("newMarginCalc")}
          </button>
        </div>

        {formMargeOuvert && (
          <form onSubmit={handleCalculerMarge} className="card" style={{ marginBottom: 14 }}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 12 }}>
              {[
                ["prix_achat_devise", "purchasePriceLabel"],
                ["taux_change", "exchangeRateLabel"],
                ["frais_douane_transit", "customsFeesLabel"],
                ["frais_bancaires", "bankFeesLabel"],
                ["frais_dao_caution", "guaranteeFeesLabel"],
                ["redevance_armp", "armpFeesLabel"],
                ["marge_pct_visee", "targetMarginLabel"],
                ["prix_final_ht_hd", "finalPriceLabel"],
              ].map(([champ, cle]) => (
                <div key={champ}>
                  <label style={labelStyle}>{t(cle)}</label>
                  <input
                    type="number"
                    step="any"
                    value={formMarge[champ]}
                    onChange={(e) => setFormMarge((f) => ({ ...f, [champ]: e.target.value }))}
                    style={inputStyle}
                  />
                </div>
              ))}
            </div>
            <button type="submit" disabled={margeEnCours} style={{ ...boutonPrincipalStyle, marginTop: 14 }}>
              {t("calculate")}
            </button>
          </form>
        )}

        <h3 style={{ fontSize: 12.5, color: "var(--sub)", marginBottom: 8, fontWeight: 600 }}>
          {t("marginHistory")}
        </h3>
        {calculsMarge.length === 0 ? (
          <p className="card" style={{ fontSize: 13, color: "var(--sub)" }}>{t("noMarginCalcs")}</p>
        ) : (
          <div style={{ display: "grid", gap: 10 }}>
            {calculsMarge.map((calc) => (
              <div
                key={calc.id}
                className="card"
                style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 10, alignItems: "center" }}
              >
                <div>
                  <div style={{ fontSize: 10.5, color: "var(--sub)", textTransform: "uppercase" }}>
                    {t("cifPriceLabel")}
                  </div>
                  <div className="mono" style={{ fontSize: 13 }}>
                    {calc.prix_cif != null ? Number(calc.prix_cif).toLocaleString(dict.dateLocale) : "—"}
                  </div>
                </div>
                <div>
                  <div style={{ fontSize: 10.5, color: "var(--sub)", textTransform: "uppercase" }}>
                    {t("costOfGoodsLabel")}
                  </div>
                  <div className="mono" style={{ fontSize: 13 }}>
                    {calc.cout_revient != null ? Number(calc.cout_revient).toLocaleString(dict.dateLocale) : "—"}
                  </div>
                </div>
                <div>
                  <div style={{ fontSize: 10.5, color: "var(--sub)", textTransform: "uppercase" }}>
                    {t("targetMarginLabel")}
                  </div>
                  <div className="mono" style={{ fontSize: 13 }}>
                    {calc.marge_pct_visee != null ? `${calc.marge_pct_visee}%` : "—"}
                  </div>
                </div>
                <div>
                  <div style={{ fontSize: 10.5, color: "var(--sub)", textTransform: "uppercase" }}>
                    {t("realMarginLabel")}
                  </div>
                  <div
                    className="mono"
                    style={{
                      fontSize: 13,
                      fontWeight: 700,
                      color:
                        calc.marge_pct_reelle != null && calc.marge_pct_visee != null
                          ? calc.marge_pct_reelle >= calc.marge_pct_visee
                            ? "var(--vert)"
                            : "var(--brique)"
                          : "var(--ink)",
                    }}
                  >
                    {calc.marge_pct_reelle != null ? `${calc.marge_pct_reelle}%` : "—"}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* ---------------- COURRIERS ---------------- */}
      <section>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
          <h2 style={{ fontSize: 15.5, color: "var(--petrol)" }}>{t("lettersSection")}</h2>
        </div>

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
                    onChange={(e) =>
                      setVariablesPersonnalisees((prev) => ({ ...prev, [cle]: e.target.value }))
                    }
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
          <div>
            <div className="no-print" style={{ display: "flex", justifyContent: "flex-end", marginBottom: 10, gap: 10 }}>
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
              <pre
                style={{
                  whiteSpace: "pre-wrap",
                  fontFamily: "inherit",
                  fontSize: 12.8,
                  lineHeight: 1.7,
                  margin: 0,
                }}
              >
                {courrierGenere.corps}
              </pre>

              {/* Signature */}
              <div style={{ marginTop: 48, textAlign: "right" }}>
                <div style={{ fontSize: 12.5 }}>{entete?.signataire_titre || ""}</div>
                <div style={{ fontWeight: 700, fontSize: 13, marginTop: 40 }}>
                  {entete?.signataire_nom || ""}
                </div>
              </div>
            </div>
          </div>
        )}
      </section>
    </AppShell>
  );
}

function statutClasse(statut) {
  if (["ATTRIBUE", "EN_EXECUTION", "RECEPTION", "CLOTURE"].includes(statut)) return "ok";
  if (["NON_ATTRIBUE", "NO_GO"].includes(statut)) return "risk";
  return "warn";
}

const labelStyle = { fontSize: 11.5, fontWeight: 600, display: "block", marginBottom: 5 };
const miniLabelStyle = { fontSize: 9.5, color: "var(--sub)", textTransform: "uppercase" };
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
