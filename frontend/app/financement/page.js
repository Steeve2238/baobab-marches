"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { api } from "../../lib/api";
import { useLangue } from "../../lib/i18n/LanguageContext";
import AppShell from "../../lib/components/AppShell";
import FinancementSousNav from "../../lib/components/financement/FinancementSousNav";
import ComparatifBanques, { CommentaireBloc } from "../../lib/components/financement/ComparatifBanques";
import DossierSelect, { payloadDossier, lienDossier } from "../../lib/components/financement/DossierSelect";
import {
  TYPES_ORDRE,
  useCatalogue,
  fmtXof,
  jour,
  aujourdhui,
  joursEntre,
  Pastille,
  Aide,
  labelStyle,
  inputStyle,
  boutonPrincipalStyle,
  boutonSecondaireStyle,
  thStyle,
  tdStyle,
  numStyle,
} from "../../lib/financementUi";

// Simulateur multi-banques (Financement v2). Le client saisit un besoin (facture
// ou montant libre) ; la plateforme calcule ce que chaque banque verserait, ce
// que cela coute, designe la plus avantageuse, et permet de choisir la banque
// pour un dossier. Le cout de la banque choisie alimente la marge du dossier.
// Back : routes/financement.js ; moteur : services/financementEngine.js.

function ajouterJours(dateStr, n) {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + Number(n));
  return d.toISOString().slice(0, 10);
}

