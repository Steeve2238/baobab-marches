"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { api } from "../../../../lib/api";
import { useLangue } from "../../../../lib/i18n/LanguageContext";
import AppShell from "../../../../lib/components/AppShell";
import { boutonSecondaireStyle } from "../../../../lib/comptaUi";

const nf = (n, d = 2) => Number(n || 0).toLocaleString("fr-FR", { minimumFractionDigits: 0, maximumFractionDigits: d }).replace(/[  ]/g, " ");
const il = (d) => (d ? String(d).slice(0, 10).split("-").reverse().join("/") : "");
const sub = (txt, vars) => String(txt).replace(/\{(\w+)\}/g, (_, k) => (vars && vars[k] !== undefined ? vars[k] : `{${k}}`));
const th = { padding: "6px 8px", fontSize: 11.5 };
const td = { padding: "6px 8px", verticalAlign: "top" };
const etiquette = { fontSize: 10.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.5, color: "var(--sub)", marginBottom: 4 };

export default function AvoirPage() {
  const { t } = useLangue();
  const { id } = useParams();
  const [a, setA] = useState(null);
  const [entete, setEntete] = useState(null);
  const [erreur, setErreur] = useState("");
  useEffect(() => {
    api.avoir(id).then(setA).catch((e) => setErreur(e.message));
    api.getEntete().then(setEntete).catch(() => {});
  }, [id]);
  const pied = [entete?.rccm ? `RCCM ${entete.rccm}` : null, entete?.ninea ? `NINEA ${entete.ninea}` : null, entete?.site_web || null].filter(Boolean);
  return (
    <AppShell title={a ? a.numero : t("avoTitre")} backHref="/ventes/avoirs" backLabelKey="avoRetourListe">
      {erreur && <p style={{ color: "var(--brique)", fontSize: 12.5 }}>{erreur}</p>}
      {a && (
        <>
          <div className="no-print" style={{ marginBottom: 12 }}>
            <button type="button" onClick={() => window.print()} style={boutonSecondaireStyle}>{t("avoImprimer")}</button>
          </div>
          <div className="card print-letter" style={{ padding: "28px 32px", background: "#fff", color: "#111", maxWidth: 860 }}>
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
                <div style={{ fontFamily: "Space Grotesk", fontWeight: 700, fontSize: 17, letterSpacing: 0.5 }}>{t("avoTitreDoc")}</div>
                <div style={{ fontWeight: 700, fontSize: 13.5, marginTop: 2 }}>N° {a.numero}</div>
                <div style={{ fontSize: 11.5, color: "var(--sub)" }}>{t("avoDocDate")} : {il(a.date_avoir)}</div>
              </div>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 24, marginBottom: 18 }}>
              <div>
                <div style={etiquette}>{t("avoDocClient")}</div>
                <div style={{ fontWeight: 600, fontSize: 13.5 }}>{a.client_nom}</div>
                {a.client_adresse && <div style={{ fontSize: 12, color: "var(--sub)" }}>{a.client_adresse}</div>}
                <div style={{ fontSize: 12, color: "var(--sub)" }}>{[a.client_telephone, a.client_email].filter(Boolean).join(" · ")}</div>
              </div>
              <div>
                <div style={etiquette}>{t("avoDocFacture")}</div>
                <div style={{ fontSize: 12.5 }}>{a.facture_numero} {t("avoDocDuLe")} {il(a.date_facture)}</div>
                <div style={{ ...etiquette, marginTop: 8 }}>{t("avoDocMotif")}</div>
                <div style={{ fontSize: 12.5 }}>{t("avoMotif" + a.motif_type)}{a.motif ? ` — ${a.motif}` : ""}</div>
              </div>
            </div>

            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
              <thead>
                <tr style={{ textAlign: "left", borderBottom: "1.5px solid #222" }}>
                  <th style={th}>{t("avoDocColDesignation")}</th>
                  <th style={{ ...th, textAlign: "right" }}>{t("avoDocColQte")}</th>
                  <th style={{ ...th, textAlign: "right" }}>{t("avoDocColPu")}</th>
                  <th style={{ ...th, textAlign: "right" }}>{t("avoDocColMontant")}</th>
                </tr>
              </thead>
              <tbody>
                {a.lignes.map((l) => (
                  <tr key={l.id} style={{ borderBottom: "1px solid #ddd" }}>
                    <td style={td}>{l.designation}{l.reference ? <span style={{ color: "var(--sub)" }}> · {l.reference}</span> : null}{l.retour_stock ? <span style={{ color: "var(--sub)", fontSize: 11 }}> ({t("avoDocRetourStock")})</span> : null}</td>
                    <td style={{ ...td, textAlign: "right" }}>{nf(l.quantite, 3)}{l.unite ? ` ${l.unite}` : ""}</td>
                    <td style={{ ...td, textAlign: "right" }}>{nf(l.prix_unitaire_ht)}</td>
                    <td style={{ ...td, textAlign: "right" }}>{nf(l.montant_ht)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 10 }}>
              <div style={{ minWidth: 280, display: "grid", gap: 4, fontSize: 12.5 }}>
                <div style={{ display: "flex", justifyContent: "space-between" }}><span>{t("avoDocTotalHt")}</span><span>{nf(a.total_ht)}</span></div>
                <div style={{ display: "flex", justifyContent: "space-between" }}><span>{sub(t("avoDocTva"), { t: nf(a.taux_tva_pourcentage) })}</span><span>{nf(a.montant_tva)}</span></div>
                <div style={{ display: "flex", justifyContent: "space-between", fontWeight: 700, fontSize: 14, borderTop: "1.5px solid #222", paddingTop: 6 }}><span>{t("avoDocTotalTtc")} (XOF)</span><span>{nf(a.total_ttc)}</span></div>
              </div>
            </div>

            <div style={{ marginTop: 18, fontSize: 12 }}>
              <div style={etiquette}>{t("avoDocReglement")}</div>
              {a.montant_impute > 0 && <div>{t("avoDocImpute")} : {nf(a.montant_impute)} F</div>}
              {a.montant_rembourse > 0 && <div>{sub(t("avoDocRembourse"), { m: a.mode_libelle || "—" })} : {nf(a.montant_rembourse)} F{a.reference ? ` (${a.reference})` : ""}</div>}
            </div>
            {a.ecritures.length > 0 && (
              <div className="no-print" style={{ marginTop: 14, fontSize: 11.5, color: "var(--sub)" }}>
                {t("avoDocEcritures")} : {a.ecritures.map((e) => `${e.origine_role === "REMBOURSEMENT" ? "↩" : "•"} ${e.statut === "VALIDEE" ? t("avoDocEcritureValidee") : t("avoDocEcritureInstance")}`).join(" · ")}
              </div>
            )}
            {pied.length > 0 && <div style={{ marginTop: 28, paddingTop: 8, borderTop: "1px solid #ddd", fontSize: 10.5, color: "var(--sub)", textAlign: "center" }}>{pied.join(" · ")}</div>}
          </div>
        </>
      )}
    </AppShell>
  );
}
