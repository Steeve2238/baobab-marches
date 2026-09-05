"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { api } from "../../../lib/api";
import { useLangue } from "../../../lib/i18n/LanguageContext";
import AppShell from "../../../lib/components/AppShell";

const NOMS_JOURS = {
  fr: ["Lundi", "Mardi", "Mercredi", "Jeudi", "Vendredi", "Samedi", "Dimanche"],
  en: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"],
};

const TYPES_TEMPS_AUTRE = [
  "ADMINISTRATION",
  "FORMATION",
  "CONGE_ABSENCE",
  "REUNION_INTERNE",
  "PROSPECTION_COMMERCIALE",
  "RECRUTEMENT",
  "MAINTENANCE_SIEGE",
  "DEPLACEMENT_HORS_DOSSIER",
  "VEILLE_MARCHES",
  "SUPPORT_INFORMATIQUE",
  "AUTRE",
];

function lundiDeCetteSemaine() {
  const maintenant = new Date();
  const jourSemaine = maintenant.getDay(); // 0 = dimanche ... 6 = samedi
  const decalage = jourSemaine === 0 ? -6 : 1 - jourSemaine;
  const lundi = new Date(maintenant);
  lundi.setDate(maintenant.getDate() + decalage);
  return lundi.toISOString().slice(0, 10);
}

function ajouterJoursLocal(dateStr, n) {
  const d = new Date(`${dateStr}T00:00:00`);
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}

function joursDeLaSemaine(semaineDebut) {
  return Array.from({ length: 7 }, (_, i) => ajouterJoursLocal(semaineDebut, i));
}

function ligneVide(jour) {
  return { jour, domaine_type: "DOSSIER", dossier_ao_id: "", categorie_autre: "", precision_autre: "", tache: "", temps: "" };
}

function chipClasseStatutFiche(statut) {
  if (statut === "VALIDEE") return "chip ok";
  if (statut === "REJETEE") return "chip risk";
  if (statut === "SOUMISE") return "chip warn";
  return "chip";
}

