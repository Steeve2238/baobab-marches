"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { api } from "../../../../lib/api";
import { useLangue } from "../../../../lib/i18n/LanguageContext";
import AppShell from "../../../../lib/components/AppShell";
import FinancementSousNav from "../../../../lib/components/financement/FinancementSousNav";
import { ReleveCarte } from "../../../../lib/components/financement/ComparatifBanques";
import { MODES, PERIODES, RETENUES, RECOURS, STATUTS, jour, Aide, labelStyle, inputStyle, boutonPrincipalStyle, boutonSecondaireStyle, boutonDangerStyle } from "../../../../lib/financementUi";

// Editeur des conditions d'une banque pour UN type de financement : dates,
// plafonds, avance, taxe, clients agrees et surtout les lignes de frais
// (commissions, interets, retenues). Les lignes arrivent pre-remplies depuis le
// modele du type ; le client n'a qu'a saisir les taux de la proposition recue.

const COLONNES_TEXTE = ["libelle", "reference_proposition", "justificatifs", "conditions_particulieres", "notes", "taxe_libelle"];

function versFormulaire(c) {
  const f = { ...c };
  for (const k of ["date_proposition", "date_effet", "date_validite", "date_fin"]) f[k] = jour(c[k]);
  for (const k of ["plafond_montant", "montant_min", "duree_min_jours", "duree_max_jours", "taux_avance_pct", "jours_valeur", "duree_minimale_facturee", "taxe_taux_pct"]) {
    f[k] = c[k] === null || c[k] === undefined ? "" : String(Number(c[k]));
  }
  for (const k of COLONNES_TEXTE) f[k] = c[k] || "";
  f.recours = c.recours || "";
  f.debiteurs_agrees_json = Array.isArray(c.debiteurs_agrees_json) ? c.debiteurs_agrees_json.map((d) => ({ nom: d.nom || "", encours_autorise: d.encours_autorise === null || d.encours_autorise === undefined ? "" : String(d.encours_autorise) })) : [];
  f.frais = (c.frais || []).map((l) => ({
    ...l,
    taux_pct: l.taux_pct === null || l.taux_pct === undefined ? "" : String(Number(l.taux_pct)),
    montant_fixe: l.montant_fixe === null || l.montant_fixe === undefined ? "" : String(Number(l.montant_fixe)),
    minimum: l.minimum === null || l.minimum === undefined ? "" : String(Number(l.minimum)),
    maximum: l.maximum === null || l.maximum === undefined ? "" : String(Number(l.maximum)),
    periode: l.periode || "",
    observation: l.observation || "",
  }));
  return f;
}

function Section({ titre, children }) {
  return (
    <section className="card" style={{ marginBottom: 14 }}>
      <h3 style={{ fontSize: 14, color: "var(--petrol)", marginBottom: 12 }}>{titre}</h3>
      {children}
    </section>
  );
}
const grille = { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 14 };

