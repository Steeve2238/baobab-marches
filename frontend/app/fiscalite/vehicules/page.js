"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "../../../lib/api";
import { useLangue } from "../../../lib/i18n/LanguageContext";
import AppShell from "../../../lib/components/AppShell";
import FiscaliteSousNav from "../../../lib/components/FiscaliteSousNav";
import FiscDossierBarre from "../../../lib/components/FiscDossierBarre";
import { inputStyle, labelStyle, thStyle, tdStyle, boutonPrincipalStyle, boutonSecondaireStyle, formaterXof, dateCourte, texteAlerte } from "../../../lib/fiscaliteUi";

const VIDE = { immatriculation: "", marque_modele: "", puissance_cv: "", categorie: "VP", mode_detention: "PROPRIETE", date_debut: "", date_fin: "", exoneration: "", note: "", parc_vehicule_id: null };
const AVERT_GRAVES = ["VEH_PUISSANCE_ABSENTE", "VEH_LOCATION_SANS_DATES"];

export default function FiscaliteVehiculesPage() {
  const { t } = useLangue();
  const locale = t("dateLocale");
  const mm = (v) => formaterXof(v, locale);
  const [annee, setAnnee] = useState(new Date().getFullYear());
  const [registre, setRegistre] = useState(null);
  const [data, setData] = useState(null);
  const [onglet, setOnglet] = useState("taxe");
  const [form, setForm] = useState(null);
  const [erreur, setErreur] = useState("");
  const [info, setInfo] = useState("");

  const charger = useCallback(async () => {
    setErreur("");
    try {
      const [reg, an] = await Promise.all([api.fiscaliteVehicules(), api.fiscaliteVehiculesAnnee(annee)]);
      setRegistre(reg);
      setData(an);
    } catch (e) {
      setErreur(e.message);
    }
  }, [annee]);
  useEffect(() => {
    charger();
  }, [charger]);

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
  const dossier = data?.dossier || null;
  const calcul = data?.calcul || null;
  const gele = !!dossier && (dossier.statut === "DEPOSEE" || dossier.statut === "PAYEE");
  const preparer = () => executer(() => api.fiscaliteVehiculesPreparer(annee), t("fiscInfoPreparee"));
  const changerStatut = (corps) => executer(() => api.fiscaliteVehiculesStatut(annee, corps), corps.action === "deposer" ? t("fiscInfoDeposee") : corps.action === "payer" ? t("fiscInfoPayee") : t("fiscInfoRouverte"));
  async function exporter(format) {
    setErreur("");
    try {
      await api.fiscaliteVehiculesExporter(annee, format);
    } catch (e) {
      setErreur(e.message);
    }
  }

  async function enregistrer(e) {
    e.preventDefault();
    const corps = { ...form, puissance_cv: form.puissance_cv === "" ? null : Number(form.puissance_cv), date_debut: form.date_debut || null, date_fin: form.date_fin || null, exoneration: form.exoneration || null };
    await executer(() => (form.id ? api.fiscaliteVehiculeModifier(form.id, corps) : api.fiscaliteVehiculeAjouter(corps)), t("fiscVehInfoEnregistre"));
    setForm(null);
  }
  const editer = (v) => setForm({ ...VIDE, ...v, puissance_cv: v.puissance_cv ?? "", date_debut: v.date_debut || "", date_fin: v.date_fin || "", exoneration: v.exoneration || "", marque_modele: v.marque_modele || "", note: v.note || "" });

  const champ = (libelle, enfant) => (
    <div>
      <label style={labelStyle}>{libelle}</label>
      {enfant}
    </div>
  );
  const ongletBtn = (cle, libelle) => (
    <button
      key={cle}
      onClick={() => setOnglet(cle)}
      style={{ padding: "7px 14px", borderRadius: "8px 8px 0 0", border: "1px solid var(--line)", borderBottom: onglet === cle ? "1px solid #fff" : "1px solid var(--line)", background: onglet === cle ? "#fff" : "var(--line-soft)", fontSize: 12.5, fontWeight: onglet === cle ? 700 : 500, color: "var(--petrol)", marginBottom: -1 }}
    >
      {libelle}
    </button>
  );
  const libelleVehicule = (v) => (v.motif ? t(`fiscVehMotif_${v.motif}`) : v.classe ? t(`fiscVehClasse_${v.classe}`) : "");

  return (
    <AppShell title={t("fiscVehTitre")} subNav={<FiscaliteSousNav />}>
      {erreur && <p style={{ color: "var(--brique)", fontSize: 12.5, marginBottom: 12 }}>{erreur}</p>}
      {info && <p style={{ color: "#2E7D5B", fontSize: 12.5, marginBottom: 12 }}>{info}</p>}
      <p style={{ fontSize: 12, color: "var(--sub)", marginBottom: 12, maxWidth: 840, lineHeight: 1.5 }}>{t("fiscVehAide")}</p>

      <div className="card" style={{ marginBottom: 14, display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
        <button style={boutonSecondaireStyle} onClick={() => setAnnee(annee - 1)}>‹ {annee - 1}</button>
        <strong style={{ fontSize: 14 }}>{annee}</strong>
        <button style={boutonSecondaireStyle} onClick={() => setAnnee(annee + 1)}>{annee + 1} ›</button>
        <span style={{ flex: 1 }} />
        <span style={{ fontSize: 12, color: "var(--sub)" }}>{t("fiscVehEcheance")} {dateCourte(`${annee + 1}-01-31`, locale)}</span>
      </div>

      {!calcul && !erreur && <p style={{ fontSize: 12.5, color: "var(--sub)" }}>{t("loading")}</p>}

      {calcul && registre && (
        <>
          {gele && data.live_differe_du_depot && <div className="card" style={{ marginBottom: 12, borderLeft: "3px solid var(--ocre)", fontSize: 12.5, lineHeight: 1.5 }}>{t("fiscLiveDiffere")}</div>}
          <FiscDossierBarre dossier={dossier} onPreparer={preparer} onStatut={changerStatut} onExporter={exporter} />

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 12, marginBottom: 14 }}>
            {calcul.trimestres.map((q) => (
              <div className="card" key={q.trimestre}>
                <div style={{ fontSize: 11, color: "var(--sub)", fontWeight: 700 }}>{t("fiscVehTrimestre")} {q.trimestre}</div>
                <div style={{ fontSize: 17, fontWeight: 700, marginTop: 4, fontVariantNumeric: "tabular-nums" }}>{mm(q.montant)}</div>
                <div style={{ fontSize: 11.5, color: "var(--sub)" }}>{dateCourte(q.debut, locale)} → {dateCourte(q.fin, locale)}</div>
              </div>
            ))}
            <div className="card" style={{ borderLeft: "3px solid var(--petrol)" }}>
              <div style={{ fontSize: 11, color: "var(--sub)", fontWeight: 700 }}>{t("fiscVehTotal")}</div>
              <div style={{ fontSize: 19, fontWeight: 700, marginTop: 4, fontVariantNumeric: "tabular-nums" }}>{mm(calcul.total)}</div>
              <div style={{ fontSize: 11.5, color: "var(--sub)" }}>XOF</div>
            </div>
          </div>

          {calcul.avertissements.length > 0 && (
            <div className="card" style={{ marginBottom: 14 }}>
              <h3 style={{ fontSize: 13, color: "var(--petrol)", marginBottom: 6 }}>{t("fiscAvertissements")} ({calcul.avertissements.length})</h3>
              <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12.3, lineHeight: 1.6 }}>
                {calcul.avertissements.map((a, i) => (
                  <li key={i} style={{ color: AVERT_GRAVES.includes(a.code) ? "var(--brique)" : "inherit" }}>{texteAlerte(t, "fiscAvVeh_", a, locale)}</li>
                ))}
              </ul>
            </div>
          )}

          <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
            {ongletBtn("taxe", t("fiscVehOngletTaxe"))}
            {ongletBtn("registre", `${t("fiscVehOngletRegistre")} (${registre.vehicules.length})`)}
          </div>
          <div className="card" style={{ borderTopLeftRadius: 0, overflowX: "auto" }}>
            {onglet === "taxe" && (
              <>
                <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 760 }}>
                  <thead>
                    <tr>
                      <th style={thStyle}>{t("fiscVehImmat")}</th>
                      <th style={thStyle}>{t("fiscVehModele")}</th>
                      <th style={{ ...thStyle, textAlign: "right" }}>{t("fiscVehCv")}</th>
                      <th style={thStyle}>{t("fiscVehCategorieTarifaire")}</th>
                      {[1, 2, 3, 4].map((n) => <th key={n} style={{ ...thStyle, textAlign: "right" }}>T{n}</th>)}
                      <th style={{ ...thStyle, textAlign: "right" }}>{t("fiscVehTaxe")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {calcul.vehicules.length === 0 && <tr><td style={{ ...tdStyle, color: "var(--sub)" }} colSpan={9}>{t("fiscVehAucun")}</td></tr>}
                    {calcul.vehicules.map((v) => (
                      <tr key={v.id}>
                        <td style={{ ...tdStyle, fontWeight: 700 }}>{v.immatriculation}</td>
                        <td style={tdStyle}>{v.marque_modele}</td>
                        <td style={{ ...tdStyle, textAlign: "right" }}>{v.puissance_cv ?? ""}</td>
                        <td style={{ ...tdStyle, fontSize: 12 }}>{libelleVehicule(v)}</td>
                        {[1, 2, 3, 4].map((n) => {
                          const q = (v.trimestres || []).find((x) => x.trimestre === n);
                          return <td key={n} style={{ ...tdStyle, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{q && q.montant ? mm(q.montant) : ""}</td>;
                        })}
                        <td style={{ ...tdStyle, textAlign: "right", fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>{v.taxe === null ? t("fiscVehParCategorie") : mm(v.taxe)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {calcul.locations.length > 0 && (
                  <>
                    <h3 style={{ fontSize: 13.5, color: "var(--petrol)", margin: "16px 0 6px" }}>{t("fiscVehLocations")}</h3>
                    <table style={{ width: "100%", maxWidth: 760, borderCollapse: "collapse" }}>
                      <thead>
                        <tr>
                          <th style={thStyle}>{t("fiscVehTrimestre")}</th>
                          <th style={thStyle}>{t("fiscVehCategorieTarifaire")}</th>
                          <th style={{ ...thStyle, textAlign: "right" }}>{t("fiscVehJours")}</th>
                          <th style={{ ...thStyle, textAlign: "right" }}>{t("fiscVehPeriodes")}</th>
                          <th style={{ ...thStyle, textAlign: "right" }}>{t("fiscMontant")}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {calcul.locations.map((l, i) => (
                          <tr key={i}>
                            <td style={tdStyle}>T{l.trimestre}</td>
                            <td style={tdStyle}>{t(`fiscVehClasse_${l.classe}`)}</td>
                            <td style={{ ...tdStyle, textAlign: "right" }}>{l.jours}</td>
                            <td style={{ ...tdStyle, textAlign: "right" }}>{l.periodes}</td>
                            <td style={{ ...tdStyle, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{mm(l.montant)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </>
                )}
                <p style={{ fontSize: 11.5, color: "var(--sub)", marginTop: 12, maxWidth: 820, lineHeight: 1.5 }}>
                  {t("fiscVehTarifs")} {registre.tarifs.map((x) => `${t(`fiscVehClasse_${x.classe}`)} : ${mm(x.annuel)}`).join(" · ")}
                </p>
              </>
            )}

            {onglet === "registre" && (
              <>
                {registre.suggestions_parc_auto.length > 0 && (
                  <div className="card" style={{ marginBottom: 12, background: "var(--line-soft)" }}>
                    <div style={{ fontSize: 12, fontWeight: 700, color: "var(--petrol)", marginBottom: 6 }}>{t("fiscVehParcAuto")}</div>
                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                      {registre.suggestions_parc_auto.map((p) => (
                        <button key={p.id} style={boutonSecondaireStyle} onClick={() => { setOnglet("registre"); setForm({ ...VIDE, parc_vehicule_id: p.id, immatriculation: p.immatriculation || "", marque_modele: p.marque_modele || "" }); }}>
                          {t("fiscVehReprendre")} {p.immatriculation}{p.marque_modele ? ` — ${p.marque_modele}` : ""}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
                <table style={{ width: "100%", borderCollapse: "collapse", marginBottom: 12, minWidth: 760 }}>
                  <thead>
                    <tr>
                      <th style={thStyle}>{t("fiscVehImmat")}</th>
                      <th style={thStyle}>{t("fiscVehModele")}</th>
                      <th style={{ ...thStyle, textAlign: "right" }}>{t("fiscVehCv")}</th>
                      <th style={thStyle}>{t("fiscVehCategorie")}</th>
                      <th style={thStyle}>{t("fiscVehDetention")}</th>
                      <th style={thStyle}>{t("fiscVehPeriode")}</th>
                      <th style={thStyle}></th>
                    </tr>
                  </thead>
                  <tbody>
                    {registre.vehicules.length === 0 && <tr><td style={{ ...tdStyle, color: "var(--sub)" }} colSpan={7}>{t("fiscVehAucun")}</td></tr>}
                    {registre.vehicules.map((v) => (
                      <tr key={v.id}>
                        <td style={{ ...tdStyle, fontWeight: 700 }}>{v.immatriculation}{v.parc_vehicule_id ? <span style={{ fontSize: 10.5, color: "var(--sub)" }}> · {t("fiscVehDuParc")}</span> : null}</td>
                        <td style={tdStyle}>{v.marque_modele}</td>
                        <td style={{ ...tdStyle, textAlign: "right" }}>{v.puissance_cv ?? ""}</td>
                        <td style={tdStyle}>{t(`fiscVehCat_${v.categorie}`)}{v.exoneration ? <div style={{ fontSize: 11, color: "var(--sub)" }}>{t(`fiscVehExo_${v.exoneration}`)}</div> : null}</td>
                        <td style={tdStyle}>{t(`fiscVehMode_${v.mode_detention}`)}</td>
                        <td style={{ ...tdStyle, fontSize: 12 }}>{v.date_debut || v.date_fin ? `${v.date_debut ? dateCourte(v.date_debut, locale) : "…"} → ${v.date_fin ? dateCourte(v.date_fin, locale) : "…"}` : "—"}</td>
                        <td style={{ ...tdStyle, textAlign: "right", whiteSpace: "nowrap" }}>
                          <button style={boutonSecondaireStyle} onClick={() => editer(v)}>{t("fiscModifier")}</button>{" "}
                          <button style={boutonSecondaireStyle} onClick={() => executer(() => api.fiscaliteVehiculeSupprimer(v.id))}>{t("fiscSupprimer")}</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {!form && <button style={boutonPrincipalStyle} onClick={() => setForm({ ...VIDE })}>{t("fiscVehAjouter")}</button>}
                {form && (
                  <form onSubmit={enregistrer} style={{ borderTop: "1px solid var(--line)", paddingTop: 12, display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end" }}>
                    {champ(t("fiscVehImmat"), <input value={form.immatriculation} onChange={(e) => setForm({ ...form, immatriculation: e.target.value })} style={{ ...inputStyle, width: 140 }} required />)}
                    {champ(t("fiscVehModele"), <input value={form.marque_modele} onChange={(e) => setForm({ ...form, marque_modele: e.target.value })} style={{ ...inputStyle, width: 190 }} />)}
                    {champ(t("fiscVehCv"), <input type="number" min="1" max="99" value={form.puissance_cv} onChange={(e) => setForm({ ...form, puissance_cv: e.target.value })} style={{ ...inputStyle, width: 80, textAlign: "right" }} />)}
                    {champ(t("fiscVehCategorie"), (
                      <select value={form.categorie} onChange={(e) => setForm({ ...form, categorie: e.target.value })} style={{ ...inputStyle, width: 230 }}>
                        <option value="VP">{t("fiscVehCat_VP")}</option>
                        <option value="AUTRE">{t("fiscVehCat_AUTRE")}</option>
                      </select>
                    ))}
                    {champ(t("fiscVehDetention"), (
                      <select value={form.mode_detention} onChange={(e) => setForm({ ...form, mode_detention: e.target.value })} style={{ ...inputStyle, width: 150 }}>
                        {registre.modes.map((m) => <option key={m} value={m}>{t(`fiscVehMode_${m}`)}</option>)}
                      </select>
                    ))}
                    {champ(t("fiscVehDebut"), <input type="date" value={form.date_debut} onChange={(e) => setForm({ ...form, date_debut: e.target.value })} style={{ ...inputStyle, width: 150 }} />)}
                    {champ(t("fiscVehFin"), <input type="date" value={form.date_fin} onChange={(e) => setForm({ ...form, date_fin: e.target.value })} style={{ ...inputStyle, width: 150 }} />)}
                    {champ(t("fiscVehExoneration"), (
                      <select value={form.exoneration} onChange={(e) => setForm({ ...form, exoneration: e.target.value })} style={{ ...inputStyle, width: 230 }}>
                        <option value="">{t("fiscVehAucuneExo")}</option>
                        {registre.exonerations.map((x) => <option key={x} value={x}>{t(`fiscVehExo_${x}`)}</option>)}
                      </select>
                    ))}
                    <button type="submit" style={boutonPrincipalStyle}>{t("fiscEnregistrer")}</button>
                    <button type="button" style={boutonSecondaireStyle} onClick={() => setForm(null)}>{t("fiscAnnuler")}</button>
                  </form>
                )}
              </>
            )}
          </div>
        </>
      )}
    </AppShell>
  );
}
