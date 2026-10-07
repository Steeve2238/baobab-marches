"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { api } from "../../../../lib/api";
import { useLangue } from "../../../../lib/i18n/LanguageContext";
import AppShell from "../../../../lib/components/AppShell";
import FiscaliteSousNav from "../../../../lib/components/FiscaliteSousNav";
import CcaOnglet, { ccaVersFormulaire, ccaPourEnvoi } from "./CcaOnglet";
import {
  inputStyle, labelStyle, thStyle, tdStyle, boutonPrincipalStyle, boutonSecondaireStyle,
  STYLE_STATUT, pastilleStyle, formaterXof, dateCourte, texteAlerte,
} from "../../../../lib/fiscaliteUi";

const AVERT_GRAVES = ["DEFICIT_PERIME", "ACOMPTES_SUPERIEURS_A_IMPOT", "ECRITURES_EN_INSTANCE", "CREDIT_IMPOT_NON_IMPUTE"];
const PARAMS = [
  ["taux_is", "fiscParamTauxIs", "0.01"],
  ["imf_taux", "fiscParamImfTaux", "0.01"],
  ["imf_plafond", "fiscParamImfPlafond", "1"],
  ["imf_plancher", "fiscParamImfPlancher", "1"],
  ["dons_plafond_pct_ca", "fiscParamDons", "0.01"],
  ["report_deficit_exercices", "fiscParamReport", "1"],
];

function saisiesVersFormulaire(s) {
  const p = s.parametres || {};
  return {
    utiliser_saisie: !!s.utiliser_saisie,
    source_donnees: s.source_donnees || "AUTO",
    cca: ccaVersFormulaire(s.cca),
    resultat_comptable_manuel: s.resultat_comptable_manuel ?? "",
    ca_manuel: s.ca_manuel ?? "",
    amortissements_manuel: s.amortissements_manuel ?? "",
    imf_exonere: !!s.imf_exonere,
    imf_motif: s.imf_motif || "",
    is_precedent: s.is_precedent ?? "",
    parametres: p,
    credits_impot: (s.credits_impot || []).map((c) => ({ ...c })),
    retraitements: (s.retraitements || []).map((r) => ({ ...r })),
    ajustements: { ...(s.ajustements || {}) },
  };
}

