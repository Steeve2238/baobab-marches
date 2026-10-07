"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { api } from "../../../../../lib/api";
import { useLangue } from "../../../../../lib/i18n/LanguageContext";
import AppShell from "../../../../../lib/components/AppShell";
import FiscaliteSousNav from "../../../../../lib/components/FiscaliteSousNav";
import {
  inputStyle, labelStyle, thStyle, tdStyle, boutonPrincipalStyle, boutonSecondaireStyle,
  STYLE_STATUT, pastilleStyle, formaterXof, dateCourte, nomMois, texteAlerte,
} from "../../../../../lib/fiscaliteUi";

// Lignes du formulaire DGID (numero, mise en gras, saisie manuelle possible).
const LIGNES = [
  [5], [10], [15], [20], [25, true], [30, false, "L30"], [35, true], [40], [45], [50], [55], [60, true],
  [65], [70], [75, false, "L75"], [76, true], [80], [85], [90], [91, true], [92, true], [93], [95, false, "L95"],
  [100, false, "credit_precedent"], [105, true], [110, true], [115, true], [120, false, "L120"],
];

const CODES_VENTE = ["AUTO", "TAXABLE", "EXONERE", "EXPORT", "SUSPENSION"];
const AVERT_GRAVES = ["ECART_COMPTABILITE", "TVA_SUR_OPERATION_EXONEREE", "TVA_FOURNISSEUR_NON_ASSUJETTI", "NON_ASSUJETTI"];

function precedent(annee, mois) {
  return mois === 1 ? [annee - 1, 12] : [annee, mois - 1];
}
function suivant(annee, mois) {
  return mois === 12 ? [annee + 1, 1] : [annee, mois + 1];
}

