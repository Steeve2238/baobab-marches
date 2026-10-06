"use client";

import { useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { api } from "../../../lib/api";
import { useLangue } from "../../../lib/i18n/LanguageContext";
import AppShell from "../../../lib/components/AppShell";
import CourrierSection from "../../../lib/components/CourrierSection";
import FinancementDossierSection from "../../../lib/components/financement/FinancementDossierSection";
import { DEVISES } from "../../../lib/constants/devises";

const PHASES_CHRONOGRAMME = ["AVANT_SOUMISSION", "NON_ATTRIBUTION", "ATTRIBUTION_EXECUTION"];

// Statuts a partir desquels les champs descriptifs du dossier restent
// modifiables - doit rester identique a STATUTS_MODIFIABLES cote backend
// (routes/dossiers.js), au-dela le serveur refuse de toute facon la
// modification (409).
const STATUTS_DOSSIER_MODIFIABLE = ["ANALYSE", "GO", "NO_GO", "SOUMIS"];

const CONDITIONS_REGLEMENT = [
  "COMPTANT",
  "ACOMPTE_SOLDE",
  "CREDIT_FOURNISSEUR",
  "LC",
  "AVAL_TRAITE",
  "CHEQUE",
  "VIREMENT",
];

export default function DossierDetailPage() {
  const { id } = useParams();
  const {
    t,
    statutLabel,
    typeBesoinLabel,
    penaliteStatutLabel,
    typeFaciliteLabel,
    conditionReglementLabel,
    clauseTypeLabel,
    niveauVigilanceLabel,
    phaseChronogrammeLabel,
    tacheStatutLabel,
    dict,
  } = useLangue();

  const [dossier, setDossier] = useState(null);
  const [maitresOuvrage, setMaitresOuvrage] = useState([]);
  const [roles, setRoles] = useState([]);
  const [utilisateurs, setUtilisateurs] = useState([]);
  // Financement v2 : simulations rattachees a ce dossier + cout bancaire retenu.
  const [financement, setFinancement] = useState({ simulations: [], cout_retenu_total_xof: 0 });
  const [calculsMarge, setCalculsMarge] = useState([]);
  // Lot 6 : marge estimee / reelle issue du Dossier de calcul + receptions (null si module non accessible).
  const [syntheseMarge, setSyntheseMarge] = useState(null);
  const [suivisLogistiques, setSuivisLogistiques] = useState([]);
  const [incoterms, setIncoterms] = useState([]);
  const [transitaires, setTransitaires] = useState([]);
  const [fournisseurs, setFournisseurs] = useState([]);
  const [offres, setOffres] = useState([]);
  const [chargement, setChargement] = useState(true);
  const [erreur, setErreur] = useState("");
  const [signalements, setSignalements] = useState({});


  // "Dossier de calcul" (prix de revient et marge, atelier autonome - voir
  // routes/calculPrix.js) : un dossier de calcul est rattache 0 ou 1 fois a
  // ce dossier d'AO (contrainte CHECK cote base). Charge separement du
  // Promise.all principal ci-dessous pour ne pas bloquer l'affichage du
  // reste de la fiche si cet appel echoue.
  const [dossierCalcul, setDossierCalcul] = useState(null);
  const [calculPrixChargement, setCalculPrixChargement] = useState(true);
  const [formCalculPrixOuvert, setFormCalculPrixOuvert] = useState(false);
  const [nomCalculPrix, setNomCalculPrix] = useState("");
  const [creationCalculPrixEnCours, setCreationCalculPrixEnCours] = useState(false);

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

  const [formOffreOuvert, setFormOffreOuvert] = useState(false);
  const [formOffre, setFormOffre] = useState({
    fournisseur_id: "",
    prix_exw: "",
    devise: "XOF",
    delai_jours: "",
    delai_paiement_jours: "",
    condition_reglement: "",
    pourcentage_acompte: "",
    incoterm_scenario_id: "",
  });
  const [offreEnCours, setOffreEnCours] = useState(false);

  // Edition des champs descriptifs du dossier (Anomalie signalee par le
  // client, rapport PDF du 24/09/2026) : formulaire inline, visible
  // uniquement tant que le dossier est encore modifiable (voir
  // STATUTS_DOSSIER_MODIFIABLE ci-dessus). Le champ statut lui-meme n'est
  // jamais touche ici, il garde sa propre route/section dediee.
  const [formDossierOuvert, setFormDossierOuvert] = useState(false);
  const [formDossier, setFormDossier] = useState({
    intitule: "",
    reference_externe: "",
    maitre_ouvrage_id: "",
    secteur: "",
    montant_estime: "",
    devise: "XOF",
    date_limite_soumission: "",
  });
  const [dossierEnCours, setDossierEnCours] = useState(false);

  const [ajoutMaitreOuvrageOuvert, setAjoutMaitreOuvrageOuvert] = useState(false);
  const [nouveauMaitreOuvrage, setNouveauMaitreOuvrage] = useState({ nom: "", categorie: "" });
  const [maitreOuvrageEnCours, setMaitreOuvrageEnCours] = useState(false);

  const fichierDaoRef = useRef(null);
  const [analyseEnCours, setAnalyseEnCours] = useState(false);

  const [formTacheOuvert, setFormTacheOuvert] = useState(false);
  const [formTache, setFormTache] = useState({
    phase: PHASES_CHRONOGRAMME[0],
    intitule: "",
    jalon_relatif: "",
    date_echeance: "",
    role_porteur_id: "",
    assigne_utilisateur_id: "",
  });
  const [tacheEnCours, setTacheEnCours] = useState(false);
  const [genererEnCours, setGenererEnCours] = useState(false);

  useEffect(() => {
    async function charger() {
      try {
        const [
          dossierData,
          maitresOuvrageData,
          rolesData,
          utilisateursData,
          simulationsData,
          margeData,
          suivisData,
          incotermsData,
          transitairesData,
          fournisseursData,
          offresData,
        ] = await Promise.all([
          api.getDossier(id),
          api.getMaitresOuvrage(),
          api.getRoles(),
          api.getUtilisateurs(),
          api.finDossier("ao", id).catch(() => ({ simulations: [], cout_retenu_total_xof: 0 })),
          api.getCalculsMarge(id),
          api.getSuivisLogistiques(id),
          api.getIncoterms(),
          api.getTransitaires(),
          api.getFournisseurs(),
          api.getOffresFournisseur(id),
        ]);
        setDossier(dossierData);
        setMaitresOuvrage(maitresOuvrageData);
        setRoles(rolesData);
        setUtilisateurs(utilisateursData);
        setFinancement(simulationsData);
        setCalculsMarge(margeData);
        setSuivisLogistiques(suivisData);
        setIncoterms(incotermsData);
        setTransitaires(transitairesData);
        setFournisseurs(fournisseursData);
        setOffres(offresData);
        api.getSyntheseDossier({ dossier_ao_id: id }).then(setSyntheseMarge).catch(() => setSyntheseMarge(null));
      } catch (err) {
        setErreur(err.message || t("defaultLoadError"));
      } finally {
        setChargement(false);
      }
    }
    if (id) charger();
  }, [id, t]);

  useEffect(() => {
    if (!id) return;
    api
      .getDossiersCalcul({ dossier_ao_id: id })
      .then((rows) => setDossierCalcul(rows[0] || null))
      .catch(() => setDossierCalcul(null))
      .finally(() => setCalculPrixChargement(false));
  }, [id]);

  function handleOuvrirFormDossier() {
    setFormDossier({
      intitule: dossier.intitule || "",
      reference_externe: dossier.reference_externe || "",
      maitre_ouvrage_id: dossier.maitre_ouvrage_id || "",
      secteur: dossier.secteur || "",
      montant_estime: dossier.montant_estime ?? "",
      devise: dossier.devise || "XOF",
      date_limite_soumission: dossier.date_limite_soumission
        ? dossier.date_limite_soumission.slice(0, 16)
        : "",
    });
    setErreur("");
    setFormDossierOuvert(true);
  }

  async function handleEnregistrerDossier(e) {
    e.preventDefault();
    setDossierEnCours(true);
    try {
      const maj = await api.updateDossier(id, {
        ...formDossier,
        maitre_ouvrage_id: formDossier.maitre_ouvrage_id || null,
        montant_estime: formDossier.montant_estime ? Number(formDossier.montant_estime) : null,
        date_limite_soumission: formDossier.date_limite_soumission || null,
      });
      setDossier((prev) => ({ ...prev, ...maj }));
      setFormDossierOuvert(false);
    } catch (err) {
      setErreur(err.message);
    } finally {
      setDossierEnCours(false);
    }
  }

  async function handleCreerMaitreOuvrage() {
    setMaitreOuvrageEnCours(true);
    try {
      const nouveau = await api.createMaitreOuvrage(nouveauMaitreOuvrage);
      setMaitresOuvrage((prev) => [...prev, nouveau].sort((a, b) => a.nom.localeCompare(b.nom)));
      setFormDossier((f) => ({ ...f, maitre_ouvrage_id: nouveau.id }));
      setAjoutMaitreOuvrageOuvert(false);
      setNouveauMaitreOuvrage({ nom: "", categorie: "" });
    } catch (err) {
      setErreur(err.message);
    } finally {
      setMaitreOuvrageEnCours(false);
    }
  }

  function handleOuvrirFormCalculPrix() {
    setNomCalculPrix(`Calcul – ${dossier?.reference_externe || dossier?.intitule || ""}`.trim());
    setFormCalculPrixOuvert(true);
  }

  async function handleCreerDossierCalcul(e) {
    e.preventDefault();
    setCreationCalculPrixEnCours(true);
    try {
      const nouveau = await api.createDossierCalcul({ dossier_ao_id: id, nom: nomCalculPrix });
      setDossierCalcul(nouveau);
      setFormCalculPrixOuvert(false);
    } catch (err) {
      setErreur(err.message);
    } finally {
      setCreationCalculPrixEnCours(false);
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
   * et {{date_jour}}) - utilisee par CourrierSection (lib/components), plus
   * directement ici : conservee sur cette fiche car elle depend de
   * `simulations`, propre au module Financement du dossier AO.
   */
  function deduireValeursConnues() {
    const retenue = (financement.simulations || []).find((s) => s.statut !== "SIMULEE");
    if (!retenue) return {};
    return {
      montant_demande: retenue.montant ?? "",
      duree_jours: retenue.duree_jours ?? "",
      type_facilite: t(`finType_${retenue.type_facilite}`),
    };
  }

  async function handleAjouterOffre(e) {
    e.preventDefault();
    setOffreEnCours(true);
    try {
      const payload = {
        fournisseur_id: formOffre.fournisseur_id,
        prix_exw: formOffre.prix_exw ? Number(formOffre.prix_exw) : null,
        devise: formOffre.devise || "XOF",
        delai_jours: formOffre.delai_jours ? Number(formOffre.delai_jours) : null,
        delai_paiement_jours: formOffre.delai_paiement_jours ? Number(formOffre.delai_paiement_jours) : null,
        condition_reglement: formOffre.condition_reglement || null,
        pourcentage_acompte: formOffre.pourcentage_acompte ? Number(formOffre.pourcentage_acompte) : null,
        incoterm_scenario_id: formOffre.incoterm_scenario_id || null,
      };
      const nouvelle = await api.createOffreFournisseur(id, payload);
      setOffres((prev) => [...prev, nouvelle].sort((a, b) => (a.prix_exw ?? Infinity) - (b.prix_exw ?? Infinity)));
      setFormOffreOuvert(false);
      setFormOffre({
        fournisseur_id: "",
        prix_exw: "",
        devise: "XOF",
        delai_jours: "",
        delai_paiement_jours: "",
        condition_reglement: "",
        pourcentage_acompte: "",
        incoterm_scenario_id: "",
      });
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

  /**
   * Upload du DAO et extraction automatique des clauses candidates (Module
   * 1). Les clauses renvoyees sont toujours a l'etat A_VERIFIER : elles
   * viennent s'ajouter a celles deja presentes sur le dossier, en attente de
   * validation ou de rejet par l'utilisateur.
   */
  async function handleAnalyserDao(e) {
    e.preventDefault();
    const fichier = fichierDaoRef.current?.files?.[0];
    if (!fichier) return;
    setAnalyseEnCours(true);
    try {
      const resultat = await api.analyserDao(id, fichier);
      setDossier((prev) => ({ ...prev, clauses: [...prev.clauses, ...resultat.clauses] }));
      if (fichierDaoRef.current) fichierDaoRef.current.value = "";
    } catch (err) {
      setErreur(err.message);
    } finally {
      setAnalyseEnCours(false);
    }
  }

  async function handleValiderClause(clauseId) {
    try {
      const maj = await api.patchClause(clauseId, {
        valide_par_juridique: true,
        niveau_vigilance: "STANDARD",
      });
      setDossier((prev) => ({
        ...prev,
        clauses: prev.clauses.map((c) => (c.id === clauseId ? maj : c)),
      }));
    } catch (err) {
      setErreur(err.message);
    }
  }

  async function handleRejeterClause(clauseId) {
    try {
      await api.supprimerClause(clauseId);
      setDossier((prev) => ({
        ...prev,
        clauses: prev.clauses.filter((c) => c.id !== clauseId),
      }));
    } catch (err) {
      setErreur(err.message);
    }
  }

  /**
   * Raccourci Module 1 -> Module 7 : signale qu'une clause deja extraite
   * constitue un motif recurrent pour le maitre d'ouvrage de ce dossier. Le
   * backend regroupe automatiquement par (maitre d'ouvrage, type de clause) :
   * une nouvelle entree est creee la premiere fois, puis son compteur
   * d'occurrences est incremente les fois suivantes.
   */
  async function handleSignalerRecurrent(clause) {
    setSignalements((prev) => ({ ...prev, [clause.id]: { loading: true } }));
    try {
      const resultat = await api.signalerClauseRecurrente({
        dossier_ao_id: id,
        type_clause: clause.type_clause,
        libelle: clause.libelle,
      });
      setSignalements((prev) => ({
        ...prev,
        [clause.id]: {
          loading: false,
          message: resultat.cree
            ? t("signalerRecurrentCreated")
            : t("signalerRecurrentIncremented").replace("{n}", resultat.clause.occurrences),
          isError: false,
        },
      }));
    } catch (err) {
      setSignalements((prev) => ({
        ...prev,
        [clause.id]: { loading: false, message: err.message || t("signalerRecurrentError"), isError: true },
      }));
    }
  }

  /**
   * Genere le chronogramme standard (retro-planning J-7 -> J0 -> J+X). Si un
   * chronogramme existe deja pour ce dossier, `force` remplace l'existant
   * (utilise par le bouton "Regenerer").
   */
  async function handleGenererChronogramme(force = false) {
    setGenererEnCours(true);
    try {
      const nouvelles = await api.genererChronogramme(id, force);
      setDossier((prev) => ({ ...prev, chronogramme: nouvelles }));
    } catch (err) {
      setErreur(err.message);
    } finally {
      setGenererEnCours(false);
    }
  }

  async function handleAjouterTache(e) {
    e.preventDefault();
    setTacheEnCours(true);
    try {
      const nouvelle = await api.createTacheChronogramme(id, {
        phase: formTache.phase,
        intitule: formTache.intitule,
        jalon_relatif: formTache.jalon_relatif || null,
        date_echeance: formTache.date_echeance || null,
        role_porteur_id: formTache.role_porteur_id || null,
        assigne_utilisateur_id: formTache.assigne_utilisateur_id || null,
      });
      setDossier((prev) => ({ ...prev, chronogramme: [...prev.chronogramme, nouvelle] }));
      setFormTacheOuvert(false);
      setFormTache({
        phase: PHASES_CHRONOGRAMME[0],
        intitule: "",
        jalon_relatif: "",
        date_echeance: "",
        role_porteur_id: "",
        assigne_utilisateur_id: "",
      });
    } catch (err) {
      setErreur(err.message);
    } finally {
      setTacheEnCours(false);
    }
  }

  async function handlePatchTacheStatut(tacheId, statut) {
    try {
      const maj = await api.patchTacheStatut(tacheId, statut);
      setDossier((prev) => ({
        ...prev,
        chronogramme: prev.chronogramme.map((tache) => (tache.id === tacheId ? maj : tache)),
      }));
    } catch (err) {
      setErreur(err.message);
    }
  }

  /**
   * Affectation d'une tache a un role et/ou une personne, editable
   * directement depuis chaque carte de tache (voir section CHRONOGRAMME).
   * champ vaut "role_porteur_id" ou "assigne_utilisateur_id" ; une valeur
   * vide envoie explicitement null pour desaffecter ce champ.
   */
  async function handlePatchTacheAffectation(tacheId, champ, valeur) {
    try {
      const tacheActuelle = dossier.chronogramme.find((tache) => tache.id === tacheId);
      const maj = await api.patchTacheAffectation(tacheId, {
        role_porteur_id: tacheActuelle.role_porteur_id,
        assigne_utilisateur_id: tacheActuelle.assigne_utilisateur_id,
        [champ]: valeur || null,
      });
      setDossier((prev) => ({
        ...prev,
        chronogramme: prev.chronogramme.map((tache) => (tache.id === tacheId ? maj : tache)),
      }));
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

  const dossierModifiable = STATUTS_DOSSIER_MODIFIABLE.includes(dossier.statut);

  return (
    <AppShell backHref="/dashboard">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 16, marginBottom: 20 }}>
        <div>
          <h1 style={{ fontSize: 19, color: "var(--petrol)" }}>{dossier.intitule}</h1>
          <div className="mono" style={{ fontSize: 11.5, color: "var(--sub)", marginTop: 2 }}>
            {dossier.reference_externe} {dossier.maitre_ouvrage_nom ? `· ${dossier.maitre_ouvrage_nom}` : ""}
            {" · "}
            <span className={`chip ${statutClasse(dossier.statut)}`} style={{ marginLeft: 4 }}>
              {statutLabel(dossier.statut)}
            </span>
          </div>
        </div>
        {dossierModifiable && !formDossierOuvert && (
          <button type="button" onClick={handleOuvrirFormDossier} style={boutonSecondaireStyle}>
            {t("dossierEditButton")}
          </button>
        )}
      </div>

      {formDossierOuvert && (
        <form onSubmit={handleEnregistrerDossier} className="card" style={{ maxWidth: 560, marginBottom: 20 }}>
          <label style={labelStyle}>{t("intituleLabel")}</label>
          <input
            required
            value={formDossier.intitule}
            onChange={(e) => setFormDossier((f) => ({ ...f, intitule: e.target.value }))}
            style={inputStyle}
          />

          <label style={{ ...labelStyle, marginTop: 10 }}>{t("referenceExterneLabel")}</label>
          <input
            value={formDossier.reference_externe}
            onChange={(e) => setFormDossier((f) => ({ ...f, reference_externe: e.target.value }))}
            style={inputStyle}
          />

          <label style={{ ...labelStyle, marginTop: 10 }}>{t("maitreOuvrageLabel")}</label>
          <select
            value={formDossier.maitre_ouvrage_id}
            onChange={(e) => setFormDossier((f) => ({ ...f, maitre_ouvrage_id: e.target.value }))}
            style={inputStyle}
          >
            <option value="">{t("selectMaitreOuvrage")}</option>
            {maitresOuvrage.map((m) => (
              <option key={m.id} value={m.id}>
                {m.nom}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={() => setAjoutMaitreOuvrageOuvert((v) => !v)}
            style={{ ...boutonLienStyle, marginTop: 4 }}
          >
            {t("dossierQuickAddMaitreOuvrage")}
          </button>
          {ajoutMaitreOuvrageOuvert && (
            <div style={{ display: "flex", gap: 6, marginTop: 6 }}>
              <input
                placeholder={t("dossierNewMaitreOuvrageNomLabel")}
                value={nouveauMaitreOuvrage.nom}
                onChange={(e) => setNouveauMaitreOuvrage((f) => ({ ...f, nom: e.target.value }))}
                style={{ ...inputStyle, fontSize: 11.5, padding: "5px 8px" }}
              />
              <input
                placeholder={t("dossierNewMaitreOuvrageCategorieLabel")}
                value={nouveauMaitreOuvrage.categorie}
                onChange={(e) => setNouveauMaitreOuvrage((f) => ({ ...f, categorie: e.target.value }))}
                style={{ ...inputStyle, fontSize: 11.5, padding: "5px 8px", maxWidth: 120 }}
              />
              <button
                type="button"
                onClick={handleCreerMaitreOuvrage}
                disabled={maitreOuvrageEnCours || !nouveauMaitreOuvrage.nom.trim()}
                style={boutonSecondaireStyle}
              >
                {t("save")}
              </button>
            </div>
          )}

          <label style={{ ...labelStyle, marginTop: 10 }}>{t("secteurLabel")}</label>
          <input
            value={formDossier.secteur}
            onChange={(e) => setFormDossier((f) => ({ ...f, secteur: e.target.value }))}
            style={inputStyle}
          />

          <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 12, marginTop: 10 }}>
            <div>
              <label style={labelStyle}>{t("montantEstimeLabel")}</label>
              <input
                type="number"
                step="0.01"
                value={formDossier.montant_estime}
                onChange={(e) => setFormDossier((f) => ({ ...f, montant_estime: e.target.value }))}
                style={inputStyle}
              />
            </div>
            <div>
              <label style={labelStyle}>{t("deviseLabel")}</label>
              <select
                value={formDossier.devise}
                onChange={(e) => setFormDossier((f) => ({ ...f, devise: e.target.value }))}
                style={inputStyle}
              >
                {DEVISES.map((d) => (
                  <option key={d.code} value={d.code}>
                    {d.code}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <label style={{ ...labelStyle, marginTop: 10 }}>{t("dateLimiteSoumissionLabel")}</label>
          <input
            type="datetime-local"
            value={formDossier.date_limite_soumission}
            onChange={(e) => setFormDossier((f) => ({ ...f, date_limite_soumission: e.target.value }))}
            style={inputStyle}
          />

          <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
            <button type="submit" disabled={dossierEnCours} style={boutonPrincipalStyle}>
              {t("save")}
            </button>
            <button
              type="button"
              onClick={() => setFormDossierOuvert(false)}
              style={boutonSecondaireStyle}
            >
              {t("cancel")}
            </button>
          </div>
        </form>
      )}

      {erreur && <p style={{ color: "var(--brique)", fontSize: 12.5, marginBottom: 14 }}>{erreur}</p>}

      {/* ---------------- CLAUSES EXTRAITES (Module 1) ---------------- */}
      <section style={{ marginBottom: 30 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
          <h2 style={{ fontSize: 15.5, color: "var(--petrol)" }}>{t("clausesSection")}</h2>
        </div>

        <form
          onSubmit={handleAnalyserDao}
          className="card"
          style={{ marginBottom: 14, display: "flex", gap: 12, alignItems: "flex-end" }}
        >
          <div style={{ flex: 1 }}>
            <label style={labelStyle}>{t("uploadDaoLabel")}</label>
            <input ref={fichierDaoRef} type="file" accept=".pdf,.doc,.docx" style={inputStyle} />
          </div>
          <button type="submit" disabled={analyseEnCours} style={boutonPrincipalStyle}>
            {analyseEnCours ? t("analyzing") : t("uploadDaoLabel")}
          </button>
        </form>

        {dossier.clauses.length === 0 ? (
          <p className="card" style={{ fontSize: 13, color: "var(--sub)" }}>
            {t("noClauses")}
          </p>
        ) : (
          <div style={{ display: "grid", gap: 8 }}>
            {dossier.clauses.map((clause) => (
              <div
                key={clause.id}
                className="card"
                style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}
              >
                <div>
                  <div style={{ fontWeight: 600, fontSize: 13 }}>
                    {clauseTypeLabel(clause.type_clause)}
                    <span
                      className={`chip ${
                        clause.niveau_vigilance === "RISQUE"
                          ? "risk"
                          : clause.niveau_vigilance === "STANDARD"
                          ? "ok"
                          : "warn"
                      }`}
                      style={{ marginLeft: 8 }}
                    >
                      {niveauVigilanceLabel(clause.niveau_vigilance)}
                    </span>
                    {clause.valide_par_juridique && (
                      <span className="chip ok" style={{ marginLeft: 6 }}>
                        {t("clauseValidated")}
                      </span>
                    )}
                  </div>
                  <div style={{ fontSize: 12.5, marginTop: 4 }}>{clause.libelle}</div>
                  {clause.article_reference && (
                    <div style={{ fontSize: 11, color: "var(--sub)", marginTop: 2 }}>
                      {t("articleRefLabel")} {clause.article_reference}
                    </div>
                  )}
                  {signalements[clause.id]?.message && (
                    <div
                      style={{
                        fontSize: 11,
                        marginTop: 4,
                        color: signalements[clause.id].isError ? "var(--brique)" : "var(--sub)",
                      }}
                    >
                      {signalements[clause.id].message}
                    </div>
                  )}
                </div>
                <div style={{ display: "flex", gap: 8, flexShrink: 0 }}>
                  <button
                    onClick={() => handleSignalerRecurrent(clause)}
                    disabled={signalements[clause.id]?.loading}
                    style={boutonSecondaireStyle}
                  >
                    {signalements[clause.id]?.loading ? t("signalerRecurrentSending") : t("signalerRecurrent")}
                  </button>
                  {!clause.valide_par_juridique && (
                    <>
                      <button onClick={() => handleValiderClause(clause.id)} style={boutonSecondaireStyle}>
                        {t("validateClause")}
                      </button>
                      <button onClick={() => handleRejeterClause(clause.id)} style={boutonSecondaireStyle}>
                        {t("rejectClause")}
                      </button>
                    </>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* ---------------- CHRONOGRAMME (Module 1) ---------------- */}
      <section style={{ marginBottom: 30 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
          <h2 style={{ fontSize: 15.5, color: "var(--petrol)" }}>{t("chronogramSection")}</h2>
          <div style={{ display: "flex", gap: 10 }}>
            <button
              onClick={() => handleGenererChronogramme(dossier.chronogramme.length > 0)}
              disabled={genererEnCours || !dossier.date_limite_soumission}
              style={boutonSecondaireStyle}
            >
              {dossier.chronogramme.length > 0 ? t("regenerateChronogram") : t("generateChronogram")}
            </button>
            <button onClick={() => setFormTacheOuvert((v) => !v)} style={boutonPrincipalStyle}>
              {formTacheOuvert ? t("cancel") : t("addTask")}
            </button>
          </div>
        </div>

        {!dossier.date_limite_soumission && (
          <p style={{ fontSize: 11.5, color: "var(--ocre)", marginBottom: 10 }}>
            {t("missingSubmissionDate")}
          </p>
        )}

        {formTacheOuvert && (
          <form onSubmit={handleAjouterTache} className="card" style={{ marginBottom: 14 }}>
            <div style={{ display: "grid", gridTemplateColumns: "1.4fr 1fr 1fr 1fr", gap: 12 }}>
              <div>
                <label style={labelStyle}>{t("taskTitleLabel")}</label>
                <input
                  required
                  value={formTache.intitule}
                  onChange={(e) => setFormTache((f) => ({ ...f, intitule: e.target.value }))}
                  style={inputStyle}
                />
              </div>
              <div>
                <label style={labelStyle}>{t("taskPhaseLabel")}</label>
                <select
                  value={formTache.phase}
                  onChange={(e) => setFormTache((f) => ({ ...f, phase: e.target.value }))}
                  style={inputStyle}
                >
                  {PHASES_CHRONOGRAMME.map((code) => (
                    <option key={code} value={code}>
                      {phaseChronogrammeLabel(code)}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label style={labelStyle}>{t("taskMilestoneLabel")}</label>
                <input
                  value={formTache.jalon_relatif}
                  onChange={(e) => setFormTache((f) => ({ ...f, jalon_relatif: e.target.value }))}
                  style={inputStyle}
                />
              </div>
              <div>
                <label style={labelStyle}>{t("taskDueDateLabel")}</label>
                <input
                  type="date"
                  value={formTache.date_echeance}
                  onChange={(e) => setFormTache((f) => ({ ...f, date_echeance: e.target.value }))}
                  style={inputStyle}
                />
              </div>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginTop: 12 }}>
              <div>
                <label style={labelStyle}>{t("assignRoleLabel")}</label>
                <select
                  value={formTache.role_porteur_id}
                  onChange={(e) => setFormTache((f) => ({ ...f, role_porteur_id: e.target.value }))}
                  style={inputStyle}
                >
                  <option value="">{t("noRoleOption")}</option>
                  {roles.map((role) => (
                    <option key={role.id} value={role.id}>
                      {role.libelle}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label style={labelStyle}>{t("assignPersonLabel")}</label>
                <select
                  value={formTache.assigne_utilisateur_id}
                  onChange={(e) => setFormTache((f) => ({ ...f, assigne_utilisateur_id: e.target.value }))}
                  style={inputStyle}
                >
                  <option value="">{t("noPersonOption")}</option>
                  {utilisateurs.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.prenom} {u.nom}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <button type="submit" disabled={tacheEnCours} style={{ ...boutonPrincipalStyle, marginTop: 14 }}>
              {t("save")}
            </button>
          </form>
        )}

        {dossier.chronogramme.length === 0 ? (
          <p className="card" style={{ fontSize: 13, color: "var(--sub)" }}>
            {t("noTasks")}
          </p>
        ) : (
          <div style={{ display: "grid", gap: 8 }}>
            {dossier.chronogramme.map((tache) => (
              <div key={tache.id} className="card" style={{ display: "grid", gap: 10 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
                  <div>
                    <div style={{ fontSize: 10.5, color: "var(--sub)", textTransform: "uppercase" }}>
                      {phaseChronogrammeLabel(tache.phase)} {tache.jalon_relatif ? `· ${tache.jalon_relatif}` : ""}
                    </div>
                    <div style={{ fontWeight: 600, fontSize: 13, marginTop: 2 }}>{tache.intitule}</div>
                    <div className="mono" style={{ fontSize: 11.5, color: "var(--sub)", marginTop: 2 }}>
                      {tache.date_echeance
                        ? new Date(tache.date_echeance).toLocaleDateString(dict.dateLocale)
                        : "—"}
                    </div>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 10, flexShrink: 0 }}>
                    <span
                      className={`chip ${
                        tache.statut === "FAIT"
                          ? "ok"
                          : tache.statut === "EN_RETARD"
                          ? "risk"
                          : tache.statut === "EN_COURS"
                          ? "warn"
                          : ""
                      }`}
                      style={tache.statut === "A_FAIRE" ? { background: "var(--line-soft)", color: "var(--sub)" } : {}}
                    >
                      {tacheStatutLabel(tache.statut)}
                    </span>
                    {tache.statut !== "FAIT" && (
                      <button
                        onClick={() =>
                          handlePatchTacheStatut(tache.id, tache.statut === "A_FAIRE" ? "EN_COURS" : "FAIT")
                        }
                        style={boutonSecondaireStyle}
                      >
                        {tache.statut === "A_FAIRE" ? t("markAsInProgress") : t("markAsDone")}
                      </button>
                    )}
                  </div>
                </div>

                <div
                  style={{
                    display: "flex",
                    gap: 10,
                    alignItems: "center",
                    borderTop: "1px solid var(--line)",
                    paddingTop: 8,
                  }}
                >
                  <span style={{ fontSize: 10.5, color: "var(--sub)", textTransform: "uppercase", flexShrink: 0 }}>
                    {t("assignedToLabel")}
                  </span>
                  <select
                    value={tache.role_porteur_id || ""}
                    onChange={(e) => handlePatchTacheAffectation(tache.id, "role_porteur_id", e.target.value)}
                    style={{ ...inputStyle, fontSize: 11.5, padding: "5px 8px" }}
                  >
                    <option value="">{t("noRoleOption")}</option>
                    {roles.map((role) => (
                      <option key={role.id} value={role.id}>
                        {role.libelle}
                      </option>
                    ))}
                  </select>
                  <select
                    value={tache.assigne_utilisateur_id || ""}
                    onChange={(e) =>
                      handlePatchTacheAffectation(tache.id, "assigne_utilisateur_id", e.target.value)
                    }
                    style={{ ...inputStyle, fontSize: 11.5, padding: "5px 8px" }}
                  >
                    <option value="">{t("noPersonOption")}</option>
                    {utilisateurs.map((u) => (
                      <option key={u.id} value={u.id}>
                        {u.prenom} {u.nom}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* ---------------- FINANCEMENT ---------------- */}
      <FinancementDossierSection type="ao" id={id} onLoaded={setFinancement} />

      {/* ---------------- FOURNISSEURS ---------------- */}
      {offres.length > 0 && (
      <section style={{ marginBottom: 30 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
          <h2 style={{ fontSize: 15.5, color: "var(--petrol)" }}>{t("suppliersSection")}</h2>
        </div>

        <p style={{ fontSize: 12, color: "var(--sub)", marginBottom: 10 }}>
          {t("dossierLegacyOffres")}{" "}
          <a href="#dossier-calcul" style={{ color: "var(--petrol)", fontWeight: 600 }}>{t("dossierVoirCalcul")}</a>
        </p>
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
                  gridTemplateColumns: "1.3fr 1fr 0.8fr 0.8fr 1.1fr 0.8fr 0.8fr",
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
                    {o.prix_exw ? `${Number(o.prix_exw).toLocaleString(dict.dateLocale)} ${o.devise}` : "—"}
                  </div>
                </div>
                <div>
                  <div style={miniLabelStyle}>{t("deliveryDelayLabel")}</div>
                  <div className="mono" style={{ fontSize: 12.5 }}>{o.delai_jours ?? "—"}</div>
                </div>
                <div>
                  <div style={miniLabelStyle}>{t("paymentDelayLabel")}</div>
                  <div className="mono" style={{ fontSize: 12.5 }}>{o.delai_paiement_jours ?? "—"}</div>
                </div>
                <div>
                  <div style={miniLabelStyle}>{t("paymentTermsLabel")}</div>
                  <div style={{ fontSize: 12 }}>
                    {o.condition_reglement ? conditionReglementLabel(o.condition_reglement) : "—"}
                    {o.condition_reglement === "ACOMPTE_SOLDE" && o.pourcentage_acompte
                      ? ` (${o.pourcentage_acompte}%)`
                      : ""}
                  </div>
                </div>
                <div>
                  <div style={miniLabelStyle}>{t("reliabilityScoreLabel")}</div>
                  <div className="mono" style={{ fontSize: 12.5 }}>
                    {o.score_fiabilite != null ? `${Math.round(Number(o.score_fiabilite))}%` : "—"}
                  </div>
                </div>
                <div>
                  {o.retenue ? <span className="chip ok">{t("retainedOffer")}</span> : null}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
      )}

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

      {/* ---------------- DOSSIER DE CALCUL ---------------- */}
      <section id="dossier-calcul" style={{ marginBottom: 30 }}>
        <h2 style={{ fontSize: 15.5, color: "var(--petrol)", marginBottom: 4 }}>{t("calcPrixSectionTitle")}</h2>
        <p style={{ fontSize: 11.5, color: "var(--sub)", marginBottom: 12 }}>{t("calcPrixSectionDescription")}</p>
        <div className="card">
          {calculPrixChargement ? (
            <p style={{ fontSize: 12.5, color: "var(--sub)" }}>{t("loading")}</p>
          ) : dossierCalcul ? (
            <Link
              href={`/calcul-prix/${dossierCalcul.id}`}
              style={{ ...boutonPrincipalStyle, textDecoration: "none", display: "inline-block" }}
            >
              {t("calcPrixOpenButton")}
            </Link>
          ) : (
            <>
              <p style={{ fontSize: 13, color: "var(--sub)", marginBottom: 10 }}>{t("calcPrixNoneYet")}</p>
              {formCalculPrixOuvert ? (
                <form
                  onSubmit={handleCreerDossierCalcul}
                  style={{ display: "flex", gap: 10, alignItems: "flex-end", flexWrap: "wrap" }}
                >
                  <div style={{ flex: 1, minWidth: 220 }}>
                    <label style={labelStyle}>{t("calcPrixNomLabel")}</label>
                    <input
                      required
                      value={nomCalculPrix}
                      onChange={(e) => setNomCalculPrix(e.target.value)}
                      style={inputStyle}
                    />
                  </div>
                  <button type="submit" disabled={creationCalculPrixEnCours} style={boutonPrincipalStyle}>
                    {creationCalculPrixEnCours ? t("calcPrixCreating") : t("save")}
                  </button>
                </form>
              ) : (
                <button onClick={handleOuvrirFormCalculPrix} style={boutonPrincipalStyle}>
                  {t("calcPrixCreateButton")}
                </button>
              )}
            </>
          )}
        </div>
      </section>

      {/* ---------------- MARGE ---------------- */}
      <section>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
          <h2 style={{ fontSize: 15.5, color: "var(--petrol)" }}>{t("marginSection")}</h2>
        </div>

        <MargeDossier t={t} syn={syntheseMarge} />

        {calculsMarge.length > 0 && (
          <p style={{ fontSize: 12, color: "var(--sub)", marginBottom: 10 }}>{t("dossierLegacyMarge")}</p>
        )}
        {calculsMarge.length > 0 && (
          <h3 style={{ fontSize: 12.5, color: "var(--sub)", marginBottom: 8, fontWeight: 600 }}>
            {t("marginHistory")}
          </h3>
        )}
        {calculsMarge.length === 0 ? null : (
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
      <CourrierSection
        dossierType="AO"
        dossierId={id}
        valeursConnues={deduireValeursConnues()}
        afficherSuggestions
      />
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
const boutonLienStyle = {
  background: "none",
  border: "none",
  color: "var(--petrol)",
  fontSize: 11,
  fontWeight: 600,
  padding: 0,
  textDecoration: "underline",
  cursor: "pointer",
};

// Marge du dossier (Lot 6) : marge estimee = marge nette du Dossier de calcul ;
// marge reelle = recalculee avec le cout de revient reel des receptions, une fois
// tout commande et recu. Alimente le Radar d'anticipation.
function MargeDossier({ t, syn }) {
  if (!syn) return <p className="card" style={{ fontSize: 13, color: "var(--sub)", marginBottom: 12 }}>{t("dossierMargeIndispo")}</p>;
  const nb = (n) => (n == null ? "—" : Number(n).toLocaleString(undefined, { maximumFractionDigits: 2 }));
  const m = syn.marge;
  return (
    <div className="card" style={{ marginBottom: 12 }}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))", gap: 18 }}>
        <div>
          <div style={miniLabelStyle}>{t("dossierMargeEstimee")}</div>
          <div className="mono" style={{ fontSize: 17, fontWeight: 700 }}>{m.estimee_pct == null ? "—" : `${nb(m.estimee_pct)} %`}</div>
          <div className="mono" style={{ fontSize: 11.5, color: "var(--sub)" }}>{nb(m.estimee_xof)} XOF</div>
        </div>
        <div>
          <div style={miniLabelStyle}>{t("dossierMargeReelle")}</div>
          {m.reelle_pct == null ? (
            <div style={{ fontSize: 12, color: "var(--sub)", marginTop: 4 }}>{t("dossierMargeReelleAttente")}</div>
          ) : (
            <>
              <div className="mono" style={{ fontSize: 17, fontWeight: 700 }}>{nb(m.reelle_pct)} %</div>
              <div className="mono" style={{ fontSize: 11.5, color: "var(--sub)" }}>{nb(m.reelle_xof)} XOF</div>
            </>
          )}
        </div>
        <div>
          <div style={miniLabelStyle}>{t("dossierMargeEcart")}</div>
          {m.ecart_points == null ? (
            <div style={{ fontSize: 12, color: "var(--sub)", marginTop: 4 }}>—</div>
          ) : (
            <div className="mono" style={{ fontSize: 17, fontWeight: 700, color: m.ecart_points > 0 ? "var(--brique)" : "var(--vert)" }}>
              {m.ecart_points > 0 ? "▼ " : "▲ "}
              {nb(Math.abs(m.ecart_points))} {t("dossierMargePoints")}
            </div>
          )}
        </div>
        {syn.frais_bancaires && (
          <div>
            <div style={miniLabelStyle}>{t("finMargeFrais")}</div>
            <div className="mono" style={{ fontSize: 17, fontWeight: 700 }}>{nb(syn.frais_bancaires.utilises_xof)} XOF</div>
            <div style={{ fontSize: 11.5, color: "var(--sub)" }}>
              {syn.frais_bancaires.source === "FINANCEMENT" ? t("finMargeSourceFinancement") : t("finMargeSourceCalcul")}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
