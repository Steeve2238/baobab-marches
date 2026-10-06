"use client";

import { useState } from "react";
import { useLangue } from "../../i18n/LanguageContext";
import { fmtXof, fmtPct, Aide, labelStyle, inputStyle, boutonPrincipalStyle, boutonSecondaireStyle, boutonDangerStyle, thStyle, tdStyle, numStyle, Pastille } from "../../financementUi";

// Blocs partages par la page « Contrôler un versement » et la fiche d'une
// simulation : saisie du montant recu (+ decompte de la banque) et affichage du
// verdict, des explications possibles et des questions a poser a la banque.

export const VERSEMENT_VIDE = { montant_recu: "", date_versement: "", date_prise_reelle: "", date_echeance_reelle: "", lignes_banque: [], notes: "" };

export function VersementFields({ valeur, onChange }) {
  const { t } = useLangue();
  const maj = (k, v) => onChange({ ...valeur, [k]: v });
  const majLigne = (i, k, v) => onChange({ ...valeur, lignes_banque: valeur.lignes_banque.map((l, j) => (j === i ? { ...l, [k]: v } : l)) });
  return (
    <div style={{ display: "grid", gap: 14 }}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 14 }}>
        <div>
          <label style={labelStyle}>{t("finCtlMontantRecu")}</label>
          <input type="number" step="any" value={valeur.montant_recu} onChange={(e) => maj("montant_recu", e.target.value)} style={inputStyle} required />
        </div>
        <div>
          <label style={labelStyle}>
            {t("finCtlDateVersement")} ({t("finOptional")})
          </label>
          <input type="date" value={valeur.date_versement} onChange={(e) => maj("date_versement", e.target.value)} style={inputStyle} />
        </div>
        <div>
          <label style={labelStyle}>
            {t("finCtlDatePriseReelle")} ({t("finOptional")})
          </label>
          <input type="date" value={valeur.date_prise_reelle} onChange={(e) => maj("date_prise_reelle", e.target.value)} style={inputStyle} />
        </div>
        <div>
          <label style={labelStyle}>
            {t("finCtlDateEcheanceReelle")} ({t("finOptional")})
          </label>
          <input type="date" value={valeur.date_echeance_reelle} onChange={(e) => maj("date_echeance_reelle", e.target.value)} style={inputStyle} />
        </div>
      </div>
      <Aide>{t("finCtlDatesAide")}</Aide>
      <div>
        <div style={{ fontSize: 12.5, fontWeight: 700, marginBottom: 2 }}>{t("finCtlLignesBanque")}</div>
        <Aide>{t("finCtlLignesBanqueAide")}</Aide>
        <div style={{ marginTop: 8, display: "grid", gap: 6 }}>
          {valeur.lignes_banque.map((l, i) => (
            <div key={i} style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <input placeholder={t("finCtlLigneLibelle")} value={l.libelle} onChange={(e) => majLigne(i, "libelle", e.target.value)} style={{ ...inputStyle, maxWidth: 320 }} />
              <input type="number" step="any" placeholder={t("finCtlLigneMontant")} value={l.montant} onChange={(e) => majLigne(i, "montant", e.target.value)} style={{ ...inputStyle, maxWidth: 200 }} />
              <button type="button" style={boutonDangerStyle} onClick={() => onChange({ ...valeur, lignes_banque: valeur.lignes_banque.filter((_, j) => j !== i) })}>
                {t("finFraisRetirer")}
              </button>
            </div>
          ))}
        </div>
        <button type="button" style={{ ...boutonSecondaireStyle, marginTop: 8 }} onClick={() => onChange({ ...valeur, lignes_banque: [...valeur.lignes_banque, { libelle: "", montant: "" }] })}>
          {t("finCtlLigneAjouter")}
        </button>
      </div>
      <div>
        <label style={labelStyle}>
          {t("finCtlNotes")} ({t("finOptional")})
        </label>
        <textarea value={valeur.notes} onChange={(e) => maj("notes", e.target.value)} rows={2} style={{ ...inputStyle, resize: "vertical" }} />
      </div>
    </div>
  );
}

