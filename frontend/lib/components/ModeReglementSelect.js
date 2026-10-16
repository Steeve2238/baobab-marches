"use client";

import { useEffect, useState } from "react";
import { api } from "../api";
import { useLangue } from "../i18n/LanguageContext";

/**
 * Liste deroulante des modes de reglement parametres (Parametres > Modes de reglement).
 * `sens` : "ENCAISSEMENT" ou "DECAISSEMENT" pour ne proposer que les modes autorises.
 * `onChange(id, mode)` recoit l'identifiant et l'objet mode complet.
 */
export default function ModeReglementSelect({ value, onChange, sens, style, disabled, vide = true, ...rest }) {
  const { t } = useLangue();
  const [modes, setModes] = useState([]);
  useEffect(() => {
    const params = { actifs: "1" };
    if (sens) params.sens = sens;
    api.modesReglement(params).then((r) => {
      setModes(r.modes || []);
      // Pas de valeur choisie : le mode par defaut est preselectionne.
      if (!value && !vide) {
        const d = (r.modes || []).find((m) => m.par_defaut) || (r.modes || [])[0];
        if (d) onChange(d.id, d);
      }
    }).catch(() => {});
  }, [sens]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <select
      value={value || ""}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value, modes.find((m) => m.id === e.target.value) || null)}
      style={style}
      {...rest}
    >
      {vide && <option value="">{t("mdrChoisir")}</option>}
      {modes.map((m) => (
        <option key={m.id} value={m.id}>{m.libelle}</option>
      ))}
    </select>
  );
}
