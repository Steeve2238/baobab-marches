"use client";

import { useLangue } from "../../i18n/LanguageContext";
import { labelStyle, inputStyle } from "../../financementUi";

const TYPES = ["BANQUE", "ASSURANCE", "SFD", "AUTRE"];

// Champs d'identification d'une banque (fiche creation et modification).
export default function BanqueForm({ valeur, onChange }) {
  const { t } = useLangue();
  const maj = (k, v) => onChange({ ...valeur, [k]: v });
  const champ = (k, label, extra = {}) => (
    <div>
      <label style={labelStyle}>{label}</label>
      <input value={valeur[k] || ""} onChange={(e) => maj(k, e.target.value)} style={inputStyle} {...extra} />
    </div>
  );
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 12 }}>
      {champ("nom", t("finBanqueNom"), { required: true })}
      {champ("sigle", t("finBanqueSigle"))}
      <div>
        <label style={labelStyle}>{t("finBanqueType")}</label>
        <select value={valeur.type_partenaire || "BANQUE"} onChange={(e) => maj("type_partenaire", e.target.value)} style={inputStyle}>
          {TYPES.map((x) => (
            <option key={x} value={x}>
              {t(`finTypePartenaire_${x}`)}
            </option>
          ))}
        </select>
      </div>
      {champ("agence", t("finBanqueAgence"))}
      {champ("interlocuteur", t("finBanqueInterlocuteur"))}
      {champ("email", t("finBanqueEmail"), { type: "email" })}
      {champ("telephone", t("finBanqueTelephone"))}
      {champ("adresse", t("finBanqueAdresse"))}
      {champ("numero_compte", t("finBanqueCompte"))}
      <div style={{ gridColumn: "1 / -1" }}>
        <label style={labelStyle}>{t("finBanqueNotes")}</label>
        <textarea value={valeur.notes || ""} onChange={(e) => maj("notes", e.target.value)} rows={2} style={{ ...inputStyle, resize: "vertical" }} />
      </div>
      <label style={{ fontSize: 12.5, display: "flex", gap: 8, alignItems: "center", gridColumn: "1 / -1" }}>
        <input type="checkbox" checked={valeur.actif !== false} onChange={(e) => maj("actif", e.target.checked)} />
        {t("finBanqueActive")}
      </label>
    </div>
  );
}
