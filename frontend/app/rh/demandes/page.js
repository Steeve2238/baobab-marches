"use client";

import { useEffect, useState } from "react";
import { api } from "../../../lib/api";
import { useLangue } from "../../../lib/i18n/LanguageContext";
import AppShell from "../../../lib/components/AppShell";

const TYPES = [
  "CONGE",
  "AVANCE",
  "ORDRE_MISSION",
  "HEURES_SUP",
  "DEMANDE_FONDS",
  "CARBURANT",
  "FOURNITURES",
  "PHOTOCOPIE",
  "EXPRESSION_BESOIN",
];

const TYPES_ABSENCE = ["CONGE_ANNUEL", "PERMISSION_FAMILIALE", "SANS_SOLDE", "AUTRE"];
const TYPES_IMPRESSION = ["AGRAFE", "RELIE", "RECTO_VERSO", "SIMPLE"];

const FORM_VIDE = {
  // CONGE
  date_debut: "",
  date_fin: "",
  nb_jours: "",
  type_absence: "",
  // AVANCE
  objet_mission: "",
  duree_mission: "",
  itineraire: "",
  lignes_budget: [],
  // ORDRE_MISSION
  destination: "",
  date_depart: "",
  date_retour_prevue: "",
  // HEURES_SUP
  date: "",
  nb_heures: "",
  // DEMANDE_FONDS
  activite: "",
  depense: "",
  montant: "",
  // CARBURANT
  vehicule_id: "",
  km_a_parcourir: "",
  quantite_necessaire: "",
  // FOURNITURES / EXPRESSION_BESOIN
  lignes_articles: [],
  // PHOTOCOPIE
  documents: [],
};

function detailsPourType(type_demande, form) {
  if (type_demande === "CONGE") {
    return {
      date_debut: form.date_debut,
      date_fin: form.date_fin,
      nb_jours: Number(form.nb_jours),
      type_absence: form.type_absence,
    };
  }
  if (type_demande === "AVANCE") {
    return {
      objet_mission: form.objet_mission,
      duree_mission: form.duree_mission,
      itineraire: form.itineraire,
      lignes_budget: form.lignes_budget.map((l) => ({ rubrique: l.rubrique, montant: Number(l.montant) })),
    };
  }
  if (type_demande === "ORDRE_MISSION") {
    return { destination: form.destination, date_depart: form.date_depart, date_retour_prevue: form.date_retour_prevue };
  }
  if (type_demande === "HEURES_SUP") {
    return { date: form.date, nb_heures: Number(form.nb_heures) };
  }
  if (type_demande === "DEMANDE_FONDS") {
    return { activite: form.activite, depense: form.depense, montant: Number(form.montant) };
  }
  if (type_demande === "CARBURANT") {
    return {
      vehicule_id: form.vehicule_id,
      activite: form.activite,
      km_a_parcourir: Number(form.km_a_parcourir),
      quantite_necessaire: Number(form.quantite_necessaire),
    };
  }
  if (type_demande === "FOURNITURES") {
    return {
      activite: form.activite,
      lignes_articles: form.lignes_articles.map((l) => ({ description: l.description, quantite: Number(l.quantite) })),
    };
  }
  if (type_demande === "PHOTOCOPIE") {
    return {
      documents: form.documents.map((d) => ({
        titre: d.titre,
        pages: Number(d.pages),
        ...(d.type_impression ? { type_impression: d.type_impression } : {}),
      })),
    };
  }
  if (type_demande === "EXPRESSION_BESOIN") {
    return {
      activite: form.activite,
      lignes_articles: form.lignes_articles.map((l) => ({ article: l.article, quantite: Number(l.quantite) })),
    };
  }
  return {};
}

