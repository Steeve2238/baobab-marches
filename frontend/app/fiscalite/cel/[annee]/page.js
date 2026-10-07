"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { api } from "../../../../lib/api";
import { useLangue } from "../../../../lib/i18n/LanguageContext";
import AppShell from "../../../../lib/components/AppShell";
import FiscaliteSousNav from "../../../../lib/components/FiscaliteSousNav";
import FiscDossierBarre from "../../../../lib/components/FiscDossierBarre";
import { inputStyle, labelStyle, thStyle, tdStyle, boutonPrincipalStyle, boutonSecondaireStyle, formaterXof, dateCourte, texteAlerte } from "../../../../lib/fiscaliteUi";

const AVERT_GRAVES = ["CEL_EXERCICE_PRECEDENT_ABSENT", "ECRITURES_EN_INSTANCE", "CEL_VA_NEGATIVE", "CEL_IMMEUBLES_ACTIF_A_SAISIR", "CEL_LOYERS_A_SAISIR", "CEL_VA_A_SAISIR"];
const PARAMS = [
  ["taux_locatif_loue", "fiscCelParamTauxLoue"],
  ["taux_locatif_actif", "fiscCelParamTauxActif"],
  ["coef_valeur_locative_actif", "fiscCelParamCoef"],
  ["cva_taux", "fiscCelParamCvaTaux"],
  ["cva_minimum_taux", "fiscCelParamMinimum"],
  ["cva_minimum_taux_faible_marge", "fiscCelParamMinimumFaible"],
  ["plafond_va_pct_ca", "fiscCelParamPlafond"],
];
const LOCAL_VIDE = { libelle: "", commune: "", nature: "LOUE", loyer_annuel: "", prix_revient: "", valeur_locative_reelle: "", regime: "NORMAL", part_professionnelle_pct: "100", donne_en_location: false, exonere: false, motif_exoneration: "", date_debut: "", date_fin: "", note: "" };

function saisiesVersFormulaire(s) {
  return {
    source_donnees: s.source_donnees || "AUTO",
    utiliser_saisie: !!s.utiliser_saisie,
    regime_cva: s.regime_cva || "AUTO",
    faible_marge: !!s.faible_marge,
    cree_en_annee: !!s.cree_en_annee,
    hors_champ: !!s.hors_champ,
    ca_manuel: s.ca_manuel ?? "",
    va_manuel: s.va_manuel ?? "",
    va_ajustement: s.va_ajustement || "",
    parametres: { ...(s.parametres || {}) },
  };
}