export default function FinancementConditionPage() {
  const { t } = useLangue();
  const { id } = useParams();
  const router = useRouter();
  const [form, setForm] = useState(null);
  const [modele, setModele] = useState(null);
  const [erreur, setErreur] = useState("");
  const [message, setMessage] = useState("");
  const [envoi, setEnvoi] = useState(false);
  const [test, setTest] = useState({ montant: "1000000", duree_jours: "90" });
  const [testRes, setTestRes] = useState(null);

  async function charger() {
    try {
      const c = await api.finCondition(id);
      setModele(c.modele);
      setForm(versFormulaire(c));
    } catch (e) {
      setErreur(e.message);
    }
  }
  useEffect(() => {
    charger();
  }, [id]);

  const maj = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const majLigne = (i, k, v) => setForm((f) => ({ ...f, frais: f.frais.map((l, j) => (j === i ? { ...l, [k]: v } : l)) }));
  const majDebiteur = (i, k, v) => setForm((f) => ({ ...f, debiteurs_agrees_json: f.debiteurs_agrees_json.map((d, j) => (j === i ? { ...d, [k]: v } : d)) }));

  async function enregistrer(e) {
    if (e) e.preventDefault();
    setErreur("");
    setMessage("");
    setEnvoi(true);
    try {
      const c = await api.finMajCondition(id, form);
      setModele(c.modele);
      setForm(versFormulaire(c));
      setMessage(t("finSaved"));
      return true;
    } catch (err) {
      setErreur(err.message);
      return false;
    } finally {
      setEnvoi(false);
    }
  }

  async function tester() {
    setTestRes(null);
    if (!(await enregistrer())) return;
    try {
      const r = await api.finCalculer({ type_facilite: form.type_facilite, montant: Number(test.montant), duree_jours: Number(test.duree_jours), condition_ids: [id] });
      setTestRes(r);
    } catch (err) {
      setErreur(err.message);
    }
  }

  async function dupliquer() {
    try {
      const c = await api.finDupliquerCondition(id);
      router.push(`/financement/conditions/${c.id}`);
    } catch (err) {
      setErreur(err.message);
    }
  }
  async function supprimer() {
    if (!window.confirm(t("finConfirmDelete"))) return;
    try {
      await api.finSupprimerCondition(id);
      router.push(`/financement/banques/${form.partenaire_id}`);
    } catch (err) {
      setErreur(err.message);
    }
  }

  if (!form || !modele) {
    return (
      <AppShell title={t("finTitle")} subNav={<FinancementSousNav />}>
        <p style={{ fontSize: 12.5, color: erreur ? "var(--brique)" : "var(--sub)" }}>{erreur || t("finLoading")}</p>
      </AppShell>
    );
  }

  const champs = modele.champs || {};
  const famille = modele.famille;

  const champNum = (k, label, aide, extra = {}) => (
    <div>
      <label style={labelStyle}>{label}</label>
      <input type="number" step="any" value={form[k]} onChange={(e) => maj(k, e.target.value)} style={inputStyle} {...extra} />
      {aide && <Aide>{aide}</Aide>}
    </div>
  );
  const champDate = (k, label, aide) => (
    <div>
      <label style={labelStyle}>{label}</label>
      <input type="date" value={form[k]} onChange={(e) => maj(k, e.target.value)} style={inputStyle} />
      {aide && <Aide>{aide}</Aide>}
    </div>
  );
  const selectStyle = { ...inputStyle };

  return (
    <AppShell title={t("finTitle")} subNav={<FinancementSousNav />} backHref={`/financement/banques/${form.partenaire_id}`}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 10, marginBottom: 6 }}>
        <div>
          <h2 style={{ fontSize: 16, color: "var(--petrol)" }}>
            {form.partenaire_nom} — {t(`finType_${form.type_facilite}`)}
          </h2>
          <p style={{ fontSize: 12, color: "var(--sub)", marginTop: 2 }}>{t(`finFamille_${famille}`)}</p>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button type="button" onClick={dupliquer} style={boutonSecondaireStyle}>{t("finCondDupliquer")}</button>
          <button type="button" onClick={supprimer} style={boutonDangerStyle}>{t("finCondSupprimer")}</button>
        </div>
      </div>
      <p style={{ fontSize: 12.5, color: "var(--sub)", marginBottom: 14, maxWidth: 760, lineHeight: 1.55 }}>{t("finCondIntro")}</p>

      <form onSubmit={enregistrer}>
        <Section titre={t("finCondSectionIdentification")}>
          <div style={grille}>
            <div>
              <label style={labelStyle}>{t("finCondLibelle")}</label>
              <input value={form.libelle} onChange={(e) => maj("libelle", e.target.value)} style={inputStyle} required />
              <Aide>{t("finCondLibelleAide")}</Aide>
            </div>
            <div>
              <label style={labelStyle}>{t("finCondReference")}</label>
              <input value={form.reference_proposition} onChange={(e) => maj("reference_proposition", e.target.value)} style={inputStyle} />
            </div>
            <div>
              <label style={labelStyle}>{t("finCondStatut")}</label>
              <select value={form.statut} onChange={(e) => maj("statut", e.target.value)} style={selectStyle}>
                {STATUTS.map((s) => (
                  <option key={s} value={s}>
                    {t(`finStatut_${s}`)}
                  </option>
                ))}
              </select>
              <Aide>{t("finCondStatutAide")}</Aide>
            </div>
          </div>
        </Section>

        <Section titre={t("finCondSectionDates")}>
          <div style={grille}>
            {champDate("date_proposition", t("finCondDateProposition"))}
            {champDate("date_effet", t("finCondDateEffet"), t("finCondDateEffetAide"))}
            {champDate("date_validite", t("finCondDateValidite"), t("finCondDateValiditeAide"))}
            {champDate("date_fin", t("finCondDateFin"), t("finCondDateFinAide"))}
          </div>
        </Section>

        <Section titre={t("finCondSectionLimites")}>
          <div style={grille}>
            {champNum("plafond_montant", t("finCondPlafond"), t("finCondPlafondAide"), { min: 0 })}
            {champNum("montant_min", t("finCondMontantMin"), null, { min: 0 })}
            {champNum("duree_min_jours", t("finCondDureeMin"), null, { min: 0 })}
            {champNum("duree_max_jours", t("finCondDureeMax"), null, { min: 0 })}
          </div>
        </Section>

        {champs.avance && (
          <Section titre={t("finCondSectionAvance")}>
            <div style={grille}>
              {champNum("taux_avance_pct", t("finCondTauxAvance"), t("finCondTauxAvanceAide"), { min: 0, max: 100 })}
              {champs.retenue && (
                <div>
                  <label style={labelStyle}>{t("finCondRetenueIncluse")}</label>
                  <select value={form.retenue_incluse_avance} onChange={(e) => maj("retenue_incluse_avance", e.target.value)} style={selectStyle}>
                    {RETENUES.map((r) => (
                      <option key={r} value={r}>
                        {t(`finRetenue_${r}`)}
                      </option>
                    ))}
                  </select>
                  <Aide>{t("finCondRetenueIncluseAide")}</Aide>
                </div>
              )}
            </div>
          </Section>
        )}

        {famille !== "GARANTIE" && (
          <Section titre={t("finCondSectionCalcul")}>
            <div style={grille}>
              {famille === "CREANCE" && (
                <div>
                  <label style={labelStyle}>{t("finCondBaseCreance")}</label>
                  <select value={form.base_creance} onChange={(e) => maj("base_creance", e.target.value)} style={selectStyle}>
                    {["TTC", "HT"].map((b) => (
                      <option key={b} value={b}>
                        {t(`finBaseCreance_${b}`)}
                      </option>
                    ))}
                  </select>
                </div>
              )}
              <div>
                <label style={labelStyle}>{t("finCondBaseJours")}</label>
                <select value={form.base_jours} onChange={(e) => maj("base_jours", Number(e.target.value))} style={selectStyle}>
                  <option value={360}>360 {t("finDays")}</option>
                  <option value={365}>365 {t("finDays")}</option>
                </select>
                <Aide>{t("finCondBaseJoursAide")}</Aide>
              </div>
              {champNum("jours_valeur", t("finCondJoursValeur"), t("finCondJoursValeurAide"), { min: 0 })}
              {champNum("duree_minimale_facturee", t("finCondDureeMinFacturee"), t("finCondDureeMinFactureeAide"), { min: 0 })}
            </div>
          </Section>
        )}

        <Section titre={t("finCondSectionTaxe")}>
          <div style={grille}>
            <div>
              <label style={labelStyle}>{t("finCondTaxeLibelle")}</label>
              <input value={form.taxe_libelle} onChange={(e) => maj("taxe_libelle", e.target.value)} style={inputStyle} />
            </div>
            {champNum("taxe_taux_pct", t("finCondTaxeTaux"), null, { min: 0 })}
          </div>
          <Aide>{t("finCondTaxeAide")}</Aide>
        </Section>

        {(champs.recours || champs.domiciliation || champs.debiteurs) && (
          <Section titre={t("finCondSectionRisque")}>
            <div style={{ display: "grid", gap: 12 }}>
              {champs.recours && (
                <div style={{ maxWidth: 420 }}>
                  <label style={labelStyle}>{t("finCondRecours")}</label>
                  <select value={form.recours} onChange={(e) => maj("recours", e.target.value)} style={selectStyle}>
                    <option value="">{t("finNone")}</option>
                    {RECOURS.map((r) => (
                      <option key={r} value={r}>
                        {t(`finRecours_${r}`)}
                      </option>
                    ))}
                  </select>
                </div>
              )}
              {champs.domiciliation && (
                <label style={{ fontSize: 12.8, display: "flex", gap: 8, alignItems: "center" }}>
                  <input type="checkbox" checked={!!form.domiciliation_exigee} onChange={(e) => maj("domiciliation_exigee", e.target.checked)} />
                  {t("finCondDomiciliation")}
                </label>
              )}
              {champs.debiteurs && (
                <>
                  <label style={{ fontSize: 12.8, display: "flex", gap: 8, alignItems: "center" }}>
                    <input type="checkbox" checked={!!form.restreindre_debiteurs} onChange={(e) => maj("restreindre_debiteurs", e.target.checked)} />
                    {t("finCondRestreindre")}
                  </label>
                  {form.restreindre_debiteurs && (
                    <div>
                      <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 6 }}>{t("finCondDebiteurs")}</div>
                      {form.debiteurs_agrees_json.map((d, i) => (
                        <div key={i} style={{ display: "flex", gap: 8, marginBottom: 6, flexWrap: "wrap" }}>
                          <input placeholder={t("finCondDebiteurNom")} value={d.nom} onChange={(e) => majDebiteur(i, "nom", e.target.value)} style={{ ...inputStyle, maxWidth: 260 }} />
                          <input type="number" min="0" placeholder={t("finCondDebiteurEncours")} value={d.encours_autorise} onChange={(e) => majDebiteur(i, "encours_autorise", e.target.value)} style={{ ...inputStyle, maxWidth: 220 }} />
                          <button type="button" style={boutonDangerStyle} onClick={() => setForm((f) => ({ ...f, debiteurs_agrees_json: f.debiteurs_agrees_json.filter((_, j) => j !== i) }))}>
                            {t("finFraisRetirer")}
                          </button>
                        </div>
                      ))}
                      <button type="button" style={boutonSecondaireStyle} onClick={() => setForm((f) => ({ ...f, debiteurs_agrees_json: [...f.debiteurs_agrees_json, { nom: "", encours_autorise: "" }] }))}>
                        {t("finCondDebiteurAjouter")}
                      </button>
                    </div>
                  )}
                </>
              )}
            </div>
          </Section>
        )}

        <Section titre={t("finCondSectionFrais")}>
          <p style={{ fontSize: 12.3, color: "var(--sub)", marginBottom: 12, lineHeight: 1.5 }}>{t("finFraisIntro")}</p>
          <div style={{ display: "grid", gap: 10 }}>
            {form.frais.map((l, i) => {
              const pct = l.mode_calcul.startsWith("POURCENT");
              const periodique = l.mode_calcul.endsWith("PERIODE");
              const aRenseigner = l.actif && (l.taux_pct === "" && l.montant_fixe === "");
              return (
                <div key={l.id || i} style={{ border: `1px solid ${aRenseigner ? "var(--ocre)" : "var(--line)"}`, borderRadius: 10, padding: 12, background: l.actif ? "#fff" : "var(--line-soft)" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
                    <label style={{ fontSize: 12.5, display: "flex", gap: 8, alignItems: "center" }}>
                      <input type="checkbox" checked={l.actif} onChange={(e) => majLigne(i, "actif", e.target.checked)} />
                      {t("finFraisActif")}
                    </label>
                    {aRenseigner && <span style={{ fontSize: 11.5, color: "var(--ocre)", fontWeight: 700 }}>{t("finFraisAReseigner")}</span>}
                    <button type="button" style={boutonDangerStyle} onClick={() => setForm((f) => ({ ...f, frais: f.frais.filter((_, j) => j !== i) }))}>
                      {t("finFraisRetirer")}
                    </button>
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: 10 }}>
                    <div style={{ gridColumn: "span 2" }}>
                      <label style={labelStyle}>{t("finFraisLibelle")}</label>
                      <input value={l.libelle} onChange={(e) => majLigne(i, "libelle", e.target.value)} style={inputStyle} />
                    </div>
                    <div>
                      <label style={labelStyle}>{t("finFraisNature")}</label>
                      <select value={l.nature} onChange={(e) => majLigne(i, "nature", e.target.value)} style={selectStyle}>
                        {["COUT", "RETENUE"].map((n) => (
                          <option key={n} value={n}>
                            {t(`finNature_${n}`)}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label style={labelStyle}>{t("finFraisMode")}</label>
                      <select value={l.mode_calcul} onChange={(e) => majLigne(i, "mode_calcul", e.target.value)} style={selectStyle}>
                        {MODES.map((m) => (
                          <option key={m} value={m}>
                            {t(`finMode_${m}`)}
                          </option>
                        ))}
                      </select>
                    </div>
                    {pct && (
                      <div>
                        <label style={labelStyle}>{t("finFraisTaux")}</label>
                        <input type="number" step="any" min="0" value={l.taux_pct} onChange={(e) => majLigne(i, "taux_pct", e.target.value)} style={inputStyle} />
                      </div>
                    )}
                    {pct && famille !== "GARANTIE" && (
                      <div>
                        <label style={labelStyle}>{t("finFraisBase")}</label>
                        <select value={l.base} onChange={(e) => majLigne(i, "base", e.target.value)} style={selectStyle}>
                          {["CREANCE", "AVANCE"].map((b) => (
                            <option key={b} value={b}>
                              {t(`finBaseFrais_${b}`)}
                            </option>
                          ))}
                        </select>
                      </div>
                    )}
                    {!pct && (
                      <div>
                        <label style={labelStyle}>{t("finFraisFixe")}</label>
                        <input type="number" step="any" min="0" value={l.montant_fixe} onChange={(e) => majLigne(i, "montant_fixe", e.target.value)} style={inputStyle} />
                      </div>
                    )}
                    {periodique && (
                      <>
                        <div>
                          <label style={labelStyle}>{t("finFraisPeriode")}</label>
                          <select value={l.periode} onChange={(e) => majLigne(i, "periode", e.target.value)} style={selectStyle}>
                            <option value="">{t("finNone")}</option>
                            {PERIODES.map((p) => (
                              <option key={p} value={p}>
                                {t(`finPeriode_${p}`)}
                              </option>
                            ))}
                          </select>
                        </div>
                        <label style={{ fontSize: 12.3, display: "flex", gap: 8, alignItems: "center", alignSelf: "end", paddingBottom: 8 }}>
                          <input type="checkbox" checked={l.periode_entamee !== false} onChange={(e) => majLigne(i, "periode_entamee", e.target.checked)} />
                          {t("finFraisEntamee")}
                        </label>
                      </>
                    )}
                    <div>
                      <label style={labelStyle}>{t("finFraisMin")}</label>
                      <input type="number" step="any" min="0" value={l.minimum} onChange={(e) => majLigne(i, "minimum", e.target.value)} style={inputStyle} />
                    </div>
                    <div>
                      <label style={labelStyle}>{t("finFraisMax")}</label>
                      <input type="number" step="any" min="0" value={l.maximum} onChange={(e) => majLigne(i, "maximum", e.target.value)} style={inputStyle} />
                    </div>
                    {l.nature === "COUT" && (
                      <div>
                        <label style={labelStyle}>{t("finFraisPrelevement")}</label>
                        <select value={l.prelevement} onChange={(e) => majLigne(i, "prelevement", e.target.value)} style={selectStyle}>
                          {["A_LA_MISE_EN_PLACE", "A_L_ECHEANCE"].map((p) => (
                            <option key={p} value={p}>
                              {t(`finPrelev_${p}`)}
                            </option>
                          ))}
                        </select>
                      </div>
                    )}
                    {l.nature === "COUT" && (
                      <label style={{ fontSize: 12.3, display: "flex", gap: 8, alignItems: "center", alignSelf: "end", paddingBottom: 8 }}>
                        <input type="checkbox" checked={l.soumis_taxe !== false} onChange={(e) => majLigne(i, "soumis_taxe", e.target.checked)} />
                        {t("finFraisTaxe")} ({form.taxe_libelle || "TOB"})
                      </label>
                    )}
                    <div style={{ gridColumn: "1 / -1" }}>
                      <label style={labelStyle}>{t("finFraisObservation")}</label>
                      <input value={l.observation} onChange={(e) => majLigne(i, "observation", e.target.value)} style={inputStyle} />
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
          <button
            type="button"
            style={{ ...boutonSecondaireStyle, marginTop: 10 }}
            onClick={() =>
              setForm((f) => ({
                ...f,
                frais: [
                  ...f.frais,
                  { code: `LIGNE_${f.frais.length + 1}`, libelle: "", nature: "COUT", mode_calcul: "POURCENT_FLAT", base: "CREANCE", taux_pct: "", montant_fixe: "", periode: "", periode_entamee: true, minimum: "", maximum: "", prelevement: "A_LA_MISE_EN_PLACE", soumis_taxe: true, actif: true, observation: "" },
                ],
              }))
            }
          >
            {t("finFraisAjouter")}
          </button>
        </Section>

        <Section titre={t("finCondSectionPieces")}>
          <div style={{ display: "grid", gap: 12 }}>
            <div>
              <label style={labelStyle}>{t("finCondJustificatifs")}</label>
              <textarea value={form.justificatifs} onChange={(e) => maj("justificatifs", e.target.value)} rows={3} style={{ ...inputStyle, resize: "vertical" }} />
            </div>
            <div>
              <label style={labelStyle}>{t("finCondParticulieres")}</label>
              <textarea value={form.conditions_particulieres} onChange={(e) => maj("conditions_particulieres", e.target.value)} rows={3} style={{ ...inputStyle, resize: "vertical" }} />
            </div>
            <div>
              <label style={labelStyle}>{t("finCondNotes")}</label>
              <textarea value={form.notes} onChange={(e) => maj("notes", e.target.value)} rows={2} style={{ ...inputStyle, resize: "vertical" }} />
            </div>
          </div>
        </Section>

        <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap", marginBottom: 22 }}>
          <button type="submit" disabled={envoi} style={boutonPrincipalStyle}>
            {envoi ? t("finSaving") : t("finCondEnregistrer")}
          </button>
          <Link href={`/financement/banques/${form.partenaire_id}`} style={{ ...boutonSecondaireStyle, textDecoration: "none" }}>
            {t("finCondRetourBanque")}
          </Link>
          {message && <span style={{ color: "var(--vert)", fontSize: 12.5 }}>{message}</span>}
          {erreur && <span style={{ color: "var(--brique)", fontSize: 12.5 }}>{erreur}</span>}
        </div>
      </form>

      <Section titre={t("finCondTester")}>
        <p style={{ fontSize: 12.3, color: "var(--sub)", marginBottom: 10 }}>{t("finCondTesterAide")}</p>
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "flex-end", marginBottom: 12 }}>
          <div>
            <label style={labelStyle}>{t("finCondTestMontant")}</label>
            <input type="number" min="1" value={test.montant} onChange={(e) => setTest((x) => ({ ...x, montant: e.target.value }))} style={{ ...inputStyle, width: 200 }} />
          </div>
          <div>
            <label style={labelStyle}>{t("finCondTestDuree")}</label>
            <input type="number" min="1" value={test.duree_jours} onChange={(e) => setTest((x) => ({ ...x, duree_jours: e.target.value }))} style={{ ...inputStyle, width: 140 }} />
          </div>
          <button type="button" onClick={tester} style={boutonPrincipalStyle}>
            {t("finCondTestLancer")}
          </button>
        </div>
        {testRes && testRes.releves[0] && <ReleveCarte releve={testRes.releves[0]} classement={null} />}
      </Section>
    </AppShell>
  );
}