function ResumeDetails({ demande, typeAbsenceLabel, typeImpressionLabel, vehicules }) {
  const d = demande.details || {};
  if (demande.type_demande === "CONGE") {
    return (
      <span>
        {typeAbsenceLabel(d.type_absence)} — {d.date_debut} → {d.date_fin} ({d.nb_jours} j)
      </span>
    );
  }
  if (demande.type_demande === "AVANCE") {
    const total = (d.lignes_budget || []).reduce((s, l) => s + (Number(l.montant) || 0), 0);
    return (
      <span>
        {d.objet_mission} — {d.itineraire} ({d.duree_mission}) — {total.toLocaleString("fr-FR")}
      </span>
    );
  }
  if (demande.type_demande === "ORDRE_MISSION") {
    return (
      <span>
        {d.destination} — {d.date_depart} → {d.date_retour_prevue}
      </span>
    );
  }
  if (demande.type_demande === "HEURES_SUP") {
    return <span>{d.date} — {d.nb_heures}h</span>;
  }
  if (demande.type_demande === "DEMANDE_FONDS") {
    return <span>{d.activite} — {d.depense} — {Number(d.montant || 0).toLocaleString("fr-FR")}</span>;
  }
  if (demande.type_demande === "CARBURANT") {
    const vehicule = (vehicules || []).find((v) => v.id === d.vehicule_id);
    return (
      <span>
        {d.activite} — {vehicule ? vehicule.immatriculation : d.vehicule_id} — {d.km_a_parcourir} km — {d.quantite_necessaire} L
      </span>
    );
  }
  if (demande.type_demande === "FOURNITURES") {
    return (
      <span>
        {d.activite} — {(d.lignes_articles || []).length} article(s)
      </span>
    );
  }
  if (demande.type_demande === "PHOTOCOPIE") {
    return <span>{(d.documents || []).length} document(s) à imprimer</span>;
  }
  if (demande.type_demande === "EXPRESSION_BESOIN") {
    return (
      <span>
        {d.activite} — {(d.lignes_articles || []).length} article(s)
      </span>
    );
  }
  return null;
}

function chipClasseStatut(statut) {
  if (statut === "APPROUVEE") return "chip ok";
  if (statut === "REJETEE" || statut === "ANNULEE") return "chip risk";
  if (statut === "SOUMISE") return "chip warn";
  return "chip";
}

// Barre de progression du circuit d'approbation (une seule etape pour les
// types sans chaine configuree, plusieurs pour les circuits multi-etapes
// comme Fournitures / Demande de fonds / Carburant - cf. modeles OGAA).
function ChaineApprobationProgress({ demande, t }) {
  const chaine = demande.chaine_approbation;
  if (!Array.isArray(chaine) || chaine.length === 0) return null;
  const decisionsParOrdre = Object.fromEntries((demande.decisions || []).map((dec) => [dec.ordre, dec]));

  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 2 }}>
      {chaine.map((etape) => {
        const decision = decisionsParOrdre[etape.ordre];
        const estCourante = demande.statut === "SOUMISE" && demande.etape_courante === etape.ordre;
        let style = etapeChipBaseStyle;
        let suffixe = "";
        if (decision) {
          if (decision.decision === "APPROUVEE") {
            style = { ...etapeChipBaseStyle, background: "var(--vert, #2e7d32)", color: "#fff", borderColor: "transparent" };
            suffixe = " ✓";
          } else {
            style = { ...etapeChipBaseStyle, background: "var(--brique)", color: "#fff", borderColor: "transparent" };
            suffixe = " ✗";
          }
        } else if (estCourante) {
          style = { ...etapeChipBaseStyle, background: "var(--ocre, #E0954C)", color: "#1a1a1a", borderColor: "transparent", fontWeight: 700 };
        }
        return (
          <span key={etape.ordre} style={style} title={etape.role_libelle || ""}>
            {etape.ordre}. {etape.libelle}
            {suffixe}
          </span>
        );
      })}
    </div>
  );
}