export default function FiscaliteCelDetailPage() {
  const { t } = useLangue();
  const locale = t("dateLocale");
  const annee = Number(useParams().annee);
  const mm = (v) => formaterXof(v, locale);
  const nb = (v) => Number(v).toLocaleString(locale, { maximumFractionDigits: 4 });

  const [data, setData] = useState(null);
  const [saisies, setSaisies] = useState(null);
  const [calculLive, setCalculLive] = useState(null);
  const [locaux, setLocaux] = useState([]);
  const [parametresDefaut, setParametresDefaut] = useState({});
  const [natures, setNatures] = useState([]);
  const [regimes, setRegimes] = useState([]);
  const [onglet, setOnglet] = useState("calcul");
  const [erreur, setErreur] = useState("");
  const [info, setInfo] = useState("");
  const [local, setLocal] = useState(null); // formulaire de local (id absent = creation)

  const charger = useCallback(async () => {
    setErreur("");
    try {
      const [r, liste] = await Promise.all([api.fiscaliteCelAnnee(annee), api.fiscaliteCel()]);
      setData(r);
      setCalculLive(null);
      setLocaux(r.locaux);
      setSaisies(saisiesVersFormulaire(r.calcul.saisies || {}));
      setParametresDefaut(liste.parametres_defaut);
      setNatures(liste.natures);
      setRegimes(liste.regimes);
    } catch (e) {
      setErreur(e.message);
    }
  }, [annee]);
  useEffect(() => {
    charger();
  }, [charger]);

  const dossier = data?.dossier || null;
  const gele = !!dossier && (dossier.statut === "DEPOSEE" || dossier.statut === "PAYEE");
  const calcul = calculLive || data?.calcul || null;

  function saisiesPourEnvoi() {
    const s = saisies;
    const nombre = (v) => (v === "" || v === null || v === undefined ? null : Number(v));
    const parametres = {};
    for (const [k] of PARAMS) if (s.parametres[k] !== undefined && s.parametres[k] !== "") parametres[k] = Number(s.parametres[k]);
    return { ...s, ca_manuel: nombre(s.ca_manuel), va_manuel: nombre(s.va_manuel), va_ajustement: nombre(s.va_ajustement) || 0, parametres };
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
      const r = await api.fiscaliteCelSimuler(annee, saisiesPourEnvoi());
      setCalculLive(r.calcul);
    } catch (e) {
      setErreur(e.message);
    }
  }
  const enregistrer = () => executer(() => api.fiscaliteCelSaisies(annee, saisiesPourEnvoi()), t("fiscIsInfoEnregistre"));
  const preparer = () => executer(() => api.fiscaliteCelPreparer(annee, saisiesPourEnvoi()), t("fiscInfoPreparee"));
  const changerStatut = (corps) => executer(() => api.fiscaliteCelStatut(annee, corps), corps.action === "deposer" ? t("fiscInfoDeposee") : corps.action === "payer" ? t("fiscInfoPayee") : t("fiscInfoRouverte"));
  async function exporter(format) {
    setErreur("");
    try {
      await api.fiscaliteCelExporter(annee, format);
    } catch (e) {
      setErreur(e.message);
    }
  }

  async function enregistrerLocal(e) {
    e.preventDefault();
    const corps = { ...local, loyer_annuel: Number(local.loyer_annuel || 0), prix_revient: Number(local.prix_revient || 0), valeur_locative_reelle: Number(local.valeur_locative_reelle || 0), part_professionnelle_pct: Number(local.part_professionnelle_pct === "" ? 100 : local.part_professionnelle_pct), date_debut: local.date_debut || null, date_fin: local.date_fin || null };
    await executer(() => (local.id ? api.fiscaliteCelModifierLocal(local.id, corps) : api.fiscaliteCelAjouterLocal(corps)), t("fiscCelInfoLocal"));
    setLocal(null);
  }
  const supprimerLocal = (id) => executer(() => api.fiscaliteCelSupprimerLocal(id));
  const editerLocal = (l) => setLocal({ ...LOCAL_VIDE, ...l, loyer_annuel: l.loyer_annuel || "", prix_revient: l.prix_revient || "", valeur_locative_reelle: l.valeur_locative_reelle || "", date_debut: l.date_debut || "", date_fin: l.date_fin || "", commune: l.commune || "", motif_exoneration: l.motif_exoneration || "", note: l.note || "", part_professionnelle_pct: String(l.part_professionnelle_pct) });

  const majSaisie = (champ, valeur) => setSaisies({ ...saisies, [champ]: valeur });
  const majParametre = (k, v) => setSaisies({ ...saisies, parametres: { ...saisies.parametres, [k]: v } });

  const ongletBtn = (cle, libelle) => (
    <button
      key={cle}
      onClick={() => setOnglet(cle)}
      style={{ padding: "7px 14px", borderRadius: "8px 8px 0 0", border: "1px solid var(--line)", borderBottom: onglet === cle ? "1px solid #fff" : "1px solid var(--line)", background: onglet === cle ? "#fff" : "var(--line-soft)", fontSize: 12.5, fontWeight: onglet === cle ? 700 : 500, color: "var(--petrol)", marginBottom: -1 }}
    >
      {libelle}
    </button>
  );
  const carte = (titre, valeur, sous, couleur) => (
    <div className="card" style={couleur ? { borderLeft: `3px solid ${couleur}` } : undefined}>
      <div style={{ fontSize: 11, color: "var(--sub)", fontWeight: 700 }}>{titre}</div>
      <div style={{ fontSize: 19, fontWeight: 700, marginTop: 4, fontVariantNumeric: "tabular-nums" }}>{valeur}</div>
      <div style={{ fontSize: 11.5, color: "var(--sub)" }}>{sous || "XOF"}</div>
    </div>
  );
  const ligne = (libelle, valeur, { fort = false, ref = "" } = {}) => (
    <tr key={libelle} style={fort ? { background: "var(--line-soft)" } : {}}>
      <td style={{ ...tdStyle, fontWeight: fort ? 700 : 500 }}>{libelle}</td>
      <td style={{ ...tdStyle, color: "var(--sub)", fontSize: 11.5 }}>{ref}</td>
      <td style={{ ...tdStyle, textAlign: "right", fontWeight: fort ? 700 : 500, fontVariantNumeric: "tabular-nums" }}>{mm(valeur)}</td>
    </tr>
  );
  const champ = (libelle, enfant, largeur) => (
    <div style={{ minWidth: largeur }}>
      <label style={labelStyle}>{libelle}</label>
      {enfant}
    </div>
  );
  const nombreInput = (valeur, onChange, largeur = 160, placeholder) => (
    <input type="number" step="1" value={valeur ?? ""} placeholder={placeholder} disabled={gele} onChange={(e) => onChange(e.target.value)} style={{ ...inputStyle, width: largeur, textAlign: "right" }} />
  );
  const aCocher = (valeur, onChange, libelle, desactive = gele) => (
    <label style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 12.5 }}>
      <input type="checkbox" checked={!!valeur} disabled={desactive} onChange={(e) => onChange(e.target.checked)} />
      {libelle}
    </label>
  );

  return (
    <AppShell title={`${t("fiscCelTitreAnnee")} ${annee}`} subNav={<FiscaliteSousNav />}>
      {erreur && <p style={{ color: "var(--brique)", fontSize: 12.5, marginBottom: 12 }}>{erreur}</p>}
      {info && <p style={{ color: "#2E7D5B", fontSize: 12.5, marginBottom: 12 }}>{info}</p>}

      <div className="card" style={{ marginBottom: 14, display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
        <Link href={`/fiscalite/cel/${annee - 1}`} style={boutonSecondaireStyle}>‹ {annee - 1}</Link>
        <Link href={`/fiscalite/cel/${annee + 1}`} style={boutonSecondaireStyle}>{annee + 1} ›</Link>
        <Link href="/fiscalite/cel" style={{ ...boutonSecondaireStyle, border: "none" }}>{t("fiscCelToutesAnnees")}</Link>
        <span style={{ flex: 1 }} />
        <span style={{ fontSize: 12, color: "var(--sub)" }}>
          {t("fiscCelLocauxDecl")} {dateCourte(`${annee}-01-31`, locale)} · {t("fiscCelCvaDecl")} {dateCourte(`${annee}-04-30`, locale)} · {t("fiscCelCvaPaie")} {dateCourte(`${annee}-07-31`, locale)}
        </span>
      </div>

      {!calcul && !erreur && <p style={{ fontSize: 12.5, color: "var(--sub)" }}>{t("loading")}</p>}

      {calcul && saisies && (
        <>
          {gele && data.live_differe_du_depot && <div className="card" style={{ marginBottom: 12, borderLeft: "3px solid var(--ocre)", fontSize: 12.5, lineHeight: 1.5 }}>{t("fiscLiveDiffere")}</div>}

          <div style={{ fontSize: 12, color: "var(--sub)", marginBottom: 10 }}>
            {t("fiscCelBaseCva")} : {calcul.exercice_reference ? `${calcul.exercice_reference.libelle} (${dateCourte(calcul.exercice_reference.date_debut, locale)} → ${dateCourte(calcul.exercice_reference.date_fin, locale)})` : `${t("fiscCelExercice")} ${annee - 1}`}
            {" · "}
            {calcul.source === "COMPTABILITE" ? t("fiscIsSourceCompta") : calcul.source === "IMPORT" ? t("fiscIsSourceImport") : t("fiscIsSourceSaisie")}
          </div>

          <FiscDossierBarre dossier={dossier} onPreparer={preparer} onStatut={changerStatut} onExporter={exporter} onRecalculer={recalculer} onEnregistrer={enregistrer} />

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 12, marginBottom: 14 }}>
            {carte(t("fiscCelLocaux"), mm(calcul.locaux.total))}
            {carte(t("fiscCelCva"), mm(calcul.hors_champ ? 0 : calcul.cva.cva), t(`fiscCelBase_${calcul.cva.base}`))}
            {carte(t("fiscCelTotal"), mm(calcul.total_cel), "XOF", "var(--petrol)")}
          </div>

          {calcul.avertissements.length > 0 && (
            <div className="card" style={{ marginBottom: 14 }}>
              <h3 style={{ fontSize: 13, color: "var(--petrol)", marginBottom: 6 }}>{t("fiscAvertissements")} ({calcul.avertissements.length})</h3>
              <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12.3, lineHeight: 1.6 }}>
                {calcul.avertissements.map((a, i) => (
                  <li key={i} style={{ color: AVERT_GRAVES.includes(a.code) ? "var(--brique)" : "inherit" }}>{texteAlerte(t, "fiscAvCel_", a, locale)}</li>
                ))}
              </ul>
            </div>
          )}

          <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
            {ongletBtn("calcul", t("fiscCelOngletCalcul"))}
            {ongletBtn("locaux", `${t("fiscCelOngletLocaux")} (${locaux.length})`)}
            {ongletBtn("cva", t("fiscCelOngletCva"))}
            {ongletBtn("parametres", t("fiscIsOngletParametres"))}
          </div>

          <div className="card" style={{ borderTopLeftRadius: 0, overflowX: "auto" }}>
            {onglet === "calcul" && (
              <>
                <h3 style={{ fontSize: 13.5, color: "var(--petrol)", marginBottom: 6 }}>{t("fiscCelLocaux")}</h3>
                <table style={{ width: "100%", borderCollapse: "collapse", marginBottom: 18 }}>
                  <thead>
                    <tr>
                      <th style={thStyle}>{t("fiscCelLocal")}</th>
                      <th style={thStyle}>{t("fiscCelNature")}</th>
                      <th style={{ ...thStyle, textAlign: "right" }}>{t("fiscCelBaseRetenue")}</th>
                      <th style={{ ...thStyle, textAlign: "right" }}>{t("fiscCelTaux")}</th>
                      <th style={{ ...thStyle, textAlign: "right" }}>{t("fiscCelProrata")}</th>
                      <th style={{ ...thStyle, textAlign: "right" }}>{t("fiscCelContribution")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {calcul.locaux.lignes.length === 0 && <tr><td style={{ ...tdStyle, color: "var(--sub)" }} colSpan={6}>{t("fiscCelAucunLocal")}</td></tr>}
                    {calcul.locaux.lignes.map((l) => (
                      <tr key={l.id}>
                        <td style={tdStyle}>{l.libelle}{l.commune ? <span style={{ color: "var(--sub)" }}> — {l.commune}</span> : null}{l.motif ? <div style={{ fontSize: 11, color: "var(--sub)" }}>{t(`fiscCelMotif_${l.motif}`)}</div> : null}</td>
                        <td style={tdStyle}>{t(`fiscCelNature_${l.nature}`)}</td>
                        <td style={{ ...tdStyle, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{l.imposable ? mm(l.base) : ""}</td>
                        <td style={{ ...tdStyle, textAlign: "right" }}>{l.imposable ? `${nb(l.taux)} %` : ""}</td>
                        <td style={{ ...tdStyle, textAlign: "right" }}>{l.imposable && l.prorata < 1 ? nb(l.prorata) : ""}</td>
                        <td style={{ ...tdStyle, textAlign: "right", fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>{mm(l.contribution)}</td>
                      </tr>
                    ))}
                    <tr style={{ background: "var(--line-soft)" }}>
                      <td style={{ ...tdStyle, fontWeight: 700 }} colSpan={5}>{t("fiscTotal")}</td>
                      <td style={{ ...tdStyle, textAlign: "right", fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>{mm(calcul.locaux.total)}</td>
                    </tr>
                  </tbody>
                </table>

                <h3 style={{ fontSize: 13.5, color: "var(--petrol)", marginBottom: 6 }}>{t("fiscCelCvaDetail")} ({annee - 1})</h3>
                <table style={{ width: "100%", maxWidth: 820, borderCollapse: "collapse" }}>
                  <thead>
                    <tr>
                      <th style={thStyle}>{t("fiscDesignation")}</th>
                      <th style={thStyle}>{t("fiscRetReference")}</th>
                      <th style={{ ...thStyle, textAlign: "right", width: 160 }}>{t("fiscMontant")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {ligne(t("fiscCelProduits"), calcul.cva.produits.total, { ref: "art. 336" })}
                    {ligne(`- ${t("fiscCelCharges")}`, calcul.cva.charges.total, { ref: "art. 336" })}
                    {calcul.cva.va_comptable !== calcul.cva.produits.total - calcul.cva.charges.total && ligne(t("fiscCelAjustement"), saisies.va_ajustement || 0)}
                    {ligne(`= ${t("fiscCelVa")}${calcul.cva.va_manuelle ? ` (${t("fiscCelSaisie")})` : ""}`, calcul.cva.va_brute, { fort: true })}
                    {ligne(t("fiscCelCa"), calcul.cva.chiffre_affaires)}
                    {ligne(`${t("fiscCelPlafond")} (${nb(calcul.parametres.plafond_va_pct_ca)} %)`, calcul.cva.plafond_va, { ref: "art. 336" })}
                    {ligne(t("fiscCelVaRetenue"), calcul.cva.va_retenue, { fort: true })}
                    {ligne(`${t("fiscCelCvaCalculee")} (${nb(calcul.cva.taux)} %)`, calcul.cva.cva_calculee, { ref: "art. 337" })}
                    {ligne(`${t("fiscCelMinimum")} (${nb(calcul.cva.taux_minimum)} %)`, calcul.cva.minimum, { ref: "art. 337" })}
                    {ligne(`${t("fiscCelCvaDue")} — ${t(`fiscCelBase_${calcul.cva.base}`)}`, calcul.hors_champ ? 0 : calcul.cva.cva, { fort: true })}
                  </tbody>
                </table>
              </>
            )}

            {onglet === "locaux" && (
              <>
                <p style={{ fontSize: 12, color: "var(--sub)", marginBottom: 10, maxWidth: 820, lineHeight: 1.5 }}>{t("fiscCelLocauxAide")}</p>
                {(calcul.suggestions.immeubles_actif.prix_revient > 0 || calcul.suggestions.loyers_compta > 0) && (
                  <div className="card" style={{ marginBottom: 12, background: "var(--line-soft)" }}>
                    <div style={{ fontSize: 12, fontWeight: 700, color: "var(--petrol)", marginBottom: 6 }}>{t("fiscCelSuggestions")}</div>
                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                      {calcul.suggestions.immeubles_actif.prix_revient > 0 && (
                        <button style={boutonSecondaireStyle} onClick={() => setLocal({ ...LOCAL_VIDE, libelle: "", nature: "ACTIF", prix_revient: String(calcul.suggestions.immeubles_actif.prix_revient) })}>
                          {t("fiscCelSuggestionActif").split("{montant}").join(mm(calcul.suggestions.immeubles_actif.prix_revient))}
                        </button>
                      )}
                      {calcul.suggestions.loyers_compta > 0 && (
                        <button style={boutonSecondaireStyle} onClick={() => setLocal({ ...LOCAL_VIDE, libelle: "", nature: "LOUE", loyer_annuel: String(calcul.suggestions.loyers_compta) })}>
                          {t("fiscCelSuggestionLoyers").split("{montant}").join(mm(calcul.suggestions.loyers_compta))}
                        </button>
                      )}
                    </div>
                  </div>
                )}
                <table style={{ width: "100%", borderCollapse: "collapse", marginBottom: 12 }}>
                  <thead>
                    <tr>
                      <th style={thStyle}>{t("fiscCelLocal")}</th>
                      <th style={thStyle}>{t("fiscCelNature")}</th>
                      <th style={{ ...thStyle, textAlign: "right" }}>{t("fiscCelLoyer")}</th>
                      <th style={{ ...thStyle, textAlign: "right" }}>{t("fiscCelPrixRevient")}</th>
                      <th style={thStyle}>{t("fiscCelPeriode")}</th>
                      <th style={thStyle}></th>
                    </tr>
                  </thead>
                  <tbody>
                    {locaux.length === 0 && <tr><td style={{ ...tdStyle, color: "var(--sub)" }} colSpan={6}>{t("fiscCelAucunLocal")}</td></tr>}
                    {locaux.map((l) => (
                      <tr key={l.id}>
                        <td style={tdStyle}>{l.libelle}{l.commune ? <span style={{ color: "var(--sub)" }}> — {l.commune}</span> : null}{l.exonere ? <div style={{ fontSize: 11, color: "var(--sub)" }}>{t("fiscCelMotif_EXONERE")}</div> : null}</td>
                        <td style={tdStyle}>{t(`fiscCelNature_${l.nature}`)}</td>
                        <td style={{ ...tdStyle, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{l.loyer_annuel ? mm(l.loyer_annuel) : ""}</td>
                        <td style={{ ...tdStyle, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{l.prix_revient ? mm(l.prix_revient) : ""}</td>
                        <td style={{ ...tdStyle, fontSize: 12 }}>{l.date_debut || l.date_fin ? `${l.date_debut ? dateCourte(l.date_debut, locale) : "…"} → ${l.date_fin ? dateCourte(l.date_fin, locale) : "…"}` : "—"}</td>
                        <td style={{ ...tdStyle, textAlign: "right", whiteSpace: "nowrap" }}>
                          <button style={boutonSecondaireStyle} onClick={() => editerLocal(l)}>{t("fiscModifier")}</button>{" "}
                          <button style={boutonSecondaireStyle} onClick={() => supprimerLocal(l.id)}>{t("fiscSupprimer")}</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {!local && <button style={boutonPrincipalStyle} onClick={() => setLocal({ ...LOCAL_VIDE })}>{t("fiscCelAjouterLocal")}</button>}
                {local && (
                  <form onSubmit={enregistrerLocal} style={{ borderTop: "1px solid var(--line)", paddingTop: 12, display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end" }}>
                    {champ(t("fiscCelLocal"), <input value={local.libelle} onChange={(e) => setLocal({ ...local, libelle: e.target.value })} style={{ ...inputStyle, width: 220 }} required />)}
                    {champ(t("fiscCelCommune"), <input value={local.commune} onChange={(e) => setLocal({ ...local, commune: e.target.value })} style={{ ...inputStyle, width: 150 }} />)}
                    {champ(t("fiscCelNature"), (
                      <select value={local.nature} onChange={(e) => setLocal({ ...local, nature: e.target.value })} style={{ ...inputStyle, width: 190 }}>
                        {natures.map((n) => <option key={n} value={n}>{t(`fiscCelNature_${n}`)}</option>)}
                      </select>
                    ))}
                    {local.nature === "LOUE" && champ(t("fiscCelLoyer"), <input type="number" min="0" value={local.loyer_annuel} onChange={(e) => setLocal({ ...local, loyer_annuel: e.target.value })} style={{ ...inputStyle, width: 150, textAlign: "right" }} />)}
                    {local.nature === "ACTIF" && champ(t("fiscCelPrixRevient"), <input type="number" min="0" value={local.prix_revient} onChange={(e) => setLocal({ ...local, prix_revient: e.target.value })} style={{ ...inputStyle, width: 170, textAlign: "right" }} />)}
                    {local.nature !== "ACTIF" && champ(t("fiscCelValeurLocative"), <input type="number" min="0" value={local.valeur_locative_reelle} onChange={(e) => setLocal({ ...local, valeur_locative_reelle: e.target.value })} style={{ ...inputStyle, width: 150, textAlign: "right" }} />)}
                    {champ(t("fiscCelRegime"), (
                      <select value={local.regime} onChange={(e) => setLocal({ ...local, regime: e.target.value })} style={{ ...inputStyle, width: 190 }}>
                        {regimes.map((r) => <option key={r} value={r}>{t(`fiscCelRegime_${r}`)}</option>)}
                      </select>
                    ))}
                    {champ(t("fiscCelPartPro"), <input type="number" min="0" max="100" value={local.part_professionnelle_pct} onChange={(e) => setLocal({ ...local, part_professionnelle_pct: e.target.value })} style={{ ...inputStyle, width: 90, textAlign: "right" }} />)}
                    {champ(t("fiscCelDebut"), <input type="date" value={local.date_debut} onChange={(e) => setLocal({ ...local, date_debut: e.target.value })} style={{ ...inputStyle, width: 150 }} />)}
                    {champ(t("fiscCelFin"), <input type="date" value={local.date_fin} onChange={(e) => setLocal({ ...local, date_fin: e.target.value })} style={{ ...inputStyle, width: 150 }} />)}
                    {local.nature === "ACTIF" && aCocher(local.donne_en_location, (v) => setLocal({ ...local, donne_en_location: v }), t("fiscCelDonneLocation"), false)}
                    {aCocher(local.exonere, (v) => setLocal({ ...local, exonere: v }), t("fiscCelExonere"), false)}
                    {local.exonere && champ(t("fiscCelMotifExoneration"), <input value={local.motif_exoneration} onChange={(e) => setLocal({ ...local, motif_exoneration: e.target.value })} style={{ ...inputStyle, width: 220 }} />)}
                    <button type="submit" style={boutonPrincipalStyle}>{t("fiscEnregistrer")}</button>
                    <button type="button" style={boutonSecondaireStyle} onClick={() => setLocal(null)}>{t("fiscAnnuler")}</button>
                  </form>
                )}
              </>
            )}

            {onglet === "cva" && (
              <>
                <p style={{ fontSize: 12, color: "var(--sub)", marginBottom: 12, maxWidth: 820, lineHeight: 1.5 }}>{t("fiscCelCvaAide")}</p>
                <div style={{ display: "flex", gap: 14, flexWrap: "wrap", alignItems: "flex-end", marginBottom: 14 }}>
                  {champ(t("fiscIsSourceDonnees"), (
                    <select value={saisies.source_donnees} disabled={gele} onChange={(e) => majSaisie("source_donnees", e.target.value)} style={{ ...inputStyle, width: 330 }}>
                      <option value="AUTO">{t("fiscIsSourceAuto")}</option>
                      {calcul.donnees?.sources_disponibles?.compta_module_actif && <option value="COMPTABILITE">{t("fiscIsSourceOptCompta")}</option>}
                      <option value="IMPORT">{t("fiscIsSourceOptImport")}</option>
                    </select>
                  ))}
                  {champ(t("fiscCelRegimeCva"), (
                    <select value={saisies.regime_cva} disabled={gele} onChange={(e) => majSaisie("regime_cva", e.target.value)} style={{ ...inputStyle, width: 240 }}>
                      <option value="AUTO">{t("fiscCelRegimeAuto")}</option>
                      <option value="NORMAL">{t("fiscCelRegimeNormal")}</option>
                      <option value="SIMPLIFIE">{t("fiscCelRegimeSimplifie")}</option>
                    </select>
                  ))}
                </div>
                <div style={{ display: "flex", gap: 20, flexWrap: "wrap", marginBottom: 14 }}>
                  {aCocher(saisies.utiliser_saisie, (v) => majSaisie("utiliser_saisie", v), t("fiscCelUtiliserSaisie"))}
                  {aCocher(saisies.faible_marge, (v) => majSaisie("faible_marge", v), t("fiscCelFaibleMarge"))}
                  {aCocher(saisies.cree_en_annee, (v) => majSaisie("cree_en_annee", v), t("fiscCelCreeEnAnnee"))}
                  {aCocher(saisies.hors_champ, (v) => majSaisie("hors_champ", v), t("fiscCelHorsChamp"))}
                </div>
                <div style={{ display: "flex", gap: 14, flexWrap: "wrap", alignItems: "flex-end" }}>
                  {champ(t("fiscCelVaManuelle"), nombreInput(saisies.va_manuel, (v) => majSaisie("va_manuel", v), 180, String(calcul.cva.va_comptable)))}
                  {champ(t("fiscCelCaManuel"), nombreInput(saisies.ca_manuel, (v) => majSaisie("ca_manuel", v), 180, String(calcul.cva.chiffre_affaires)))}
                  {champ(t("fiscCelAjustement"), nombreInput(saisies.va_ajustement, (v) => majSaisie("va_ajustement", v), 180))}
                </div>
                <p style={{ fontSize: 11.5, color: "var(--sub)", marginTop: 10, maxWidth: 820, lineHeight: 1.5 }}>{t("fiscCelAjustementAide")}</p>
              </>
            )}

            {onglet === "parametres" && (
              <>
                <p style={{ fontSize: 12, color: "var(--sub)", marginBottom: 12, maxWidth: 820, lineHeight: 1.5 }}>{t("fiscCelParamAide")}</p>
                <div style={{ display: "flex", gap: 14, flexWrap: "wrap" }}>
                  {PARAMS.map(([k, cle]) => champ(t(cle), (
                    <input key={k} type="number" step="0.001" disabled={gele} value={saisies.parametres[k] ?? ""} placeholder={String(parametresDefaut[k] ?? "")} onChange={(e) => majParametre(k, e.target.value)} style={{ ...inputStyle, width: 130, textAlign: "right" }} />
                  ), 150))}
                </div>
              </>
            )}
          </div>
        </>
      )}
    </AppShell>
  );
}
