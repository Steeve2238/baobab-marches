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