function HistoriqueDecisions({ demande, t }) {
  const decisions = demande.decisions || [];
  if (decisions.length === 0) return null;
  return (
    <div style={{ marginTop: 4, display: "grid", gap: 3 }}>
      <div style={{ fontSize: 10.5, fontWeight: 700, color: "var(--sub)", textTransform: "uppercase" }}>
        {t("historiqueDecisionsSection")}
      </div>
      {decisions.map((dec) => (
        <div key={dec.id} style={{ fontSize: 11, color: "var(--sub)" }}>
          {dec.libelle} —{" "}
          <span style={{ color: dec.decision === "APPROUVEE" ? "var(--vert, #2e7d32)" : "var(--brique)", fontWeight: 600 }}>
            {dec.decision === "APPROUVEE" ? t("decisionApprouveeLabel") : t("decisionRejeteeLabel")}
          </span>{" "}
          {t("parLabel")} {dec.decideur_prenom} {dec.decideur_nom}
          {dec.motif_rejet ? ` — ${dec.motif_rejet}` : ""}
        </div>
      ))}
    </div>
  );
}

function LigneEditor({ lignes, onChange, champs, t, ajouterLabel }) {
  function majLigne(i, champ, valeur) {
    const copie = lignes.map((l, idx) => (idx === i ? { ...l, [champ]: valeur } : l));
    onChange(copie);
  }
  function supprimerLigne(i) {
    onChange(lignes.filter((_, idx) => idx !== i));
  }
  function ajouterLigne() {
    const vide = Object.fromEntries(champs.map((c) => [c.nom, ""]));
    onChange([...lignes, vide]);
  }

  return (
    <div style={{ marginTop: 6 }}>
      {lignes.length === 0 && <p style={{ fontSize: 11.5, color: "var(--sub)", marginBottom: 6 }}>{t("aucuneLigneAjoutee")}</p>}
      {lignes.map((ligne, i) => (
        <div key={i} style={{ display: "flex", gap: 6, alignItems: "center", marginBottom: 6 }}>
          {champs.map((c) => (
            <input
              key={c.nom}
              type={c.type || "text"}
              min={c.type === "number" ? "0" : undefined}
              placeholder={c.placeholder}
              value={ligne[c.nom] ?? ""}
              onChange={(e) => majLigne(i, c.nom, e.target.value)}
              style={{ ...inputStyle, flex: c.type === "number" ? "0 0 100px" : 1 }}
            />
          ))}
          <button type="button" onClick={() => supprimerLigne(i)} style={boutonMiniStyle}>
            {t("supprimerLigneButton")}
          </button>
        </div>
      ))}
      <button type="button" onClick={ajouterLigne} style={boutonMiniStyle}>
        {ajouterLabel || t("ajouterLigneButton")}
      </button>
    </div>
  );
}

