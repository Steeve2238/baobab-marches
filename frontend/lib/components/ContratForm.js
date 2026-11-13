"use client";

import { useEffect, useState } from "react";
import { api } from "../api";
import { norm, retrouver } from "../conventionsUtil";
import { Champ, Section, grille, inputStyle, boutonLeger, fmtMontant } from "./rhUi";

const TYPES = ["CDI", "CDD", "JOURNALIER", "STAGE"];
const LIBRE = "__libre__";

export function contratFormInitial(c) {
  const f = c || {};
  return {
    type: f.type || "CDI",
    date_contrat: f.date_contrat ? String(f.date_contrat).slice(0, 10) : "",
    lieu_signature: f.lieu_signature || "",
    date_effet: f.date_effet ? String(f.date_effet).slice(0, 10) : "",
    date_fin: f.date_fin ? String(f.date_fin).slice(0, 10) : "",
    periode_essai_mois: f.periode_essai_mois != null ? String(f.periode_essai_mois) : "",
    heures_hebdo: f.heures_hebdo != null ? String(Number(f.heures_hebdo)) : "40",
    poste: f.poste || "",
    lieu_emploi: f.lieu_emploi || "",
    convention: f.convention || "",
    categorie: f.categorie || "",
    convention_id: f.convention_id || "",
    categorie_code: f.categorie_code || "",
    base_grille: f.composition && f.composition.categorie ? f.composition.categorie.salaire_base : null,
    etablissement: f.etablissement || "",
    tuteur: f.tuteur || "",
    motif: f.motif || "",
    notes: f.notes || "",
    elements: (f.elements_json || f.elements || []).map((l) => ({ libelle: l.libelle, montant: String(l.montant), essai: l.essai !== false, auto: Boolean(l.auto) })),
  };
}

export function contratFormVersCorps(form) {
  const { convention_id, categorie_code, base_grille, ...reste } = form;
  const stage = form.type === "STAGE";
  return {
    ...reste,
    convention: stage ? "" : form.convention,
    categorie: stage ? "" : form.categorie,
    etablissement: stage ? form.etablissement : "",
    tuteur: stage ? form.tuteur : "",
    periode_essai_mois: stage || form.periode_essai_mois === "" ? null : Number(form.periode_essai_mois),
    heures_hebdo: Number(form.heures_hebdo) || 40,
    date_fin: form.type === "CDD" || stage ? form.date_fin || null : null,
    elements: form.elements.filter((l) => l.libelle.trim()).map((l) => ({ libelle: l.libelle, montant: Number(l.montant) || 0, essai: l.essai })),
  };
}

