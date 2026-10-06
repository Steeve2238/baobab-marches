"use client";

import { useEffect, useState } from "react";
import { api } from "../../api";
import { useLangue } from "../../i18n/LanguageContext";
import { inputStyle } from "../../financementUi";

// Choix du dossier auquel affecter un financement, sans se soucier de son type :
// la liste fusionne les dossiers d'appel d'offres et les consultations
// restreintes (meme source que l'ecran Dossiers). La valeur est "AO:<id>",
// "CONSULTATION:<id>" ou "" (aucun dossier).

export const valeurDossier = (s) => (s && s.dossier_ao_id ? `AO:${s.dossier_ao_id}` : s && s.consultation_id ? `CONSULTATION:${s.consultation_id}` : "");

/** Convertit la valeur du select en champs a envoyer a l'API (l'autre lien est vide). */
export function payloadDossier(valeur) {
  const [type, id] = String(valeur || "").split(":");
  return { dossier_ao_id: type === "AO" ? id : null, consultation_id: type === "CONSULTATION" ? id : null };
}

/** Adresse de la fiche du dossier selon son type. */
export function lienDossier(s) {
  if (s && s.dossier_ao_id) return `/dossiers/${s.dossier_ao_id}`;
  if (s && s.consultation_id) return `/marches/consultation-restreinte/consultations/${s.consultation_id}`;
  return null;
}

export default function DossierSelect({ valeur, onChange, style }) {
  const { t } = useLangue();
  const [liste, setListe] = useState([]);
  useEffect(() => {
    api.getDossiersUnifies().then(setListe).catch(() => setListe([]));
  }, []);
  const ao = liste.filter((d) => d.type_dossier === "AO");
  const cons = liste.filter((d) => d.type_dossier === "CONSULTATION");
  const manquant = valeur && !liste.some((d) => `${d.type_dossier}:${d.id}` === valeur);
  return (
    <select value={valeur} onChange={(e) => onChange(e.target.value)} style={{ ...inputStyle, ...(style || {}) }}>
      <option value="">{t("finFicheAucunDossier")}</option>
      {manquant && <option value={valeur}>{valeur.split(":")[1]}</option>}
      {ao.length > 0 && (
        <optgroup label={t("finDossierGroupeAO")}>
          {ao.map((d) => (
            <option key={d.id} value={`AO:${d.id}`}>
              {d.reference_externe ? `${d.reference_externe} — ` : ""}
              {d.intitule}
            </option>
          ))}
        </optgroup>
      )}
      {cons.length > 0 && (
        <optgroup label={t("finDossierGroupeConsultation")}>
          {cons.map((d) => (
            <option key={d.id} value={`CONSULTATION:${d.id}`}>
              {d.intitule}
              {d.tiers_nom ? ` — ${d.tiers_nom}` : ""}
            </option>
          ))}
        </optgroup>
      )}
    </select>
  );
}