export default function FiscaliteTvaDetailPage() {
  const { t } = useLangue();
  const locale = t("dateLocale");
  const params = useParams();
  const annee = Number(params.annee);
  const mois = Number(params.mois);

  const [data, setData] = useState(null);
  const [saisies, setSaisies] = useState({ L10: "", L15: "", L20: "", L30: "", L75: "", L95: "", L120: "", credit_precedent: "", source_tva: "AUTO" });
  const [creditManuel, setCreditManuel] = useState(false);
  const [onglet, setOnglet] = useState("declaration");
  const [erreur, setErreur] = useState("");
  const [info, setInfo] = useState("");
  const [chargement, setChargement] = useState(false);
  const [formStatut, setFormStatut] = useState(null); // { action, date, reference }

  const charger = useCallback(
    async (saisiesRequete) => {
      setErreur("");
      setChargement(true);
      try {
        const r = await api.fiscaliteTvaPeriode(annee, mois, saisiesRequete || {});
        setData(r);
        const s = r.calcul.saisies;
        setSaisies({
          L10: s.L10 || "",
          L15: s.L15 || "",
          L20: s.L20 || "",
          source_tva: s.source_tva || "AUTO",
          L30: s.L30 || "",
          L75: s.L75 || "",
          L95: s.L95 || "",
          L120: s.L120 || "",
          credit_precedent: s.credit_precedent || "",
        });
        setCreditManuel(s.credit_source === "SAISIE");
      } catch (e) {
        setErreur(e.message);
        setData(null);
      } finally {
        setChargement(false);
      }
    },
    [annee, mois]
  );

  useEffect(() => {
    charger();
  }, [charger]);

  const declaration = data?.declaration || null;
  const gelee = !!declaration && declaration.statut !== "PREPAREE";
  const calcul = data?.calcul || null;
  const L = gelee ? declaration.lignes : calcul?.lignes || {};
  const mm = (v) => formaterXof(v, locale);

  /** Saisies a envoyer : le credit precedent n'est transmis que s'il a ete modifie a la main. */
  function saisiesPourEnvoi() {
    const s = { source_tva: saisies.source_tva || "AUTO", L10: saisies.L10 || 0, L15: saisies.L15 || 0, L20: saisies.L20 || 0, L30: saisies.L30 || 0, L75: saisies.L75 || 0, L95: saisies.L95 || 0, L120: saisies.L120 || 0 };
    if (creditManuel && saisies.credit_precedent !== "") s.credit_precedent = saisies.credit_precedent;
    return s;
  }

  async function action(fn, message) {
    setErreur("");
    setInfo("");
    try {
      await fn();
      if (message) setInfo(message);
      await charger(saisiesPourEnvoi());
    } catch (e) {
      setErreur(e.message);
    }
  }

  const recalculer = () => charger(saisiesPourEnvoi());
  const preparer = () => action(() => api.fiscalitePreparerTva(annee, mois, saisiesPourEnvoi()), t("fiscInfoPreparee"));
  const rouvrir = () => action(() => api.fiscaliteStatutTva(annee, mois, { action: "rouvrir" }), t("fiscInfoRouverte"));
  function validerFormStatut() {
    const { action: a, date, reference } = formStatut;
    const corps = a === "deposer" ? { action: "deposer", date_depot: date, reference_depot: reference } : { action: "payer", date_paiement: date };
    action(() => api.fiscaliteStatutTva(annee, mois, corps), a === "deposer" ? t("fiscInfoDeposee") : t("fiscInfoPayee")).then(() => setFormStatut(null));
  }
  async function exporter(format) {
    setErreur("");
    try {
      await api.fiscaliteExporterTva(annee, mois, format);
    } catch (e) {
      setErreur(e.message);
    }
  }

  async function majVente(id, corps) {
    await action(() => api.fiscaliteMajVente(id, corps));
  }
  async function majAchat(id, corps) {
    await action(() => api.fiscaliteMajAchat(id, corps));
  }

  const [pa, pm] = precedent(annee, mois);
  const [sa, sm] = suivant(annee, mois);
  const titre = `${t("fiscTvaDe")} ${nomMois(mois, locale)} ${annee}`;

  const caseSaisie = (cle) => (
    <input
      type="number"
      min="0"
      step="1"
      value={saisies[cle]}
      disabled={gelee}
      onChange={(e) => {
        setSaisies({ ...saisies, [cle]: e.target.value });
        if (cle === "credit_precedent") setCreditManuel(true);
      }}
      style={{ ...inputStyle, width: 130, textAlign: "right", padding: "4px 8px" }}
    />
  );

  const ongletBtn = (cle, libelle, compte) => (
    <button
      key={cle}
      onClick={() => setOnglet(cle)}
      style={{
        padding: "7px 14px",
        borderRadius: "8px 8px 0 0",
        border: "1px solid var(--line)",
        borderBottom: onglet === cle ? "1px solid #fff" : "1px solid var(--line)",
        background: onglet === cle ? "#fff" : "var(--line-soft)",
        fontSize: 12.5,
        fontWeight: onglet === cle ? 700 : 500,
        color: "var(--petrol)",
        marginBottom: -1,
      }}
    >
      {libelle}{compte !== undefined ? ` (${compte})` : ""}
    </button>
  );

  return (
    <AppShell title={titre} subNav={<FiscaliteSousNav />}>
      {erreur && <p style={{ color: "var(--brique)", fontSize: 12.5, marginBottom: 12 }}>{erreur}</p>}
      {info && <p style={{ color: "#2E7D5B", fontSize: 12.5, marginBottom: 12 }}>{info}</p>}

      <div className="card" style={{ marginBottom: 14, display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
        <Link href={`/fiscalite/tva/${pa}/${pm}`} style={boutonSecondaireStyle}>‹ {nomMois(pm, locale)}</Link>
        <Link href={`/fiscalite/tva/${sa}/${sm}`} style={boutonSecondaireStyle}>{nomMois(sm, locale)} ›</Link>
        <Link href="/fiscalite/tva" style={{ ...boutonSecondaireStyle, border: "none" }}>{t("fiscToutesPeriodes")}</Link>
        <span style={{ flex: 1 }} />
        {declaration && <span style={pastilleStyle(STYLE_STATUT[declaration.statut])}>{t(`fiscStatut_${declaration.statut}`)}</span>}
        {calcul && <span style={{ fontSize: 12, color: "var(--sub)" }}>{t("fiscLimite")} {dateCourte(calcul.periode.date_limite, locale)}</span>}
      </div>

      {chargement && !data && <p style={{ fontSize: 12.5, color: "var(--sub)" }}>{t("loading")}</p>}

      {calcul && (
        <>
          {gelee && data.live_differe_de_declaration && (
            <div className="card" style={{ marginBottom: 12, borderLeft: "3px solid var(--ocre)", fontSize: 12.5, lineHeight: 1.5 }}>{t("fiscLiveDiffere")}</div>
          )}

          {/* ---- Actions ---- */}
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 14 }}>
            {!gelee && <button style={boutonSecondaireStyle} onClick={recalculer}>{t("fiscRecalculer")}</button>}
            {!gelee && <button style={boutonPrincipalStyle} onClick={preparer}>{declaration ? t("fiscMettreAJour") : t("fiscEnregistrerPreparation")}</button>}
            {declaration && declaration.statut === "PREPAREE" && (
              <button style={boutonSecondaireStyle} onClick={() => setFormStatut({ action: "deposer", date: new Date().toISOString().slice(0, 10), reference: "" })}>{t("fiscMarquerDeposee")}</button>
            )}
            {declaration && declaration.statut === "DEPOSEE" && (
              <button style={boutonSecondaireStyle} onClick={() => setFormStatut({ action: "payer", date: new Date().toISOString().slice(0, 10), reference: "" })}>{t("fiscMarquerPayee")}</button>
            )}
            {gelee && <button style={boutonSecondaireStyle} onClick={rouvrir}>{t("fiscRouvrir")}</button>}
            <button style={boutonSecondaireStyle} onClick={() => exporter("pdf")}>PDF</button>
            <button style={boutonSecondaireStyle} onClick={() => exporter("xlsx")}>Excel</button>
          </div>

          {formStatut && (
            <div className="card" style={{ marginBottom: 14, display: "flex", gap: 10, alignItems: "flex-end", flexWrap: "wrap" }}>
              <div>
                <label style={labelStyle}>{formStatut.action === "deposer" ? t("fiscDateDepot") : t("fiscDatePaiement")}</label>
                <input type="date" value={formStatut.date} onChange={(e) => setFormStatut({ ...formStatut, date: e.target.value })} style={{ ...inputStyle, width: 160 }} />
              </div>
              {formStatut.action === "deposer" && (
                <div>
                  <label style={labelStyle}>{t("fiscReferenceDepot")}</label>
                  <input value={formStatut.reference} onChange={(e) => setFormStatut({ ...formStatut, reference: e.target.value })} style={{ ...inputStyle, width: 220 }} />
                </div>
              )}
              <button style={boutonPrincipalStyle} onClick={validerFormStatut}>{t("fiscConfirmer")}</button>
              <button style={boutonSecondaireStyle} onClick={() => setFormStatut(null)}>{t("fiscAnnuler")}</button>
            </div>
          )}

          {declaration && declaration.date_depot && (
            <p style={{ fontSize: 12, color: "var(--sub)", marginTop: -4, marginBottom: 12 }}>
              {t("fiscDeposeeLe")} {dateCourte(declaration.date_depot, locale)}
              {declaration.reference_depot ? ` — ${t("fiscReference")} ${declaration.reference_depot}` : ""}
              {declaration.date_paiement ? ` · ${t("fiscPayeeLe")} ${dateCourte(declaration.date_paiement, locale)}` : ""}
            </p>
          )}

          {/* ---- Resume ---- */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12, marginBottom: 14 }}>
            <div className="card">
              <div style={{ fontSize: 11, color: "var(--sub)", fontWeight: 700 }}>{t("fiscTvaBrute")} (L60)</div>
              <div style={{ fontSize: 19, fontWeight: 700, marginTop: 4, fontVariantNumeric: "tabular-nums" }}>{mm(L[60])}</div>
            </div>
            <div className="card">
              <div style={{ fontSize: 11, color: "var(--sub)", fontWeight: 700 }}>{t("fiscDeductions")} (L105)</div>
              <div style={{ fontSize: 19, fontWeight: 700, marginTop: 4, fontVariantNumeric: "tabular-nums" }}>{mm(L[105])}</div>
            </div>
            <div className="card" style={{ borderLeft: `3px solid ${Number(L[110]) > 0 ? "var(--brique)" : "#2E7D5B"}` }}>
              <div style={{ fontSize: 11, color: "var(--sub)", fontWeight: 700 }}>{Number(L[110]) > 0 ? `${t("fiscSoldeAPayer")} (L110)` : `${t("fiscCreditAReporter")} (L115)`}</div>
              <div style={{ fontSize: 19, fontWeight: 700, marginTop: 4, fontVariantNumeric: "tabular-nums" }}>{mm(Number(L[110]) > 0 ? L[110] : L[115])}</div>
              <div style={{ fontSize: 11.5, color: "var(--sub)" }}>XOF</div>
            </div>
          </div>

          {/* ---- Avertissements ---- */}
          {calcul.avertissements.length > 0 && (
            <div className="card" style={{ marginBottom: 14 }}>
              <h3 style={{ fontSize: 13, color: "var(--petrol)", marginBottom: 6 }}>{t("fiscAvertissements")} ({calcul.avertissements.length})</h3>
              <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12.3, lineHeight: 1.6 }}>
                {calcul.avertissements.map((a, i) => (
                  <li key={i} style={{ color: AVERT_GRAVES.includes(a.code) ? "var(--brique)" : "inherit" }}>{texteAlerte(t, "fiscAv_", a, locale)}</li>
                ))}
              </ul>
            </div>
          )}

          {/* ---- Onglets ---- */}
          <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
            {ongletBtn("declaration", t("fiscOngletDeclaration"))}
            {ongletBtn("ventes", t("fiscOngletVentes"), calcul.ventes.length)}
            {ongletBtn("achats", t("fiscOngletAchats"), calcul.achats.length)}
            {ongletBtn("annexes", t("fiscOngletAnnexes"))}
          </div>
          <div className="card" style={{ borderTopLeftRadius: 0, padding: onglet === "declaration" ? 16 : 0, overflowX: "auto" }}>
            {onglet === "declaration" && (
              <div>
                <table style={{ width: "100%", borderCollapse: "collapse", maxWidth: 760 }}>
                  <thead>
                    <tr>
                      <th style={{ ...thStyle, width: 56 }}>{t("fiscLigne")}</th>
                      <th style={thStyle}>{t("fiscDesignation")}</th>
                      <th style={{ ...thStyle, textAlign: "right", width: 150 }}>{t("fiscMontant")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {LIGNES.map(([n, gras, cleSaisie]) => (
                      <tr key={n} style={gras ? { background: "var(--line-soft)" } : {}}>
                        <td style={{ ...tdStyle, fontFamily: "IBM Plex Mono, monospace", color: "var(--sub)" }}>L{n}</td>
                        <td style={{ ...tdStyle, fontWeight: gras ? 700 : 500 }}>
                          {t(`fiscL_${n}`)}
                          {n === 50 ? ` (${calcul.profil.taux_tva_reduit} %)` : n === 55 ? ` (${calcul.profil.taux_tva_normal} %)` : ""}
                          {n === 100 && calcul.saisies.credit_source === "DECLARATION_PRECEDENTE" && !creditManuel && <span style={{ color: "var(--sub)", fontWeight: 400 }}> — {t("fiscCreditReporte")}</span>}
                        </td>
                        <td style={{ ...tdStyle, textAlign: "right", fontVariantNumeric: "tabular-nums", fontWeight: gras ? 700 : 500 }}>
                          {cleSaisie && !gelee ? caseSaisie(cleSaisie) : [10, 15, 20].includes(n) && calcul.source === "GRAND_LIVRE" && !gelee ? caseSaisie(`L${n}`) : mm(L[n])}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {!gelee && <p style={{ fontSize: 11.5, color: "var(--sub)", marginTop: 10, lineHeight: 1.5 }}>{t("fiscSaisiesAide")}</p>}
                {calcul.grand_livre_disponible && !gelee && (
                  <div style={{ marginTop: 12 }}>
                    <label style={labelStyle}>{t("fiscTvaSourceDonnees")}</label>
                    <select value={saisies.source_tva} onChange={(e) => setSaisies({ ...saisies, source_tva: e.target.value })} style={{ ...inputStyle, width: 360 }}>
                      <option value="AUTO">{t("fiscTvaSourceAuto")}</option>
                      <option value="FACTURES">{t("fiscTvaSourceFactures")}</option>
                      <option value="GRAND_LIVRE">{t("fiscTvaSourceGl")}</option>
                    </select>
                    <div style={{ fontSize: 11.5, color: "var(--sub)", marginTop: 4 }}>{t("fiscTvaSourceAide")}</div>
                  </div>
                )}
                {calcul.source === "GRAND_LIVRE" && calcul.grand_livre && (
                  <div className="card" style={{ marginTop: 14, maxWidth: 760, fontSize: 12.5, lineHeight: 1.6 }}>
                    <strong>{t("fiscTvaGlTitre")}</strong>
                    <div>{t("fiscTvaGlCollectee")} : {mm(calcul.grand_livre.collectee)} XOF · {t("fiscTvaGlRecuperable")} : {mm(calcul.grand_livre.recuperable)} XOF · {t("fiscTvaGlCa")} : {mm(calcul.grand_livre.ventes_70)} XOF · {calcul.grand_livre.nb_ecritures} {t("fiscTvaGlLignes")}</div>
                  </div>
                )}
                {calcul.rapprochement && (
                  <div style={{ marginTop: 16, maxWidth: 760 }}>
                    <h3 style={{ fontSize: 13, color: "var(--petrol)", marginBottom: 6 }}>{t("fiscRapprochement")}</h3>
                    <table style={{ width: "100%", borderCollapse: "collapse" }}>
                      <thead>
                        <tr>
                          <th style={thStyle}></th>
                          <th style={{ ...thStyle, textAlign: "right" }}>{t("fiscDeclareeCol")}</th>
                          <th style={{ ...thStyle, textAlign: "right" }}>{t("fiscComptabiliteCol")}</th>
                          <th style={{ ...thStyle, textAlign: "right" }}>{t("fiscEcartCol")}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {[["tva_collectee", "fiscTvaCollectee"], ["tva_deductible", "fiscTvaDeductible"]].map(([k, lib]) => {
                          const r = calcul.rapprochement[k];
                          return (
                            <tr key={k}>
                              <td style={tdStyle}>{t(lib)} <span style={{ color: "var(--sub)" }}>({t("fiscCompte")} {r.compte})</span></td>
                              <td style={{ ...tdStyle, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{mm(r.declaree)}</td>
                              <td style={{ ...tdStyle, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{mm(r.comptabilite)}</td>
                              <td style={{ ...tdStyle, textAlign: "right", fontVariantNumeric: "tabular-nums", color: Math.abs(r.ecart) > 1 ? "var(--brique)" : "#2E7D5B", fontWeight: 700 }}>{Math.abs(r.ecart) > 1 ? mm(r.ecart) : "✓"}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                    <p style={{ fontSize: 11.5, color: "var(--sub)", marginTop: 6 }}>{t("fiscRapprochementAide")}</p>
                  </div>
                )}
              </div>
            )}

            {onglet === "ventes" && (
              <div>
                <p style={{ fontSize: 12, color: "var(--sub)", margin: 12, lineHeight: 1.5 }}>{t("fiscVentesAide")}</p>
                <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 980 }}>
                  <thead>
                    <tr>
                      <th style={thStyle}>{t("fiscNumero")}</th>
                      <th style={thStyle}>{t("fiscDate")}</th>
                      <th style={thStyle}>{t("fiscClient")}</th>
                      <th style={{ ...thStyle, textAlign: "right" }}>{t("fiscHT")}</th>
                      <th style={{ ...thStyle, textAlign: "right" }}>{t("fiscTVA")}</th>
                      <th style={thStyle}>{t("fiscCodeOperation")}</th>
                      <th style={{ ...thStyle, textAlign: "right" }}>{t("fiscPrecompte")}</th>
                      <th style={thStyle}>{t("fiscEcriture")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {calcul.ventes.length === 0 && (
                      <tr><td colSpan={8} style={{ ...tdStyle, color: "var(--sub)" }}>{t("fiscAucuneOperation")}</td></tr>
                    )}
                    {calcul.ventes.map((v, i) => (
                      <tr key={`${v.facture_id}-${i}`}>
                        <td style={{ ...tdStyle, fontFamily: "IBM Plex Mono, monospace", whiteSpace: "nowrap" }}>{v.numero}{v.numero_reglement ? <div style={{ fontSize: 10.5, color: "var(--sub)" }}>{v.numero_reglement}</div> : null}</td>
                        <td style={{ ...tdStyle, whiteSpace: "nowrap" }}>{dateCourte(v.date, locale)}</td>
                        <td style={tdStyle}>{v.client_nom}<div style={{ fontSize: 11, color: v.client_ninea ? "var(--sub)" : "var(--brique)" }}>{v.client_ninea ? `NINEA ${v.client_ninea}` : t("fiscNineaManquant")}</div></td>
                        <td style={{ ...tdStyle, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{mm(v.ht)}</td>
                        <td style={{ ...tdStyle, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{mm(v.tva)}<div style={{ fontSize: 10.5, color: "var(--sub)" }}>{v.taux} %</div></td>
                        <td style={tdStyle}>
                          <select
                            value={v.code_automatique ? "AUTO" : v.code_operation}
                            disabled={gelee}
                            onChange={(e) => majVente(v.facture_id, { code_operation: e.target.value })}
                            style={{ ...inputStyle, width: 190, padding: "4px 6px", fontSize: 12 }}
                          >
                            {CODES_VENTE.map((c) => (
                              <option key={c} value={c}>{c === "AUTO" ? `${t("fiscCodeAuto")} (${t(`fiscCode_${v.code_operation}`)})` : t(`fiscCode_${c}`)}</option>
                            ))}
                          </select>
                        </td>
                        <td style={{ ...tdStyle, textAlign: "right" }}>
                          <input
                            type="number"
                            min="0"
                            defaultValue={v.precompte || ""}
                            key={`${v.facture_id}-${v.precompte}`}
                            disabled={gelee}
                            onBlur={(e) => Number(e.target.value || 0) !== Number(v.precompte || 0) && majVente(v.facture_id, { precompte: e.target.value || 0 })}
                            style={{ ...inputStyle, width: 100, textAlign: "right", padding: "4px 6px", fontSize: 12 }}
                          />
                        </td>
                        <td style={tdStyle}>
                          <span style={pastilleStyle(v.ecriture_statut === "VALIDEE" ? STYLE_STATUT.PAYEE : STYLE_STATUT.PREPAREE)}>
                            {v.ecriture_statut === "VALIDEE" ? t("fiscEcritureValidee") : v.ecriture_statut === "EN_INSTANCE" ? t("fiscEcritureInstance") : t("fiscEcritureAucune")}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {onglet === "achats" && (
              <div>
                <p style={{ fontSize: 12, color: "var(--sub)", margin: 12, lineHeight: 1.5 }}>{t("fiscAchatsAide")}</p>
                <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 1040 }}>
                  <thead>
                    <tr>
                      <th style={thStyle}>{t("fiscNumero")}</th>
                      <th style={thStyle}>{t("fiscDate")}</th>
                      <th style={thStyle}>{t("fiscFournisseur")}</th>
                      <th style={{ ...thStyle, textAlign: "right" }}>{t("fiscBase")}</th>
                      <th style={{ ...thStyle, textAlign: "right" }}>{t("fiscTVA")}</th>
                      <th style={thStyle}>{t("fiscTypeAchat")}</th>
                      <th style={thStyle}>{t("fiscDeductible")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {calcul.achats.length === 0 && (
                      <tr><td colSpan={7} style={{ ...tdStyle, color: "var(--sub)" }}>{t("fiscAucuneOperation")}</td></tr>
                    )}
                    {calcul.achats.map((a) => (
                      <tr key={a.facture_id} style={!a.deductible ? { color: "var(--sub)" } : {}}>
                        <td style={{ ...tdStyle, fontFamily: "IBM Plex Mono, monospace", whiteSpace: "nowrap" }}>{a.numero}<div style={{ fontSize: 10.5, color: "var(--sub)" }}>{a.reference_fournisseur}</div></td>
                        <td style={{ ...tdStyle, whiteSpace: "nowrap" }}>{dateCourte(a.date, locale)}</td>
                        <td style={tdStyle}>
                          {a.fournisseur_nom}
                          <div style={{ fontSize: 11, color: a.fournisseur_ninea ? "var(--sub)" : "var(--brique)" }}>
                            {a.fournisseur_ninea ? `NINEA ${a.fournisseur_ninea}` : t("fiscNineaManquant")}
                            {a.fournisseur_regime === "CGU" ? ` · ${t("fiscRegime_CGU")}` : ""}
                            {a.fournisseur_assujetti_tva === false && a.fournisseur_regime !== "CGU" ? ` · ${t("fiscNonAssujetti")}` : ""}
                          </div>
                        </td>
                        <td style={{ ...tdStyle, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{mm(a.base)}</td>
                        <td style={{ ...tdStyle, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{mm(a.tva)}</td>
                        <td style={tdStyle}>
                          <select
                            value={a.type_operation}
                            disabled={gelee}
                            onChange={(e) => majAchat(a.facture_id, { type_operation: e.target.value })}
                            style={{ ...inputStyle, width: 130, padding: "4px 6px", fontSize: 12 }}
                          >
                            <option value="LOCAL">{t("fiscAchatLocal")}</option>
                            <option value="IMPORT">{t("fiscAchatImport")}</option>
                          </select>
                          {a.type_operation === "IMPORT" && !gelee && (
                            <div style={{ display: "flex", gap: 4, marginTop: 4 }}>
                              <input type="number" min="0" placeholder={t("fiscBaseDouane")} title={t("fiscBaseDouane")} defaultValue={a.base} key={`b${a.facture_id}-${a.base}`}
                                onBlur={(e) => e.target.value !== "" && Number(e.target.value) !== a.base && majAchat(a.facture_id, { base_importation: e.target.value })}
                                style={{ ...inputStyle, width: 92, padding: "3px 5px", fontSize: 11.5, textAlign: "right" }} />
                              <input type="number" min="0" placeholder={t("fiscTvaDouane")} title={t("fiscTvaDouane")} defaultValue={a.tva} key={`d${a.facture_id}-${a.tva}`}
                                onBlur={(e) => e.target.value !== "" && Number(e.target.value) !== a.tva && majAchat(a.facture_id, { montant_douane: e.target.value })}
                                style={{ ...inputStyle, width: 92, padding: "3px 5px", fontSize: 11.5, textAlign: "right" }} />
                            </div>
                          )}
                        </td>
                        <td style={tdStyle}>
                          <label style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 12 }}>
                            <input
                              type="checkbox"
                              checked={a.deductible}
                              disabled={gelee}
                              onChange={(e) => majAchat(a.facture_id, e.target.checked ? { deductible: true } : { deductible: false, motif: a.motif_non_deductible || "" })}
                            />
                            {a.deductible ? t("fiscOui") : t("fiscNon")}
                          </label>
                          {!a.deductible && (
                            <input
                              placeholder={t("fiscMotif")}
                              defaultValue={a.motif_non_deductible || ""}
                              key={`m${a.facture_id}-${a.motif_non_deductible}`}
                              disabled={gelee}
                              onBlur={(e) => e.target.value !== (a.motif_non_deductible || "") && majAchat(a.facture_id, { deductible: false, motif: e.target.value })}
                              style={{ ...inputStyle, width: 170, padding: "3px 6px", fontSize: 11.5, marginTop: 4 }}
                            />
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {onglet === "annexes" && (
              <div style={{ padding: 16, display: "grid", gap: 20 }}>
                <AnnexeTable titre={t("fiscAnnexeExonerations")} vide={t("fiscAucuneOperation")} t={t}
                  colonnes={[["code_libelle", t("fiscNature")], ["numero", t("fiscNumero")], ["date", t("fiscDate"), "date"], ["client_nom", t("fiscClient")], ["client_ninea", "NINEA"], ["base", t("fiscHT"), "n"]]}
                  lignes={calcul.annexes.exonerations} locale={locale} />
                <AnnexeTable titre={t("fiscAnnexePrecompte")} vide={t("fiscAucuneOperation")} t={t}
                  colonnes={[["numero", t("fiscNumero")], ["date", t("fiscDate"), "date"], ["client_nom", t("fiscClient")], ["client_ninea", "NINEA"], ["base", t("fiscHT"), "n"], ["precompte", t("fiscPrecompte"), "n"]]}
                  lignes={calcul.annexes.precompte} locale={locale} />
                <AnnexeTable titre={t("fiscAnnexeAchatsLocaux")} vide={t("fiscAucuneOperation")} t={t}
                  colonnes={[["fournisseur_nom", t("fiscFournisseur")], ["ninea", "NINEA"], ["nombre", t("fiscNb")], ["base", t("fiscBase"), "n"], ["tva", t("fiscTvaFacturee"), "n"], ["tva_deductible", t("fiscTvaDeductibleCol"), "n"]]}
                  lignes={calcul.annexes.achats_locaux} locale={locale} />
                <AnnexeTable titre={t("fiscAnnexeImportations")} vide={t("fiscAucuneOperation")} t={t}
                  colonnes={[["numero", t("fiscNumero")], ["date", t("fiscDate"), "date"], ["fournisseur_nom", t("fiscFournisseur")], ["base", t("fiscBaseDouane"), "n"], ["tva", t("fiscTvaDouane"), "n"]]}
                  lignes={calcul.annexes.importations} locale={locale} />
              </div>
            )}
          </div>
        </>
      )}
    </AppShell>
  );
}

function AnnexeTable({ titre, colonnes, lignes, vide, locale }) {
  return (
    <div style={{ overflowX: "auto" }}>
      <h3 style={{ fontSize: 13, color: "var(--petrol)", marginBottom: 6 }}>{titre}</h3>
      <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 560 }}>
        <thead>
          <tr>{colonnes.map(([k, lib, type]) => <th key={k} style={{ ...thStyle, textAlign: type === "n" ? "right" : "left" }}>{lib}</th>)}</tr>
        </thead>
        <tbody>
          {lignes.length === 0 && <tr><td colSpan={colonnes.length} style={{ ...tdStyle, color: "var(--sub)" }}>{vide}</td></tr>}
          {lignes.map((l, i) => (
            <tr key={i}>
              {colonnes.map(([k, , type]) => (
                <td key={k} style={{ ...tdStyle, textAlign: type === "n" ? "right" : "left", fontVariantNumeric: type === "n" ? "tabular-nums" : "normal", color: k.includes("ninea") && !l[k] ? "var(--brique)" : "inherit" }}>
                  {type === "n" ? formaterXof(l[k], locale) : type === "date" ? dateCourte(l[k], locale) : l[k] || (k.includes("ninea") ? "?" : "")}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
