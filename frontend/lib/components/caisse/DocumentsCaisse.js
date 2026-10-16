"use client";

import { useLangue } from "../../i18n/LanguageContext";

const fmt = (n) => Math.round(Number(n) || 0).toLocaleString("fr-FR").replace(/[  ]/g, " ");

const sub = (txt, vars) => String(txt).replace(/\{(\w+)\}/g, (_, k) => (vars && vars[k] !== undefined ? vars[k] : `{${k}}`));

const heure = (d) => new Date(d).toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" });

/** Ticket de caisse (rouleau 80 mm). */
export function TicketCaisse({ vente }) {
  const { t } = useLangue();
  const e = vente.entreprise || {};
  const f = vente.facture;
  const liv = vente.livraison;
  const rendu = vente.paiements.reduce((a, p) => a + (p.montant_remis ?? p.montant) - p.montant, 0);
  return (
    <div className="caisse-ticket">
      <div className="c big">{e.raison_sociale}</div>
      <div className="c">{[e.adresse, e.telephone].filter(Boolean).join(" · ")}</div>
      {(e.ninea || e.rccm) && <div className="c">{[e.ninea && `NINEA ${e.ninea}`, e.rccm && `RCCM ${e.rccm}`].filter(Boolean).join(" · ")}</div>}
      <hr />
      <div className="r"><span>{t("caiTicketNum")} {f.numero}</span><span>{heure(f.date_creation)}</span></div>
      {vente.vendeur && <div>{t("caiVendeur")} : {vente.vendeur}</div>}
      <div>{t("caiClient")} : {vente.client.comptoir ? t("caiClientComptoir") : vente.client.nom}</div>
      <hr />
      {vente.lignes.map((l, i) => (
        <div key={i}>
          <div>{l.designation}</div>
          <div className="r"><span>{l.quantite} × {fmt(l.prix_unitaire_ttc)}</span><span>{fmt(l.prix_unitaire_ttc * l.quantite)}</span></div>
        </div>
      ))}
      <hr />
      {f.montant_remise > 0 && <div className="r"><span>{t("caiRemise")} {Number(f.pourcentage_remise)}</span><span>-{fmt(f.montant_remise * (1 + f.taux_tva / 100))}</span></div>}
      <div className="r big"><span>{t("caiTotalTtc")}</span><span>{fmt(f.total_ttc)} F</span></div>
      <div className="r"><span>{sub(t("caiTva"), { t: f.taux_tva })}</span><span>{fmt(f.montant_tva)}</span></div>
      <hr />
      {vente.paiements.map((p, i) => (
        <div className="r" key={i}><span>{p.mode}</span><span>{fmt(p.montant_remis ?? p.montant)}</span></div>
      ))}
      {rendu > 0.5 && <div className="r"><span>{t("caiRendu")}</span><span>{fmt(rendu)}</span></div>}
      {f.reste > 0.5 && <div className="r big"><span>{t("caiResteDu")}</span><span>{fmt(f.reste)}</span></div>}
      <hr />
      <div className="c">
        {liv && liv.statut === "BROUILLON" ? t("caiLivraisonAConvenir") : t("caiMarchandiseEmportee")}
        <br />{t("caiMerci")}
      </div>
    </div>
  );
}

