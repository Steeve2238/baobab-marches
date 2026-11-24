"use client";

import { useLangue } from "../i18n/LanguageContext";

/**
 * Barre de recherche commune a toutes les listes.
 * Props : valeur, onChange(texte), placeholder, total (nb de lignes chargees), affiche (nb de lignes apres filtre), note (texte discret).
 */
export default function BarreRecherche({ valeur, onChange, placeholder, total, affiche, note }) {
  const { t } = useLangue();
  const actif = String(valeur || "").trim() !== "";
  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ position: "relative", maxWidth: 520 }}>
        <input
          type="search"
          value={valeur}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder || t("rechPlaceholder")}
          aria-label={placeholder || t("rechPlaceholder")}
          style={{
            width: "100%",
            padding: "9px 34px 9px 12px",
            border: "1px solid var(--line)",
            borderRadius: 8,
            fontSize: 13,
            background: "var(--card, #fff)",
            color: "inherit",
          }}
        />
        {actif && (
          <button
            type="button"
            onClick={() => onChange("")}
            aria-label={t("rechEffacer")}
            title={t("rechEffacer")}
            style={{ position: "absolute", right: 6, top: "50%", transform: "translateY(-50%)", border: "none", background: "transparent", cursor: "pointer", fontSize: 16, color: "var(--sub)", padding: "2px 6px" }}
          >
            ×
          </button>
        )}
      </div>
      {actif && typeof total === "number" && typeof affiche === "number" && (
        <div style={{ fontSize: 11.5, color: "var(--sub)", marginTop: 5 }}>
          {t("rechResultats").replace("{n}", String(affiche)).replace("{total}", String(total))}
          {note ? ` · ${note}` : ""}
        </div>
      )}
    </div>
  );
}