export default function FinancementSimulateurPage() {
  const { t, dict } = useLangue();
  const locale = dict.dateLocale || "fr-FR";
  const catalogue = useCatalogue();
  const [conditions, setConditions] = useState(null);
  const [factures, setFactures] = useState([]);
  const [historique, setHistorique] = useState([]);
  const [dossier, setDossier] = useState("");
  const [source, setSource] = useState("LIBRE");
  const [form, setForm] = useState({
    type_facilite: "AFFACTURAGE",
    facture_vente_id: "",
    montant: "",
    montant_ht: "",
    date_prise: aujourdhui(),
    date_echeance: "",
    duree_jours: "90",
    debiteur: "",
    libelle: "",
  });
  const [calcul, setCalcul] = useState(null);
  const [calculEnCours, setCalculEnCours] = useState(false);
  const [simulationId, setSimulationId] = useState(null);
  const [choisiId, setChoisiId] = useState(null);
  const [choixEnCours, setChoixEnCours] = useState(false);
  const [message, setMessage] = useState("");
  const [erreur, setErreur] = useState("");

  const maj = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  async function chargerHistorique() {
    api.finSimulations().then(setHistorique).catch(() => {});
  }

  useEffect(() => {
    api.finConditions().then(setConditions).catch(() => setConditions([]));
    api.getFacturesVente("IMPAYEE").then(setFactures).catch(() => {});
    chargerHistorique();
    const q = new URLSearchParams(window.location.search);
    if (q.get("dossier_ao_id")) setDossier(`AO:${q.get("dossier_ao_id")}`);
    else if (q.get("consultation_id")) setDossier(`CONSULTATION:${q.get("consultation_id")}`);
    const type = q.get("type");
    if (type && TYPES_ORDRE.includes(type)) setForm((f) => ({ ...f, type_facilite: type }));
  }, []);

  const typesAvecConditions = useMemo(() => new Set((conditions || []).filter((c) => c.statut !== "ARCHIVEE").map((c) => c.type_facilite)), [conditions]);
  const modele = catalogue ? catalogue.find((c) => c.code === form.type_facilite) : null;
  const famille = modele ? modele.famille : "CREANCE";
  const nbBanquesType = (conditions || []).filter((c) => c.type_facilite === form.type_facilite && c.statut !== "ARCHIVEE").length;

  function changerPrise(v) {
    setForm((f) => ({ ...f, date_prise: v, date_echeance: f.duree_jours && v ? ajouterJours(v, f.duree_jours) : f.date_echeance }));
  }
  function changerEcheance(v) {
    setForm((f) => {
      const d = joursEntre(f.date_prise, v);
      return { ...f, date_echeance: v, duree_jours: d && d > 0 ? String(d) : f.duree_jours };
    });
  }
  function changerDuree(v) {
    setForm((f) => ({ ...f, duree_jours: v, date_echeance: v && Number(v) > 0 && f.date_prise ? ajouterJours(f.date_prise, v) : "" }));
  }
  function choisirFacture(id) {
    const fv = factures.find((x) => x.id === id);
    if (!fv) {
      setForm((f) => ({ ...f, facture_vente_id: "" }));
      return;
    }
    const echeance = jour(fv.date_echeance);
    setForm((f) => {
      const duree = echeance ? joursEntre(f.date_prise, echeance) : null;
      return {
        ...f,
        facture_vente_id: id,
        montant: String(Number(fv.montant_net_a_payer) || Number(fv.total_ttc) || ""),
        montant_ht: String(Number(fv.total_ht) || ""),
        date_echeance: echeance || f.date_echeance,
        duree_jours: duree && duree > 0 ? String(duree) : f.duree_jours,
        debiteur: fv.client_nom || f.debiteur,
        libelle: f.libelle || `${t("finSimFacture")} ${fv.numero}`,
      };
    });
  }

  function payload() {
    const p = {
      type_facilite: form.type_facilite,
      montant: Number(form.montant),
      montant_ht: form.montant_ht ? Number(form.montant_ht) : null,
      debiteur: form.debiteur || null,
      libelle: form.libelle || null,
      facture_vente_id: source === "FACTURE" && form.facture_vente_id ? form.facture_vente_id : null,
      ...payloadDossier(dossier),
    };
    if (form.date_prise && form.date_echeance) {
      p.date_prise = form.date_prise;
      p.date_echeance = form.date_echeance;
    }
    p.duree_jours = form.duree_jours ? Number(form.duree_jours) : null;
    return p;
  }

  async function lancer(e) {
    e.preventDefault();
    setErreur("");
    setMessage("");
    setCalcul(null);
    setSimulationId(null);
    setChoisiId(null);
    setCalculEnCours(true);
    try {
      setCalcul(await api.finCalculer(payload()));
    } catch (err) {
      setErreur(err.message);
    } finally {
      setCalculEnCours(false);
    }
  }

  async function enregistrer() {
    setErreur("");
    try {
      if (simulationId) return simulationId;
      const sim = await api.finEnregistrerSimulation(payload());
      setSimulationId(sim.id);
      setMessage(t("finSimEnregistree"));
      chargerHistorique();
      return sim.id;
    } catch (err) {
      setErreur(err.message);
      return null;
    }
  }

  async function choisir(releve) {
    setChoixEnCours(true);
    setErreur("");
    try {
      const id = await enregistrer();
      if (!id) return;
      await api.finRetenir(id, { condition_id: releve.condition_id, ...payloadDossier(dossier) });
      setChoisiId(releve.condition_id);
      setMessage(t("finSimChoixOk"));
      chargerHistorique();
    } catch (err) {
      setErreur(err.message);
    } finally {
      setChoixEnCours(false);
    }
  }

  const aucuneBanque = conditions !== null && conditions.length === 0;
  const aideMontant = famille === "CREANCE" ? t("finSimMontantAideCreance") : famille === "PRET" ? t("finSimMontantAidePret") : t("finSimMontantAideGarantie");
  const champ = { marginBottom: 0 };

  return (
    <AppShell title={t("finTitle")} subNav={<FinancementSousNav />}>
      <h2 style={{ fontSize: 16, color: "var(--petrol)", marginBottom: 4 }}>{t("finSimTitre")}</h2>
      <p style={{ fontSize: 12.5, color: "var(--sub)", marginBottom: 14, maxWidth: 760, lineHeight: 1.55 }}>{t("finSimIntro")}</p>

      {aucuneBanque && (
        <div className="card" style={{ marginBottom: 14, borderLeft: "4px solid var(--ocre)" }}>
          <h3 style={{ fontSize: 14, color: "var(--petrol)", marginBottom: 4 }}>{t("finSimAucuneBanqueTitre")}</h3>
          <p style={{ fontSize: 12.8, lineHeight: 1.55, marginBottom: 10 }}>{t("finSimAucuneBanqueTexte")}</p>
          <Link href="/financement/banques" style={{ ...boutonPrincipalStyle, display: "inline-block", textDecoration: "none" }}>
            {t("finSimAllerBanques")}
          </Link>
        </div>
      )}

      <form onSubmit={lancer} className="card" style={{ marginBottom: 16 }}>
        <h3 style={{ fontSize: 14, color: "var(--petrol)", marginBottom: 10 }}>{t("finSimFormTitre")}</h3>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(230px, 1fr))", gap: 14 }}>
          <div style={champ}>
            <label style={labelStyle}>{t("finSimType")}</label>
            <select value={form.type_facilite} onChange={(e) => maj("type_facilite", e.target.value)} style={inputStyle}>
              {TYPES_ORDRE.map((code) => (
                <option key={code} value={code}>
                  {t(`finType_${code}`)}
                  {conditions && !typesAvecConditions.has(code) ? " (—)" : ""}
                </option>
              ))}
            </select>
            <Aide>{t(`finFamille_${famille}`)}</Aide>
          </div>
          <div style={champ}>
            <label style={labelStyle}>{t("finSimSource")}</label>
            <select value={source} onChange={(e) => setSource(e.target.value)} style={inputStyle}>
              <option value="LIBRE">{t("finSimSourceLibre")}</option>
              <option value="FACTURE">{t("finSimSourceFacture")}</option>
            </select>
          </div>
          {source === "FACTURE" && (
            <div style={champ}>
              <label style={labelStyle}>{t("finSimFacture")}</label>
              <select value={form.facture_vente_id} onChange={(e) => choisirFacture(e.target.value)} style={inputStyle}>
                <option value="">{t("finSimChoisirFacture")}</option>
                {factures.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.numero} — {f.client_nom} — {fmtXof(f.montant_net_a_payer || f.total_ttc, locale)}
                  </option>
                ))}
              </select>
            </div>
          )}
          <div style={champ}>
            <label style={labelStyle}>{t("finSimMontant")}</label>
            <input type="number" min="1" step="any" value={form.montant} onChange={(e) => maj("montant", e.target.value)} style={inputStyle} required />
            <Aide>{aideMontant}</Aide>
          </div>
          {famille === "CREANCE" && (
            <div style={champ}>
              <label style={labelStyle}>
                {t("finSimMontantHt")} ({t("finOptional")})
              </label>
              <input type="number" min="0" step="any" value={form.montant_ht} onChange={(e) => maj("montant_ht", e.target.value)} style={inputStyle} />
              <Aide>{t("finSimMontantHtAide")}</Aide>
            </div>
          )}
          <div style={champ}>
            <label style={labelStyle}>{t("finSimDatePrise")}</label>
            <input type="date" value={form.date_prise} onChange={(e) => changerPrise(e.target.value)} style={inputStyle} />
            <Aide>{t("finSimDatePriseAide")}</Aide>
          </div>
          <div style={champ}>
            <label style={labelStyle}>{t("finSimDateEcheance")}</label>
            <input type="date" value={form.date_echeance} onChange={(e) => changerEcheance(e.target.value)} style={inputStyle} />
            <Aide>{t("finSimDateEcheanceAide")}</Aide>
          </div>
          <div style={champ}>
            <label style={labelStyle}>{t("finSimDuree")}</label>
            <input type="number" min="1" value={form.duree_jours} onChange={(e) => changerDuree(e.target.value)} style={inputStyle} required />
            <Aide>{t("finSimDureeAide")}</Aide>
          </div>
          {(famille === "CREANCE" || famille === "GARANTIE") && (
            <div style={champ}>
              <label style={labelStyle}>
                {t("finSimDebiteur")} ({t("finOptional")})
              </label>
              <input value={form.debiteur} onChange={(e) => maj("debiteur", e.target.value)} style={inputStyle} />
              <Aide>{t("finSimDebiteurAide")}</Aide>
            </div>
          )}
          <div style={champ}>
            <label style={labelStyle}>
              {t("finSimLibelle")} ({t("finOptional")})
            </label>
            <input value={form.libelle} onChange={(e) => maj("libelle", e.target.value)} style={inputStyle} />
            <Aide>{t("finSimLibelleAide")}</Aide>
          </div>
          <div style={champ}>
            <label style={labelStyle}>
              {t("finFicheAffecter")} ({t("finOptional")})
            </label>
            <DossierSelect valeur={dossier} onChange={setDossier} />
            <Aide>{t("finFicheAffecterAide")}</Aide>
          </div>
        </div>
        <div style={{ marginTop: 14, display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <button type="submit" disabled={calculEnCours} style={boutonPrincipalStyle}>
            {calculEnCours ? t("finSimEnCours") : t("finSimLancer")}
          </button>
          {erreur && <span style={{ color: "var(--brique)", fontSize: 12.5 }}>{erreur}</span>}
        </div>
      </form>

      {calcul && (
        <section style={{ marginBottom: 24 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8, marginBottom: 10 }}>
            <h3 style={{ fontSize: 15, color: "var(--petrol)" }}>{t("finSimResultat")}</h3>
            <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
              {message && <span style={{ color: "var(--vert)", fontSize: 12.5 }}>{message}</span>}
              {simulationId ? (
                <Link href={`/financement/simulations/${simulationId}`} style={{ ...boutonSecondaireStyle, textDecoration: "none" }}>
                  {t("finSimVoirFiche")}
                </Link>
              ) : (
                <button type="button" onClick={enregistrer} style={boutonSecondaireStyle}>
                  {t("finSimEnregistrer")}
                </button>
              )}
            </div>
          </div>
          <CommentaireBloc commentaire={calcul.commentaire} />
          <ComparatifBanques releves={calcul.releves} classement={calcul.classement} choisiId={choisiId} onChoisir={choisir} choixEnCours={choixEnCours} />
        </section>
      )}

      <section>
        <h3 style={{ fontSize: 14, color: "var(--petrol)", marginBottom: 8 }}>{t("finSimHistorique")}</h3>
        {historique.length === 0 ? (
          <p className="card" style={{ fontSize: 13, color: "var(--sub)" }}>{t("finSimHistoriqueVide")}</p>
        ) : (
          <div className="card" style={{ overflowX: "auto", padding: 0 }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr>
                  <th style={thStyle}>{t("finSimColDate")}</th>
                  <th style={thStyle}>{t("finSimColLibelle")}</th>
                  <th style={thStyle}>{t("finSimColType")}</th>
                  <th style={{ ...thStyle, textAlign: "right" }}>{t("finSimColMontant")}</th>
                  <th style={thStyle}>{t("finSimColDossier")}</th>
                  <th style={thStyle}>{t("finSimColBanque")}</th>
                  <th style={{ ...thStyle, textAlign: "right" }}>{t("finSimColCout")}</th>
                  <th style={thStyle}>{t("finSimColStatut")}</th>
                  <th style={thStyle}></th>
                </tr>
              </thead>
              <tbody>
                {historique.map((s) => (
                  <tr key={s.id}>
                    <td style={tdStyle}>{jour(s.date_creation)}</td>
                    <td style={tdStyle}>{s.libelle || s.facture_numero || "—"}</td>
                    <td style={tdStyle}>{t(`finType_${s.type_facilite}`)}</td>
                    <td style={{ ...tdStyle, ...numStyle }}>{fmtXof(s.montant, locale)}</td>
                    <td style={tdStyle}>
                      {lienDossier(s) ? (
                        <Link href={lienDossier(s)} style={{ color: "var(--petrol)", fontWeight: 600 }}>
                          {s.dossier_libelle || t("finOpen")}
                        </Link>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td style={tdStyle}>{s.partenaire_retenu_nom || "—"}</td>
                    <td style={{ ...tdStyle, ...numStyle }}>{s.cout_retenu_xof ? fmtXof(s.cout_retenu_xof, locale) : "—"}</td>
                    <td style={tdStyle}>
                      <Pastille couleur={s.statut === "SIMULEE" ? "var(--sub)" : "var(--vert)"}>{t(`finStatutSim_${s.statut}`)}</Pastille>
                    </td>
                    <td style={tdStyle}>
                      <Link href={`/financement/simulations/${s.id}`} style={{ color: "var(--petrol)", fontWeight: 600, fontSize: 12 }}>
                        {t("finOpen")}
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </AppShell>
  );
}
