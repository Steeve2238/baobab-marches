"use client";

import { useLangue } from "../i18n/LanguageContext";
import { texteEcheancier } from "../echeancier";

const nf = (n, d = 2) => Number(n || 0).toLocaleString("fr-FR", { minimumFractionDigits: 0, maximumFractionDigits: d }).replace(/[  ]/g, " ");

function formaterDate(v, locale) {
  if (!v) return "";
  const d = new Date(String(v).slice(0, 10) + "T12:00:00");
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString(locale || "fr-FR");
}

/**
 * Bon de commande fournisseur imprimable (A4), en bonne et due forme :
 * en-tete de la societe, fournisseur, lignes, conditions, signatures.
 * Classe .print-letter : seul ce bloc sort a l'impression (voir globals.css).
 */
export default function BonCommandeDocument({ commande, entete }) {
  const { t, dict } = useLangue();
  const locale = dict?.dateLocale;
  const lignes = commande.lignes || [];
  const ech = Array.isArray(commande.echeancier_json) && commande.echeancier_json.length > 0 ? commande.echeancier_json : null;
  const conditions = commande.conditions_paiement || (ech ? texteEcheancier(ech, t) : "");
  const horsXof = commande.devise && commande.devise !== "XOF";
  const pied = [
    entete?.rccm ? `RCCM ${entete.rccm}` : null,
    entete?.ninea ? `NINEA ${entete.ninea}` : null,
    entete?.site_web || null,
  ].filter(Boolean);
  const coordFourn = [commande.fournisseur_adresse, commande.fournisseur_pays].filter(Boolean).join(" — ");
  const contactFourn = [commande.fournisseur_contact, commande.fournisseur_telephone, commande.fournisseur_email].filter(Boolean).join(" · ");

  return (
    <div className="card print-letter" style={{ padding: "28px 32px", background: "#fff", color: "#111" }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 24, borderBottom: "2px solid var(--petrol)", paddingBottom: 16, marginBottom: 20 }}>
        <div style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
          {entete?.logo_base64 && <img src={`data:${entete.logo_type_mime};base64,${entete.logo_base64}`} alt="logo" style={{ maxWidth: 90, maxHeight: 70, objectFit: "contain" }} />}
          <div>
            <div style={{ fontFamily: "Space Grotesk", fontWeight: 700, fontSize: 14, color: "var(--petrol)" }}>{entete?.raison_sociale || "—"}</div>
            <div style={{ fontSize: 11, color: "var(--sub)", marginTop: 2 }}>{entete?.adresse}</div>
            <div style={{ fontSize: 11, color: "var(--sub)" }}>{[entete?.telephone, entete?.email].filter(Boolean).join(" · ")}</div>
          </div>
        </div>
        <div style={{ textAlign: "right" }}>
          <div style={{ fontFamily: "Space Grotesk", fontWeight: 700, fontSize: 17, letterSpacing: 0.5 }}>{t("docBcTitre")}</div>
          <div style={{ fontWeight: 700, fontSize: 13.5, marginTop: 2 }}>N° {commande.numero}</div>
          <div style={{ fontSize: 11.5, color: "var(--sub)" }}>{t("docBcDate")} : {formaterDate(commande.date_commande, locale)}</div>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 24, marginBottom: 18 }}>
        <div>
          <div style={etiquette}>{t("docBcFournisseur")}</div>
          <div style={{ fontWeight: 600, fontSize: 13.5 }}>{commande.fournisseur_nom}</div>
          {coordFourn && <div style={{ fontSize: 12, color: "var(--sub)" }}>{coordFourn}</div>}
          {contactFourn && <div style={{ fontSize: 12, color: "var(--sub)" }}>{contactFourn}</div>}
          {commande.reference_fournisseur && <div style={{ fontSize: 12, marginTop: 4 }}>{t("docBcRefFourn")} : {commande.reference_fournisseur}</div>}
        </div>
        <div>
          <div style={etiquette}>{t("docBcLivraison")}</div>
          <div style={{ fontSize: 12.5, display: "grid", gap: 2 }}>
            {commande.lieu_livraison && <div>{t("docBcLieu")} : {commande.lieu_livraison}</div>}
            {commande.date_livraison_prevue && <div>{t("docBcDateLivraison")} : {formaterDate(commande.date_livraison_prevue, locale)}</div>}
            {commande.incoterm && <div>{t("docBcIncoterm")} : {commande.incoterm}</div>}
            {commande.transitaire_nom && <div>{t("docBcTransitaire")} : {commande.transitaire_nom}</div>}
            <div>{t("docBcDevise")} : {commande.devise}</div>
          </div>
        </div>
      </div>

      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
        <thead>
          <tr style={{ textAlign: "left", borderBottom: "1.5px solid #222" }}>
            <th style={th}>{t("cmdColRef")}</th>
            <th style={th}>{t("cmdColDesignation")}</th>
            <th style={th}>{t("cmdColUnite")}</th>
            <th style={{ ...th, textAlign: "right" }}>{t("cmdColQuantite")}</th>
            <th style={{ ...th, textAlign: "right" }}>{t("cmdColPu")}</th>
            <th style={{ ...th, textAlign: "right" }}>{t("cmdColMontant")}</th>
          </tr>
        </thead>
        <tbody>
          {lignes.map((l) => (
            <tr key={l.id} style={{ borderBottom: "1px solid #ddd" }}>
              <td style={td}>{l.reference_fournisseur || ""}</td>
              <td style={td}>{l.designation}</td>
              <td style={td}>{l.unite}</td>
              <td style={{ ...td, textAlign: "right" }}>{nf(l.quantite, 3)}</td>
              <td style={{ ...td, textAlign: "right" }}>{nf(l.prix_unitaire_devise, 4)}</td>
              <td style={{ ...td, textAlign: "right" }}>{nf(Number(l.quantite) * Number(l.prix_unitaire_devise))}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 10 }}>
        <div style={{ minWidth: 260 }}>
          <div style={{ display: "flex", justifyContent: "space-between", fontWeight: 700, fontSize: 14, borderTop: "1.5px solid #222", paddingTop: 6 }}>
            <span>{t("docBcTotal")} ({commande.devise})</span><span>{nf(commande.total_devise)}</span>
          </div>
          {horsXof && (
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11.5, color: "var(--sub)", marginTop: 3 }}>
              <span>{t("docBcEquivalent")}</span><span>{nf(commande.total_xof, 0)}</span>
            </div>
          )}
        </div>
      </div>

      {(conditions || commande.notes) && (
        <div style={{ marginTop: 18, display: "grid", gap: 10, fontSize: 12 }}>
          {conditions && <div><div style={etiquette}>{t("docBcConditions")}</div><div>{conditions}</div></div>}
          {commande.notes && <div><div style={etiquette}>{t("docBcNotes")}</div><div>{commande.notes}</div></div>}
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 24, marginTop: 30, breakInside: "avoid" }}>
        <div>
          <div style={etiquette}>{t("docBcSociete")}</div>
          <div style={{ height: 84, border: "1px dashed #aaa", borderRadius: 6, display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden" }}>
            {entete?.signature_cachet_base64 && <img src={`data:${entete.signature_cachet_type_mime};base64,${entete.signature_cachet_base64}`} alt="" style={{ maxHeight: 80, maxWidth: "100%", objectFit: "contain" }} />}
          </div>
          <div style={{ fontSize: 10.5, color: "var(--sub)", marginTop: 3 }}>{t("docBcNomDate")}</div>
        </div>
        <div>
          <div style={etiquette}>{t("docBcAccord")}</div>
          <div style={{ height: 84, border: "1px dashed #aaa", borderRadius: 6 }} />
          <div style={{ fontSize: 10.5, color: "var(--sub)", marginTop: 3 }}>{t("docBcNomDate")}</div>
        </div>
      </div>
      <p style={{ fontSize: 11, color: "var(--sub)", marginTop: 14 }}>{t("docBcRetour")}</p>
      {pied.length > 0 && <div style={{ borderTop: "1px solid #ccc", marginTop: 16, paddingTop: 8, fontSize: 10.5, color: "var(--sub)", textAlign: "center" }}>{pied.join(" · ")}</div>}
    </div>
  );
}

const etiquette = { fontSize: 10.5, fontWeight: 700, color: "var(--sub)", textTransform: "uppercase", marginBottom: 4 };
const th = { padding: "6px 4px", fontSize: 11, textTransform: "uppercase" };
const td = { padding: "6px 4px", verticalAlign: "top" };
