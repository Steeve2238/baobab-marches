"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { api } from "../../../../../lib/api";
import { useLangue } from "../../../../../lib/i18n/LanguageContext";
import AppShell from "../../../../../lib/components/AppShell";
import FinancementSousNav from "../../../../../lib/components/financement/FinancementSousNav";
import { useEntete, EnteteOfficielle, SignatureOfficielle, PiedOfficiel } from "../../../../../lib/components/DocumentOfficiel";
import { fmtXof, labelStyle, inputStyle, boutonPrincipalStyle, boutonSecondaireStyle, thStyle, tdStyle } from "../../../../../lib/financementUi";

const fmtDate = (iso) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : "");
const lienDossier = (type, id) => (type === "ao" ? `/dossiers/${id}` : `/marches/consultation-restreinte/consultations/${id}`);
const pct = (n, locale) => (n === null || n === undefined ? "" : `${Number(n).toLocaleString(locale, { maximumFractionDigits: 1 })} %`);

export default function CompteExploitationPage() {
  const { t, dict } = useLangue();
  const locale = dict.dateLocale || "fr-FR";
  const { type, id } = useParams();
  const entete = useEntete();
  const [version, setVersion] = useState("INTERNE");
  const [simulation, setSimulation] = useState(""); // "" = toutes les lignes retenues ; "simId|condId"
  const [detail, setDetail] = useState(false);
  const [data, setData] = useState(null);
  const [plan, setPlan] = useState(null);
  const [erreur, setErreur] = useState("");
  const [charge, setCharge] = useState({ libelle: "", montant_xof: "" });
  const [edition, setEdition] = useState(null); // { id, libelle, montant_xof }
  const [pret, setPret] = useState(false);

  // Parametres de l'URL (simulation choisie depuis la fiche d'une simulation).
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    if (q.get("simulation_id")) setSimulation(`${q.get("simulation_id")}|${q.get("condition_id") || ""}`);
    if (q.get("version") === "BANQUE") setVersion("BANQUE");
    setPret(true);
  }, []);

  const params = useCallback(() => {
    const [sim, cond] = simulation ? simulation.split("|") : [];
    const p = { version };
    if (sim) p.simulation_id = sim;
    if (cond) p.condition_id = cond;
    if (detail) p.detail = "1";
    return p;
  }, [simulation, version, detail]);

  const charger = useCallback(async () => {
    setErreur("");
    try {
      const d = await api.finCompte(type, id, params());
      setData(d);
      if (version === "BANQUE") {
        const [sim, cond] = simulation ? simulation.split("|") : [];
        const body = { avec_financement: true };
        if (sim) body.simulation_id = sim;
        if (cond) body.condition_id = cond;
        try {
          const p = await api.finPlanCalculer(type, id, body);
          setPlan(p && p.plan && !(p.plan.incomplet && p.plan.incomplet.length) ? { ...p.plan, date_t: p.params.date_t, apport_xof: p.params.apport_xof } : null);
        } catch (e) {
          setPlan(null);
        }
      } else {
        setPlan(null);
      }
    } catch (err) {
      setErreur(err.message || t("cexErreur"));
    }
  }, [type, id, params, version, simulation, t]);

  useEffect(() => {
    if (pret) charger();
  }, [pret, charger]);

  async function ajouterCharge(e) {
    e.preventDefault();
    try {
      setData(await api.finChargeAjouter(type, id, charge, params()));
      setCharge({ libelle: "", montant_xof: "" });
    } catch (err) {
      setErreur(err.message);
    }
  }
  async function enregistrerEdition() {
    try {
      setData(await api.finChargeModifier(type, id, edition.id, { libelle: edition.libelle, montant_xof: edition.montant_xof }, params()));
      setEdition(null);
    } catch (err) {
      setErreur(err.message);
    }
  }
  async function supprimerCharge(chargeId) {
    try {
      setData(await api.finChargeSupprimer(type, id, chargeId, params()));
    } catch (err) {
      setErreur(err.message);
    }
  }
  async function exporter(format) {
    try {
      await api.finCompteExporter(type, id, format, params());
    } catch (err) {
      setErreur(err.message);
    }
  }

  const banque = version === "BANQUE";
  const sims = data ? data.simulations_disponibles || [] : [];
  const f0 = data && data.financements[0];

  return (
    <AppShell title={t("cexTitre")} subNav={<FinancementSousNav />} backHref={lienDossier(type, id)}>
      <section className="card no-print" style={{ marginBottom: 14 }}>
        <p style={{ fontSize: 12.5, color: "var(--sub)", lineHeight: 1.55, maxWidth: 820, marginBottom: 12 }}>{t("cexIntro")}</p>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 12, alignItems: "end" }}>
          <div>
            <label style={labelStyle}>{t("cexVersion")}</label>
            <select value={version} onChange={(e) => setVersion(e.target.value)} style={inputStyle}>
              <option value="INTERNE">{t("cexVersionInterne")}</option>
              <option value="BANQUE">{t("cexVersionBanque")}</option>
            </select>
          </div>
          <div>
            <label style={labelStyle}>{t("cexSimulation")}</label>
            <select value={simulation} onChange={(e) => setSimulation(e.target.value)} style={inputStyle}>
              <option value="">{t("cexSimulationRetenues")}</option>
              {sims.map((s) =>
                (s.banques || []).map((b) => (
                  <option key={`${s.id}|${b.condition_id}`} value={`${s.id}|${b.condition_id}`}>
                    {(s.libelle || t(`finType_${s.type_facilite}`))} · {b.partenaire_nom}
                    {b.cout_ttc !== null && b.cout_ttc !== undefined ? ` · ${fmtXof(b.cout_ttc, locale)}` : ""}
                    {s.statut === "SIMULEE" ? "" : ` · ${t(`finStatutSim_${s.statut}`)}`}
                  </option>
                ))
              )}
            </select>
          </div>
          {banque && (
            <label style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 12.8, cursor: "pointer", paddingBottom: 8 }}>
              <input type="checkbox" checked={detail} onChange={(e) => setDetail(e.target.checked)} />
              {t("cexDetail")}
            </label>
          )}
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 14 }}>
          <button type="button" onClick={() => window.print()} style={boutonPrincipalStyle}>{t("cexImprimer")}</button>
          <button type="button" onClick={() => exporter("pdf")} style={boutonSecondaireStyle}>{t("cexPdf")}</button>
          <button type="button" onClick={() => exporter("xlsx")} style={boutonSecondaireStyle}>{t("cexExcel")}</button>
          <Link href={`/financement/plan/${type}/${id}`} style={{ ...boutonSecondaireStyle, textDecoration: "none" }}>{t("cexVoirPlan")}</Link>
        </div>
      </section>

      {erreur && <p className="no-print" style={{ color: "var(--brique)", fontSize: 12.5, marginBottom: 10 }}>{erreur}</p>}
      {!data && !erreur && <p className="no-print" style={{ fontSize: 13, color: "var(--sub)" }}>{t("cexChargement")}</p>}

      {data && (
        <>
          {data.alertes.length > 0 && (
            <div className="no-print" style={{ display: "grid", gap: 6, marginBottom: 14 }}>
              {data.alertes.map((a, i) => (
                <div key={i} style={{ fontSize: 12.8, padding: "8px 12px", borderRadius: 8, background: a.niveau === "ALERTE" ? "var(--brique-bg)" : a.niveau === "ATTENTION" ? "#FFF3D6" : "var(--line-soft)" }}>
                  {t(`cexAlerte_${a.code}`)}
                </div>
              ))}
            </div>
          )}

          <div className="card print-letter" style={{ padding: "28px 32px", marginBottom: 18 }}>
            <EnteteOfficielle
              entete={entete}
              titre={t("cexTitreDocument")}
              sousTitre={data.dossier.libelle}
              droite={<div style={{ fontSize: 11.5, color: "var(--sub)" }}>{banque ? t("cexVersionLibelleBanque") : t("cexVersionLibelleInterne")}</div>}
            />
            <div style={{ fontSize: 12.5, marginBottom: 10 }}>
              <div>
                <b>{t("cexDossier")} :</b> {data.dossier.libelle}
                {data.dossier.reference ? ` (${data.dossier.reference})` : ""}
              </div>
              {data.dossier.client_nom && (
                <div>
                  <b>{t("cexClient")} :</b> {data.dossier.client_nom}
                </div>
              )}
              <div style={{ color: "var(--sub)", fontSize: 11.5, marginTop: 2 }}>{t("cexDevise")}</div>
            </div>

            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5 }}>
              <thead>
                <tr>
                  <th style={thStyle}>{t("cexPoste")}</th>
                  <th style={{ ...thStyle, textAlign: "right" }}>{banque ? t("cexMontant") : t("cexPrev")}</th>
                  <th style={{ ...thStyle, textAlign: "right" }}>{t("cexPctCa")}</th>
                  {banque ? (
                    <th style={{ ...thStyle, textAlign: "right" }}>{t("cexPctRevient")}</th>
                  ) : (
                    <>
                      <th style={{ ...thStyle, textAlign: "right" }}>{t("cexEngage")}</th>
                      <th style={{ ...thStyle, textAlign: "right" }}>{t("cexReel")}</th>
                      <th style={{ ...thStyle, textAlign: "right" }}>{t("cexEcart")}</th>
                    </>
                  )}
                </tr>
              </thead>
              <tbody>
                {data.lignes.map((l, i) => {
                  const section = l.type === "section";
                  const fort = l.type === "total" || l.type === "resultat";
                  const fond = l.type === "resultat" ? "var(--vert-bg, #E3EFE9)" : section ? "var(--line-soft)" : "transparent";
                  const base = { padding: "5px 10px", borderBottom: "1px solid var(--line-soft)", fontWeight: fort || section ? 700 : 400, background: fond, fontStyle: l.type === "detail" ? "italic" : "normal", color: l.type === "detail" ? "var(--sub)" : "inherit" };
                  const num = { ...base, textAlign: "right", fontVariantNumeric: "tabular-nums" };
                  return (
                    <tr key={i} style={{ borderTop: l.type === "total" ? "1px solid var(--ink)" : undefined }}>
                      <td style={{ ...base, paddingLeft: 10 + (l.type === "detail" ? 28 : l.type === "ligne" ? 14 : 0) }}>{l.libelle}</td>
                      <td style={num}>{section || l.note ? "" : fmtXof(l.previsionnel, locale)}</td>
                      <td style={num}>{section || l.note ? "" : pct(l.pct_ca, locale)}</td>
                      {banque ? (
                        <td style={num}>{pct(l.pct_revient, locale)}</td>
                      ) : (
                        <>
                          <td style={num}>{l.engage !== null && l.engage !== undefined ? fmtXof(l.engage, locale) : ""}</td>
                          <td style={num}>{l.reel !== null && l.reel !== undefined ? fmtXof(l.reel, locale) : ""}</td>
                          <td style={{ ...num, color: l.ecart > 0.5 && !["MARGE_COM", "MARGE_GLOBALE", "CA"].includes(l.code) ? "var(--brique)" : "inherit" }}>
                            {l.ecart !== null && l.ecart !== undefined ? fmtXof(l.ecart, locale) : ""}
                          </td>
                        </>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>

            <div style={{ marginTop: 12, fontSize: 12.5, lineHeight: 1.7 }}>
              <div>
                {t("cexMargeCom")} : <b className="mono">{fmtXof(data.synthese.marge_commerciale, locale)} F CFA</b> — {pct(data.synthese.marge_commerciale_pct_ca, locale)} {t("cexDuCa")}, {pct(data.synthese.marge_commerciale_pct_revient, locale)} {t("cexDuRevient")}
              </div>
              <div>
                {t("cexMargeGlobale")} : <b className="mono">{fmtXof(data.synthese.marge_globale, locale)} F CFA</b> — {pct(data.synthese.marge_globale_pct_ca, locale)} {t("cexDuCa")}, {pct(data.synthese.marge_globale_pct_revient, locale)} {t("cexDuRevient")}
              </div>
            </div>
            <div style={{ marginTop: 8, fontSize: 11, color: "var(--sub)", lineHeight: 1.5 }}>
              {!banque && data.reel_partiel && <div>{t("cexNoteReelPartiel")}</div>}
              {!banque && <div>{t("cexNoteReel")}</div>}
              <div>{t("cexNoteTva")}</div>
            </div>

            {banque && f0 && (
              <div style={{ marginTop: 26, breakBefore: "page", pageBreakBefore: "always" }}>
                <div style={{ textAlign: "center", fontFamily: "Space Grotesk", fontWeight: 700, fontSize: 15, marginBottom: 12 }}>{t("cexDemandeTitre").toUpperCase()}</div>
                <Bloc titre={t("cexDemande")}>
                  <Ligne k={t("cexFacilite")} v={t(`finType_${f0.type_facilite}`)} />
                  <Ligne k={t("cexBanque")} v={f0.banque} />
                  <Ligne k={t("cexMontantDemande")} v={`${fmtXof(f0.montant, locale)} F CFA`} />
                  <Ligne k={t("cexDatePrise")} v={fmtDate(f0.date_prise)} />
                  <Ligne k={t("cexDateEcheance")} v={fmtDate(f0.date_echeance)} />
                  <Ligne k={t("cexDuree")} v={f0.duree_jours ? `${f0.duree_jours} ${t("cexJours")}` : ""} />
                </Bloc>
                <Bloc titre={t("cexRemboursement")}>
                  <Ligne k={t("cexSource")} v={t("cexSourceTexte")} />
                  <Ligne k={t("cexDebiteur")} v={data.dossier.client_nom || ""} />
                  <Ligne k={t("cexDernierEncaissement")} v={plan ? fmtDate(plan.synthese.dernier_encaissement) : ""} />
                </Bloc>
                <Bloc titre={t("cexCouverture")}>
                  <Ligne k={t("cexMargeCom")} v={`${fmtXof(data.synthese.marge_commerciale, locale)} F CFA`} />
                  <Ligne k={t("cexCoutFin")} v={`${fmtXof(data.synthese.cout_financement, locale)} F CFA`} />
                  <Ligne k={t("cexCouvre")} v={data.synthese.couverture !== null ? `${data.synthese.couverture.toLocaleString(locale)} ${t("cexFois")}` : "—"} />
                  <Ligne k={t("cexCoutFinPct")} v={pct(data.synthese.cout_financement_pct_ca, locale) || "—"} />
                  <Ligne k={t("cexTauxAnnuel")} v={pct(f0.taux_effectif_annuel_pct, locale) || "—"} />
                </Bloc>
                {plan && (
                  <Bloc titre={t("cexBesoin")}>
                    <Ligne k={t("cexDateT")} v={fmtDate(plan.date_t)} />
                    <Ligne k={t("cexBesoinMax")} v={`${fmtXof(plan.synthese.besoin_max, locale)} F CFA`} />
                    <Ligne k={t("cexAtteintLe")} v={plan.synthese.date_besoin_max ? `${fmtDate(plan.synthese.date_besoin_max)} (T + ${plan.synthese.jour_besoin_max})` : "—"} />
                    <Ligne k={t("cexPortage")} v={`${plan.synthese.portage_jours} ${t("cexJours")}`} />
                    <Ligne k={t("cexPointBas")} v={plan.synthese.point_bas_avec !== null ? `${fmtXof(plan.synthese.point_bas_avec, locale)} F CFA` : "—"} />
                    {plan.apport_xof > 0 && <Ligne k={t("cexApport")} v={`${fmtXof(plan.apport_xof, locale)} F CFA`} />}
                  </Bloc>
                )}
                <Bloc titre={t("cexGaranties")}>
                  {f0.domiciliation_exigee && <div style={{ fontSize: 12.5 }}>{t("cexDomiciliation")}</div>}
                  {f0.conditions_particulieres && <div style={{ fontSize: 12.5 }}>{f0.conditions_particulieres}</div>}
                  {!f0.domiciliation_exigee && !f0.conditions_particulieres && <div style={{ fontSize: 12.5, color: "var(--sub)" }}>{t("cexAucuneCondition")}</div>}
                </Bloc>
              </div>
            )}

            <SignatureOfficielle entete={entete} lieuDate={`${t("cexFaitLe")} ${new Date().toLocaleDateString(locale)}`} />
            <PiedOfficiel entete={entete} />
          </div>

          <section className="card no-print">
            <h3 style={{ fontSize: 14, color: "var(--petrol)", marginBottom: 2 }}>{t("cexChargesTitre")}</h3>
            <p style={{ fontSize: 12, color: "var(--sub)", marginBottom: 10 }}>{t("cexChargesAide")}</p>
            {data.charges.length === 0 && <p style={{ fontSize: 12.5, color: "var(--sub)", marginBottom: 8 }}>{t("cexChargeVide")}</p>}
            <div style={{ display: "grid", gap: 6, marginBottom: 12 }}>
              {data.charges.map((c) =>
                edition && edition.id === c.id ? (
                  <div key={c.id} style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                    <input value={edition.libelle} onChange={(e) => setEdition({ ...edition, libelle: e.target.value })} style={{ ...inputStyle, flex: "2 1 220px" }} />
                    <input value={edition.montant_xof} onChange={(e) => setEdition({ ...edition, montant_xof: e.target.value })} inputMode="decimal" style={{ ...inputStyle, flex: "1 1 140px" }} />
                    <button type="button" onClick={enregistrerEdition} style={boutonPrincipalStyle}>{t("cexChargeEnregistrer")}</button>
                    <button type="button" onClick={() => setEdition(null)} style={boutonSecondaireStyle}>{t("cexChargeAnnuler")}</button>
                  </div>
                ) : (
                  <div key={c.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, fontSize: 13, borderBottom: "1px solid var(--line-soft)", paddingBottom: 6 }}>
                    <span>{c.libelle}</span>
                    <span style={{ display: "flex", gap: 10, alignItems: "center" }}>
                      <b className="mono">{fmtXof(c.montant_xof, locale)}</b>
                      <button type="button" onClick={() => setEdition({ id: c.id, libelle: c.libelle, montant_xof: String(c.montant_xof) })} style={boutonSecondaireStyle}>{t("cexChargeModifier")}</button>
                      <button type="button" onClick={() => supprimerCharge(c.id)} style={boutonSecondaireStyle}>{t("cexChargeSupprimer")}</button>
                    </span>
                  </div>
                )
              )}
            </div>
            <form onSubmit={ajouterCharge} style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "flex-end" }}>
              <div style={{ flex: "2 1 220px" }}>
                <label style={labelStyle}>{t("cexChargeLibelle")}</label>
                <input required value={charge.libelle} onChange={(e) => setCharge({ ...charge, libelle: e.target.value })} style={inputStyle} />
              </div>
              <div style={{ flex: "1 1 160px" }}>
                <label style={labelStyle}>{t("cexChargeMontant")}</label>
                <input required inputMode="decimal" value={charge.montant_xof} onChange={(e) => setCharge({ ...charge, montant_xof: e.target.value })} style={inputStyle} />
              </div>
              <button type="submit" style={boutonPrincipalStyle}>{t("cexChargeAjouter")}</button>
            </form>
          </section>
        </>
      )}
    </AppShell>
  );
}

function Bloc({ titre, children }) {
  return (
    <div style={{ marginBottom: 12, breakInside: "avoid" }}>
      <div style={{ fontWeight: 700, fontSize: 12.5, color: "var(--petrol)", borderBottom: "1px solid var(--line)", paddingBottom: 3, marginBottom: 5 }}>{titre}</div>
      {children}
    </div>
  );
}
function Ligne({ k, v }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", gap: 16, fontSize: 12.5, padding: "2px 0" }}>
      <span>{k}</span>
      <span style={{ textAlign: "right", fontWeight: 600 }}>{v}</span>
    </div>
  );
}
