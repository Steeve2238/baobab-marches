"use client";

import { Champ, Section, grille, inputStyle, boutonLeger, fmtMontant } from "./rhUi";

export const OBJETS = ["EMBAUCHE", "LICENCIEMENT_ECONOMIQUE", "EXPIRATION_CONTRAT", "DEMISSION", "MUTATION", "CHANGEMENT_CATEGORIE", "MODIFICATION_CONTRAT", "CHANGEMENT_SITUATION_FAMILLE", "CHANGEMENT_RESIDENCE", "CHANGEMENT_EMPLOI", "DECES"];

const DATES = ["date_naissance", "piece_date", "date_entree", "declaration_date", "date_debut_contrat", "date_debut", "date_fin", "date_entree_senegal"];
const SECTIONS = [
  ["rhdmSecTravailleur", ["nom", "prenoms", "sexe", "date_naissance", "lieu_naissance", "pays_naissance", "nationalite", "pere", "mere", "groupe_ethnique", "adresse", "piece_type", "piece_numero", "piece_lieu", "piece_date", "numero_css", "numero_ipres", "situation_familiale", "nombre_epouses", "noms_epouses", "nombre_enfants", "noms_enfants", "residence_habituelle", "date_entree_senegal", "precedent_employeur"]],
  ["rhdmSecEmploi", ["date_entree", "declaration_numero", "declaration_date", "profession", "emploi", "convention", "categorie", "date_debut_contrat", "visa_inspecteur", "visa_section_locale", "employeur", "activite", "duree", "date_debut", "date_fin", "essai_mois", "chantier"]],
  ["rhdmSecMilitaire", ["mil_classe", "mil_service", "mil_armee", "mil_grade"]],
];
const LARGES = ["adresse", "employeur", "precedent_employeur", "noms_enfants", "noms_epouses", "visa_inspecteur", "visa_section_locale", "precision_objet", "residence_habituelle"];

export default function DmtForm({ donnees, setDonnees, t, lectureSeule }) {
  const dis = !!lectureSeule;
  const maj = (k, v) => setDonnees((d) => ({ ...d, [k]: v }));
  const total = (donnees.elements || []).reduce((s, l) => s + (Number(l.montant) || 0), 0);
  const majLigne = (i, k, v) => setDonnees((d) => ({ ...d, elements: d.elements.map((l, j) => (j === i ? { ...l, [k]: v } : l)) }));

  function champ(k) {
    const label = t(`rhdmF_${k}`);
    let input;
    if (k === "duree") {
      input = (
        <select value={donnees.duree || "CDI"} disabled={dis} onChange={(e) => maj("duree", e.target.value)} style={inputStyle}>
          <option value="CDI">{t("rhcType_CDI")}</option>
          <option value="CDD">{t("rhcType_CDD")}</option>
        </select>
      );
    } else if (DATES.includes(k)) {
      input = <input type="date" value={donnees[k] || ""} disabled={dis} onChange={(e) => maj(k, e.target.value)} style={inputStyle} />;
    } else {
      input = <input value={donnees[k] || ""} disabled={dis} onChange={(e) => maj(k, e.target.value)} style={inputStyle} />;
    }
    return <Champ key={k} label={label} large={LARGES.includes(k)}>{input}</Champ>;
  }

  return (
    <div style={{ display: "grid", gap: 16 }}>
      <Section titre={t("rhdmSecObjet")}>
        <div style={grille}>
          <Champ label={t("rhdmColObjet")}>
            <select value={donnees.objet} disabled={dis} onChange={(e) => maj("objet", e.target.value)} style={inputStyle}>
              {OBJETS.map((o) => (
                <option key={o} value={o}>{t(`rhdmObjet_${o}`)}</option>
              ))}
            </select>
          </Champ>
          {champ("precision_objet")}
        </div>
      </Section>
      {SECTIONS.map(([titre, champs]) => (
        <Section key={titre} titre={t(titre)}>
          <div style={grille}>{champs.map(champ)}</div>
        </Section>
      ))}
      <Section titre={t("rhdmSecDispositions")}>
        <div style={{ ...grille, marginBottom: 12 }}>
          {champ("categorie_texte")}
          {champ("heures_hebdo")}
        </div>
        <div style={{ display: "grid", gap: 8 }}>
          {(donnees.elements || []).map((l, i) => (
            <div key={i} style={{ display: "grid", gridTemplateColumns: "2fr 1fr auto", gap: 10, alignItems: "center" }}>
              <input placeholder={t("rhdmLigneLibelle")} value={l.libelle} disabled={dis} onChange={(e) => majLigne(i, "libelle", e.target.value)} style={inputStyle} />
              <input type="number" min="0" value={l.montant} disabled={dis} onChange={(e) => majLigne(i, "montant", e.target.value)} style={{ ...inputStyle, textAlign: "right" }} />
              {!dis && <button type="button" style={{ ...boutonLeger, color: "var(--brique)" }} onClick={() => setDonnees((d) => ({ ...d, elements: d.elements.filter((_, j) => j !== i) }))}>{t("rhcRetirer")}</button>}
            </div>
          ))}
        </div>
        {!dis && <button type="button" style={{ ...boutonLeger, marginTop: 10 }} onClick={() => setDonnees((d) => ({ ...d, elements: [...(d.elements || []), { libelle: "", montant: "" }] }))}>+ {t("rhcAjouterLigne")}</button>}
        <div style={{ marginTop: 12, fontWeight: 700, fontSize: 14 }}>{t("rhcTotal")} : <span className="mono">{fmtMontant(total)} F CFA</span></div>
      </Section>
    </div>
  );
}

export function donneesVersApi(d) {
  return { ...d, elements: (d.elements || []).filter((l) => String(l.libelle).trim()).map((l) => ({ libelle: l.libelle, montant: Number(l.montant) || 0 })) };
}
