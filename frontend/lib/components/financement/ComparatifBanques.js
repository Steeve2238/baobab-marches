"use client";

import { useState } from "react";
import { useLangue } from "../../i18n/LanguageContext";
import { fmtXof, fmtPct, Pastille, boutonPrincipalStyle, boutonSecondaireStyle, thStyle, tdStyle, numStyle } from "../../financementUi";

// Comparatif des banques pour un meme besoin : commentaire en langage simple,
// puis une carte par banque (chiffres cles, points bloquants, detail ligne a ligne).

export function CommentaireBloc({ commentaire }) {
  const { t } = useLangue();
  if (!commentaire || !commentaire.titre) return null;
  return (
    <div className="card" style={{ borderLeft: "4px solid var(--vert)", marginBottom: 14 }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: "var(--sub)", textTransform: "uppercase", letterSpacing: 0.4 }}>{t("finComTitre")}</div>
      <h3 style={{ fontSize: 16, color: "var(--petrol)", margin: "4px 0 6px" }}>{commentaire.titre}</h3>
      <p style={{ fontSize: 13.3, lineHeight: 1.55 }}>{commentaire.resume}</p>
      {commentaire.points && commentaire.points.length > 0 && (
        <div style={{ marginTop: 10 }}>
          <div style={{ fontSize: 11.5, fontWeight: 700, marginBottom: 4 }}>{t("finComPoints")}</div>
          <ul style={{ paddingLeft: 18, fontSize: 12.8, lineHeight: 1.55 }}>
            {commentaire.points.map((p, i) => (
              <li key={i}>{p}</li>
            ))}
          </ul>
        </div>
      )}
      {commentaire.vigilance && commentaire.vigilance.length > 0 && (
        <div style={{ marginTop: 10, background: "var(--ocre-bg)", borderRadius: 8, padding: "8px 12px" }}>
          <div style={{ fontSize: 11.5, fontWeight: 700, color: "var(--ocre)", marginBottom: 4 }}>{t("finComVigilance")}</div>
          <ul style={{ paddingLeft: 18, fontSize: 12.8, lineHeight: 1.55 }}>
            {commentaire.vigilance.map((p, i) => (
              <li key={i}>{p}</li>
            ))}
          </ul>
        </div>
      )}
      {commentaire.questions_avant_signature && commentaire.questions_avant_signature.length > 0 && (
        <div style={{ marginTop: 10 }}>
          <div style={{ fontSize: 11.5, fontWeight: 700, marginBottom: 4 }}>{t("finComQuestions")}</div>
          <ul style={{ paddingLeft: 18, fontSize: 12.8, lineHeight: 1.55 }}>
            {commentaire.questions_avant_signature.map((p, i) => (
              <li key={i}>{p}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function Chiffre({ label, valeur, sous, fort, couleur }) {
  return (
    <div style={{ minWidth: 130 }}>
      <div style={{ fontSize: 11, color: "var(--sub)" }}>{label}</div>
      <div className="mono" style={{ fontSize: fort ? 18 : 14, fontWeight: fort ? 700 : 600, color: couleur || "var(--ink)" }}>{valeur}</div>
      {sous && <div style={{ fontSize: 11, color: "var(--sub)" }}>{sous}</div>}
    </div>
  );
}

export function ReleveCarte({ releve, classement, onChoisir, choisi, choixEnCours }) {
  const { t } = useLangue();
  const [detail, setDetail] = useState(false);
  const tt = releve.totaux;
  const garantie = releve.famille === "GARANTIE";
  const recommandee = classement && classement.recommandee_id === releve.condition_id;
  const moinsChere = classement && classement.moins_chere_id === releve.condition_id;
  const tresorerie = classement && classement.plus_tresorerie_id === releve.condition_id;
  const flux = Number(tt.flux_mise_en_place);
  const lignesActives = (releve.lignes || []).filter((l) => l.montant_ht !== 0 || l.incomplete);
  const lignesVides = lignesActives.filter((l) => l.incomplete);
  const avertissements = (releve.avertissements || []).filter((a) => a.code !== "LIGNE_INCOMPLETE");

  return (
    <div className="card" style={{ borderColor: choisi ? "var(--vert)" : recommandee ? "var(--petrol-3)" : undefined, borderWidth: choisi || recommandee ? 2 : 1, opacity: releve.eligible ? 1 : 0.9 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 8, marginBottom: 10 }}>
        <div>
          <div style={{ fontWeight: 700, fontSize: 15 }}>{releve.partenaire_nom}</div>
          <div style={{ fontSize: 11.5, color: "var(--sub)" }}>{releve.libelle}</div>
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 5, justifyContent: "flex-end" }}>
          {recommandee && <Pastille couleur="var(--vert)" fond="var(--vert-bg)">{t("finBadgeRecommandee")}</Pastille>}
          {moinsChere && !recommandee && <Pastille couleur="var(--vert)">{t("finBadgeMoinsChere")}</Pastille>}
          {tresorerie && <Pastille couleur="var(--petrol-3)">{t("finBadgeTresorerie")}</Pastille>}
          {!releve.eligible && <Pastille couleur="var(--brique)" fond="var(--brique-bg)">{t("finBadgeNonEligible")}</Pastille>}
          {releve.statut_condition === "EN_NEGOCIATION" && <Pastille couleur="var(--ocre)">{t("finBadgeNegociation")}</Pastille>}
          {choisi && <Pastille couleur="var(--vert)" fond="var(--vert-bg)">{t("finStatutSim_RETENUE")}</Pastille>}
        </div>
      </div>

      {!releve.eligible && (
        <div style={{ background: "var(--brique-bg)", borderRadius: 8, padding: "8px 12px", marginBottom: 10 }}>
          <div style={{ fontSize: 11.5, fontWeight: 700, color: "var(--brique)", marginBottom: 3 }}>{t("finCarteBloquants")}</div>
          <ul style={{ paddingLeft: 18, fontSize: 12.5, lineHeight: 1.5 }}>
            {releve.bloquants.map((b, i) => (
              <li key={i}>{b.texte}</li>
            ))}
          </ul>
        </div>
      )}

      <div style={{ display: "flex", flexWrap: "wrap", gap: "12px 26px", marginBottom: 10 }}>
        {garantie ? (
          <Chiffre label={t("finCarteRecuGarantie")} valeur={`${fmtXof(Math.abs(flux))} ${t("finXof")}`} fort couleur="var(--brique)" />
        ) : (
          <Chiffre label={t("finCarteRecu")} valeur={`${fmtXof(flux)} ${t("finXof")}`} fort couleur={releve.eligible ? "var(--vert)" : "var(--sub)"} sous={releve.avance_montant ? `${t("finCarteAvance")} ${fmtPct(releve.taux_avance_pct, undefined, 2)} %` : null} />
        )}
        <Chiffre label={t("finCarteCout")} valeur={`${fmtXof(tt.cout_ttc)} ${t("finXof")}`} fort sous={`${fmtPct(tt.part_du_montant_pct)} % — ${t("finCartePart")}`} />
        {Number(tt.frais_uniques_ttc) > 0 && <Chiffre label={t("finCarteFraisUniques")} valeur={`${fmtXof(tt.frais_uniques_ttc)} ${t("finXof")}`} sous={`${t("finCarteCoutCourant")} : ${fmtXof(tt.cout_courant_ttc)} ${t("finXof")}`} />}
        {Number(tt.a_payer_echeance) > 0 && <Chiffre label={t("finCarteEcheance")} valeur={`${fmtXof(tt.a_payer_echeance)} ${t("finXof")}`} />}
        {Number(tt.retenue_totale) > 0 && <Chiffre label={t("finCarteRestitue")} valeur={`${fmtXof(tt.retenue_totale)} ${t("finXof")}`} />}
        {tt.net_final !== null && tt.net_final !== undefined && <Chiffre label={t("finCarteNetFinal")} valeur={`${fmtXof(tt.net_final)} ${t("finXof")}`} />}
        {tt.taux_effectif_annuel_pct !== null && tt.taux_effectif_annuel_pct !== undefined && <Chiffre label={t("finCarteTaux")} valeur={`${fmtPct(tt.taux_effectif_annuel_pct, undefined, 1)} %`} />}
      </div>

      {(avertissements.length > 0 || lignesVides.length > 0) && (
        <div style={{ background: "var(--ocre-bg)", borderRadius: 8, padding: "8px 12px", marginBottom: 10 }}>
          <div style={{ fontSize: 11.5, fontWeight: 700, color: "var(--ocre)", marginBottom: 3 }}>{t("finCarteAttention")}</div>
          <ul style={{ paddingLeft: 18, fontSize: 12.3, lineHeight: 1.5 }}>
            {avertissements.map((a, i) => (
              <li key={i}>{a.texte}</li>
            ))}
            {lignesVides.length > 0 && (
              <li>
                {t("finCarteLignesVides")} : {lignesVides.map((l) => l.libelle).join(", ")}.
              </li>
            )}
          </ul>
        </div>
      )}

      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
        <button type="button" onClick={() => setDetail((v) => !v)} style={boutonSecondaireStyle}>
          {detail ? t("finCarteMasquer") : t("finCarteDetail")}
        </button>
        {onChoisir && releve.eligible && !choisi && (
          <button type="button" disabled={choixEnCours} onClick={() => onChoisir(releve)} style={boutonPrincipalStyle}>
            {t("finSimChoisir")}
          </button>
        )}
      </div>

      {detail && (
        <div style={{ marginTop: 12 }}>
          <div style={{ fontSize: 11.5, color: "var(--sub)", marginBottom: 6 }}>
            {t("finCarteDuree")} : {releve.duree_jours} {t("finDays")}
            {releve.duree_facturee && releve.duree_facturee !== releve.duree_jours ? ` — ${t("finCarteDureeFacturee")} : ${releve.duree_facturee}` : ""}
            {releve.recours ? ` — ${t("finCarteRecours")} : ${t(`finRecours_${releve.recours}`)}` : ""}
            {releve.domiciliation_exigee ? ` — ${t("finCarteDomiciliation")}` : ""}
          </div>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr>
                  <th style={thStyle}>{t("finCarteLigne")}</th>
                  <th style={thStyle}>{t("finCarteFormule")}</th>
                  <th style={{ ...thStyle, textAlign: "right" }}>{t("finCarteHt")}</th>
                  <th style={{ ...thStyle, textAlign: "right" }}>{releve.taxe_libelle}</th>
                  <th style={{ ...thStyle, textAlign: "right" }}>{t("finCarteTotal")}</th>
                  <th style={thStyle}>{t("finCarteQuand")}</th>
                </tr>
              </thead>
              <tbody>
                {lignesActives.map((l, i) => (
                  <tr key={i}>
                    <td style={tdStyle}>
                      {l.libelle}
                      {l.nature === "RETENUE" && <span style={{ color: "var(--sub)" }}> ({t("finCarteBloquee")})</span>}
                      {l.frequence === "UNIQUE_CONTRAT" && <span style={{ color: "var(--sub)" }}> ({t("finCarteUnique")})</span>}
                      {l.incomplete && <span style={{ color: "var(--ocre)", fontWeight: 700 }}> — {t("finCarteIncomplete")}</span>}
                    </td>
                    <td style={{ ...tdStyle, color: "var(--sub)", fontSize: 11.5 }}>{l.formule || ""}</td>
                    <td style={{ ...tdStyle, ...numStyle }}>{fmtXof(l.montant_ht)}</td>
                    <td style={{ ...tdStyle, ...numStyle }}>{l.taxe ? fmtXof(l.taxe) : ""}</td>
                    <td style={{ ...tdStyle, ...numStyle, fontWeight: 600 }}>{fmtXof(l.total)}</td>
                    <td style={{ ...tdStyle, fontSize: 11.5 }}>{l.nature === "RETENUE" ? t("finCarteBloquee") : l.prelevement === "A_L_ECHEANCE" ? t("finCarteEcheanceCourt") : t("finCarteMiseEnPlace")}</td>
                  </tr>
                ))}
                <tr>
                  <td style={{ ...tdStyle, fontWeight: 700 }} colSpan={2}>{t("finCarteTotalCouts")}</td>
                  <td style={{ ...tdStyle, ...numStyle, fontWeight: 700 }}>{fmtXof(tt.cout_ht)}</td>
                  <td style={{ ...tdStyle, ...numStyle, fontWeight: 700 }}>{fmtXof(tt.taxes)}</td>
                  <td style={{ ...tdStyle, ...numStyle, fontWeight: 700 }}>{fmtXof(tt.cout_ttc)}</td>
                  <td style={tdStyle}></td>
                </tr>
              </tbody>
            </table>
          </div>
          {releve.variante_retenue_en_plus && (
            <p style={{ fontSize: 12, color: "var(--ocre)", marginTop: 8 }}>
              {t("finCarteRetenueAlt")} {fmtXof(releve.variante_retenue_en_plus.flux_mise_en_place)} {t("finXof")}.
            </p>
          )}
          {releve.justificatifs && (
            <p style={{ fontSize: 12, marginTop: 8 }}>
              <b>{t("finCarteJustificatifs")} : </b>
              {releve.justificatifs}
            </p>
          )}
          {releve.conditions_particulieres && (
            <p style={{ fontSize: 12, marginTop: 6 }}>
              <b>{t("finCarteParticulieres")} : </b>
              {releve.conditions_particulieres}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

/** Liste des cartes, dans l'ordre du classement (les plus avantageuses d'abord). */
export default function ComparatifBanques({ releves, classement, choisiId, onChoisir, choixEnCours }) {
  return (
    <div style={{ display: "grid", gap: 12 }}>
      {(releves || []).map((r) => (
        <ReleveCarte key={r.condition_id} releve={r} classement={classement} onChoisir={onChoisir} choisi={choisiId === r.condition_id} choixEnCours={choixEnCours} />
      ))}
    </div>
  );
}