export default function ContratForm({ form, setForm, t, lectureSeule, typeFige }) {
  const maj = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const dis = !!lectureSeule;
  const stage = form.type === "STAGE";
  const [conventions, setConventions] = useState([]);
  const [libre, setLibre] = useState(false);

  // Liste des conventions (grille Paie). Les anciens contrats / fiches ne portent que du texte : on retrouve la convention.
  useEffect(() => {
    let vivant = true;
    api.getContratConventions(form.date_contrat || "").then((r) => {
      if (!vivant) return;
      setConventions(r.conventions || []);
      setForm((f) => {
        if (f.convention_id || !(f.convention || f.categorie)) return f;
        const o = retrouver(r.conventions || [], f.convention, f.categorie);
        if (!o.convention_id) return f;
        const conv = r.conventions.find((c) => c.id === o.convention_id);
        const cat = conv && conv.categories.find((k) => k.code === o.categorie_code);
        return { ...f, ...o, base_grille: cat ? cat.salaire_base : f.base_grille, convention: conv.libelle, categorie: cat ? cat.libelle : f.categorie };
      });
    }).catch(() => {});
    return () => { vivant = false; };
  }, []);
  const convChoisie = conventions.find((c) => c.id === form.convention_id) || null;
  const textLibre = libre || (!form.convention_id && Boolean(form.convention) && conventions.length > 0);
  const valeurConv = textLibre ? LIBRE : form.convention_id;

  // Met a jour (ou cree) la ligne « Salaire de base » avec le montant de la grille.
  const appliquerBase = (elements, montant) => {
    const i = elements.findIndex((l) => norm(l.libelle) === "salaire de base");
    const ligne = { libelle: "Salaire de base", montant: String(montant), essai: true, auto: true };
    if (i >= 0) return elements.map((l, j) => (j === i ? { ...l, montant: String(montant), auto: true } : l));
    return [ligne, ...elements];
  };
  const choisirConvention = (v) => {
    if (v === LIBRE) { setLibre(true); setForm((f) => ({ ...f, convention_id: "", categorie_code: "", base_grille: null })); return; }
    setLibre(false);
    const c = conventions.find((x) => x.id === v);
    setForm((f) => ({ ...f, convention_id: v, convention: c ? c.libelle : "", categorie_code: "", categorie: "", base_grille: null }));
  };
  const choisirCategorie = (code) => {
    const k = convChoisie && convChoisie.categories.find((x) => x.code === code);
    if (!k) { setForm((f) => ({ ...f, categorie_code: "", categorie: "", base_grille: null })); return; }
    // montant de la grille a la date du contrat (peut differer de la date du jour si la grille est versionnee)
    api.getContratComposition(convChoisie.id, code, form.date_contrat || "").then((r) => {
      const base = r.categorie ? r.categorie.salaire_base : k.salaire_base;
      setForm((f) => ({ ...f, categorie_code: code, categorie: k.libelle, base_grille: base, elements: appliquerBase(f.elements, base) }));
    }).catch(() => setForm((f) => ({ ...f, categorie_code: code, categorie: k.libelle, base_grille: k.salaire_base, elements: appliquerBase(f.elements, k.salaire_base) })));
  };
  const changerType = (type) => setForm((f) => {
    const vide = f.elements.every((l) => !(Number(l.montant) > 0) || l.auto);
    if (type === "STAGE") {
      return { ...f, type, convention: "", categorie: "", convention_id: "", categorie_code: "", base_grille: null, periode_essai_mois: "",
        elements: vide ? [{ libelle: "Gratification mensuelle", montant: "", essai: true }] : f.elements };
    }
    const etaitStage = f.type === "STAGE";
    return { ...f, type, date_fin: type === "CDD" ? f.date_fin : "",
      elements: etaitStage && vide ? [{ libelle: "Salaire de base", montant: "", essai: true }] : f.elements };
  });
  const total = form.elements.reduce((s, l) => s + (Number(l.montant) || 0), 0);
  const majLigne = (i, k, v) => setForm((f) => ({ ...f, elements: f.elements.map((l, j) => (j === i ? { ...l, [k]: v } : l)) }));
  return (
    <div style={{ display: "grid", gap: 16 }}>
      <Section titre={t("rhcSecContrat")}>
        <div style={grille}>
          <Champ label={t("rhcType")}>
            <select value={form.type} disabled={dis || typeFige} onChange={(e) => changerType(e.target.value)} style={inputStyle}>
              {TYPES.map((x) => (
                <option key={x} value={x}>{t(`rhcType_${x}`)}</option>
              ))}
            </select>
          </Champ>
          <Champ label={t("rhcDateContrat")}>
            <input type="date" value={form.date_contrat} disabled={dis} onChange={(e) => maj("date_contrat", e.target.value)} style={inputStyle} />
          </Champ>
          <Champ label={t("rhcLieuSignature")}>
            <input value={form.lieu_signature} disabled={dis} onChange={(e) => maj("lieu_signature", e.target.value)} style={inputStyle} />
          </Champ>
          <Champ label={t("rhcDateEffet")} requis>
            <input type="date" required value={form.date_effet} disabled={dis} onChange={(e) => maj("date_effet", e.target.value)} style={inputStyle} />
          </Champ>
          {(form.type === "CDD" || stage) && (
            <Champ label={stage ? t("rhcDateFinStage") : t("rhcDateFin")} requis>
              <input type="date" value={form.date_fin} disabled={dis} onChange={(e) => maj("date_fin", e.target.value)} style={inputStyle} />
            </Champ>
          )}
          {form.type === "CDD" && (
            <Champ label={t("rhcMotif")}>
              <input value={form.motif} disabled={dis} onChange={(e) => maj("motif", e.target.value)} style={inputStyle} />
            </Champ>
          )}
          {stage && (
            <>
              <Champ label={t("rhcEtablissement")}>
                <input value={form.etablissement} disabled={dis} onChange={(e) => maj("etablissement", e.target.value)} style={inputStyle} />
              </Champ>
              <Champ label={t("rhcTuteur")}>
                <input value={form.tuteur} disabled={dis} onChange={(e) => maj("tuteur", e.target.value)} style={inputStyle} />
              </Champ>
            </>
          )}
          {form.type !== "JOURNALIER" && !stage && (
            <Champ label={t("rhcEssai")}>
              <input type="number" min="0" step="1" value={form.periode_essai_mois} disabled={dis} onChange={(e) => maj("periode_essai_mois", e.target.value)} style={inputStyle} />
            </Champ>
          )}
          <Champ label={t("rhcHeures")}>
            <input type="number" min="1" step="0.5" value={form.heures_hebdo} disabled={dis} onChange={(e) => maj("heures_hebdo", e.target.value)} style={inputStyle} />
          </Champ>
          <Champ label={t("rhcPoste")} requis>
            <input value={form.poste} disabled={dis} onChange={(e) => maj("poste", e.target.value)} style={inputStyle} />
          </Champ>
          <Champ label={t("rhcLieuEmploi")}>
            <input value={form.lieu_emploi} disabled={dis} onChange={(e) => maj("lieu_emploi", e.target.value)} style={inputStyle} />
          </Champ>
          {!stage && (
            <>
              <Champ label={t("rhcConvention")}>
                <select value={valeurConv} disabled={dis} onChange={(e) => choisirConvention(e.target.value)} style={inputStyle}>
                  <option value="">{t("rhcConventionChoisir")}</option>
                  {conventions.map((c) => (
                    <option key={c.id} value={c.id}>{c.libelle}</option>
                  ))}
                  <option value={LIBRE}>{t("rhcConventionLibre")}</option>
                </select>
                {textLibre && (
                  <input value={form.convention} disabled={dis} onChange={(e) => maj("convention", e.target.value)} style={{ ...inputStyle, marginTop: 6 }} />
                )}
              </Champ>
              <Champ label={t("rhcCategorie")}>
                {textLibre ? (
                  <input value={form.categorie} disabled={dis} onChange={(e) => maj("categorie", e.target.value)} style={inputStyle} />
                ) : (
                  <select value={form.categorie_code} disabled={dis || !convChoisie} onChange={(e) => choisirCategorie(e.target.value)} style={inputStyle}>
                    <option value="">{t("rhcCategorieChoisir")}</option>
                    {convChoisie && convChoisie.categories.map((k) => (
                      <option key={k.code} value={k.code}>{k.libelle}</option>
                    ))}
                  </select>
                )}
              </Champ>
            </>
          )}
        </div>
      </Section>

      <Section titre={stage ? t("rhcStageRemuneration") : t("rhcRemuneration")} aide={stage ? t("rhcStageRemunerationAide") : form.base_grille != null || convChoisie ? t("rhcCategorieAideAuto") : t("rhcRemunerationAide")}>
        <div style={{ display: "grid", gap: 8 }}>
          {form.elements.map((l, i) => (
            <div key={i} style={{ display: "grid", gridTemplateColumns: "2fr 1fr auto auto", gap: 10, alignItems: "center" }}>
              <input placeholder={t("rhcLigneLibelle")} value={l.libelle} disabled={dis} onChange={(e) => majLigne(i, "libelle", e.target.value)} style={inputStyle} />
              <div>
                <input type="number" min="0" step="1" placeholder={t("rhcLigneMontant")} value={l.montant} disabled={dis} onChange={(e) => setForm((f) => ({ ...f, elements: f.elements.map((x, j) => (j === i ? { ...x, montant: e.target.value, auto: false } : x)) }))} style={{ ...inputStyle, textAlign: "right" }} />
                {!stage && norm(l.libelle) === "salaire de base" && form.base_grille != null && (
                  <div style={{ fontSize: 11, marginTop: 3, textAlign: "right", color: Number(l.montant) < form.base_grille ? "var(--brique)" : "var(--sub)" }}>
                    {Number(l.montant) < form.base_grille
                      ? t("rhcBaseSousGrille").replace("{montant}", fmtMontant(form.base_grille))
                      : l.auto ? `${t("rhcLigneAuto")} · ` + t("rhcBaseGrille").replace("{montant}", fmtMontant(form.base_grille)) : t("rhcBaseGrille").replace("{montant}", fmtMontant(form.base_grille))}
                  </div>
                )}
              </div>
              {stage ? <span /> : (
              <label style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 12 }}>
                <input type="checkbox" checked={l.essai} disabled={dis} onChange={(e) => majLigne(i, "essai", e.target.checked)} />
                {t("rhcLigneEssai")}
              </label>
              )}
              {!dis && (
                <button type="button" style={{ ...boutonLeger, color: "var(--brique)" }} onClick={() => setForm((f) => ({ ...f, elements: f.elements.filter((_, j) => j !== i) }))}>
                  {t("rhcRetirer")}
                </button>
              )}
            </div>
          ))}
        </div>
        {!dis && (
          <button type="button" style={{ ...boutonLeger, marginTop: 10 }} onClick={() => setForm((f) => ({ ...f, elements: [...f.elements, { libelle: "", montant: "", essai: true, auto: false }] }))}>
            + {t("rhcAjouterLigne")}
          </button>
        )}
        <div style={{ marginTop: 12, fontWeight: 700, fontSize: 14 }}>
          {t("rhcTotal")} : <span className="mono">{fmtMontant(total)} F CFA</span>
        </div>
      </Section>

      <Section titre={t("rhcNotes")}>
        <textarea rows={3} value={form.notes} disabled={dis} onChange={(e) => maj("notes", e.target.value)} style={{ ...inputStyle, resize: "vertical" }} />
      </Section>
    </div>
  );
}
