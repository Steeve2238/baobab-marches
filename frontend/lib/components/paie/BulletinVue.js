"use client";

import { cellule, enteteCellule, droite, fmt, fmtDec, Pastille } from "../paieUi";

/** Bulletin calcule (simulateur, brouillon de la paie du mois) : lignes, retenues, net a payer, charges patronales. */
export default function BulletinVue({ b, t }) {
  const ligne = (libelle, valeur, fort, detail) => (
    <tr>
      <td style={{ ...cellule, fontWeight: fort ? 700 : 400 }}>{libelle}{detail ? <span style={{ color: "var(--sub)", fontSize: 11.5 }}> {detail}</span> : null}</td>
      <td style={{ ...cellule, ...droite, fontWeight: fort ? 700 : 400 }}>{valeur}</td>
    </tr>
  );
  const detailLigne = (l) => {
    if (l.code === "SALAIRE_BASE" || l.code === "SURSALAIRE") return `(${fmt(l.base)} × ${fmtDec(l.quantite * 30, 1)}/30)`;
    if (l.taux != null && l.base != null) return l.origine === "VARIABLE" ? `(${fmtDec(l.base, 2)} F/h × ${fmtDec(1 + l.taux / 100, 2)} × ${fmtDec(l.quantite)} h)` : `(${fmtDec(l.taux)} %)`;
    if (l.quantite != null && l.base != null) return `(${fmt(l.base)} × ${fmtDec(l.quantite)})`;
    return "";
  };
  const retSal = b.retenues;
  return (
    <div style={{ display: "grid", gap: 12 }}>
      {b.avertissements.length > 0 && (
        <div className="card" style={{ borderColor: "#B26A00" }}>
          {b.avertissements.map((a, i) => <div key={i} style={{ fontSize: 12.5, marginBottom: 4 }}><Pastille ton={a.niveau === "BLOQUANT" ? "erreur" : a.niveau === "INFO" ? "neutre" : "alerte"}>{t(`paieAvert_${a.niveau}`)}</Pastille> {t(`paieAvert_${a.code}`)}{a.valeur ? ` (${a.valeur})` : ""}</div>)}
        </div>
      )}
      <div className="card">
        <div style={{ display: "flex", gap: 18, flexWrap: "wrap", fontSize: 12.5, marginBottom: 10 }}>
          <span>{t("paieJoursMois")} : <b>{b.jours.mois}</b></span>
          <span>{t("paieJoursPresence")} : <b>{fmtDec(b.jours.presence, 1)}</b></span>
          <span>{t("paieJoursAbsences")} : <b>{fmtDec(b.jours.absences_retenues, 1)}</b></span>
          <span>{t("paieJoursPayes")} : <b>{fmtDec(b.jours.payes, 1)}</b></span>
          <span>{t("paieAnciennete")} : <b>{b.anciennete.annees} {t("paieAns")} ({fmtDec(b.anciennete.taux)} %)</b></span>
          {b.categorie && <span>{t("paieCategorie")} : <b>{b.categorie.libelle}</b></span>}
          <span>{b.cadre ? <Pastille ton="neutre">{t("paieCadre")}</Pastille> : null}</span>
        </div>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <tbody>
            <tr><td colSpan={2} style={{ ...enteteCellule, paddingTop: 10 }}>{t("paieBullSalaire")}</td></tr>
            {b.lignes.filter((l) => l.section === "SALAIRE").map((l, i) => ligne(l.libelle, fmt(l.montant), false, detailLigne(l)))}
            {ligne(t("paieBullTotalSalaire"), fmt(b.totaux.elements_salaire), true)}
            {b.lignes.some((l) => l.section === "INDEMNITES") && <tr><td colSpan={2} style={{ ...enteteCellule, paddingTop: 12 }}>{t("paieBullIndemnites")}</td></tr>}
            {b.lignes.filter((l) => l.section === "INDEMNITES").map((l, i) => ligne(l.libelle, fmt(l.montant), false, detailLigne(l) + (l.imposable_montant < l.montant ? ` — ${t("paieNonImposableDe")} ${fmt(l.montant - l.imposable_montant)}` : "")))}
            {ligne(t("paieBullBrut"), fmt(b.totaux.brut), true)}
            {ligne(t("paieBullImposable"), fmt(b.totaux.imposable), false)}
            <tr><td colSpan={2} style={{ ...enteteCellule, paddingTop: 12 }}>{t("paieBullRetenues")}</td></tr>
            {retSal.map((r) => ligne(r.libelle, fmt(r.montant), false, r.taux != null ? `(${fmtDec(r.taux, 3)} % × ${fmt(r.base)})` : r.parts != null ? `(${fmtDec(r.parts, 1)} ${t("paieParts")})` : ""))}
            {b.retenues_saisies.map((r) => ligne(r.libelle, fmt(r.montant), false))}
            {ligne(t("paieBullTotalRetenues"), fmt(b.total_retenues), true)}
            {b.remboursements.length > 0 && <tr><td colSpan={2} style={{ ...enteteCellule, paddingTop: 12 }}>{t("paieBullRemboursements")}</td></tr>}
            {b.remboursements.map((r) => ligne(r.libelle, fmt(r.montant), false))}
          </tbody>
        </table>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginTop: 14, padding: "12px 14px", background: "var(--petrol)", color: "#fff", borderRadius: 8 }}>
          <span style={{ fontWeight: 700 }}>{t("paieBullNet")}</span>
          <span style={{ fontSize: 22, fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>{fmt(b.net_a_payer)} F</span>
        </div>
        {b.net_a_payer !== b.net_avant_arrondi && <p style={{ fontSize: 11.5, color: "var(--sub)", margin: "6px 0 0" }}>{t("paieBullArrondi")} : {fmt(b.net_avant_arrondi)} → {fmt(b.net_a_payer)}</p>}
      </div>
      <div className="card">
        <h3 style={{ fontSize: 13, margin: "0 0 8px" }}>{t("paieBullPatronales")}</h3>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <tbody>
            {b.charges_patronales.map((c) => ligne(c.libelle, fmt(c.montant), false, `(${fmtDec(c.taux, 3)} % × ${fmt(c.base)})`))}
            {ligne(t("paieBullTotalPatronales"), fmt(b.total_charges_patronales), true)}
            {ligne(t("paieBullCoutEmployeur"), fmt(b.cout_employeur), true)}
          </tbody>
        </table>
        <p style={{ fontSize: 11.5, color: "var(--sub)", margin: "8px 0 0" }}>
          IR : {b.ir.source === "TABLE" ? t("paieCtlSourceTable") : b.ir.source === "SOUS_TABLE" ? t("paieCtlSousTable") : t("paieCtlSourceFormule")} · TRIMF : {fmt(b.trimf.par_personne)} F × {fmtDec(b.trimf.parts, 1)}
        </p>
      </div>
    </div>
  );
}
