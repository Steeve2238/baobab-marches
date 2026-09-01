"use client";

import { createContext, useContext, useEffect, useState } from "react";
import {
  DICTIONARIES,
  STATUT_LABELS,
  TYPE_BESOIN_LABELS,
  TYPE_FACILITE_LABELS,
  GRILLE_STATUT_LABELS,
  PENALITE_STATUT_LABELS,
  TYPE_COURRIER_LABELS,
  CONDITION_REGLEMENT_LABELS,
  CLAUSE_TYPE_LABELS,
  NIVEAU_VIGILANCE_LABELS,
  PHASE_CHRONOGRAMME_LABELS,
  TACHE_STATUT_LABELS,
  RESULTAT_CONCURRENT_LABELS,
  NIVEAU_RISQUE_LABELS,
  STATUT_VEHICULE_LABELS,
  STATUT_SORTIE_LABELS,
  NIVEAU_CARBURANT_LABELS,
  TYPE_ENTRETIEN_LABELS,
  STATUT_ENTRETIEN_LABELS,
  ALERTE_TYPE_LABELS,
  ALERTE_SEVERITE_LABELS,
  STATUT_EMPLOYE_LABELS,
  TYPE_DEMANDE_RH_LABELS,
  TYPE_ABSENCE_LABELS,
  TYPE_IMPRESSION_LABELS,
  STATUT_DEMANDE_RH_LABELS,
  STATUT_FICHE_TEMPS_LABELS,
  TYPE_TEMPS_AUTRE_LABELS,
  LANGUES_SUPPORTEES,
  LANGUE_PAR_DEFAUT,
} from "./dictionaries";
import { setLangueLocale, getLangueLocale, api } from "../api";

const LanguageContext = createContext(null);

