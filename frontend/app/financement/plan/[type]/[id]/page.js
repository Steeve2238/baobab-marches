"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { api } from "../../../../../lib/api";
import { useLangue } from "../../../../../lib/i18n/LanguageContext";
import AppShell from "../../../../../lib/components/AppShell";
import FinancementSousNav from "../../../../../lib/components/financement/FinancementSousNav";
import CourbeTresorerie, { fmtCompact } from "../../../../../lib/components/financement/CourbeTresorerie";
import { useEntete, EnteteOfficielle, SignatureOfficielle, PiedOfficiel } from "../../../../../lib/components/DocumentOfficiel";
import EcheancierEditor from "../../../../../lib/components/EcheancierEditor";
import { echeancierValide, pourApi, texteEcheancier } from "../../../../../lib/echeancier";
import { fmtXof, Pastille, labelStyle, inputStyle, boutonPrincipalStyle, boutonSecondaireStyle, thStyle, tdStyle, numStyle } from "../../../../../lib/financementUi";

const JALONS = ["production_jours", "transport_jours", "livraison_jours", "facturation_jours", "reception_jours"];
const EVENEMENTS = ["COMMANDE", "EXPEDITION", "ARRIVEE", "LIVRAISON", "FACTURATION", "RECEPTION"];

function fmtDate(iso) {
  return iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : "";
}
const fmtDdMm = (iso) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}` : "");

function lienDossier(type, id) {
  return type === "ao" ? `/dossiers/${id}` : `/marches/consultation-restreinte/consultations/${id}`;
}

// Plan de tresorerie previsionnel d'un dossier (appel d'offres ou consultation
// restreinte) : parametres, besoin de financement, courbe, tableau par periode.
export default function PlanTresoreriePage() {
  const { t, dict } = useLangue();
  const locale = dict.dateLocale || "fr-FR";
  const { type, id } = useParams();
  const [data, setData] = useState(null);
  const [form, setForm] = useState(null);
  const [clientEdit, setClientEdit] = useState(null); // null = pas de modification
  const [fournEdit, setFournEdit] = useState({}); // { fournisseur_id: lignes | [] }
  const [fournOuvert, setFournOuvert] = useState({});
  const [erreur, setErreur] = useState("");
  const [message, setMessage] = useState("");
  const [calcul, setCalcul] = useState(false);
  const entete = useEntete();

  function initialiser(d) {
    const p = d.params;
    const fin = d.sources.financement;
    setForm({
      date_t: p.date_t,
      base: p.base,
      hors_douane: p.hors_douane,
      apport_xof: String(p.apport_xof || 0),
      pas: p.pas,
      marge_jours: String(p.marge_jours),
      jalons: Object.fromEntries(JALONS.map((k) => [k, p.jalons && p.jalons[k] !== undefined ? String(p.jalons[k]) : ""])),
      avec_financement: p.avec_financement,
      simulation_id: p.simulation_id || (fin ? fin.simulation_id : ""),
      condition_id: p.condition_id || (fin ? fin.condition_id : ""),
      autres_flux: (p.autres_flux || []).map((a) => ({
        libelle: a.libelle || "",
        sens: a.sens,
        montant: String(a.montant),
        mode: a.date ? "DATE" : "EVT",
        date: a.date || "",
        evenement: a.evenement || "COMMANDE",
        jours: String(a.jours ?? 0),
      })),
    });
  }

  useEffect(() => {
    let vivant = true;
    api
      .finPlan(type, id)
      .then((d) => {
        if (!vivant) return;
        setData(d);
        initialiser(d);
      })
      .catch((e) => vivant && setErreur(e.message || t("planChargementErreur")));
    return () => {
      vivant = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [type, id]);

  function payload() {
    const p = {
      date_t: form.date_t,
      base: form.base,
      hors_douane: form.hors_douane,
      apport_xof: form.apport_xof === "" ? 0 : form.apport_xof,
      pas: form.pas,
      marge_jours: form.marge_jours === "" ? 15 : form.marge_jours,
      jalons: Object.fromEntries(JALONS.filter((k) => form.jalons[k] !== "").map((k) => [k, form.jalons[k]])),
      avec_financement: form.avec_financement,
      simulation_id: form.simulation_id || null,
      condition_id: form.condition_id || null,
      autres_flux: form.autres_flux
        .filter((a) => a.montant !== "")
        .map((a) => ({
          libelle: a.libelle,
          sens: a.sens,
          montant: a.montant,
          ...(a.mode === "DATE" && a.date ? { date: a.date } : { evenement: a.evenement, jours: a.jours === "" ? 0 : a.jours }),
        })),
    };
    if (clientEdit !== null) p.echeancier_client = clientEdit.length ? pourApi(clientEdit) : null;
    const map = { ...(data.params.echeanciers_fournisseurs || {}) };
    for (const [fid, lignes] of Object.entries(fournEdit)) {
      if (lignes.length === 0) delete map[fid];
      else map[fid] = pourApi(lignes);
    }
    p.echeanciers_fournisseurs = map;
    return p;
  }

  function verifier() {
    if (clientEdit !== null && clientEdit.length > 0 && !echeancierValide(clientEdit)) return t("echObligatoire");
    for (const l of Object.values(fournEdit)) if (l.length > 0 && !echeancierValide(l)) return t("echObligatoire");
    return "";
  }

  async function recalculer() {
    setErreur("");
    setMessage("");
    const v = verifier();
    if (v) return setErreur(v);
    setCalcul(true);
    try {
      const d = await api.finPlanCalculer(type, id, payload());
      setData(d);
    } catch (e) {
      setErreur(e.message);
    } finally {
      setCalcul(false);
    }
  }

  async function enregistrer() {
    setErreur("");
    setMessage("");
    const v = verifier();
    if (v) return setErreur(v);
    setCalcul(true);
    try {
      const d = await api.finPlanEnregistrer(type, id, payload());
      setData(d);
      initialiser(d);
      setClientEdit(null);
      setFournEdit({});
      setMessage(t("planEnregistre"));
    } catch (e) {
      setErreur(e.message);
    } finally {
      setCalcul(false);
    }
  }

  const maj = (champ, v) => setForm((f) => ({ ...f, [champ]: v }));
  const sim = useMemo(() => (data && form ? data.simulations_disponibles.find((s) => s.id === form.simulation_id) : null), [data, form]);

  if (!data || !form) {
    return (
      <AppShell title={t("planTitre")} subNav={<FinancementSousNav />}>
        <p style={{ fontSize: 12.5, color: erreur ? "var(--brique)" : "var(--sub)" }}>{erreur || t("finLoading")}</p>
      </AppShell>
    );
  }

  const plan = data.plan;
  const sources = data.sources;
  const echClientAffiche = clientEdit !== null ? clientEdit : sources.client.echeancier || [];
  const srcClient = clientEdit !== null ? "PLAN" : sources.client.source || "NONE";

  function changerSimulation(simId) {
    const s = data.simulations_disponibles.find((x) => x.id === simId);
    setForm((f) => ({ ...f, simulation_id: simId, condition_id: s ? s.condition_retenue_id || s.recommandee_id || (s.banques[0] && s.banques[0].condition_id) || "" : "" }));
  }

  return (
    <AppShell title={t("planTitre")} subNav={<FinancementSousNav />} backHref={lienDossier(type, id)}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, flexWrap: "wrap", marginBottom: 12 }}>
        <div>
          <h2 style={{ fontSize: 16, color: "var(--petrol)", marginBottom: 4 }}>
            {t("planSurDossier")} : {data.dossier.reference ? `${data.dossier.reference} · ` : ""}
            {data.dossier.libelle}
          </h2>
          <p style={{ fontSize: 12.5, color: "var(--sub)", maxWidth: 780, lineHeight: 1.55 }}>{t("planIntro")}</p>
        </div>
        <div className="no-print" style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button type="button" onClick={() => window.print()} style={boutonSecondaireStyle}>{t("planImprimer")}</button>
          <button type="button" onClick={() => api.finPlanExporter(type, id, "pdf").catch((e) => setErreur(e.message))} style={boutonSecondaireStyle}>{t("planPdf")}</button>
          <button type="button" onClick={() => api.finPlanExporter(type, id, "xlsx").catch((e) => setErreur(e.message))} style={boutonSecondaireStyle}>{t("planExcel")}</button>
          <Link href={`/financement/compte/${type}/${id}`} style={{ ...boutonSecondaireStyle, textDecoration: "none" }}>{t("cexLienOuvrir")}</Link>
        </div>
      </div>

      {erreur && <p style={{ color: "var(--brique)", fontSize: 12.5, marginBottom: 10 }}>{erreur}</p>}
      {message && <p style={{ color: "var(--vert)", fontSize: 12.5, marginBottom: 10 }}>{message}</p>}

      {/* ------------------------------------------------ parametres */}
      <section className="card no-print" style={{ marginBottom: 16 }}>
        <h3 style={{ fontSize: 14, color: "var(--petrol)", marginBottom: 10 }}>{t("planParametres")}</h3>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 12 }}>
          <div>
            <label style={labelStyle}>{t("planDateT")}</label>
            <input type="date" value={form.date_t} onChange={(e) => maj("date_t", e.target.value)} style={inputStyle} />
            <p style={aideStyle}>{t("planDateTAide")}</p>
          </div>
          <div>
            <label style={labelStyle}>{t("planApport")}</label>
            <input inputMode="decimal" value={form.apport_xof} onChange={(e) => maj("apport_xof", e.target.value)} style={inputStyle} />
            <p style={aideStyle}>{t("planApportAide")}</p>
          </div>
          <div>
            <label style={labelStyle}>{t("planPas")}</label>
            <select value={form.pas} onChange={(e) => maj("pas", e.target.value)} style={inputStyle}>
              <option value="AUTO">{t("planPasAuto")}</option>
              <option value="JOUR">{t("planPasJour")}</option>
              <option value="SEMAINE">{t("planPasSemaine")}</option>
              <option value="MOIS">{t("planPasMois")}</option>
            </select>
          </div>
          <div>
            <label style={labelStyle}>{t("planMarge")}</label>
            <input type="number" min="0" max="365" value={form.marge_jours} onChange={(e) => maj("marge_jours", e.target.value)} style={inputStyle} />
          </div>
        </div>

        <div style={{ marginTop: 12 }}>
          <label style={labelStyle}>{t("planBase")}</label>
          <div style={{ display: "grid", gap: 6 }}>
            <label style={radioStyle}>
              <input type="radio" name="base" checked={form.base === "TTC"} onChange={() => maj("base", "TTC")} /> {t("planBaseTtc")}
            </label>
            <label style={radioStyle}>
              <input type="radio" name="base" checked={form.base === "HT"} onChange={() => maj("base", "HT")} /> {t("planBaseHt")}
            </label>
            <label style={radioStyle}>
              <input type="checkbox" checked={form.hors_douane} onChange={(e) => maj("hors_douane", e.target.checked)} /> {t("planHorsDouane")}
            </label>
          </div>
        </div>

        <h4 style={sousTitre}>{t("planJalons")}</h4>
        <p style={aideStyle}>{t("planJalonsAide")}</p>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))", gap: 10, marginTop: 6 }}>
          {JALONS.map((k) => (
            <div key={k}>
              <label style={labelStyle}>{t(`planJ_${k}`)}</label>
              <input type="number" min="0" max="720" placeholder={String(data.jalons_defaut[k])} value={form.jalons[k]} onChange={(e) => setForm((f) => ({ ...f, jalons: { ...f.jalons, [k]: e.target.value } }))} style={inputStyle} />
            </div>
          ))}
        </div>

        <h4 style={sousTitre}>{t("planFinancement")}</h4>
        <label style={radioStyle}>
          <input type="checkbox" checked={form.avec_financement} onChange={(e) => maj("avec_financement", e.target.checked)} /> {t("planAvecFinancement")}
        </label>
        {form.avec_financement &&
          (data.simulations_disponibles.length === 0 ? (
            <p style={{ ...aideStyle, marginTop: 8 }}>{t("planAucuneSimulation")}</p>
          ) : (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 12, marginTop: 8 }}>
              <div>
                <label style={labelStyle}>{t("planSimulation")}</label>
                <select value={form.simulation_id} onChange={(e) => changerSimulation(e.target.value)} style={inputStyle}>
                  <option value="">{t("planChoisirSimulation")}</option>
                  {data.simulations_disponibles.map((s) => (
                    <option key={s.id} value={s.id}>
                      {(s.libelle || t(`finType_${s.type_facilite}`)) + " · " + fmtXof(s.montant, locale) + " XOF" + (s.statut !== "SIMULEE" ? ` · ${t("planRetenue")}` : "")}
                    </option>
                  ))}
                </select>
              </div>
              {sim && (
                <div>
                  <label style={labelStyle}>{t("planBanque")}</label>
                  <select value={form.condition_id} onChange={(e) => maj("condition_id", e.target.value)} style={inputStyle}>
                    {sim.banques.map((b) => (
                      <option key={b.condition_id} value={b.condition_id}>
                        {`${b.partenaire_nom} · ${t("planCoutLigne")} ${fmtXof(b.cout_ttc, locale)}${b.eligible ? "" : ` · ${t("planNonEligible")}`}`}
                      </option>
                    ))}
                  </select>
                </div>
              )}
            </div>
          ))}

        <h4 style={sousTitre}>{t("planEcheancierClient")}</h4>
        <p style={aideStyle}>{t(`planEcheancierClientSource_${srcClient}`)}</p>
        <div style={{ marginTop: 6 }}>
          <EcheancierEditor sens="CLIENT" valeur={echClientAffiche} onChange={setClientEdit} compact titre={data.dossier.client_nom || t("planEcheancierClient")} />
          {srcClient === "PLAN" && (
            <button type="button" onClick={() => setClientEdit([])} style={{ ...boutonSecondaireStyle, marginTop: 6 }}>{t("planRevenirFiche")}</button>
          )}
        </div>

        <h4 style={sousTitre}>{t("planEcheancierFournisseurs")}</h4>
        <div style={{ display: "grid", gap: 8, marginTop: 6 }}>
          {sources.fournisseurs.length === 0 && <p style={aideStyle}>{t("planFournisseurSource_NONE")}</p>}
          {sources.fournisseurs.map((f) => {
            const edit = fournEdit[f.fournisseur_id];
            const lignes = edit !== undefined ? edit : f.echeancier || [];
            const src = edit !== undefined ? "PLAN" : f.source || "NONE";
            const ouvert = !!fournOuvert[f.fournisseur_id] || (!f.echeancier && edit === undefined);
            return (
              <div key={f.fournisseur_id} style={{ border: "1px solid var(--line)", borderRadius: 10, padding: 10, background: "#fff" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                  <div>
                    <div style={{ fontWeight: 600, fontSize: 13 }}>{f.nom} <span style={{ color: "var(--sub)", fontWeight: 400 }}>· {fmtXof(f.montant_xof, locale)} XOF</span></div>
                    <div style={{ fontSize: 12, color: lignes.length ? "var(--sub)" : "var(--brique)" }}>
                      {t(`planFournisseurSource_${src}`)}
                      {lignes.length > 0 && echeancierValide(lignes) ? ` — ${texteEcheancier(lignes, t)}` : ""}
                    </div>
                  </div>
                  <div style={{ display: "flex", gap: 6 }}>
                    <button type="button" onClick={() => setFournOuvert((o) => ({ ...o, [f.fournisseur_id]: !ouvert }))} style={boutonSecondaireStyle}>
                      {ouvert ? t("echFermer") : t("planModifierPourDossier")}
                    </button>
                    {src === "PLAN" && (
                      <button type="button" onClick={() => setFournEdit((m) => ({ ...m, [f.fournisseur_id]: [] }))} style={boutonSecondaireStyle}>{t("planRevenirFiche")}</button>
                    )}
                  </div>
                </div>
                {ouvert && (
                  <div style={{ marginTop: 8 }}>
                    <EcheancierEditor sens="FOURNISSEUR" valeur={lignes} onChange={(v) => setFournEdit((m) => ({ ...m, [f.fournisseur_id]: v }))} compact titre={f.nom} />
                  </div>
                )}
              </div>
            );
          })}
        </div>

        <h4 style={sousTitre}>{t("planAutresFlux")}</h4>
        <p style={aideStyle}>{t("planAutresFluxAide")}</p>
        <div style={{ display: "grid", gap: 8, marginTop: 6 }}>
          {form.autres_flux.map((a, i) => {
            const setA = (champ, v) => setForm((f) => ({ ...f, autres_flux: f.autres_flux.map((x, k) => (k === i ? { ...x, [champ]: v } : x)) }));
            return (
              <div key={i} style={{ display: "grid", gridTemplateColumns: "minmax(140px, 2fr) 120px 130px minmax(190px, 2fr) 32px", gap: 8, alignItems: "end" }}>
                <div>
                  <label style={labelStyle}>{t("planAutreLibelle")}</label>
                  <input value={a.libelle} onChange={(e) => setA("libelle", e.target.value)} style={inputStyle} />
                </div>
                <div>
                  <label style={labelStyle}>{t("planAutreSens")}</label>
                  <select value={a.sens} onChange={(e) => setA("sens", e.target.value)} style={inputStyle}>
                    <option value="SORTIE">{t("planAutreSortie")}</option>
                    <option value="ENTREE">{t("planAutreEntree")}</option>
                  </select>
                </div>
                <div>
                  <label style={labelStyle}>{t("planAutreMontant")}</label>
                  <input inputMode="decimal" value={a.montant} onChange={(e) => setA("montant", e.target.value)} style={inputStyle} />
                </div>
                <div>
                  <label style={labelStyle}>{t("planAutreQuand")}</label>
                  <div style={{ display: "flex", gap: 6 }}>
                    <select value={a.mode} onChange={(e) => setA("mode", e.target.value)} style={{ ...inputStyle, width: 110 }}>
                      <option value="EVT">{t("planAutreJoursApres")}</option>
                      <option value="DATE">{t("planAutreDateFixe")}</option>
                    </select>
                    {a.mode === "DATE" ? (
                      <input type="date" value={a.date} onChange={(e) => setA("date", e.target.value)} style={inputStyle} />
                    ) : (
                      <>
                        <input type="number" min="0" value={a.jours} onChange={(e) => setA("jours", e.target.value)} style={{ ...inputStyle, width: 64 }} aria-label={t("echJours")} />
                        <select value={a.evenement} onChange={(e) => setA("evenement", e.target.value)} style={inputStyle}>
                          {EVENEMENTS.map((ev) => (
                            <option key={ev} value={ev}>{t(`echEv_${ev}`)}</option>
                          ))}
                        </select>
                      </>
                    )}
                  </div>
                </div>
                <button type="button" onClick={() => setForm((f) => ({ ...f, autres_flux: f.autres_flux.filter((_, k) => k !== i) }))} style={{ ...boutonSecondaireStyle, padding: "8px 0" }} title={t("echSupprimerLigne")}>×</button>
              </div>
            );
          })}
          <div>
            <button type="button" onClick={() => setForm((f) => ({ ...f, autres_flux: [...f.autres_flux, { libelle: "", sens: "SORTIE", montant: "", mode: "EVT", date: "", evenement: "COMMANDE", jours: "0" }] }))} style={boutonSecondaireStyle}>
              {t("planAjouterFlux")}
            </button>
          </div>
        </div>

        <div style={{ display: "flex", gap: 8, marginTop: 16, flexWrap: "wrap" }}>
          <button type="button" disabled={calcul} onClick={recalculer} style={boutonPrincipalStyle}>{calcul ? t("planCalcul") : t("planRecalculer")}</button>
          <button type="button" disabled={calcul} onClick={enregistrer} style={boutonSecondaireStyle}>{t("planEnregistrer")}</button>
        </div>
      </section>

      {/* ------------------------------------------------ resultat */}
      {plan.incomplet.length > 0 ? (
        <section className="card" style={{ borderColor: "var(--brique)" }}>
          <h3 style={{ fontSize: 14, color: "var(--brique)", marginBottom: 6 }}>{t("planIncomplet")}</h3>
          <p style={aideStyle}>{t("planIncompletAide")}</p>
          <ul style={{ margin: "8px 0 0 18px", fontSize: 13, lineHeight: 1.7 }}>
            {plan.incomplet.map((x, i) => (
              <li key={i}>{x.texte}</li>
            ))}
          </ul>
          <div className="no-print" style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
            <Link href="/fournisseurs" style={{ ...boutonSecondaireStyle, textDecoration: "none" }}>{t("planAllerFournisseurs")}</Link>
            <Link href="/ventes/clients" style={{ ...boutonSecondaireStyle, textDecoration: "none" }}>{t("planAllerClients")}</Link>
            <Link href="/calcul-prix" style={{ ...boutonSecondaireStyle, textDecoration: "none" }}>{t("planAllerCalcul")}</Link>
          </div>
        </section>
      ) : (
        <div className="card print-letter" style={{ padding: "28px 32px" }}>
          <EnteteOfficielle entete={entete} titre={t("planTitreDocument")} sousTitre={`${data.dossier.reference ? `${data.dossier.reference} · ` : ""}${data.dossier.libelle}`} />
          <p style={{ fontSize: 12, color: "var(--sub)", marginBottom: 6 }}>
            {t("planDateT")} : <b>{fmtDate(data.params.date_t)}</b>
          </p>
          <Resultat plan={plan} t={t} locale={locale} />
          <SignatureOfficielle entete={entete} lieuDate={`${t("cexFaitLe")} ${new Date().toLocaleDateString(locale)}`} />
          <PiedOfficiel entete={entete} />
        </div>
      )}
    </AppShell>
  );
}

function Tuile({ titre, valeur, aide, alerte }) {
  return (
    <div className="card" style={{ minWidth: 0 }}>
      <div style={{ fontSize: 10.5, color: "var(--sub)", textTransform: "uppercase", letterSpacing: 0.4 }}>{titre}</div>
      <div className="mono" style={{ fontSize: 19, fontWeight: 700, marginTop: 4, color: alerte ? "var(--brique)" : "var(--ink)" }}>{valeur}</div>
      {aide && <div style={{ fontSize: 11.5, color: "var(--sub)", marginTop: 4, lineHeight: 1.4 }}>{aide}</div>}
    </div>
  );
}

function Resultat({ plan, t, locale }) {
  const s = plan.synthese;
  const avec = plan.avec;
  const niveauStyle = {
    ALERTE: { c: "var(--brique)", f: "var(--brique-bg)" },
    ATTENTION: { c: "#8A5A00", f: "#FFF3D6" },
    INFO: { c: "var(--sub)", f: "var(--line-soft)" },
  };
  return (
    <>
      <p style={{ fontSize: 12, color: "var(--sub)", marginBottom: 8 }}>
        {plan.notes.join(" ")} {t("planMontantsEn")}
      </p>
      <h3 style={h3Style}>{t("planSynthese")}</h3>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))", gap: 10, marginBottom: 14 }}>
        <Tuile
          titre={t("planBesoinMax")}
          valeur={s.besoin_max > 0 ? `${fmtXof(s.besoin_max, locale)}` : "0"}
          aide={s.besoin_max > 0 ? t("planBesoinDate").replace("{date}", fmtDate(s.date_besoin_max)).replace("{j}", s.jour_besoin_max) : t("planAucunBesoin")}
          alerte={s.besoin_max > 0}
        />
        <Tuile titre={t("planPortage")} valeur={`${s.portage_jours} ${t("planJoursUnite")}`} aide={`${t("planPortageAide")} (${fmtDate(s.premier_decaissement)} → ${fmtDate(s.dernier_encaissement)})`} />
        <Tuile titre={t("planSoldeFinalSans")} valeur={fmtXof(s.solde_final_sans, locale)} />
        {avec && <Tuile titre={t("planSoldeFinalAvec")} valeur={fmtXof(s.solde_final_avec, locale)} />}
        {avec && <Tuile titre={t("planCoutFinancement")} valeur={fmtXof(s.cout_financement, locale)} aide={plan.financement ? `${plan.financement.banque} · ${fmtDate(plan.financement.date_prise)} → ${fmtDate(plan.financement.date_echeance)}` : null} />}
        {avec && <Tuile titre={t("planPointBasAvec")} valeur={fmtXof(s.point_bas_avec, locale)} alerte={s.point_bas_avec < -0.5} />}
      </div>

      <div className="card" style={{ marginBottom: 14 }}>
        <h3 style={{ ...h3Style, marginTop: 0 }}>{t("planCommentaire")}</h3>
        <ul style={{ margin: "4px 0 0 18px", fontSize: 13.2, lineHeight: 1.7 }}>
          {plan.commentaire.map((c, i) => (
            <li key={i}>{c}</li>
          ))}
        </ul>
      </div>

      {plan.alertes.length > 0 && (
        <div style={{ display: "grid", gap: 6, marginBottom: 14 }}>
          <h3 style={{ ...h3Style, marginBottom: 2 }}>{t("planAlertes")}</h3>
          {plan.alertes.map((a, i) => (
            <div key={i} style={{ display: "flex", gap: 10, alignItems: "flex-start", background: niveauStyle[a.niveau].f, borderRadius: 8, padding: "8px 12px", fontSize: 13 }}>
              <Pastille couleur={niveauStyle[a.niveau].c}>{t(`planNiveau_${a.niveau}`)}</Pastille>
              <span style={{ lineHeight: 1.5 }}>{a.texte}</span>
            </div>
          ))}
        </div>
      )}

      <div className="card" style={{ marginBottom: 14 }}>
        <h3 style={{ ...h3Style, marginTop: 0 }}>{t("planGraphique")}</h3>
        <CourbeTresorerie plan={plan} locale={locale} />
      </div>

      <h3 style={h3Style}>{t("planTableau")}</h3>
      <div className="card" style={{ overflowX: "auto", marginBottom: 14, padding: 0 }}>
        <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 760 }}>
          <thead>
            <tr>
              <th style={thStyle}>{t("planPeriode")}</th>
              <th style={{ ...thStyle, textAlign: "right" }}>{t("planColEncaissements")}</th>
              <th style={{ ...thStyle, textAlign: "right" }}>{t("planColDecaissements")}</th>
              {avec && <th style={{ ...thStyle, textAlign: "right" }}>{t("planColFinancement")}</th>}
              <th style={{ ...thStyle, textAlign: "right" }}>{t("planColSoldeSans")}</th>
              {avec && <th style={{ ...thStyle, textAlign: "right" }}>{t("planColSoldeAvec")}</th>}
              <th style={{ ...thStyle, textAlign: "right" }}>{t("planColPointBas")}</th>
            </tr>
          </thead>
          <tbody>
            {plan.periodes.map((p) => {
              const fin = p.financement_entrees - p.financement_sorties;
              return (
                <tr key={p.indice}>
                  <td style={tdStyle}>
                    {p.debut === p.fin ? fmtDdMm(p.debut) : `${fmtDdMm(p.debut)} → ${fmtDdMm(p.fin)}`}
                    <span style={{ color: "var(--sub)", fontSize: 11.5 }}> · T+{p.jour_debut}{p.jour_fin !== p.jour_debut ? `…${p.jour_fin}` : ""}</span>
                  </td>
                  <td style={numStyle}>{p.encaissements ? fmtXof(p.encaissements, locale) : "—"}</td>
                  <td style={numStyle}>{p.decaissements ? fmtXof(p.decaissements, locale) : "—"}</td>
                  {avec && <td style={numStyle}>{fin ? fmtXof(fin, locale) : "—"}</td>}
                  <td style={{ ...numStyle, color: p.cloture_sans < -0.5 ? "var(--brique)" : "inherit", fontWeight: 600 }}>{fmtXof(p.cloture_sans, locale)}</td>
                  {avec && <td style={{ ...numStyle, color: p.cloture_avec < -0.5 ? "var(--brique)" : "inherit", fontWeight: 600 }}>{fmtXof(p.cloture_avec, locale)}</td>}
                  <td style={{ ...numStyle, color: p.min_sans < -0.5 ? "var(--brique)" : "inherit" }}>{fmtXof(p.min_sans, locale)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <h3 style={h3Style}>{t("planDetail")}</h3>
      <div className="card" style={{ overflowX: "auto", padding: 0 }}>
        <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 700 }}>
          <thead>
            <tr>
              <th style={thStyle}>{t("planColDate")}</th>
              <th style={thStyle}>{t("planColJour")}</th>
              <th style={thStyle}>{t("planColLibelle")}</th>
              <th style={thStyle}>{t("planColCategorie")}</th>
              <th style={{ ...thStyle, textAlign: "right" }}>{t("planColEntree")}</th>
              <th style={{ ...thStyle, textAlign: "right" }}>{t("planColSortie")}</th>
            </tr>
          </thead>
          <tbody>
            {plan.flux.map((f) => (
              <tr key={f.id}>
                <td style={tdStyle}>{fmtDate(f.date)}</td>
                <td style={tdStyle}>T+{f.jour}</td>
                <td style={tdStyle}>{f.libelle}</td>
                <td style={tdStyle}>{t(`planCat_${f.categorie}`)}</td>
                <td style={numStyle}>{f.sens === "ENTREE" ? fmtXof(f.montant, locale) : ""}</td>
                <td style={numStyle}>{f.sens === "SORTIE" ? fmtXof(f.montant, locale) : ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

const aideStyle = { fontSize: 11.5, color: "var(--sub)", marginTop: 4, lineHeight: 1.45 };
const radioStyle = { display: "flex", alignItems: "center", gap: 8, fontSize: 12.8, cursor: "pointer" };
const sousTitre = { fontSize: 13, color: "var(--petrol)", marginTop: 18, marginBottom: 2 };
const h3Style = { fontSize: 14, color: "var(--petrol)", margin: "18px 0 8px" };
