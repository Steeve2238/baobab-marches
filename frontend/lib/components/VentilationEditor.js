"use client";

import { useLangue } from "../i18n/LanguageContext";
import { inputStyle } from "../comptaUi";

const nombre = (v) => Number(String(v || "").replace(/\s/g, "").replace(",", ".")) || 0;

/** Parts de ventilation -> corps de requete (null si aucun dossier choisi). */
export function ventilationVersPayload(parts) {
  const choisies = (parts || []).filter((p) => p.section_id);
  if (choisies.length === 0) return null;
  if (choisies.length === 1) return [{ section_id: choisies[0].section_id }];
  return choisies.map((p) => ({ section_id: p.section_id, pourcentage: nombre(p.pourcentage) }));
}

/** Total des pourcentages saisis (pour controle d'affichage). */
export function totalParts(parts) {
  return Math.round((parts || []).filter((p) => p.section_id).reduce((a, p) => a + nombre(p.pourcentage), 0) * 100) / 100;
}

/** Ventilation lue sur le serveur ({section_id, montant}) -> parts en % pour l'edition. */
export function partsDepuisLigne(analytique, montantLigne) {
  const items = analytique || [];
  if (items.length === 0) return [];
  if (items.length === 1) return [{ section_id: items[0].section_id, pourcentage: "100" }];
  const total = items.reduce((a, x) => a + Number(x.montant), 0) || Number(montantLigne) || 1;
  const parts = items.map((x) => ({ section_id: x.section_id, pourcentage: String(Math.round((Number(x.montant) / total) * 10000) / 100) }));
  // Le dernier absorbe l'arrondi pour retomber sur 100 %.
  const somme = parts.slice(0, -1).reduce((a, p) => a + Number(p.pourcentage), 0);
  parts[parts.length - 1].pourcentage = String(Math.round((100 - somme) * 100) / 100);
  return parts;
}

/**
 * Selecteur de dossier(s) analytique(s) pour une ligne : un seul dossier (100 %)
 * ou plusieurs parts en pourcentage. `parts` = [{ section_id, pourcentage }].
 */
export default function VentilationEditor({ sections, parts, onChange, disabled = false, compact = false }) {
  const { t } = useLangue();
  const lignes = parts && parts.length > 0 ? parts : [{ section_id: "", pourcentage: "" }];
  const multiple = lignes.length > 1;
  const somme = totalParts(lignes);
  const maj = (i, patch) => onChange(lignes.map((p, k) => (k === i ? { ...p, ...patch } : p)));
  const libelle = (s) => `${s.code} — ${s.libelle}`;
  const largeur = compact ? 190 : "100%";

  function repartir() {
    // Passe en mode multi-parts : la premiere part garde 100 %, la seconde est vide.
    onChange([{ ...lignes[0], pourcentage: lignes[0].pourcentage || "100" }, { section_id: "", pourcentage: "" }]);
  }

  return (
    <div style={{ display: "grid", gap: 4 }}>
      {lignes.map((p, i) => (
        <div key={i} style={{ display: "flex", gap: 4, alignItems: "center" }}>
          <select disabled={disabled} value={p.section_id} onChange={(e) => maj(i, { section_id: e.target.value })} style={{ ...inputStyle, width: multiple ? 150 : largeur, padding: "6px 8px", fontSize: 12 }}>
            <option value="">{t("comptaAnaChoisirDossier")}</option>
            {sections.map((s) => (
              <option key={s.id} value={s.id}>{libelle(s)}</option>
            ))}
          </select>
          {multiple && (
            <>
              <input disabled={disabled} inputMode="decimal" aria-label={t("comptaAnaPart")} value={p.pourcentage} onChange={(e) => maj(i, { pourcentage: e.target.value })} style={{ ...inputStyle, width: 60, padding: "6px 6px", fontSize: 12, textAlign: "right" }} />
              <span style={{ fontSize: 11, color: "var(--sub)" }}>%</span>
              {!disabled && (
                <button type="button" title={t("comptaAnaRetirerPart")} onClick={() => onChange(lignes.filter((_, k) => k !== i))} style={{ border: "none", background: "transparent", color: "var(--brique)", fontSize: 15, padding: 0 }}>×</button>
              )}
            </>
          )}
        </div>
      ))}
      {!disabled && lignes[0].section_id && (
        <div style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 11 }}>
          <button type="button" onClick={multiple ? () => onChange([...lignes, { section_id: "", pourcentage: "" }]) : repartir} style={{ border: "none", background: "transparent", color: "var(--petrol)", fontWeight: 600, padding: 0, fontSize: 11 }}>
            {multiple ? t("comptaAnaAjouterPart") : t("comptaAnaRepartir")}
          </button>
          {multiple && (
            <span style={{ color: Math.abs(somme - 100) < 0.005 ? "var(--vert)" : "var(--brique)" }}>
              {t("comptaAnaTotalParts")} : {somme} %
            </span>
          )}
        </div>
      )}
    </div>
  );
}