export function LanguageProvider({ children }) {
  const [langue, setLangueState] = useState(LANGUE_PAR_DEFAUT);

  // Au montage cote client : recupere la langue deja choisie (localStorage)
  useEffect(() => {
    const stored = getLangueLocale();
    if (stored && LANGUES_SUPPORTEES.includes(stored)) {
      setLangueState(stored);
    }
  }, []);

  // Reflete la langue active sur <html lang="..."> pour l'accessibilite
  useEffect(() => {
    if (typeof document !== "undefined") {
      document.documentElement.lang = langue;
    }
  }, [langue]);

  /**
   * Change la langue active. Si `persistToBackend` est vrai (utilisateur
   * connecte), synchronise aussi la preference sur son profil.
   */
  function setLangue(newLangue, { persistToBackend = false } = {}) {
    if (!LANGUES_SUPPORTEES.includes(newLangue)) return;
    setLangueState(newLangue);
    setLangueLocale(newLangue);
    if (persistToBackend) {
      api.setLangue(newLangue).catch(() => {
        // silencieux : la preference reste appliquee localement
      });
    }
  }

  const dict = DICTIONARIES[langue] || DICTIONARIES[LANGUE_PAR_DEFAUT];
  const statutLabels = STATUT_LABELS[langue] || STATUT_LABELS[LANGUE_PAR_DEFAUT];
  const typeBesoinLabels = TYPE_BESOIN_LABELS[langue] || TYPE_BESOIN_LABELS[LANGUE_PAR_DEFAUT];
  const typeFaciliteLabels = TYPE_FACILITE_LABELS[langue] || TYPE_FACILITE_LABELS[LANGUE_PAR_DEFAUT];
  const grilleStatutLabels = GRILLE_STATUT_LABELS[langue] || GRILLE_STATUT_LABELS[LANGUE_PAR_DEFAUT];
  const penaliteStatutLabels = PENALITE_STATUT_LABELS[langue] || PENALITE_STATUT_LABELS[LANGUE_PAR_DEFAUT];
  const typeCourrierLabels = TYPE_COURRIER_LABELS[langue] || TYPE_COURRIER_LABELS[LANGUE_PAR_DEFAUT];
  const conditionReglementLabels =
    CONDITION_REGLEMENT_LABELS[langue] || CONDITION_REGLEMENT_LABELS[LANGUE_PAR_DEFAUT];
  const clauseTypeLabels = CLAUSE_TYPE_LABELS[langue] || CLAUSE_TYPE_LABELS[LANGUE_PAR_DEFAUT];
  const niveauVigilanceLabels = NIVEAU_VIGILANCE_LABELS[langue] || NIVEAU_VIGILANCE_LABELS[LANGUE_PAR_DEFAUT];
  const phaseChronogrammeLabels =
    PHASE_CHRONOGRAMME_LABELS[langue] || PHASE_CHRONOGRAMME_LABELS[LANGUE_PAR_DEFAUT];
  const tacheStatutLabels = TACHE_STATUT_LABELS[langue] || TACHE_STATUT_LABELS[LANGUE_PAR_DEFAUT];
  const resultatConcurrentLabels =
    RESULTAT_CONCURRENT_LABELS[langue] || RESULTAT_CONCURRENT_LABELS[LANGUE_PAR_DEFAUT];
  const niveauRisqueLabels = NIVEAU_RISQUE_LABELS[langue] || NIVEAU_RISQUE_LABELS[LANGUE_PAR_DEFAUT];
  const statutVehiculeLabels = STATUT_VEHICULE_LABELS[langue] || STATUT_VEHICULE_LABELS[LANGUE_PAR_DEFAUT];
  const statutSortieLabels = STATUT_SORTIE_LABELS[langue] || STATUT_SORTIE_LABELS[LANGUE_PAR_DEFAUT];
  const niveauCarburantLabels = NIVEAU_CARBURANT_LABELS[langue] || NIVEAU_CARBURANT_LABELS[LANGUE_PAR_DEFAUT];
  const typeEntretienLabels = TYPE_ENTRETIEN_LABELS[langue] || TYPE_ENTRETIEN_LABELS[LANGUE_PAR_DEFAUT];
  const statutEntretienLabels = STATUT_ENTRETIEN_LABELS[langue] || STATUT_ENTRETIEN_LABELS[LANGUE_PAR_DEFAUT];
  const alerteTypeLabels = ALERTE_TYPE_LABELS[langue] || ALERTE_TYPE_LABELS[LANGUE_PAR_DEFAUT];
  const alerteSeveriteLabels = ALERTE_SEVERITE_LABELS[langue] || ALERTE_SEVERITE_LABELS[LANGUE_PAR_DEFAUT];
  const statutEmployeLabels = STATUT_EMPLOYE_LABELS[langue] || STATUT_EMPLOYE_LABELS[LANGUE_PAR_DEFAUT];
  const typeDemandeRHLabels = TYPE_DEMANDE_RH_LABELS[langue] || TYPE_DEMANDE_RH_LABELS[LANGUE_PAR_DEFAUT];
  const typeAbsenceLabels = TYPE_ABSENCE_LABELS[langue] || TYPE_ABSENCE_LABELS[LANGUE_PAR_DEFAUT];
  const typeImpressionLabels = TYPE_IMPRESSION_LABELS[langue] || TYPE_IMPRESSION_LABELS[LANGUE_PAR_DEFAUT];
  const statutDemandeRHLabels = STATUT_DEMANDE_RH_LABELS[langue] || STATUT_DEMANDE_RH_LABELS[LANGUE_PAR_DEFAUT];
  const statutFicheTempsLabels = STATUT_FICHE_TEMPS_LABELS[langue] || STATUT_FICHE_TEMPS_LABELS[LANGUE_PAR_DEFAUT];
  const typeTempsAutreLabels = TYPE_TEMPS_AUTRE_LABELS[langue] || TYPE_TEMPS_AUTRE_LABELS[LANGUE_PAR_DEFAUT];

  function t(key) {
    return dict[key] || key;
  }

  function statutLabel(statut) {
    return statutLabels[statut] || statut;
  }

  function typeBesoinLabel(code) {
    return typeBesoinLabels[code] || code;
  }

  function typeFaciliteLabel(code) {
    return typeFaciliteLabels[code] || code;
  }

  function grilleStatutLabel(code) {
    return grilleStatutLabels[code] || code;
  }

  function penaliteStatutLabel(code) {
    return penaliteStatutLabels[code] || code;
  }

  function typeCourrierLabel(code) {
    return typeCourrierLabels[code] || code;
  }

  function conditionReglementLabel(code) {
    return conditionReglementLabels[code] || code;
  }

  function clauseTypeLabel(code) {
    return clauseTypeLabels[code] || code;
  }

  function niveauVigilanceLabel(code) {
    return niveauVigilanceLabels[code] || code;
  }

  function phaseChronogrammeLabel(code) {
    return phaseChronogrammeLabels[code] || code;
  }

  function tacheStatutLabel(code) {
    return tacheStatutLabels[code] || code;
  }

  function resultatConcurrentLabel(code) {
    return resultatConcurrentLabels[code] || code;
  }

  function niveauRisqueLabel(code) {
    return niveauRisqueLabels[code] || code;
  }

  function statutVehiculeLabel(code) {
    return statutVehiculeLabels[code] || code;
  }

  function statutSortieLabel(code) {
    return statutSortieLabels[code] || code;
  }

  function niveauCarburantLabel(code) {
    return niveauCarburantLabels[code] || code;
  }

  function typeEntretienLabel(code) {
    return typeEntretienLabels[code] || code;
  }

  function statutEntretienLabel(code) {
    return statutEntretienLabels[code] || code;
  }

  function alerteTypeLabel(code) {
    return alerteTypeLabels[code] || code;
  }

  function alerteSeveriteLabel(code) {
    return alerteSeveriteLabels[code] || code;
  }

  function statutEmployeLabel(code) {
    return statutEmployeLabels[code] || code;
  }

  function typeDemandeRHLabel(code) {
    return typeDemandeRHLabels[code] || code;
  }

  function typeAbsenceLabel(code) {
    return typeAbsenceLabels[code] || code;
  }

  function typeImpressionLabel(code) {
    return typeImpressionLabels[code] || code;
  }

  function statutDemandeRHLabel(code) {
    return statutDemandeRHLabels[code] || code;
  }

  function statutFicheTempsLabel(code) {
    return statutFicheTempsLabels[code] || code;
  }

  function typeTempsAutreLabel(code) {
    return typeTempsAutreLabels[code] || code;
  }

  return (
    <LanguageContext.Provider
      value={{
        langue,
        setLangue,
        t,
        statutLabel,
        typeBesoinLabel,
        typeFaciliteLabel,
        grilleStatutLabel,
        penaliteStatutLabel,
        typeCourrierLabel,
        conditionReglementLabel,
        clauseTypeLabel,
        niveauVigilanceLabel,
        phaseChronogrammeLabel,
        tacheStatutLabel,
        resultatConcurrentLabel,
        niveauRisqueLabel,
        statutVehiculeLabel,
        statutSortieLabel,
        niveauCarburantLabel,
        typeEntretienLabel,
        statutEntretienLabel,
        alerteTypeLabel,
        alerteSeveriteLabel,
        statutEmployeLabel,
        typeDemandeRHLabel,
        typeAbsenceLabel,
        typeImpressionLabel,
        statutDemandeRHLabel,
        statutFicheTempsLabel,
        typeTempsAutreLabel,
        dict,
      }}
    >
      {children}
    </LanguageContext.Provider>
  );
}

export function useLangue() {
  const ctx = useContext(LanguageContext);
  if (!ctx) {
    throw new Error("useLangue doit etre utilise a l'interieur de LanguageProvider");
  }
  return ctx;
}
