"use client";

import { boutonLeger, inputStyle, Champ, Section, grille, fmtMontant } from "./rhUi";

/** Valeurs initiales du formulaire a partir du prefill ou d'un courrier existant. */
export function courrierFormInitial(p) {
  return {
    date_courrier: String(p.date_courrier || "").slice(0, 10),
    lieu: p.lieu || "",
    champs: Object.fromEntries(Object.entries(p.champs || {}).map(([k, v]) => [k, v == null ? "" : /^\d{4}-\d{2}-\d{2}T/.test(String(v)) ? String(v).slice(0, 10) : String(v)])),
    lignes: (p.lignes || []).map((l) => ({ libelle: l.libelle, montant: String(l.montant ?? "") })),
    notes: p.notes || "",
  };
}

export function courrierFormVersCorps(f) {
  return {
    date_courrier: f.date_courrier || undefined,
    lieu: f.lieu,
    champs: f.champs,
    lignes: f.lignes.filter((l) => l.libelle.trim() || l.montant !== "").map((l) => ({ libelle: l.libelle, montant: Number(l.montant) || 0 })),
    notes: f.notes,
  };
}

const typeInput = { date: "date", int: "number", time: "time", text: "text" };

export default function CourrierForm({ t, def, form, setForm, lecture }) {
  const maj = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const majChamp = (k, v) => setForm((f) => ({ ...f, champs: { ...f.champs, [k]: v } }));
  const majLigne = (i, k, v) => setForm((f) => ({ ...f, lignes: f.lignes.map((l, j) => (j === i ? { ...l, [k]: v } : l)) }));
  const total = form.lignes.reduce((s, l) => s + (Number(l.montant) || 0), 0);

  return (
    <div style={{ display: "grid", gap: 14 }}>
      <Section titre={t(`rhkType_${def.type}`)}>
        <div style={grille}>
          <Champ label={t("rhkDateCourrier")}>
            <input type="date" disabled={lecture} value={form.date_courrier} onChange={(e) => maj("date_courrier", e.target.value)} style={inputStyle} />
          </Champ>
          <Champ label={t("rhkLieu")}>
            <input disabled={lecture} value={form.lieu} onChange={(e) => maj("lieu", e.target.value)} style={inputStyle} />
          </Champ>
          {def.champs.map((c) => (
            <Champ key={c.name} label={t(`rhkChamp_${c.name}`)} requis={c.requis} large={c.type === "textarea"}>
              {c.type === "textarea" ? (
                <textarea rows={c.name === "texte" ? 8 : 4} disabled={lecture} value={form.champs[c.name] || ""} onChange={(e) => majChamp(c.name, e.target.value)} style={{ ...inputStyle, resize: "vertical", lineHeight: 1.45 }} />
              ) : (
                <input type={typeInput[c.type] || "text"} min={c.type === "int" ? 0 : undefined} disabled={lecture} value={form.champs[c.name] || ""} onChange={(e) => majChamp(c.name, e.target.value)} style={inputStyle} />
              )}
            </Champ>
          ))}
        </div>
      </Section>

      {def.lignes && (
        <Section titre={t("rhkLignes")} aide={t("rhkLignesAide")}>
          <div style={{ display: "grid", gap: 8 }}>
            {form.lignes.map((l, i) => (
              <div key={i} style={{ display: "grid", gridTemplateColumns: "1fr 170px auto", gap: 8, alignItems: "center" }}>
                <input placeholder={t("rhkLigneLibelle")} disabled={lecture} value={l.libelle} onChange={(e) => majLigne(i, "libelle", e.target.value)} style={inputStyle} />
                <input type="number" min={0} placeholder={t("rhkLigneMontant")} disabled={lecture} value={l.montant} onChange={(e) => majLigne(i, "montant", e.target.value)} style={{ ...inputStyle, textAlign: "right" }} />
                {!lecture && <button type="button" style={{ ...boutonLeger, color: "var(--brique)" }} onClick={() => setForm((f) => ({ ...f, lignes: f.lignes.filter((_, j) => j !== i) }))}>{t("rhkRetirer")}</button>}
              </div>
            ))}
            {!lecture && (
              <div><button type="button" style={boutonLeger} onClick={() => setForm((f) => ({ ...f, lignes: [...f.lignes, { libelle: "", montant: "" }] }))}>{t("rhkAjouterLigne")}</button></div>
            )}
            <div style={{ textAlign: "right", fontWeight: 700, fontSize: 13 }}>{t("rhkTotal")} : {fmtMontant(total)} F CFA</div>
          </div>
        </Section>
      )}

      <Section titre={t("rhkNotes")}>
        <textarea rows={2} disabled={lecture} value={form.notes} onChange={(e) => maj("notes", e.target.value)} style={{ ...inputStyle, resize: "vertical" }} />
      </Section>
    </div>
  );
}
