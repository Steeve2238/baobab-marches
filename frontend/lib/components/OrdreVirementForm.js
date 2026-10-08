"use client";

import { useState } from "react";
import { api } from "../api";
import { boutonLeger, inputStyle, Champ, Section, grille, fmtMontant } from "./rhUi";

export function ovFormInitial(p) {
  return {
    type_paiement: p.type_paiement || "SALAIRE",
    periode: p.periode || new Date().toISOString().slice(0, 7),
    libelle: p.libelle || "",
    date_execution: String(p.date_execution || "").slice(0, 10),
    banque_donneur: p.banque_donneur || "",
    compte_donneur: p.compte_donneur || "",
    notes: p.notes || "",
    lignes: (p.lignes_json || p.lignes || []).map((l) => ({ ...l, montant: String(l.montant ?? 0) })),
  };
}
export const ovFormVersCorps = (f) => ({
  type_paiement: f.type_paiement,
  periode: f.type_paiement === "SALAIRE" ? f.periode : null,
  libelle: f.libelle,
  date_execution: f.date_execution,
  banque_donneur: f.banque_donneur,
  compte_donneur: f.compte_donneur,
  notes: f.notes,
  lignes: f.lignes.map((l) => ({ ...l, montant: Number(l.montant) || 0 })),
});

const TYPES = ["SALAIRE", "SOLDE_TOUT_COMPTE", "AUTRE"];