export function versementPayload(v) {
  return {
    montant_recu: Number(v.montant_recu),
    date_versement: v.date_versement || null,
    date_prise_reelle: v.date_prise_reelle || null,
    date_echeance_reelle: v.date_echeance_reelle || null,
    lignes_banque: v.lignes_banque.filter((l) => l.libelle && l.montant !== "").map((l) => ({ libelle: l.libelle, montant: Number(l.montant) })),
    notes: v.notes || null,
  };
}

const COULEUR_VERDICT = { CONFORME: "var(--vert)", MOINS_QUE_PREVU: "var(--brique)", PLUS_QUE_PREVU: "var(--ocre)" };
const FOND_VERDICT = { CONFORME: "var(--vert-bg)", MOINS_QUE_PREVU: "var(--brique-bg)", PLUS_QUE_PREVU: "var(--ocre-bg)" };

export function ControleResultat({ res }) {
  const { t, dict } = useLangue();
  const locale = dict.dateLocale || "fr-FR";
  const [copie, setCopie] = useState(false);
  if (!res) return null;
  const imp = res.implicites || {};
  const hyp = res.hypotheses || {};
  const questions = res.questions || [];
  const lignes = res.comparaison_lignes || [];

  function copierQuestions() {
    const texte = questions.map((q, i) => `${i + 1}. ${q.question}`).join("\n");
    if (navigator.clipboard) navigator.clipboard.writeText(texte).then(() => setCopie(true)).catch(() => {});
  }

  return (
    <div style={{ display: "grid", gap: 14 }}>
      <div className="card" style={{ borderLeft: `4px solid ${COULEUR_VERDICT[res.verdict]}`, background: FOND_VERDICT[res.verdict] }}>
        <div style={{ fontSize: 15, fontWeight: 700, color: COULEUR_VERDICT[res.verdict], marginBottom: 6 }}>{t(`finCtlVerdict_${res.verdict}`)}</div>
        <div style={{ display: "flex", gap: "10px 28px", flexWrap: "wrap", marginBottom: 8 }}>
          <div>
            <div style={{ fontSize: 11, color: "var(--sub)" }}>{t("finCtlRecu")}</div>
            <div className="mono" style={{ fontSize: 17, fontWeight: 700 }}>{fmtXof(res.montant_recu, locale)} {t("finXof")}</div>
          </div>
          <div>
            <div style={{ fontSize: 11, color: "var(--sub)" }}>{t("finCtlAttendu")}</div>
            <div className="mono" style={{ fontSize: 17, fontWeight: 700 }}>{fmtXof(res.montant_attendu, locale)} {t("finXof")}</div>
          </div>
          <div>
            <div style={{ fontSize: 11, color: "var(--sub)" }}>{t("finCtlEcart")}</div>
            <div className="mono" style={{ fontSize: 17, fontWeight: 700, color: COULEUR_VERDICT[res.verdict] }}>
              {res.ecart > 0 ? "+" : ""}
              {fmtXof(res.ecart, locale)} {t("finXof")} ({fmtPct(res.ecart_pct, locale, 1)} %)
            </div>
          </div>
        </div>
        <p style={{ fontSize: 13, lineHeight: 1.55 }}>{res.synthese}</p>
        <p style={{ fontSize: 11, color: "var(--sub)", marginTop: 4 }}>
          {t("finCtlTolerance")} : {fmtXof(res.tolerance, locale)} {t("finXof")}
        </p>
      </div>

      {res.verdict !== "CONFORME" && (
        <div className="card">
          <h3 style={{ fontSize: 14, color: "var(--petrol)", marginBottom: 8 }}>{t("finCtlHypotheses")}</h3>
          {hyp.explicatives && hyp.explicatives.length > 0 ? (
            <ul style={{ paddingLeft: 18, fontSize: 12.8, lineHeight: 1.6 }}>
              {hyp.explicatives.map((h, i) => (
                <li key={i}>
                  {h.libelle} <span style={{ color: "var(--sub)" }}>({fmtXof(h.net_calcule, locale)} {t("finXof")})</span>
                </li>
              ))}
            </ul>
          ) : (
            <>
              <p style={{ fontSize: 12.8, marginBottom: 6 }}>{t("finCtlHypothesesAucune")}</p>
              {hyp.meilleure_approximation && (
                <p style={{ fontSize: 12.5, color: "var(--sub)" }}>
                  {t("finCtlHypotheseProche")} : {hyp.meilleure_approximation.libelle} — {fmtXof(hyp.meilleure_approximation.net_calcule, locale)} {t("finXof")} ({t("finCtlResteInexplique")} : {fmtXof(Math.abs(hyp.meilleure_approximation.ecart_restant), locale)} {t("finXof")})
                </p>
              )}
            </>
          )}
          {(imp.duree_jours || imp.taux_avance_pct) && (
            <div style={{ marginTop: 10 }}>
              <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 3 }}>{t("finCtlImplicites")}</div>
              <ul style={{ paddingLeft: 18, fontSize: 12.8, lineHeight: 1.6 }}>
                {imp.duree_jours && <li>{t("finCtlImpliciteDuree").replace("{n}", imp.duree_jours).replace("{d}", res.duree_utilisee)}</li>}
                {imp.taux_avance_pct !== null && imp.taux_avance_pct !== undefined && <li>{t("finCtlImpliciteAvance").replace("{n}", fmtPct(imp.taux_avance_pct, locale, 1)).replace("{a}", fmtPct(res.releve_simule.taux_avance_pct, locale, 1))}</li>}
              </ul>
            </div>
          )}
        </div>
      )}

      {lignes.length > 0 && (
        <div className="card" style={{ overflowX: "auto" }}>
          <h3 style={{ fontSize: 14, color: "var(--petrol)", marginBottom: 8 }}>{t("finCtlComparaison")}</h3>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                <th style={thStyle}>{t("finCtlColLigne")}</th>
                <th style={{ ...thStyle, textAlign: "right" }}>{t("finCtlColProposition")}</th>
                <th style={{ ...thStyle, textAlign: "right" }}>{t("finCtlColBanque")}</th>
                <th style={{ ...thStyle, textAlign: "right" }}>{t("finCtlColEcart")}</th>
                <th style={thStyle}>{t("finCtlColEtat")}</th>
              </tr>
            </thead>
            <tbody>
              {lignes.map((l, i) => (
                <tr key={i}>
                  <td style={tdStyle}>{l.libelle_simule || l.libelle_banque}</td>
                  <td style={{ ...tdStyle, ...numStyle }}>{l.montant_simule !== undefined ? fmtXof(l.montant_simule, locale) : "—"}</td>
                  <td style={{ ...tdStyle, ...numStyle }}>{l.montant_banque !== undefined ? fmtXof(l.montant_banque, locale) : "—"}</td>
                  <td style={{ ...tdStyle, ...numStyle }}>{fmtXof(l.ecart, locale)}</td>
                  <td style={tdStyle}>
                    <Pastille couleur={l.statut === "CONFORME" ? "var(--vert)" : l.statut === "ECART" ? "var(--brique)" : "var(--ocre)"}>{t(`finCtlLigne_${l.statut}`)}</Pastille>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {questions.length > 0 && (
        <div className="card" style={{ borderLeft: "4px solid var(--petrol-3)" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 4 }}>
            <h3 style={{ fontSize: 14, color: "var(--petrol)" }}>{t("finCtlQuestions")}</h3>
            <button type="button" onClick={copierQuestions} style={boutonSecondaireStyle}>
              {copie ? t("finCopied") : t("finCtlCopierQuestions")}
            </button>
          </div>
          <Aide>{t("finCtlQuestionsAide")}</Aide>
          <ol style={{ paddingLeft: 20, marginTop: 10, display: "grid", gap: 10 }}>
            {questions.map((q, i) => (
              <li key={i} style={{ fontSize: 13, lineHeight: 1.5 }}>
                <div style={{ fontWeight: 600 }}>{q.question}</div>
                {q.contexte && <div style={{ fontSize: 11.8, color: "var(--sub)", marginTop: 2 }}>{q.contexte}</div>}
              </li>
            ))}
          </ol>
        </div>
      )}
    </div>
  );
}

export { boutonPrincipalStyle };