export default function DemandesRHPage() {
  const { t, typeDemandeRHLabel, statutDemandeRHLabel, typeAbsenceLabel, typeImpressionLabel } = useLangue();
  const [onglet, setOnglet] = useState("mes");
  const [mesDemandes, setMesDemandes] = useState([]);
  const [aValider, setAValider] = useState([]);
  const [vehicules, setVehicules] = useState([]);
  const [chargement, setChargement] = useState(true);
  const [erreur, setErreur] = useState("");
  const [pasDeFiche, setPasDeFiche] = useState(false);
  const [form, setForm] = useState({ type_demande: "", ...FORM_VIDE });
  const [enCours, setEnCours] = useState(false);
  const [rejetEnCoursId, setRejetEnCoursId] = useState(null);
  const [motifRejet, setMotifRejet] = useState("");

  useEffect(() => {
    chargerTout();
  }, []);

  async function chargerTout() {
    setErreur("");
    try {
      const mes = await api.getMesDemandesRH();
      setMesDemandes(mes);
      setPasDeFiche(false);
    } catch (err) {
      if (err.status === 404) {
        setPasDeFiche(true);
      } else {
        setErreur(err.message);
      }
    }
    try {
      const val = await api.getDemandesRHAValider();
      setAValider(val);
    } catch (err) {
      // silencieux : la plupart des utilisateurs n'ont rien a valider
    }
    try {
      const vs = await api.getVehicules();
      setVehicules(vs);
    } catch (err) {
      // silencieux : uniquement necessaire pour le formulaire CARBURANT
    }
    setChargement(false);
  }

  function changerType(nouveauType) {
    setForm({ ...FORM_VIDE, type_demande: nouveauType });
  }

  async function handleCreer(e) {
    e.preventDefault();
    setEnCours(true);
    setErreur("");
    try {
      await api.createDemandeRH({ type_demande: form.type_demande, details: detailsPourType(form.type_demande, form) });
      setForm({ type_demande: "", ...FORM_VIDE });
      await chargerTout();
    } catch (err) {
      setErreur(err.message);
    } finally {
      setEnCours(false);
    }
  }

  async function handleSoumettre(id) {
    setErreur("");
    try {
      await api.soumettreDemandeRH(id);
      await chargerTout();
    } catch (err) {
      setErreur(err.message);
    }
  }

  async function handleAnnuler(id) {
    setErreur("");
    try {
      await api.annulerDemandeRH(id);
      await chargerTout();
    } catch (err) {
      setErreur(err.message);
    }
  }

  async function handleApprouver(id) {
    setErreur("");
    try {
      await api.validerDemandeRH(id, { decision: "APPROUVEE" });
      await chargerTout();
    } catch (err) {
      setErreur(err.message);
    }
  }

  async function handleConfirmerRejet(id) {
    setErreur("");
    try {
      await api.validerDemandeRH(id, { decision: "REJETEE", motif_rejet: motifRejet });
      setRejetEnCoursId(null);
      setMotifRejet("");
      await chargerTout();
    } catch (err) {
      setErreur(err.message);
    }
  }

  const liste = onglet === "mes" ? mesDemandes : aValider;

  return (
    <AppShell title={t("demandesRHPageTitle")}>
      <p style={{ fontSize: 12.5, color: "var(--sub)", marginTop: -6, marginBottom: 16 }}>
        {t("demandesRHPageSubtitle")}
      </p>

      {erreur && <p style={{ color: "var(--brique)", fontSize: 12.5, marginBottom: 14 }}>{erreur}</p>}

      <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
        <button onClick={() => setOnglet("mes")} style={ongletStyle(onglet === "mes")}>
          {t("tabMesDemandes")}
        </button>
        <button onClick={() => setOnglet("avalider")} style={ongletStyle(onglet === "avalider")}>
          {t("tabAValider")} {aValider.length > 0 && <span className="chip warn">{aValider.length}</span>}
        </button>
      </div>

      {onglet === "mes" && (
        <>
          {pasDeFiche ? (
            <p style={{ fontSize: 12.5, color: "var(--sub)", marginBottom: 16 }}>{t("pasDeFicheEmployeMessage")}</p>
          ) : (
            <form onSubmit={handleCreer} className="card" style={{ marginBottom: 16, maxWidth: 560 }}>
              <label style={labelStyle}>{t("typeDemandeLabel")}</label>
              <select required value={form.type_demande} onChange={(e) => changerType(e.target.value)} style={inputStyle}>
                <option value="">{t("selectTypeDemande")}</option>
                {TYPES.map((ty) => (
                  <option key={ty} value={ty}>
                    {typeDemandeRHLabel(ty)}
                  </option>
                ))}
              </select>

              {form.type_demande === "CONGE" && (
                <>
                  <label style={{ ...labelStyle, marginTop: 10 }}>{t("typeAbsenceLabel")}</label>
                  <select
                    required
                    value={form.type_absence}
                    onChange={(e) => setForm((f) => ({ ...f, type_absence: e.target.value }))}
                    style={inputStyle}
                  >
                    <option value="">{t("selectTypeAbsence")}</option>
                    {TYPES_ABSENCE.map((ty) => (
                      <option key={ty} value={ty}>
                        {typeAbsenceLabel(ty)}
                      </option>
                    ))}
                  </select>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginTop: 10 }}>
                    <div>
                      <label style={labelStyle}>{t("dateDebutLabel")}</label>
                      <input type="date" required value={form.date_debut} onChange={(e) => setForm((f) => ({ ...f, date_debut: e.target.value }))} style={inputStyle} />
                    </div>
                    <div>
                      <label style={labelStyle}>{t("dateFinLabel")}</label>
                      <input type="date" required value={form.date_fin} onChange={(e) => setForm((f) => ({ ...f, date_fin: e.target.value }))} style={inputStyle} />
                    </div>
                  </div>
                  <label style={{ ...labelStyle, marginTop: 10 }}>{t("nbJoursLabel")}</label>
                  <input type="number" min="0.5" step="0.5" required value={form.nb_jours} onChange={(e) => setForm((f) => ({ ...f, nb_jours: e.target.value }))} style={inputStyle} />
                </>
              )}

              {form.type_demande === "AVANCE" && (
                <>
                  <label style={{ ...labelStyle, marginTop: 10 }}>{t("objetMissionLabel")}</label>
                  <input required value={form.objet_mission} onChange={(e) => setForm((f) => ({ ...f, objet_mission: e.target.value }))} style={inputStyle} />
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginTop: 10 }}>
                    <div>
                      <label style={labelStyle}>{t("dureeMissionLabel")}</label>
                      <input required value={form.duree_mission} onChange={(e) => setForm((f) => ({ ...f, duree_mission: e.target.value }))} style={inputStyle} />
                    </div>
                    <div>
                      <label style={labelStyle}>{t("itineraireLabel")}</label>
                      <input required value={form.itineraire} onChange={(e) => setForm((f) => ({ ...f, itineraire: e.target.value }))} style={inputStyle} />
                    </div>
                  </div>
                  <label style={{ ...labelStyle, marginTop: 10 }}>{t("lignesBudgetSection")}</label>
                  <LigneEditor
                    lignes={form.lignes_budget}
                    onChange={(lignes) => setForm((f) => ({ ...f, lignes_budget: lignes }))}
                    champs={[
                      { nom: "rubrique", placeholder: t("rubriqueLabel") },
                      { nom: "montant", type: "number", placeholder: t("montantLabel") },
                    ]}
                    t={t}
                  />
                </>
              )}

              {form.type_demande === "ORDRE_MISSION" && (
                <>
                  <label style={{ ...labelStyle, marginTop: 10 }}>{t("destinationLabel")}</label>
                  <input required value={form.destination} onChange={(e) => setForm((f) => ({ ...f, destination: e.target.value }))} style={inputStyle} />
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginTop: 10 }}>
                    <div>
                      <label style={labelStyle}>{t("dateDepartLabel")}</label>
                      <input type="date" required value={form.date_depart} onChange={(e) => setForm((f) => ({ ...f, date_depart: e.target.value }))} style={inputStyle} />
                    </div>
                    <div>
                      <label style={labelStyle}>{t("dateRetourPrevueLabel")}</label>
                      <input type="date" required value={form.date_retour_prevue} onChange={(e) => setForm((f) => ({ ...f, date_retour_prevue: e.target.value }))} style={inputStyle} />
                    </div>
                  </div>
                </>
              )}

              {form.type_demande === "HEURES_SUP" && (
                <>
                  <label style={{ ...labelStyle, marginTop: 10 }}>{t("dateDebutLabel")}</label>
                  <input type="date" required value={form.date} onChange={(e) => setForm((f) => ({ ...f, date: e.target.value }))} style={inputStyle} />
                  <label style={{ ...labelStyle, marginTop: 10 }}>{t("nbHeuresLabel")}</label>
                  <input type="number" min="0.5" step="0.5" required value={form.nb_heures} onChange={(e) => setForm((f) => ({ ...f, nb_heures: e.target.value }))} style={inputStyle} />
                </>
              )}

              {form.type_demande === "DEMANDE_FONDS" && (
                <>
                  <label style={{ ...labelStyle, marginTop: 10 }}>{t("activiteLabel")}</label>
                  <input required value={form.activite} onChange={(e) => setForm((f) => ({ ...f, activite: e.target.value }))} style={inputStyle} />
                  <label style={{ ...labelStyle, marginTop: 10 }}>{t("depenseLabel")}</label>
                  <input required value={form.depense} onChange={(e) => setForm((f) => ({ ...f, depense: e.target.value }))} style={inputStyle} />
                  <label style={{ ...labelStyle, marginTop: 10 }}>{t("montantLabel")}</label>
                  <input type="number" min="0" required value={form.montant} onChange={(e) => setForm((f) => ({ ...f, montant: e.target.value }))} style={inputStyle} />
                </>
              )}

              {form.type_demande === "CARBURANT" && (
                <>
                  <label style={{ ...labelStyle, marginTop: 10 }}>{t("vehiculeLabel")}</label>
                  <select required value={form.vehicule_id} onChange={(e) => setForm((f) => ({ ...f, vehicule_id: e.target.value }))} style={inputStyle}>
                    <option value="">{t("selectVehicule")}</option>
                    {vehicules.map((v) => (
                      <option key={v.id} value={v.id}>
                        {v.immatriculation} {v.marque_modele ? `— ${v.marque_modele}` : ""}
                      </option>
                    ))}
                  </select>
                  <label style={{ ...labelStyle, marginTop: 10 }}>{t("activiteLabel")}</label>
                  <input required value={form.activite} onChange={(e) => setForm((f) => ({ ...f, activite: e.target.value }))} style={inputStyle} />
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginTop: 10 }}>
                    <div>
                      <label style={labelStyle}>{t("kmAParcourirLabel")}</label>
                      <input type="number" min="0" required value={form.km_a_parcourir} onChange={(e) => setForm((f) => ({ ...f, km_a_parcourir: e.target.value }))} style={inputStyle} />
                    </div>
                    <div>
                      <label style={labelStyle}>{t("quantiteNecessaireLabel")}</label>
                      <input type="number" min="0" required value={form.quantite_necessaire} onChange={(e) => setForm((f) => ({ ...f, quantite_necessaire: e.target.value }))} style={inputStyle} />
                    </div>
                  </div>
                </>
              )}

              {form.type_demande === "FOURNITURES" && (
                <>
                  <label style={{ ...labelStyle, marginTop: 10 }}>{t("activiteLabel")}</label>
                  <input required value={form.activite} onChange={(e) => setForm((f) => ({ ...f, activite: e.target.value }))} style={inputStyle} />
                  <label style={{ ...labelStyle, marginTop: 10 }}>{t("lignesArticlesFournituresSection")}</label>
                  <LigneEditor
                    lignes={form.lignes_articles}
                    onChange={(lignes) => setForm((f) => ({ ...f, lignes_articles: lignes }))}
                    champs={[
                      { nom: "description", placeholder: t("descriptionLabel") },
                      { nom: "quantite", type: "number", placeholder: t("quantiteLabel") },
                    ]}
                    t={t}
                  />
                </>
              )}

              {form.type_demande === "PHOTOCOPIE" && (
                <>
                  <label style={{ ...labelStyle, marginTop: 10 }}>{t("documentsSection")}</label>
                  <div style={{ marginTop: 6 }}>
                    {form.documents.length === 0 && (
                      <p style={{ fontSize: 11.5, color: "var(--sub)", marginBottom: 6 }}>{t("aucuneLigneAjoutee")}</p>
                    )}
                    {form.documents.map((doc, i) => (
                      <div key={i} style={{ display: "flex", gap: 6, alignItems: "center", marginBottom: 6 }}>
                        <input
                          placeholder={t("titreDocumentLabel")}
                          value={doc.titre}
                          onChange={(e) =>
                            setForm((f) => ({
                              ...f,
                              documents: f.documents.map((d, idx) => (idx === i ? { ...d, titre: e.target.value } : d)),
                            }))
                          }
                          style={{ ...inputStyle, flex: 1 }}
                        />
                        <input
                          type="number"
                          min="1"
                          placeholder={t("pagesLabel")}
                          value={doc.pages}
                          onChange={(e) =>
                            setForm((f) => ({
                              ...f,
                              documents: f.documents.map((d, idx) => (idx === i ? { ...d, pages: e.target.value } : d)),
                            }))
                          }
                          style={{ ...inputStyle, flex: "0 0 90px" }}
                        />
                        <select
                          value={doc.type_impression}
                          onChange={(e) =>
                            setForm((f) => ({
                              ...f,
                              documents: f.documents.map((d, idx) => (idx === i ? { ...d, type_impression: e.target.value } : d)),
                            }))
                          }
                          style={{ ...inputStyle, flex: "0 0 150px" }}
                        >
                          <option value="">{t("selectTypeImpression")}</option>
                          {TYPES_IMPRESSION.map((ty) => (
                            <option key={ty} value={ty}>
                              {typeImpressionLabel(ty)}
                            </option>
                          ))}
                        </select>
                        <button
                          type="button"
                          onClick={() => setForm((f) => ({ ...f, documents: f.documents.filter((_, idx) => idx !== i) }))}
                          style={boutonMiniStyle}
                        >
                          {t("supprimerLigneButton")}
                        </button>
                      </div>
                    ))}
                    <button
                      type="button"
                      onClick={() => setForm((f) => ({ ...f, documents: [...f.documents, { titre: "", pages: "", type_impression: "" }] }))}
                      style={boutonMiniStyle}
                    >
                      {t("ajouterLigneButton")}
                    </button>
                  </div>
                </>
              )}

              {form.type_demande === "EXPRESSION_BESOIN" && (
                <>
                  <label style={{ ...labelStyle, marginTop: 10 }}>{t("activiteLabel")}</label>
                  <input required value={form.activite} onChange={(e) => setForm((f) => ({ ...f, activite: e.target.value }))} style={inputStyle} />
                  <label style={{ ...labelStyle, marginTop: 10 }}>{t("lignesArticlesExpressionSection")}</label>
                  <LigneEditor
                    lignes={form.lignes_articles}
                    onChange={(lignes) => setForm((f) => ({ ...f, lignes_articles: lignes }))}
                    champs={[
                      { nom: "article", placeholder: t("articleLabel") },
                      { nom: "quantite", type: "number", placeholder: t("quantiteLabel") },
                    ]}
                    t={t}
                  />
                </>
              )}

              {form.type_demande && (
                <button type="submit" disabled={enCours} style={{ ...boutonPrincipalStyle, marginTop: 14 }}>
                  {enCours ? t("creatingDemande") : t("creerDemandeButton")}
                </button>
              )}
            </form>
          )}
        </>
      )}

      {chargement ? (
        <p style={{ fontSize: 12.5, color: "var(--sub)" }}>{t("loading")}</p>
      ) : liste.length === 0 ? (
        <p style={{ fontSize: 12.5, color: "var(--sub)" }}>
          {onglet === "mes" ? t("noMesDemandes") : t("noDemandesAValider")}
        </p>
      ) : (
        <div style={{ display: "grid", gap: 8 }}>
          {liste.map((d) => (
            <div key={d.id} className="card" style={{ display: "grid", gap: 6 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <span style={{ fontWeight: 700, fontSize: 13.5 }}>{typeDemandeRHLabel(d.type_demande)}</span>
                  <span className={chipClasseStatut(d.statut)}>{statutDemandeRHLabel(d.statut)}</span>
                </div>
                {onglet === "avalider" && (
                  <span style={{ fontSize: 11.5, color: "var(--sub)" }}>
                    {t("demandeurLabel")} : {d.employe_prenom} {d.employe_nom}
                  </span>
                )}
              </div>
              <div style={{ fontSize: 12.5, color: "var(--sub)" }}>
                <ResumeDetails demande={d} typeAbsenceLabel={typeAbsenceLabel} typeImpressionLabel={typeImpressionLabel} vehicules={vehicules} />
              </div>
              {d.statut === "REJETEE" && d.motif_rejet && (
                <div style={{ fontSize: 11.5, color: "var(--brique)" }}>{t("motifRejetPrompt")} {d.motif_rejet}</div>
              )}

              <ChaineApprobationProgress demande={d} t={t} />
              <HistoriqueDecisions demande={d} t={t} />

              {onglet === "mes" && d.statut === "BROUILLON" && (
                <div style={{ display: "flex", gap: 6 }}>
                  <button onClick={() => handleSoumettre(d.id)} style={boutonMiniStyle}>{t("soumettreButton")}</button>
                  <button onClick={() => handleAnnuler(d.id)} style={boutonMiniStyle}>{t("annulerButton")}</button>
                </div>
              )}
              {onglet === "mes" && d.statut === "SOUMISE" && (
                <div style={{ display: "flex", gap: 6 }}>
                  <button onClick={() => handleAnnuler(d.id)} style={boutonMiniStyle}>{t("annulerButton")}</button>
                </div>
              )}

              {onglet === "avalider" && d.statut === "SOUMISE" && (
                <div style={{ display: "grid", gap: 6 }}>
                  <div style={{ display: "flex", gap: 6 }}>
                    <button onClick={() => handleApprouver(d.id)} style={boutonMiniStyle}>{t("approuverButton")}</button>
                    <button
                      onClick={() => { setRejetEnCoursId(rejetEnCoursId === d.id ? null : d.id); setMotifRejet(""); }}
                      style={boutonMiniStyle}
                    >
                      {t("rejeterButton")}
                    </button>
                  </div>
                  {rejetEnCoursId === d.id && (
                    <div style={{ display: "flex", gap: 6 }}>
                      <input
                        placeholder={t("motifRejetPrompt")}
                        value={motifRejet}
                        onChange={(e) => setMotifRejet(e.target.value)}
                        style={{ ...inputStyle, flex: 1 }}
                      />
                      <button onClick={() => handleConfirmerRejet(d.id)} disabled={!motifRejet} style={boutonMiniStyle}>
                        {t("rejeterButton")}
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </AppShell>
  );
}

function ongletStyle(actif) {
  return {
    background: actif ? "var(--petrol)" : "transparent",
    color: actif ? "#fff" : "var(--petrol)",
    border: "1px solid var(--petrol)",
    borderRadius: 8,
    padding: "6px 14px",
    fontSize: 12.5,
    fontWeight: 600,
    cursor: "pointer",
    display: "flex",
    gap: 6,
    alignItems: "center",
  };
}

const labelStyle = { fontSize: 11.5, fontWeight: 600, display: "block", marginBottom: 5 };
const inputStyle = {
  width: "100%",
  padding: "8px 10px",
  border: "1px solid var(--line)",
  borderRadius: 8,
  fontSize: 13,
  fontFamily: "inherit",
};
const boutonPrincipalStyle = {
  background: "var(--petrol)",
  color: "#fff",
  border: "none",
  borderRadius: 8,
  padding: "8px 16px",
  fontSize: 12.5,
  fontWeight: 600,
};
const boutonMiniStyle = {
  background: "transparent",
  color: "var(--petrol)",
  border: "1px solid var(--petrol)",
  borderRadius: 6,
  padding: "4px 10px",
  fontSize: 11,
  fontWeight: 600,
  cursor: "pointer",
  whiteSpace: "nowrap",
};
const etapeChipBaseStyle = {
  display: "inline-block",
  fontSize: 10.5,
  fontWeight: 600,
  padding: "3px 8px",
  borderRadius: 999,
  border: "1px solid var(--line)",
  color: "var(--sub)",
  background: "transparent",
};