export default function FichesTempsPage() {
  const { t, langue, statutFicheTempsLabel, typeTempsAutreLabel } = useLangue();
  const [onglet, setOnglet] = useState("ma-semaine");

  const [semaineDebut, setSemaineDebut] = useState(lundiDeCetteSemaine());
  const [fiche, setFiche] = useState(null);
  const [lignes, setLignes] = useState([]);
  const [semainePrecedenteOk, setSemainePrecedenteOk] = useState(true);
  const [dossiers, setDossiers] = useState([]);
  const [resumeAnnee, setResumeAnnee] = useState({ total_heures: 0, nb_semaines_soumises: 0 });

  const [aValider, setAValider] = useState([]);
  const [detailAValiderId, setDetailAValiderId] = useState(null);
  const [detailAValiderLignes, setDetailAValiderLignes] = useState([]);
  const [rejetEnCoursId, setRejetEnCoursId] = useState(null);
  const [motifRejet, setMotifRejet] = useState("");

  const [pasDeFiche, setPasDeFiche] = useState(false);
  const [erreur, setErreur] = useState("");
  const [info, setInfo] = useState("");
  const [chargement, setChargement] = useState(true);
  const [enCours, setEnCours] = useState(false);
  // Permissions recuperees uniquement pour savoir si CE compte peut se
  // creer lui-meme une fiche employe (module "rh" ou ADMIN) quand il n'en a
  // pas encore - voir pasDeFiche ci-dessous. Signale par Steeve le
  // 05/09/2026 : un compte ADMIN sans fiche employe se retrouvait bloque
  // devant un simple message ("contactez un administrateur") sans aucun
  // moyen d'agir, meme lorsque CE compte est justement l'administrateur.
  const [permissions, setPermissions] = useState(null);

  const jours = useMemo(() => joursDeLaSemaine(semaineDebut), [semaineDebut]);
  const nomsJours = NOMS_JOURS[langue] || NOMS_JOURS.fr;

  useEffect(() => {
    api.getDossiersDisponiblesFichesTemps().then(setDossiers).catch(() => {});
    api.getPermissions().then(setPermissions).catch(() => setPermissions(null));
  }, []);

  useEffect(() => {
    chargerSemaine();
    chargerResumeAnnee();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [semaineDebut]);

  useEffect(() => {
    if (onglet === "a-valider") chargerAValider();
  }, [onglet]);

  async function chargerSemaine() {
    setChargement(true);
    setErreur("");
    setInfo("");
    try {
      const r = await api.getFicheTempsSemaine(semaineDebut);
      setFiche(r.fiche);
      setLignes(r.lignes.length > 0 ? r.lignes : []);
      setSemainePrecedenteOk(r.semaine_precedente_ok);
      setPasDeFiche(false);
    } catch (err) {
      if (err.status === 404) {
        setPasDeFiche(true);
      } else {
        setErreur(err.message);
      }
    } finally {
      setChargement(false);
    }
  }

  async function chargerResumeAnnee() {
    try {
      const annee = parseInt(semaineDebut.slice(0, 4), 10);
      const liste = await api.getMesFichesTempsAnnee(annee);
      const totalHeures = liste.reduce((s, f) => s + Number(f.total_heures || 0), 0);
      const nbSoumises = liste.filter((f) => f.statut_validation !== "BROUILLON").length;
      setResumeAnnee({ total_heures: totalHeures, nb_semaines_soumises: nbSoumises });
    } catch {
      // silencieux : la carte resume n'est qu'une aide, pas critique
    }
  }

  async function chargerAValider() {
    setErreur("");
    try {
      const r = await api.getFichesTempsAValider();
      setAValider(r);
    } catch (err) {
      setErreur(err.message);
    }
  }

  function ajouterLigne() {
    setLignes((ls) => [...ls, ligneVide(jours[0])]);
  }

  function modifierLigne(index, champs) {
    setLignes((ls) => ls.map((l, i) => (i === index ? { ...l, ...champs } : l)));
  }

  function supprimerLigne(index) {
    setLignes((ls) => ls.filter((_, i) => i !== index));
  }

  async function handleEnregistrerLignes() {
    setEnCours(true);
    setErreur("");
    setInfo("");
    try {
      const lignesAEnvoyer = lignes.map((l) => ({
        jour: l.jour,
        domaine_type: l.domaine_type,
        dossier_ao_id: l.domaine_type === "DOSSIER" ? l.dossier_ao_id : null,
        categorie_autre: l.domaine_type === "AUTRE" ? l.categorie_autre : null,
        precision_autre: l.precision_autre || null,
        tache: l.tache || null,
        temps: Number(l.temps),
      }));
      const r = await api.enregistrerLignesFicheTemps(fiche.id, lignesAEnvoyer);
      setFiche(r);
      setLignes(r.lignes);
      setInfo(t("lignesEnregistrees"));
    } catch (err) {
      setErreur(err.message);
    } finally {
      setEnCours(false);
    }
  }

  async function handleSoumettre() {
    setEnCours(true);
    setErreur("");
    setInfo("");
    try {
      const r = await api.soumettreFicheTemps(fiche.id);
      setFiche(r);
      setLignes(r.lignes);
      setInfo(t("ficheTempsSoumise"));
      chargerResumeAnnee();
    } catch (err) {
      setErreur(err.message);
    } finally {
      setEnCours(false);
    }
  }

  async function handleExporter() {
    try {
      await api.exporterFicheTemps(fiche.id, semaineDebut);
    } catch (err) {
      setErreur(err.message);
    }
  }

  async function handleTelechargerModele() {
    try {
      await api.telechargerModeleFicheTemps();
    } catch (err) {
      setErreur(err.message);
    }
  }

  async function handleImporter(e) {
    const fichier = e.target.files?.[0];
    if (!fichier) return;
    setEnCours(true);
    setErreur("");
    setInfo("");
    try {
      const r = await api.importerFicheTemps(fiche.id, fichier);
      setFiche(r);
      setLignes(r.lignes);
      setInfo(`${r.nombre_lignes_importees} ${t("importReussi")}`);
    } catch (err) {
      setErreur(err.message);
    } finally {
      setEnCours(false);
      e.target.value = "";
    }
  }

  async function handleVoirDetail(id) {
    if (detailAValiderId === id) {
      setDetailAValiderId(null);
      return;
    }
    try {
      const r = await api.getFicheTemps(id);
      setDetailAValiderLignes(r.lignes);
      setDetailAValiderId(id);
    } catch (err) {
      setErreur(err.message);
    }
  }

  async function handleApprouver(id) {
    setErreur("");
    try {
      await api.validerFicheTemps(id, { decision: "APPROUVEE" });
      setInfo(t("ficheTempsDecidee"));
      await chargerAValider();
    } catch (err) {
      setErreur(err.message);
    }
  }

  async function handleConfirmerRejet(id) {
    setErreur("");
    try {
      await api.validerFicheTemps(id, { decision: "REJETEE", motif_rejet: motifRejet });
      setRejetEnCoursId(null);
      setMotifRejet("");
      await chargerAValider();
    } catch (err) {
      setErreur(err.message);
    }
  }

  const totalSemaine = lignes.reduce((s, l) => s + Number(l.temps || 0), 0);
  const estBrouillon = fiche?.statut_validation === "BROUILLON";

  return (
    <AppShell title={t("fichesTempsPageTitle")}>
      <p style={{ fontSize: 12.5, color: "var(--sub)", marginTop: -6, marginBottom: 16 }}>
        {t("fichesTempsPageSubtitle")}
      </p>

      {erreur && <p style={{ color: "var(--brique)", fontSize: 12.5, marginBottom: 14 }}>{erreur}</p>}
      {info && <p style={{ color: "var(--vert)", fontSize: 12.5, marginBottom: 14 }}>{info}</p>}

      <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
        <button onClick={() => setOnglet("ma-semaine")} style={ongletStyle(onglet === "ma-semaine")}>
          {t("tabMaSemaine")}
        </button>
        <button onClick={() => setOnglet("a-valider")} style={ongletStyle(onglet === "a-valider")}>
          {t("tabFichesAValider")} {aValider.length > 0 && <span className="chip warn">{aValider.length}</span>}
        </button>
      </div>

      {onglet === "ma-semaine" && (
        <>
          {pasDeFiche ? (
            <div>
              <p style={{ fontSize: 12.5, color: "var(--sub)" }}>{t("pasDeFicheEmployeMessage")}</p>
              {(permissions?.admin || (permissions?.modules || []).includes("rh")) && (
                <Link
                  href="/rh/personnel/nouveau"
                  style={{
                    display: "inline-block",
                    marginTop: 10,
                    background: "var(--petrol)",
                    color: "#fff",
                    borderRadius: 8,
                    padding: "8px 16px",
                    fontSize: 12.5,
                    fontWeight: 600,
                  }}
                >
                  {t("creerMaFicheEmployeButton")}
                </Link>
              )}
            </div>
          ) : (
            <>
              <div className="card" style={{ marginBottom: 14, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div style={{ fontSize: 11.5, color: "var(--sub)" }}>
                  {t("resumeAnneeSection")} — {t("totalHeuresAnneeLabel")} : <strong className="mono">{resumeAnnee.total_heures}</strong>
                  {" · "}
                  {t("nbSemainesSoumisesLabel")} : <strong className="mono">{resumeAnnee.nb_semaines_soumises}</strong>
                </div>
              </div>

              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
                <button onClick={() => setSemaineDebut(ajouterJoursLocal(semaineDebut, -7))} style={boutonMiniStyle}>
                  {t("semainePrecedenteButton")}
                </button>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ fontSize: 13, fontWeight: 700 }}>
                    {t("semaineDuLabel")} {semaineDebut}
                  </span>
                  {fiche && <span className={chipClasseStatutFiche(fiche.statut_validation)}>{statutFicheTempsLabel(fiche.statut_validation)}</span>}
                </div>
                <button onClick={() => setSemaineDebut(ajouterJoursLocal(semaineDebut, 7))} style={boutonMiniStyle}>
                  {t("semaineSuivanteButton")}
                </button>
              </div>

              {fiche?.statut_validation === "REJETEE" && fiche.motif_rejet && (
                <p style={{ fontSize: 12, color: "var(--brique)", marginBottom: 12 }}>
                  {t("motifRejetPrompt")} {fiche.motif_rejet}
                </p>
              )}

              {estBrouillon && !semainePrecedenteOk && (
                <p style={{ fontSize: 12, color: "var(--ocre)", marginBottom: 12 }}>{t("verrouChronologiqueMessage")}</p>
              )}

              {chargement ? (
                <p style={{ fontSize: 12.5, color: "var(--sub)" }}>{t("loading")}</p>
              ) : (
                <div className="card" style={{ overflowX: "auto", marginBottom: 14 }}>
                  {lignes.length === 0 ? (
                    <p style={{ fontSize: 12.5, color: "var(--sub)" }}>{t("aucuneLigneFicheTemps")}</p>
                  ) : (
                    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                      <thead>
                        <tr>
                          <th style={thStyle}>{t("jourLabel")}</th>
                          <th style={thStyle}>{t("domaineLabel")}</th>
                          <th style={thStyle}>{t("selectDossier")}</th>
                          <th style={thStyle}>{t("tacheLabel")}</th>
                          <th style={thStyle}>{t("tempsLabel")}</th>
                          {estBrouillon && <th style={thStyle}></th>}
                        </tr>
                      </thead>
                      <tbody>
                        {lignes.map((l, index) => (
                          <tr key={index}>
                            <td style={tdStyle}>
                              {estBrouillon ? (
                                <select value={l.jour} onChange={(e) => modifierLigne(index, { jour: e.target.value })} style={selectMiniStyle}>
                                  {jours.map((j, i) => (
                                    <option key={j} value={j}>
                                      {nomsJours[i]} ({j.slice(5)})
                                    </option>
                                  ))}
                                </select>
                              ) : (
                                `${nomsJours[jours.indexOf(l.jour)] ?? ""} (${l.jour.slice(5)})`
                              )}
                            </td>
                            <td style={tdStyle}>
                              {estBrouillon ? (
                                <select
                                  value={l.domaine_type}
                                  onChange={(e) => modifierLigne(index, { domaine_type: e.target.value, dossier_ao_id: "", categorie_autre: "" })}
                                  style={selectMiniStyle}
                                >
                                  <option value="DOSSIER">{t("domaineDossierOption")}</option>
                                  <option value="AUTRE">{t("domaineAutreOption")}</option>
                                </select>
                              ) : l.domaine_type === "DOSSIER" ? (
                                t("domaineDossierOption")
                              ) : (
                                t("domaineAutreOption")
                              )}
                            </td>
                            <td style={{ ...tdStyle, textAlign: "left", minWidth: 180 }}>
                              {l.domaine_type === "DOSSIER" ? (
                                estBrouillon ? (
                                  <select
                                    value={l.dossier_ao_id || ""}
                                    onChange={(e) => modifierLigne(index, { dossier_ao_id: e.target.value })}
                                    style={selectMiniStyle}
                                  >
                                    <option value="">{t("selectDossier")}</option>
                                    {dossiers.map((d) => (
                                      <option key={d.id} value={d.id}>
                                        {d.intitule}
                                      </option>
                                    ))}
                                  </select>
                                ) : (
                                  dossiers.find((d) => d.id === l.dossier_ao_id)?.intitule || l.dossier_ao_id
                                )
                              ) : estBrouillon ? (
                                <select
                                  value={l.categorie_autre || ""}
                                  onChange={(e) => modifierLigne(index, { categorie_autre: e.target.value })}
                                  style={selectMiniStyle}
                                >
                                  <option value="">{t("selectCategorieAutre")}</option>
                                  {TYPES_TEMPS_AUTRE.map((c) => (
                                    <option key={c} value={c}>
                                      {typeTempsAutreLabel(c)}
                                    </option>
                                  ))}
                                </select>
                              ) : (
                                typeTempsAutreLabel(l.categorie_autre)
                              )}
                            </td>
                            <td style={{ ...tdStyle, textAlign: "left" }}>
                              {estBrouillon ? (
                                <input
                                  value={l.tache || ""}
                                  onChange={(e) => modifierLigne(index, { tache: e.target.value })}
                                  style={inputMiniStyle}
                                />
                              ) : (
                                l.tache || "—"
                              )}
                            </td>
                            <td style={tdStyle} className="mono">
                              {estBrouillon ? (
                                <input
                                  type="number"
                                  min="0.5"
                                  step="0.5"
                                  value={l.temps}
                                  onChange={(e) => modifierLigne(index, { temps: e.target.value })}
                                  style={{ ...inputMiniStyle, width: 60, textAlign: "center" }}
                                />
                              ) : (
                                Number(l.temps)
                              )}
                            </td>
                            {estBrouillon && (
                              <td style={tdStyle}>
                                <button onClick={() => supprimerLigne(index)} style={boutonMiniStyle}>
                                  {t("supprimerLigneButton")}
                                </button>
                              </td>
                            )}
                          </tr>
                        ))}
                      </tbody>
                      <tfoot>
                        <tr>
                          <td colSpan={4} style={{ ...tdStyle, textAlign: "right", fontWeight: 700 }}>
                            {t("totalSemaineLabel")}
                          </td>
                          <td style={{ ...tdStyle, fontWeight: 700 }} className="mono">
                            {totalSemaine}
                          </td>
                          {estBrouillon && <td style={tdStyle}></td>}
                        </tr>
                      </tfoot>
                    </table>
                  )}

                  {estBrouillon && (
                    <button onClick={ajouterLigne} style={{ ...boutonMiniStyle, marginTop: 10 }}>
                      {t("ajouterLigneButton")}
                    </button>
                  )}
                </div>
              )}

              <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
                {estBrouillon && (
                  <>
                    <button onClick={handleEnregistrerLignes} disabled={enCours} style={boutonPrincipalStyle}>
                      {enCours ? t("savingLignes") : t("enregistrerLignesButton")}
                    </button>
                    <button onClick={handleSoumettre} disabled={enCours} style={boutonPrincipalStyle}>
                      {t("soumettreButton")}
                    </button>
                    <label style={{ ...boutonMiniStyle, cursor: "pointer" }}>
                      {t("importerExcelButton")}
                      <input type="file" accept=".xlsx" onChange={handleImporter} style={{ display: "none" }} />
                    </label>
                    <button onClick={handleTelechargerModele} style={boutonMiniStyle}>
                      {t("telechargerModeleButton")}
                    </button>
                  </>
                )}
                {lignes.length > 0 && (
                  <button onClick={handleExporter} style={boutonMiniStyle}>
                    {t("exporterExcelButton")}
                  </button>
                )}
              </div>
            </>
          )}
        </>
      )}

      {onglet === "a-valider" && (
        <>
          {aValider.length === 0 ? (
            <p style={{ fontSize: 12.5, color: "var(--sub)" }}>{t("noFichesTempsAValider")}</p>
          ) : (
            <div style={{ display: "grid", gap: 8 }}>
              {aValider.map((f) => (
                <div key={f.id} className="card" style={{ display: "grid", gap: 6 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                      <span style={{ fontWeight: 700, fontSize: 13.5 }}>
                        {t("semaineDuLabel")} {f.semaine_debut}
                      </span>
                      <span className={chipClasseStatutFiche(f.statut_validation)}>{statutFicheTempsLabel(f.statut_validation)}</span>
                    </div>
                    <span style={{ fontSize: 11.5, color: "var(--sub)" }}>
                      {t("demandeurLabel")} : {f.employe_prenom} {f.employe_nom}
                    </span>
                  </div>

                  <button onClick={() => handleVoirDetail(f.id)} style={{ ...boutonMiniStyle, justifySelf: "start" }}>
                    {detailAValiderId === f.id ? t("masquerDetailButton") : t("voirDetailButton")}
                  </button>

                  {detailAValiderId === f.id && (
                    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11.5 }}>
                      <thead>
                        <tr>
                          <th style={thStyle}>{t("jourLabel")}</th>
                          <th style={thStyle}>{t("domaineLabel")}</th>
                          <th style={thStyle}>{t("tacheLabel")}</th>
                          <th style={thStyle}>{t("tempsLabel")}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {detailAValiderLignes.map((l) => (
                          <tr key={l.id}>
                            <td style={tdStyle}>{l.jour}</td>
                            <td style={tdStyle}>
                              {l.domaine_type === "DOSSIER"
                                ? dossiers.find((d) => d.id === l.dossier_ao_id)?.intitule || t("domaineDossierOption")
                                : typeTempsAutreLabel(l.categorie_autre)}
                            </td>
                            <td style={tdStyle}>{l.tache || "—"}</td>
                            <td style={tdStyle} className="mono">{Number(l.temps)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}

                  <div style={{ display: "grid", gap: 6 }}>
                    <div style={{ display: "flex", gap: 6 }}>
                      <button onClick={() => handleApprouver(f.id)} style={boutonMiniStyle}>
                        {t("approuverButton")}
                      </button>
                      <button
                        onClick={() => { setRejetEnCoursId(rejetEnCoursId === f.id ? null : f.id); setMotifRejet(""); }}
                        style={boutonMiniStyle}
                      >
                        {t("rejeterButton")}
                      </button>
                    </div>
                    {rejetEnCoursId === f.id && (
                      <div style={{ display: "flex", gap: 6 }}>
                        <input
                          placeholder={t("motifRejetPrompt")}
                          value={motifRejet}
                          onChange={(e) => setMotifRejet(e.target.value)}
                          style={{ ...inputMiniStyle, flex: 1 }}
                        />
                        <button onClick={() => handleConfirmerRejet(f.id)} disabled={!motifRejet} style={boutonMiniStyle}>
                          {t("rejeterButton")}
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
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

const thStyle = { padding: "6px 8px", textAlign: "center", color: "var(--sub)", fontWeight: 600, borderBottom: "1px solid var(--line)" };
const tdStyle = { padding: "6px 8px", textAlign: "center", borderBottom: "1px solid var(--line)" };
const selectMiniStyle = { padding: "4px 6px", border: "1px solid var(--line)", borderRadius: 6, fontSize: 11.5, fontFamily: "inherit" };
const inputMiniStyle = { padding: "4px 6px", border: "1px solid var(--line)", borderRadius: 6, fontSize: 11.5, fontFamily: "inherit", width: "100%" };
const boutonPrincipalStyle = {
  background: "var(--petrol)",
  color: "#fff",
  border: "none",
  borderRadius: 8,
  padding: "8px 16px",
  fontSize: 12.5,
  fontWeight: 600,
  cursor: "pointer",
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