export default function OrdreVirementForm({ t, form, setForm, lecture, employes, coordonnees, exclus, onCharger }) {
  const [ajout, setAjout] = useState("");
  const maj = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const majLigne = (i, k, v) => setForm((f) => ({ ...f, lignes: f.lignes.map((l, j) => (j === i ? { ...l, [k]: v } : l)) }));
  const total = form.lignes.reduce((s, l) => s + (Number(l.montant) || 0), 0);
  const cellule = { ...inputStyle, padding: "6px 8px", fontSize: 12.5 };

  async function ajouter(id) {
    const base = employes.find((x) => x.id === id);
    if (!base) return;
    let fiche = base;
    try { fiche = await api.getFicheEmploye(id); } catch (e) { /* champs bancaires a saisir a la main */ }
    setForm((f) => ({
      ...f,
      lignes: [...f.lignes, { employe_id: base.id, nom: [base.prenom, String(base.nom || "").toUpperCase()].filter(Boolean).join(" "), matricule: base.matricule || null, banque: fiche.banque || "", numero_compte: fiche.numero_compte || "", montant: "0", motif: null }],
    }));
    setAjout("");
  }

  return (
    <div style={{ display: "grid", gap: 14 }}>
      <Section titre={t("rhovTitre")}>
        <div style={grille}>
          <Champ label={t("rhovTypePaiement")}>
            <select disabled={lecture} value={form.type_paiement} onChange={(e) => maj("type_paiement", e.target.value)} style={inputStyle}>
              {TYPES.map((x) => <option key={x} value={x}>{t(`rhovType_${x}`)}</option>)}
            </select>
          </Champ>
          {form.type_paiement === "SALAIRE" && (
            <Champ label={t("rhovPeriode")}>
              <input type="month" disabled={lecture} value={form.periode} onChange={(e) => maj("periode", e.target.value)} style={inputStyle} />
            </Champ>
          )}
          <Champ label={t("rhovLibelle")} requis>
            <input disabled={lecture} value={form.libelle} onChange={(e) => maj("libelle", e.target.value)} style={inputStyle} />
          </Champ>
          <Champ label={t("rhovDateExecution")} requis>
            <input type="date" disabled={lecture} value={form.date_execution} onChange={(e) => maj("date_execution", e.target.value)} style={inputStyle} />
          </Champ>
          <Champ label={t("rhovBanqueDonneur")} requis>
            <input disabled={lecture} value={form.banque_donneur} onChange={(e) => maj("banque_donneur", e.target.value)} style={inputStyle} />
          </Champ>
          <Champ label={t("rhovCompteDonneur")} requis>
            <input disabled={lecture} value={form.compte_donneur} onChange={(e) => maj("compte_donneur", e.target.value)} style={inputStyle} />
          </Champ>
        </div>
        {coordonnees && !lecture && <p style={{ fontSize: 11.5, color: "var(--sub)", margin: "10px 0 0", whiteSpace: "pre-line" }}>{t("rhovCoordonnees")} {coordonnees}</p>}
        {!lecture && onCharger && form.type_paiement !== "AUTRE" && (
          <div style={{ marginTop: 10 }}><button type="button" style={boutonLeger} onClick={onCharger}>{t("rhovCharger")}</button></div>
        )}
      </Section>

      <Section titre={t("rhovBeneficiaires")}>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 760 }}>
            <thead>
              <tr style={{ textAlign: "left", fontSize: 11.5, color: "var(--sub)" }}>
                <th style={{ padding: "4px 6px" }}>{t("rhovColBenef")}</th>
                <th style={{ padding: "4px 6px" }}>{t("rhovColBanque")}</th>
                <th style={{ padding: "4px 6px" }}>{t("rhovColCompte")}</th>
                <th style={{ padding: "4px 6px", textAlign: "right" }}>{t("rhovColMontant")}</th>
                <th style={{ padding: "4px 6px" }}>{t("rhovColMotif")}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {form.lignes.map((l, i) => (
                <tr key={i} style={{ borderTop: "1px solid var(--line)" }}>
                  <td style={{ padding: "5px 6px", fontSize: 12.5, minWidth: 150 }}>
                    <div style={{ fontWeight: 600 }}>{l.nom}</div>
                    {l.matricule && <div style={{ fontSize: 11, color: "var(--sub)" }}>{l.matricule}</div>}
                  </td>
                  <td style={{ padding: "5px 6px" }}><input disabled={lecture} value={l.banque} onChange={(e) => majLigne(i, "banque", e.target.value)} style={cellule} /></td>
                  <td style={{ padding: "5px 6px" }}><input disabled={lecture} value={l.numero_compte} onChange={(e) => majLigne(i, "numero_compte", e.target.value)} style={{ ...cellule, minWidth: 250, fontFamily: "monospace" }} /></td>
                  <td style={{ padding: "5px 6px" }}><input type="number" min={0} disabled={lecture} value={l.montant} onChange={(e) => majLigne(i, "montant", e.target.value)} style={{ ...cellule, textAlign: "right", width: 120 }} /></td>
                  <td style={{ padding: "5px 6px" }}><input disabled={lecture} value={l.motif || ""} onChange={(e) => majLigne(i, "motif", e.target.value)} style={cellule} /></td>
                  <td style={{ padding: "5px 6px" }}>
                    {!lecture && <button type="button" style={{ ...boutonLeger, padding: "4px 10px", color: "var(--brique)" }} onClick={() => setForm((f) => ({ ...f, lignes: f.lignes.filter((_, j) => j !== i) }))}>{t("rhovRetirer")}</button>}
                  </td>
                </tr>
              ))}
              <tr style={{ borderTop: "2px solid var(--line)" }}>
                <td colSpan={3} style={{ padding: "8px 6px", fontWeight: 700, textAlign: "right" }}>{t("rhovTotal")}</td>
                <td style={{ padding: "8px 6px", fontWeight: 700, textAlign: "right" }}>{fmtMontant(total)}</td>
                <td colSpan={2} />
              </tr>
            </tbody>
          </table>
        </div>
        {!lecture && employes && (
          <div style={{ marginTop: 10 }}>
            <select value={ajout} onChange={(e) => ajouter(e.target.value)} style={{ ...inputStyle, width: "auto", minWidth: 260 }}>
              <option value="">{t("rhovChoisirEmploye")}</option>
              {employes.map((p) => <option key={p.id} value={p.id}>{p.prenom} {p.nom}{p.matricule ? ` (${p.matricule})` : ""}</option>)}
            </select>
          </div>
        )}
        {exclus && exclus.length > 0 && (
          <p style={{ fontSize: 11.5, color: "var(--sub)", margin: "10px 0 0" }}>
            {t("rhovExclus")} : {exclus.map((x) => x.nom).join(", ")}
          </p>
        )}
      </Section>

      <Section titre={t("rhovNotes")}>
        <textarea rows={2} disabled={lecture} value={form.notes} onChange={(e) => maj("notes", e.target.value)} style={{ ...inputStyle, resize: "vertical" }} />
      </Section>
    </div>
  );
}