export default function FiscaliteIsDetailPage() {
  const { t } = useLangue();
  const locale = t("dateLocale");
  const annee = Number(useParams().annee);
  const mm = (v) => formaterXof(v, locale);

  const [data, setData] = useState(null);
  const [saisies, setSaisies] = useState(null);
  const [parametresDefaut, setParametresDefaut] = useState({});
  const [typesManuels, setTypesManuels] = useState({ REINTEGRATION: [], DEDUCTION: [] });
  const [onglet, setOnglet] = useState("calcul");
  const [erreur, setErreur] = useState("");
  const [info, setInfo] = useState("");
  const [formStatut, setFormStatut] = useState(null);
  const [nouveau, setNouveau] = useState({ sens: "REINTEGRATION", code: "", libelle: "", montant: "" });
  const [paiement, setPaiement] = useState({ nature: "ACOMPTE_1", date_paiement: new Date().toISOString().slice(0, 10), montant: "", reference: "" });

  const charger = useCallback(async () => {
    setErreur("");
    try {
      const [r, liste] = await Promise.all([api.fiscaliteIsAnnee(annee), api.fiscaliteIs()]);
      setData(r);
      setSaisies(saisiesVersFormulaire(r.calcul.saisies));
      setParametresDefaut(liste.parametres_defaut);
      setTypesManuels(liste.types_manuels);
    } catch (e) {
      setErreur(e.message);
    }
  }, [annee]);
  useEffect(() => {
    charger();
  }, [charger]);

  const dossier = data?.dossier || null;
  const calcul = data?.calcul || null;
  const gele = !!dossier && (dossier.statut === "DEPOSEE" || dossier.statut === "PAYEE");
  const statut = dossier ? dossier.statut : "BROUILLON";

  /** Saisies au format attendu par l'API (nombres, parametres complets). */
  function saisiesPourEnvoi() {
    const s = saisies;
    const nombre = (v) => (v === "" || v === null || v === undefined ? null : Number(v));
    const parametres = {};
    for (const [k] of PARAMS) parametres[k] = s.parametres[k] ?? parametresDefaut[k];
    return {
      utiliser_saisie: s.utiliser_saisie,
      source_donnees: s.source_donnees || "AUTO",
      cca: ccaPourEnvoi(s.cca),
      resultat_comptable_manuel: nombre(s.resultat_comptable_manuel),
      ca_manuel: nombre(s.ca_manuel),
      amortissements_manuel: nombre(s.amortissements_manuel),
      imf_exonere: s.imf_exonere,
      imf_motif: s.imf_motif,
      is_precedent: nombre(s.is_precedent),
      parametres,
      credits_impot: s.credits_impot.map((c) => ({ libelle: c.libelle, montant: nombre(c.montant) })),
      retraitements: s.retraitements.map((r) => ({ ...r, montant: nombre(r.montant) })),
      ajustements: Object.fromEntries(Object.entries(s.ajustements).map(([k, a]) => [k, { montant: nombre(a.montant), note: a.note }])),
    };
  }

  async function executer(fn, message) {
    setErreur("");
    setInfo("");
    try {
      await fn();
      if (message) setInfo(message);
      await charger();
    } catch (e) {
      setErreur(e.message);
    }
  }
  async function recalculer() {
    setErreur("");
    try {
      const r = await api.fiscaliteIsSimuler(annee, saisiesPourEnvoi());
      setData({ ...data, calcul: r.calcul });
    } catch (e) {
      setErreur(e.message);
    }
  }
  const enregistrer = () => executer(() => api.fiscaliteIsSaisies(annee, saisiesPourEnvoi()), t("fiscIsInfoEnregistre"));
  const preparer = () => executer(() => api.fiscaliteIsPreparer(annee, saisiesPourEnvoi()), t("fiscIsInfoPreparee"));
  const rouvrir = () => executer(() => api.fiscaliteIsStatut(annee, { action: "rouvrir" }), t("fiscInfoRouverte"));
  function validerFormStatut() {
    const { action, date, reference } = formStatut;
    const corps = action === "deposer" ? { action, date_depot: date, reference_depot: reference } : { action, date_paiement: date };
    executer(() => api.fiscaliteIsStatut(annee, corps), action === "deposer" ? t("fiscInfoDeposee") : t("fiscInfoPayee")).then(() => setFormStatut(null));
  }
  async function exporter(format) {
    setErreur("");
    try {
      await api.fiscaliteIsExporter(annee, format);
    } catch (e) {
      setErreur(e.message);
    }
  }

  function majSaisie(champ, valeur) {
    setSaisies({ ...saisies, [champ]: valeur });
  }
  function majParametre(k, v) {
    setSaisies({ ...saisies, parametres: { ...saisies.parametres, [k]: v } });
  }
  function ajouterLigne() {
    if (!nouveau.montant) return;
    const code = nouveau.code || (typesManuels[nouveau.sens][typesManuels[nouveau.sens].length - 1] || {}).code;
    setSaisies({ ...saisies, retraitements: [...saisies.retraitements, { id: `n${Date.now()}`, sens: nouveau.sens, code, libelle: nouveau.libelle, montant: nouveau.montant, note: "" }] });
    setNouveau({ ...nouveau, libelle: "", montant: "" });
  }
  async function ajouterPaiement(e) {
    e.preventDefault();
    await executer(() => api.fiscaliteIsAjouterPaiement(annee, { ...paiement, montant: Number(paiement.montant) }), t("fiscIsInfoPaiement"));
    setPaiement({ ...paiement, montant: "", reference: "" });
  }

  const ongletBtn = (cle, libelle) => (
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
      {libelle}
    </button>
  );
  const nombreInput = (valeur, onChange, largeur = 140, desactive = gele) => (
    <input type="number" step="1" value={valeur ?? ""} disabled={desactive} onChange={(e) => onChange(e.target.value)} style={{ ...inputStyle, width: largeur, textAlign: "right", padding: "4px 8px" }} />
  );
  const carte = (titre, valeur, couleur) => (
    <div className="card" style={couleur ? { borderLeft: `3px solid ${couleur}` } : undefined}>
      <div style={{ fontSize: 11, color: "var(--sub)", fontWeight: 700 }}>{titre}</div>
      <div style={{ fontSize: 19, fontWeight: 700, marginTop: 4, fontVariantNumeric: "tabular-nums" }}>{valeur}</div>
      <div style={{ fontSize: 11.5, color: "var(--sub)" }}>XOF</div>
    </div>
  );

  const libelleRet = (l) => l.libelle || t(`fiscRet_${l.code}`);

  function ligneRetraitement(l) {
    const manuel = l.mode === "MANUEL";
    const aj = saisies.ajustements[l.code];
    return (
      <tr key={l.cle}>
        <td style={tdStyle}>
          {libelleRet(l)}
          {l.mode === "SUGGESTION" && <span style={{ ...pastilleStyle({ color: "#8A6200", background: "rgba(214,160,40,0.16)" }), marginLeft: 8 }}>{t("fiscRetSuggestion")}</span>}
          {!manuel && l.comptes.length > 0 && <div style={{ fontSize: 11, color: "var(--sub)" }}>{t("fiscRetComptes")} {l.comptes.join(", ")}</div>}
        </td>
        <td style={{ ...tdStyle, color: "var(--sub)", fontSize: 11.5 }}>{l.reference}</td>
        <td style={{ ...tdStyle, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{l.comptabilise === null ? "" : mm(l.comptabilise)}</td>
        <td style={{ ...tdStyle, textAlign: "right" }}>
          {manuel
            ? nombreInput(saisies.retraitements.find((r) => r.id === l.id)?.montant, (v) => setSaisies({ ...saisies, retraitements: saisies.retraitements.map((r) => (r.id === l.id ? { ...r, montant: v } : r)) }), 130)
            : nombreInput(aj ? aj.montant : l.montant, (v) => setSaisies({ ...saisies, ajustements: { ...saisies.ajustements, [l.code]: { montant: v, note: aj?.note || "" } } }), 130)}
        </td>
        <td style={{ ...tdStyle, textAlign: "right", whiteSpace: "nowrap" }}>
          {!gele && manuel && <button style={boutonSecondaireStyle} onClick={() => setSaisies({ ...saisies, retraitements: saisies.retraitements.filter((r) => r.id !== l.id) })}>{t("fiscSupprimer")}</button>}
          {!gele && !manuel && aj && (
            <button
              style={boutonSecondaireStyle}
              onClick={() => {
                const copie = { ...saisies.ajustements };
                delete copie[l.code];
                setSaisies({ ...saisies, ajustements: copie });
              }}
            >
              {t("fiscRetRestaurer")}
            </button>
          )}
        </td>
      </tr>
    );
  }

  function tableRetraitements(sens, lignes, total) {
    return (
      <div style={{ marginBottom: 18 }}>
        <h3 style={{ fontSize: 13.5, color: "var(--petrol)", marginBottom: 6 }}>{sens === "REINTEGRATION" ? t("fiscRetReintegrations") : t("fiscRetDeductions")}</h3>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr>
              <th style={thStyle}>{t("fiscRetNature")}</th>
              <th style={thStyle}>{t("fiscRetReference")}</th>
              <th style={{ ...thStyle, textAlign: "right" }}>{t("fiscRetComptabilise")}</th>
              <th style={{ ...thStyle, textAlign: "right", width: 160 }}>{t("fiscRetRetenu")}</th>
              <th style={thStyle}></th>
            </tr>
          </thead>
          <tbody>
            {lignes.length === 0 && <tr><td style={{ ...tdStyle, color: "var(--sub)" }} colSpan={5}>{t("fiscRetAucune")}</td></tr>}
            {lignes.map(ligneRetraitement)}
            <tr style={{ background: "var(--line-soft)" }}>
              <td style={{ ...tdStyle, fontWeight: 700 }} colSpan={3}>{t("fiscTotal")}</td>
              <td style={{ ...tdStyle, textAlign: "right", fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>{mm(total)}</td>
              <td style={tdStyle}></td>
            </tr>
          </tbody>
        </table>
      </div>
    );
  }

  const ligneChaine = (libelle, valeur, { fort = false, ref = "" } = {}) => (
    <tr key={libelle} style={fort ? { background: "var(--line-soft)" } : {}}>
      <td style={{ ...tdStyle, fontWeight: fort ? 700 : 500 }}>{libelle}</td>
      <td style={{ ...tdStyle, color: "var(--sub)", fontSize: 11.5 }}>{ref}</td>
      <td style={{ ...tdStyle, textAlign: "right", fontWeight: fort ? 700 : 500, fontVariantNumeric: "tabular-nums" }}>{mm(valeur)}</td>
    </tr>
  );

  return (
    <AppShell title={`${t("fiscIsTitreExercice")} ${annee}`} subNav={<FiscaliteSousNav />}>
      {erreur && <p style={{ color: "var(--brique)", fontSize: 12.5, marginBottom: 12 }}>{erreur}</p>}
      {info && <p style={{ color: "#2E7D5B", fontSize: 12.5, marginBottom: 12 }}>{info}</p>}

      <div className="card" style={{ marginBottom: 14, display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
        <Link href={`/fiscalite/is/${annee - 1}`} style={boutonSecondaireStyle}>‹ {annee - 1}</Link>
        <Link href={`/fiscalite/is/${annee + 1}`} style={boutonSecondaireStyle}>{annee + 1} ›</Link>
        <Link href="/fiscalite/is" style={{ ...boutonSecondaireStyle, border: "none" }}>{t("fiscIsTousExercices")}</Link>
        <span style={{ flex: 1 }} />
        {dossier && dossier.statut !== "BROUILLON" && <span style={pastilleStyle(STYLE_STATUT[statut])}>{t(`fiscStatut_${statut}`)}</span>}
        <span style={{ fontSize: 12, color: "var(--sub)" }}>
          {t("fiscIsDateDeclaration")} {dateCourte(`${annee + 1}-04-30`, locale)} · {t("fiscIsDateSolde")} {dateCourte(`${annee + 1}-06-15`, locale)}
        </span>
      </div>

      {!calcul && !erreur && <p style={{ fontSize: 12.5, color: "var(--sub)" }}>{t("loading")}</p>}

      {calcul && saisies && (
        <>
          {gele && data.live_differe_du_depot && (
            <div className="card" style={{ marginBottom: 12, borderLeft: "3px solid var(--ocre)", fontSize: 12.5, lineHeight: 1.5 }}>{t("fiscLiveDiffere")}</div>
          )}

          <div style={{ fontSize: 12, color: "var(--sub)", marginBottom: 10 }}>
            {calcul.exercice
              ? `${t("fiscIsExercice")} : ${calcul.exercice.libelle} (${dateCourte(calcul.exercice.date_debut, locale)} → ${dateCourte(calcul.exercice.date_fin, locale)})`
              : t("fiscIsSansExercice")}
            {" · "}
            {calcul.source === "COMPTABILITE" ? t("fiscIsSourceCompta") : calcul.source === "IMPORT" ? t("fiscIsSourceImport") : t("fiscIsSourceSaisie")}
          </div>

          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 14 }}>
            {!gele && <button style={boutonSecondaireStyle} onClick={recalculer}>{t("fiscRecalculer")}</button>}
            {!gele && <button style={boutonSecondaireStyle} onClick={enregistrer}>{t("fiscIsEnregistrerSaisies")}</button>}
            {!gele && <button style={boutonPrincipalStyle} onClick={preparer}>{statut === "PREPAREE" ? t("fiscMettreAJour") : t("fiscEnregistrerPreparation")}</button>}
            {statut === "PREPAREE" && <button style={boutonSecondaireStyle} onClick={() => setFormStatut({ action: "deposer", date: new Date().toISOString().slice(0, 10), reference: "" })}>{t("fiscMarquerDeposee")}</button>}
            {statut === "DEPOSEE" && <button style={boutonSecondaireStyle} onClick={() => setFormStatut({ action: "payer", date: new Date().toISOString().slice(0, 10), reference: "" })}>{t("fiscMarquerPayee")}</button>}
            {gele && <button style={boutonSecondaireStyle} onClick={rouvrir}>{t("fiscRouvrir")}</button>}
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

          {dossier && dossier.date_depot && (
            <p style={{ fontSize: 12, color: "var(--sub)", marginTop: -4, marginBottom: 12 }}>
              {t("fiscDeposeeLe")} {dateCourte(dossier.date_depot, locale)}
              {dossier.reference_depot ? ` — ${t("fiscReference")} ${dossier.reference_depot}` : ""}
              {dossier.date_paiement ? ` · ${t("fiscPayeeLe")} ${dateCourte(dossier.date_paiement, locale)}` : ""}
            </p>
          )}

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))", gap: 12, marginBottom: 14 }}>
            {carte(t("fiscIsResultatFiscal"), mm(calcul.resultat_fiscal_imposable))}
            {carte(`${t("fiscIsImpotDu")} (${calcul.impot_applicable})`, mm(calcul.impot_du))}
            {carte(t("fiscSoldeAPayer"), mm(calcul.solde_a_payer), calcul.solde_a_payer > 0 ? "var(--brique)" : "#2E7D5B")}
          </div>

          {calcul.avertissements.length > 0 && (
            <div className="card" style={{ marginBottom: 14 }}>
              <h3 style={{ fontSize: 13, color: "var(--petrol)", marginBottom: 6 }}>{t("fiscAvertissements")} ({calcul.avertissements.length})</h3>
              <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12.3, lineHeight: 1.6 }}>
                {calcul.avertissements.map((a, i) => (
                  <li key={i} style={{ color: AVERT_GRAVES.includes(a.code) ? "var(--brique)" : "inherit" }}>{texteAlerte(t, "fiscAvIs_", a, locale)}</li>
                ))}
              </ul>
            </div>
          )}

          <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
            {ongletBtn("calcul", t("fiscIsOngletCalcul"))}
            {ongletBtn("retraitements", t("fiscIsOngletRetraitements"))}
            {ongletBtn("cca", t("fiscIsOngletCca"))}
            {ongletBtn("deficits", t("fiscIsOngletDeficits"))}
            {ongletBtn("acomptes", t("fiscIsOngletAcomptes"))}
            {ongletBtn("parametres", t("fiscIsOngletParametres"))}
          </div>
          <div className="card" style={{ borderTopLeftRadius: 0, overflowX: "auto" }}>
            {onglet === "calcul" && (
              <table style={{ width: "100%", maxWidth: 820, borderCollapse: "collapse" }}>
                <thead>
                  <tr>
                    <th style={thStyle}>{t("fiscDesignation")}</th>
                    <th style={thStyle}>{t("fiscRetReference")}</th>
                    <th style={{ ...thStyle, textAlign: "right", width: 160 }}>{t("fiscMontant")}</th>
                  </tr>
                </thead>
                <tbody>
                  {ligneChaine(t("fiscIsLResultatComptable"), calcul.comptable.resultat_comptable, { ref: calcul.source === "COMPTABILITE" ? t("fiscIsRefBalance") : t("fiscIsRefSaisie") })}
                  {ligneChaine(`+ ${t("fiscRetReintegrations")}`, calcul.retraitements.total_reintegrations, { ref: "art. 8 à 11" })}
                  {ligneChaine(`- ${t("fiscRetDeductions")}`, calcul.retraitements.total_deductions, { ref: "art. 11, 12-25" })}
                  {ligneChaine(`= ${t("fiscIsLFiscalAvant")}`, calcul.resultat_fiscal_avant_deficits, { fort: true, ref: "art. 16-2" })}
                  {ligneChaine(`- ${t("fiscIsLDeficitsImputes")}`, calcul.total_imputations, { ref: "art. 16" })}
                  {ligneChaine(`= ${t("fiscIsResultatFiscal")}`, calcul.resultat_fiscal_imposable, { fort: true })}
                  {ligneChaine(t("fiscIsLBase"), calcul.base_is, { ref: "art. 36" })}
                  {ligneChaine(`${t("fiscIsLIs")} (${calcul.parametres.taux_is} %)`, calcul.is_calcule, { ref: "art. 36" })}
                  {ligneChaine(t("fiscIsLCa"), calcul.imf.ca, { ref: t("fiscIsRefBaseImf") })}
                  {ligneChaine(`${t("fiscIsLImf")} (${calcul.imf.taux} %)`, calcul.imf.du, { ref: calcul.imf.exonere ? t("fiscIsImfExonere") : "art. 38 à 40" })}
                  {ligneChaine(`${t("fiscIsLCredits")}`, calcul.credits_impot.impute, { ref: "art. 37" })}
                  {ligneChaine(`${t("fiscIsImpotDu")} — ${calcul.impot_applicable}`, calcul.impot_du, { fort: true, ref: t("fiscIsRefMax") })}
                  {ligneChaine(t("fiscIsLAcomptes"), calcul.acomptes.verses, { ref: "art. 213-215" })}
                  {ligneChaine(t("fiscSoldeAPayer"), calcul.solde_a_payer, { fort: true, ref: "art. 214" })}
                </tbody>
              </table>
            )}

            {onglet === "retraitements" && (
              <>
                <p style={{ fontSize: 12, color: "var(--sub)", marginBottom: 12, maxWidth: 800, lineHeight: 1.5 }}>{t("fiscRetAide")}</p>
                {tableRetraitements("REINTEGRATION", calcul.retraitements.reintegrations, calcul.retraitements.total_reintegrations)}
                {tableRetraitements("DEDUCTION", calcul.retraitements.deductions, calcul.retraitements.total_deductions)}
                {!gele && (
                  <div style={{ display: "flex", gap: 10, alignItems: "flex-end", flexWrap: "wrap", borderTop: "1px solid var(--line)", paddingTop: 12 }}>
                    <div>
                      <label style={labelStyle}>{t("fiscRetSens")}</label>
                      <select value={nouveau.sens} onChange={(e) => setNouveau({ ...nouveau, sens: e.target.value, code: "" })} style={{ ...inputStyle, width: 160 }}>
                        <option value="REINTEGRATION">{t("fiscRetReintegration")}</option>
                        <option value="DEDUCTION">{t("fiscRetDeduction")}</option>
                      </select>
                    </div>
                    <div>
                      <label style={labelStyle}>{t("fiscRetNature")}</label>
                      <select value={nouveau.code || (typesManuels[nouveau.sens][typesManuels[nouveau.sens].length - 1] || {}).code || ""} onChange={(e) => setNouveau({ ...nouveau, code: e.target.value })} style={{ ...inputStyle, width: 330 }}>
                        {typesManuels[nouveau.sens].map((x) => <option key={x.code} value={x.code}>{t(`fiscRet_${x.code}`)} ({x.reference})</option>)}
                      </select>
                    </div>
                    <div>
                      <label style={labelStyle}>{t("fiscRetPrecision")}</label>
                      <input value={nouveau.libelle} onChange={(e) => setNouveau({ ...nouveau, libelle: e.target.value })} style={{ ...inputStyle, width: 200 }} />
                    </div>
                    <div>
                      <label style={labelStyle}>{t("fiscMontant")}</label>
                      {nombreInput(nouveau.montant, (v) => setNouveau({ ...nouveau, montant: v }), 140, false)}
                    </div>
                    <button style={boutonSecondaireStyle} onClick={ajouterLigne}>{t("fiscRetAjouter")}</button>
                  </div>
                )}
              </>
            )}

            {onglet === "cca" && (
              <CcaOnglet t={t} locale={locale} calcul={calcul} saisies={saisies} setSaisies={setSaisies} gele={gele} annee={annee} executer={executer} setErreur={setErreur} setInfo={setInfo} />
            )}

            {onglet === "deficits" && (
              <>
                <p style={{ fontSize: 12, color: "var(--sub)", marginBottom: 12, maxWidth: 800, lineHeight: 1.5 }}>{t("fiscIsDeficitsAide")}</p>
                <table style={{ width: "100%", maxWidth: 760, borderCollapse: "collapse", marginBottom: 14 }}>
                  <thead>
                    <tr>
                      <th style={thStyle}>{t("fiscDeficitOrigine")}</th>
                      <th style={thStyle}>{t("fiscDeficitNature")}</th>
                      <th style={{ ...thStyle, textAlign: "right" }}>{t("fiscIsImpute")}</th>
                      <th style={{ ...thStyle, textAlign: "right" }}>{t("fiscDeficitReste")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {calcul.imputations.length === 0 && <tr><td style={{ ...tdStyle, color: "var(--sub)" }} colSpan={4}>{t("fiscIsAucuneImputation")}</td></tr>}
                    {calcul.imputations.map((i) => (
                      <tr key={i.deficit_id}>
                        <td style={{ ...tdStyle, fontWeight: 700 }}>{i.annee_origine}</td>
                        <td style={tdStyle}>{t(`fiscDeficitType_${i.type}`)}</td>
                        <td style={{ ...tdStyle, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{mm(i.montant)}</td>
                        <td style={{ ...tdStyle, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{mm(i.reste_apres)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {calcul.deficit_cree.ordinaire + calcul.deficit_cree.amortissement_differe > 0 && (
                  <div className="card" style={{ borderLeft: "3px solid var(--ocre)", fontSize: 12.5, lineHeight: 1.6, maxWidth: 760 }}>
                    <strong>{t("fiscIsDeficitConstate")}</strong>
                    <div>{t("fiscDeficitType_ORDINAIRE")} : {mm(calcul.deficit_cree.ordinaire)} XOF</div>
                    <div>{t("fiscDeficitType_AMORTISSEMENT_DIFFERE")} : {mm(calcul.deficit_cree.amortissement_differe)} XOF</div>
                    <div style={{ color: "var(--sub)" }}>{t("fiscIsDeficitConstateAide")}</div>
                  </div>
                )}
                <p style={{ marginTop: 12 }}><Link href="/fiscalite/is" style={boutonSecondaireStyle}>{t("fiscIsGererDeficits")}</Link></p>
              </>
            )}

            {onglet === "acomptes" && (
              <>
                <p style={{ fontSize: 12, color: "var(--sub)", marginBottom: 12, maxWidth: 800, lineHeight: 1.5 }}>{t("fiscIsAcomptesAide")}</p>
                <table style={{ width: "100%", maxWidth: 820, borderCollapse: "collapse", marginBottom: 14 }}>
                  <thead>
                    <tr>
                      <th style={thStyle}>{t("fiscIsNaturePaiement")}</th>
                      <th style={thStyle}>{t("fiscDatePaiement")}</th>
                      <th style={thStyle}>{t("fiscReference")}</th>
                      <th style={{ ...thStyle, textAlign: "right" }}>{t("fiscMontant")}</th>
                      <th style={thStyle}></th>
                    </tr>
                  </thead>
                  <tbody>
                    {calcul.acomptes.detail.length === 0 && <tr><td style={{ ...tdStyle, color: "var(--sub)" }} colSpan={5}>{t("fiscIsAucunPaiement")}</td></tr>}
                    {calcul.acomptes.detail.map((p) => (
                      <tr key={p.id}>
                        <td style={tdStyle}>{t(`fiscIsPaiement_${p.nature}`)}</td>
                        <td style={tdStyle}>{dateCourte(p.date_paiement, locale)}</td>
                        <td style={tdStyle}>{p.reference || ""}</td>
                        <td style={{ ...tdStyle, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{mm(p.montant)}</td>
                        <td style={{ ...tdStyle, textAlign: "right" }}>
                          {!gele && <button style={boutonSecondaireStyle} onClick={() => executer(() => api.fiscaliteIsSupprimerPaiement(p.id))}>{t("fiscSupprimer")}</button>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <form onSubmit={ajouterPaiement} style={{ display: "flex", gap: 10, alignItems: "flex-end", flexWrap: "wrap", marginBottom: 18 }}>
                  <div>
                    <label style={labelStyle}>{t("fiscIsNaturePaiement")}</label>
                    <select value={paiement.nature} onChange={(e) => setPaiement({ ...paiement, nature: e.target.value })} style={{ ...inputStyle, width: 170 }}>
                      {["ACOMPTE_1", "ACOMPTE_2", "SOLDE", "AUTRE"].map((n) => <option key={n} value={n}>{t(`fiscIsPaiement_${n}`)}</option>)}
                    </select>
                  </div>
                  <div>
                    <label style={labelStyle}>{t("fiscDatePaiement")}</label>
                    <input type="date" value={paiement.date_paiement} onChange={(e) => setPaiement({ ...paiement, date_paiement: e.target.value })} style={{ ...inputStyle, width: 160 }} required />
                  </div>
                  <div>
                    <label style={labelStyle}>{t("fiscMontant")}</label>
                    <input type="number" min="1" value={paiement.montant} onChange={(e) => setPaiement({ ...paiement, montant: e.target.value })} style={{ ...inputStyle, width: 140, textAlign: "right" }} required />
                  </div>
                  <div>
                    <label style={labelStyle}>{t("fiscReference")}</label>
                    <input value={paiement.reference} onChange={(e) => setPaiement({ ...paiement, reference: e.target.value })} style={{ ...inputStyle, width: 160 }} />
                  </div>
                  <button type="submit" style={boutonPrincipalStyle}>{t("fiscIsAjouterPaiement")}</button>
                </form>
                <div className="card" style={{ maxWidth: 820, fontSize: 12.5, lineHeight: 1.7 }}>
                  <h3 style={{ fontSize: 13, color: "var(--petrol)", marginBottom: 6 }}>{t("fiscIsPlanTitre")}</h3>
                  {calcul.acomptes.plan.base === null ? (
                    <div style={{ color: "var(--sub)" }}>{t("fiscIsPlanBaseAbsente")}</div>
                  ) : (
                    <>
                      <div>{t("fiscIsPlanBase")} : <strong>{mm(calcul.acomptes.plan.base)} XOF</strong> ({calcul.acomptes.plan.origine === "SAISIE" ? t("fiscSource_SAISIE") : t("fiscIsPlanDossier")})</div>
                      <div>{t("fiscIsPaiement_ACOMPTE_1")} — {t("fiscLimite")} {dateCourte(calcul.acomptes.plan.echeance_1, locale)} : <strong>{mm(calcul.acomptes.plan.acompte_1)} XOF</strong> <span style={{ color: "var(--sub)" }}>({t("fiscIsPlanMinImf")})</span></div>
                      <div>{t("fiscIsPaiement_ACOMPTE_2")} — {t("fiscLimite")} {dateCourte(calcul.acomptes.plan.echeance_2, locale)} : <strong>{mm(calcul.acomptes.plan.acompte_2)} XOF</strong></div>
                    </>
                  )}
                </div>
              </>
            )}

            {onglet === "parametres" && (
              <div style={{ maxWidth: 820 }}>
                <div style={{ marginBottom: 16 }}>
                  <label style={labelStyle}>{t("fiscIsSourceDonnees")}</label>
                  <select disabled={gele} value={saisies.source_donnees} onChange={(e) => majSaisie("source_donnees", e.target.value)} style={{ ...inputStyle, width: 320 }}>
                    <option value="AUTO">{t("fiscIsSourceAuto")}</option>
                    {calcul.donnees?.sources_disponibles?.compta_module_actif && <option value="COMPTABILITE">{t("fiscIsSourceOptCompta")}</option>}
                    <option value="IMPORT">{t("fiscIsSourceOptImport")}</option>
                  </select>
                  <div style={{ fontSize: 11.5, color: "var(--sub)", marginTop: 4 }}>
                    {t("fiscIsSourceDonneesAide")} <Link href="/fiscalite/donnees" style={{ color: "var(--petrol)" }}>{t("fiscNavDonnees")}</Link>
                  </div>
                </div>
                <p style={{ fontSize: 12, color: "var(--sub)", marginBottom: 12, lineHeight: 1.5 }}>{t("fiscIsParamAide")}</p>
                <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 16 }}>
                  {PARAMS.map(([cle, libelle, pas]) => (
                    <div key={cle}>
                      <label style={labelStyle}>{t(libelle)}</label>
                      <input type="number" step={pas} disabled={gele} value={saisies.parametres[cle] ?? parametresDefaut[cle] ?? ""} onChange={(e) => majParametre(cle, e.target.value)} style={{ ...inputStyle, width: 150, textAlign: "right" }} />
                    </div>
                  ))}
                </div>
                <div style={{ marginBottom: 16 }}>
                  <label style={{ ...labelStyle, display: "flex", gap: 8, alignItems: "center" }}>
                    <input type="checkbox" disabled={gele} checked={saisies.imf_exonere} onChange={(e) => majSaisie("imf_exonere", e.target.checked)} />
                    {t("fiscIsImfExonereLabel")}
                  </label>
                  {saisies.imf_exonere && <input disabled={gele} placeholder={t("fiscIsImfMotif")} value={saisies.imf_motif} onChange={(e) => majSaisie("imf_motif", e.target.value)} style={{ ...inputStyle, width: 420, marginTop: 6 }} />}
                </div>
                <div style={{ marginBottom: 16 }}>
                  <label style={labelStyle}>{t("fiscIsPrecedent")}</label>
                  {nombreInput(saisies.is_precedent, (v) => majSaisie("is_precedent", v), 180)}
                  <div style={{ fontSize: 11.5, color: "var(--sub)", marginTop: 4 }}>{t("fiscIsPrecedentAide")}</div>
                </div>
                <h3 style={{ fontSize: 13.5, color: "var(--petrol)", marginBottom: 6 }}>{t("fiscIsCreditsTitre")}</h3>
                <p style={{ fontSize: 12, color: "var(--sub)", marginBottom: 8, lineHeight: 1.5 }}>{t("fiscIsCreditsAide")}</p>
                {saisies.credits_impot.map((c, i) => (
                  <div key={i} style={{ display: "flex", gap: 8, marginBottom: 6 }}>
                    <input disabled={gele} value={c.libelle} onChange={(e) => setSaisies({ ...saisies, credits_impot: saisies.credits_impot.map((x, j) => (j === i ? { ...x, libelle: e.target.value } : x)) })} style={{ ...inputStyle, width: 320 }} />
                    {nombreInput(c.montant, (v) => setSaisies({ ...saisies, credits_impot: saisies.credits_impot.map((x, j) => (j === i ? { ...x, montant: v } : x)) }), 150)}
                    {!gele && <button style={boutonSecondaireStyle} onClick={() => setSaisies({ ...saisies, credits_impot: saisies.credits_impot.filter((_, j) => j !== i) })}>{t("fiscSupprimer")}</button>}
                  </div>
                ))}
                {!gele && <button style={boutonSecondaireStyle} onClick={() => setSaisies({ ...saisies, credits_impot: [...saisies.credits_impot, { libelle: "", montant: "" }] })}>{t("fiscIsCreditAjouter")}</button>}

                <h3 style={{ fontSize: 13.5, color: "var(--petrol)", margin: "18px 0 6px" }}>{t("fiscIsManuelTitre")}</h3>
                <p style={{ fontSize: 12, color: "var(--sub)", marginBottom: 8, lineHeight: 1.5 }}>{t("fiscIsManuelAide")}</p>
                <label style={{ ...labelStyle, display: "flex", gap: 8, alignItems: "center", marginBottom: 8 }}>
                  <input type="checkbox" disabled={gele} checked={saisies.utiliser_saisie} onChange={(e) => majSaisie("utiliser_saisie", e.target.checked)} />
                  {t("fiscIsManuelUtiliser")}
                </label>
                <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
                  <div>
                    <label style={labelStyle}>{t("fiscIsLResultatComptable")}</label>
                    {nombreInput(saisies.resultat_comptable_manuel, (v) => majSaisie("resultat_comptable_manuel", v), 170)}
                  </div>
                  <div>
                    <label style={labelStyle}>{t("fiscIsLCa")}</label>
                    {nombreInput(saisies.ca_manuel, (v) => majSaisie("ca_manuel", v), 170)}
                  </div>
                  <div>
                    <label style={labelStyle}>{t("fiscIsAmortissements")}</label>
                    {nombreInput(saisies.amortissements_manuel, (v) => majSaisie("amortissements_manuel", v), 170)}
                  </div>
                </div>
              </div>
            )}
          </div>
        </>
      )}
    </AppShell>
  );
}