/** Facture / recu au format A4. */
export function FactureCaisse({ vente }) {
  const { t } = useLangue();
  const e = vente.entreprise || {};
  const f = vente.facture;
  const solde = f.reste <= 0.5;
  return (
    <div className="caisse-facture">
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
        <div>
          <h4 style={{ margin: 0, fontSize: 18, color: "#0E3B43" }}>{e.raison_sociale}</h4>
          <div>{e.adresse}</div>
          <div>{[e.telephone, e.email].filter(Boolean).join(" · ")}</div>
          <div>{[e.ninea && `NINEA ${e.ninea}`, e.rccm && `RCCM ${e.rccm}`].filter(Boolean).join(" · ")}</div>
        </div>
        <div style={{ textAlign: "right" }}>
          <b style={{ fontSize: 15 }}>{solde ? t("caiFactureAcquittee") : t("caiFacture")}</b>
          <div>N° {f.numero}</div>
          <div>{heure(f.date_creation)}</div>
        </div>
      </div>
      <div style={{ marginTop: 12 }}><b>{t("caiClient")} :</b> {vente.client.comptoir ? t("caiClientComptoir") : vente.client.nom}</div>
      <table>
        <thead>
          <tr><th>{t("caiDesignation")}</th><th className="n">{t("caiQte")}</th><th className="n">{t("caiPuTtc")}</th><th className="n">{t("caiTotal")}</th></tr>
        </thead>
        <tbody>
          {vente.lignes.map((l, i) => (
            <tr key={i}>
              <td>{l.designation}{l.reference ? <><br /><small style={{ color: "#777" }}>{l.reference}</small></> : null}</td>
              <td className="n">{l.quantite}</td>
              <td className="n">{fmt(l.prix_unitaire_ttc)}</td>
              <td className="n">{fmt(l.prix_unitaire_ttc * l.quantite)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {f.montant_remise > 0 && <div className="tt"><span>{t("caiRemise")} {Number(f.pourcentage_remise)}</span><span>-{fmt(f.montant_remise)} HT</span></div>}
      <div className="tt"><span>{t("caiTotalHt")}</span><span>{fmt(f.total_ht - f.montant_remise)}</span></div>
      <div className="tt"><span>{sub(t("caiTva"), { t: f.taux_tva })}</span><span>{fmt(f.montant_tva)}</span></div>
      <div className="tt g"><span>{t("caiTotalTtc")}</span><span>{fmt(f.total_ttc)} F CFA</span></div>
      <div style={{ marginTop: 8 }}>{t("caiReglement")} : {vente.paiements.map((p) => `${p.mode} ${fmt(p.montant)}`).join(" + ") || "—"}</div>
      {solde ? <div className="stamp">{t("caiPaye")}</div> : <div style={{ color: "#B23A2E", fontWeight: 700 }}>{t("caiResteDu")} : {fmt(f.reste)} F</div>}
    </div>
  );
}

/** Styles d'impression partages (ticket 80 mm et facture A4). */
export const STYLES_IMPRESSION = `
.caisse-ticket{width:290px;background:#fff;color:#111;font:12.5px/1.35 "Courier New",monospace;padding:16px 14px;box-shadow:0 1px 8px rgba(0,0,0,.15)}
.caisse-ticket hr{border:0;border-top:1px dashed #888;margin:8px 0}
.caisse-ticket .c{text-align:center}
.caisse-ticket .r{display:flex;justify-content:space-between;gap:8px}
.caisse-ticket .big{font-size:15px;font-weight:700}
.caisse-facture{width:430px;max-width:100%;background:#fff;color:#111;font:12px/1.4 system-ui,sans-serif;padding:22px;box-shadow:0 1px 8px rgba(0,0,0,.15)}
.caisse-facture table{width:100%;border-collapse:collapse;margin:12px 0}
.caisse-facture th{text-align:left;border-bottom:1.5px solid #222;padding:4px 0;font-size:11px;text-transform:uppercase}
.caisse-facture td{padding:4px 0;border-bottom:1px solid #ddd}
.caisse-facture td.n,.caisse-facture th.n{text-align:right}
.caisse-facture .tt{display:flex;justify-content:space-between;padding:2px 0}
.caisse-facture .tt.g{font-weight:700;font-size:14px;border-top:1.5px solid #222;margin-top:4px;padding-top:6px}
.caisse-facture .stamp{display:inline-block;border:2px solid #2F6B4F;color:#2F6B4F;padding:1px 8px;font-weight:700;transform:rotate(-4deg);margin-top:6px}
@media print{
  body *{visibility:hidden}
  #zone-impression-caisse,#zone-impression-caisse *{visibility:visible}
  #zone-impression-caisse{position:absolute;left:0;top:0;width:100%;display:flex;gap:16px;justify-content:center;background:#fff}
  #zone-impression-caisse .caisse-ticket,#zone-impression-caisse .caisse-facture{box-shadow:none}
}
`;
