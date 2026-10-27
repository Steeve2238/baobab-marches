"use client";

import { useIncoterms, codesAvec } from "../incoterms";
import { useLangue } from "../i18n/LanguageContext";
import { inputStyle, labelStyle } from "../comptaUi";

/**
 * Choix de l'Incoterm propose au client sur un devis ou une facture : code du catalogue de l'entreprise + lieu nomme
 * (« FOB » + « Dakar »). Les deux champs sont facultatifs ; sans code, rien n'apparait sur le document.
 */
export default function IncotermChamp({ incoterm, lieu, onChange, disabled }) {
  const { t } = useLangue();
  const { codes } = useIncoterms();
  return (
    <div>
      <div style={{ display: "grid", gridTemplateColumns: "minmax(120px, 1fr) minmax(160px, 2fr)", gap: 12 }}>
        <div>
          <label htmlFor="champ-incoterm" style={labelStyle}>{t("venteIncotermLabel")}</label>
          <select id="champ-incoterm" disabled={disabled} value={incoterm || ""} onChange={(e) => onChange({ incoterm: e.target.value, lieu: e.target.value ? lieu || "" : "" })} style={inputStyle}>
            <option value="">{t("venteIncotermAucun")}</option>
            {codesAvec(codes, incoterm).map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="champ-incoterm-lieu" style={labelStyle}>{t("venteIncotermLieuLabel")}</label>
          <input id="champ-incoterm-lieu" disabled={disabled || !incoterm} maxLength={120} value={lieu || ""} onChange={(e) => onChange({ incoterm, lieu: e.target.value })} placeholder={t("venteIncotermLieuPlaceholder")} style={inputStyle} />
        </div>
      </div>
      <div style={{ fontSize: 11, color: "var(--sub)", marginTop: 3 }}>{t("venteIncotermAide")}</div>
    </div>
  );
}
