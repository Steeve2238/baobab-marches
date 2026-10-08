"use client";

import { Champ, Section, grille, inputStyle, boutonLeger, fmtMontant } from "./rhUi";

const TYPES = ["CDI", "CDD", "JOURNALIER"];

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
    motif: f.motif || "",
    notes: f.notes || "",
    elements: (f.elements_json || f.elements || []).map((l) => ({ libelle: l.libelle, montant: String(l.montant), essai: l.essai !== false })),
  };
}

export function contratFormVersCorps(form) {
  return {
    ...form,
    periode_essai_mois: form.periode_essai_mois === "" ? null : Number(form.periode_essai_mois),
    heures_hebdo: Number(form.heures_hebdo) || 40,
    date_fin: form.type === "CDD" ? form.date_fin || null : null,
    elements: form.elements.filter((l) => l.libelle.trim()).map((l) => ({ libelle: l.libelle, montant: Number(l.montant) || 0, essai: l.essai })),
  };
}

export default function ContratForm({ form, setForm, t, lectureSeule, typeFige }) {
  const maj = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const dis = !!lectureSeule;
  const total = form.elements.reduce((s, l) => s + (Number(l.montant) || 0), 0);
  const majLigne = (i, k, v) => setForm((f) => ({ ...f, elements: f.elements.map((l, j) => (j === i ? { ...l, [k]: v } : l)) }));
  return (
    <div style={{ display: "grid", gap: 16 }}>
      <Section titre={t("rhcSecContrat")}>
        <div style={grille}>
          <Champ label={t("rhcType")}>
            <select value={form.type} disabled={dis || typeFige} onChange={(e) => maj("type", e.target.value)} style={inputStyle}>
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
          {form.type === "CDD" && (
            <>
              <Champ label={t("rhcDateFin")} requis>
                <input type="date" value={form.date_fin} disabled={dis} onChange={(e) => maj("date_fin", e.target.value)} style={inputStyle} />
              </Champ>
              <Champ label={t("rhcMotif")}>
                <input value={form.motif} disabled={dis} onChange={(e) => maj("motif", e.target.value)} style={inputStyle} />
              </Champ>
            </>
          )}
          {form.type !== "JOURNALIER" && (
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
          <Champ label={t("rhcConvention")}>
            <input value={form.convention} disabled={dis} onChange={(e) => maj("convention", e.target.value)} style={inputStyle} />
          </Champ>
          <Champ label={t("rhcCategorie")}>
            <input value={form.categorie} disabled={dis} onChange={(e) => maj("categorie", e.target.value)} style={inputStyle} />
          </Champ>
        </div>
      </Section>

      <Section titre={t("rhcRemuneration")} aide={t("rhcRemunerationAide")}>
        <div style={{ display: "grid", gap: 8 }}>
          {form.elements.map((l, i) => (
            <div key={i} style={{ display: "grid", gridTemplateColumns: "2fr 1fr auto auto", gap: 10, alignItems: "center" }}>
              <input placeholder={t("rhcLigneLibelle")} value={l.libelle} disabled={dis} onChange={(e) => majLigne(i, "libelle", e.target.value)} style={inputStyle} />
              <input type="number" min="0" step="1" placeholder={t("rhcLigneMontant")} value={l.montant} disabled={dis} onChange={(e) => majLigne(i, "montant", e.target.value)} style={{ ...inputStyle, textAlign: "right" }} />
              <label style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 12 }}>
                <input type="checkbox" checked={l.essai} disabled={dis} onChange={(e) => majLigne(i, "essai", e.target.checked)} />
                {t("rhcLigneEssai")}
              </label>
              {!dis && (
                <button type="button" style={{ ...boutonLeger, color: "var(--brique)" }} onClick={() => setForm((f) => ({ ...f, elements: f.elements.filter((_, j) => j !== i) }))}>
                  {t("rhcRetirer")}
                </button>
              )}
            </div>
          ))}
        </div>
        {!dis && (
          <button type="button" style={{ ...boutonLeger, marginTop: 10 }} onClick={() => setForm((f) => ({ ...f, elements: [...f.elements, { libelle: "", montant: "", essai: true }] }))}>
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
