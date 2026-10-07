"use client";

import { useState } from "react";
import { useLangue } from "../i18n/LanguageContext";
import { inputStyle, labelStyle, boutonPrincipalStyle, boutonSecondaireStyle, STYLE_STATUT, pastilleStyle, dateCourte } from "../fiscaliteUi";

/**
 * Barre d'actions d'un dossier annuel (CEL, taxe sur les voitures) : preparer, deposer, payer, rouvrir, exporter.
 * `onStatut(corps)` et `onPreparer()` renvoient une promesse ; les erreurs sont gerees par la page.
 */
export default function FiscDossierBarre({ dossier, onPreparer, onStatut, onExporter, onRecalculer, onEnregistrer }) {
  const { t } = useLangue();
  const locale = t("dateLocale");
  const [form, setForm] = useState(null);
  const statut = dossier ? dossier.statut : "BROUILLON";
  const gele = statut === "DEPOSEE" || statut === "PAYEE";
  const aujourdhui = new Date().toISOString().slice(0, 10);

  async function valider() {
    const corps = form.action === "deposer" ? { action: "deposer", date_depot: form.date, reference_depot: form.reference } : { action: "payer", date_paiement: form.date };
    await onStatut(corps);
    setForm(null);
  }

  return (
    <>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12, alignItems: "center" }}>
        {!gele && onRecalculer && <button style={boutonSecondaireStyle} onClick={onRecalculer}>{t("fiscRecalculer")}</button>}
        {!gele && onEnregistrer && <button style={boutonSecondaireStyle} onClick={onEnregistrer}>{t("fiscIsEnregistrerSaisies")}</button>}
        {!gele && <button style={boutonPrincipalStyle} onClick={onPreparer}>{statut === "PREPAREE" ? t("fiscMettreAJour") : t("fiscEnregistrerPreparation")}</button>}
        {statut === "PREPAREE" && <button style={boutonSecondaireStyle} onClick={() => setForm({ action: "deposer", date: aujourdhui, reference: "" })}>{t("fiscMarquerDeposee")}</button>}
        {statut === "DEPOSEE" && <button style={boutonSecondaireStyle} onClick={() => setForm({ action: "payer", date: aujourdhui, reference: "" })}>{t("fiscMarquerPayee")}</button>}
        {gele && <button style={boutonSecondaireStyle} onClick={() => onStatut({ action: "rouvrir" })}>{t("fiscRouvrir")}</button>}
        <button style={boutonSecondaireStyle} onClick={() => onExporter("pdf")}>PDF</button>
        <button style={boutonSecondaireStyle} onClick={() => onExporter("xlsx")}>Excel</button>
        {dossier && dossier.statut !== "BROUILLON" && <span style={pastilleStyle(STYLE_STATUT[statut])}>{t(`fiscStatut_${statut}`)}</span>}
      </div>
      {form && (
        <div className="card" style={{ marginBottom: 14, display: "flex", gap: 10, alignItems: "flex-end", flexWrap: "wrap" }}>
          <div>
            <label style={labelStyle}>{form.action === "deposer" ? t("fiscDateDepot") : t("fiscDatePaiement")}</label>
            <input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} style={{ ...inputStyle, width: 160 }} />
          </div>
          {form.action === "deposer" && (
            <div>
              <label style={labelStyle}>{t("fiscReferenceDepot")}</label>
              <input value={form.reference} onChange={(e) => setForm({ ...form, reference: e.target.value })} style={{ ...inputStyle, width: 220 }} />
            </div>
          )}
          <button style={boutonPrincipalStyle} onClick={valider}>{t("fiscConfirmer")}</button>
          <button style={boutonSecondaireStyle} onClick={() => setForm(null)}>{t("fiscAnnuler")}</button>
        </div>
      )}
      {dossier && dossier.date_depot && (
        <p style={{ fontSize: 12, color: "var(--sub)", marginTop: -4, marginBottom: 12 }}>
          {t("fiscDeposeeLe")} {dateCourte(dossier.date_depot, locale)}
          {dossier.reference_depot ? ` — ${t("fiscReference")} ${dossier.reference_depot}` : ""}
          {dossier.date_paiement ? ` · ${t("fiscPayeeLe")} ${dateCourte(dossier.date_paiement, locale)}` : ""}
        </p>
      )}
    </>
  );
}
