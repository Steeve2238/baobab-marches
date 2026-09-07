"use client";

import { Fragment, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { api } from "../../../lib/api";
import { useLangue } from "../../../lib/i18n/LanguageContext";
import AppShell from "../../../lib/components/AppShell";
import { DEVISES } from "../../../lib/constants/devises";

function offreVierge() {
  return {
    fournisseur_id: "",
    transitaire_id: "",
    devise: "XOF",
    prix_unitaire_devise: "",
    cours_devise: "1",
    quantite: "1",
    fret_alloue_xof: "0",
    frais_transit_xof: "0",
    date_reception: "",
    marge_cible_pct: "",
    notes: "",
  };
}

// Atelier du "Dossier de calcul" (prix de revient et marge) : un article =
// une ligne, plusieurs offres partenaires (fournisseur + transitaire)
// comparees par article - chaque offre est recalculee integralement a
// chaque lecture (voir services/calculPrixEngine.js cote backend, RIEN
// n'est stocke en base pour les colonnes calculees, seules les donnees de
// saisie le sont). Reproduit fidelement le tableau Excel de Steeve valide
// le 07/09/2026 ("le tableau me convient" - dossier CONSULTATION
// 26000/536/537 DN) : Identification/Achat/Douane/Cout de revient & marge/
// Prix de vente/Frais bancaires/Decision, plus une synthese par article
// (offre "retenue") qui alimentera plus tard le devis correspondant.
export default function CalculPrixDetailPage() {
  const { id } = useParams();
  const router = useRouter();
  const { t, dict } = useLangue();

  const [dossier, setDossier] = useState(null);
  const [fournisseurs, setFournisseurs] = useState([]);
  const [transitaires, setTransitaires] = useState([]);
  const [chargement, setChargement] = useState(true);
  const [erreur, setErreur] = useState("");

  const [formArticleOuvert, setFormArticleOuvert] = useState(false);
  const [libelleArticle, setLibelleArticle] = useState("");
  const [articleEnCours, setArticleEnCours] = useState(false);

  const [editingArticleId, setEditingArticleId] = useState(null);
  const [editArticleLibelle, setEditArticleLibelle] = useState("");

  // Formulaire offre : partage entre "ajout" (formOffreArticleId renseigne)
  // et "edition" (offreEnEdition renseignee) - un seul des deux actif a la
  // fois, ouvrir l'un ferme systematiquement l'autre.
  const [formOffre, setFormOffre] = useState(offreVierge());
  const [formOffreArticleId, setFormOffreArticleId] = useState(null);
  const [offreEnEdition, setOffreEnEdition] = useState(null);
  const [offreEnCours, setOffreEnCours] = useState(false);

  const [ajoutFournisseurOuvert, setAjoutFournisseurOuvert] = useState(false);
  const [nouveauFournisseur, setNouveauFournisseur] = useState({ nom: "", pays: "" });
  const [ajoutTransitaireOuvert, setAjoutTransitaireOuvert] = useState(false);
  const [nouveauTransitaire, setNouveauTransitaire] = useState({ nom: "" });
  const [partenaireEnCours, setPartenaireEnCours] = useState(false);

  const [detailsOuverts, setDetailsOuverts] = useState({});

  async function rechargerDossier() {
    const data = await api.getDossierCalcul(id);
    setDossier(data);
    return data;
  }

  useEffect(() => {
    async function charger() {
      try {
        const [dossierData, fournisseursData, transitairesData] = await Promise.all([
          api.getDossierCalcul(id),
          api.getFournisseursCalcul(),
          api.getTransitairesCalcul(),
        ]);
        setDossier(dossierData);
        setFournisseurs(fournisseursData);
        setTransitaires(transitairesData);
      } catch (err) {
        setErreur(err.message || t("defaultLoadError"));
      } finally {
        setChargement(false);
      }
    }
    if (id) charger();
  }, [id, t]);

  // ---------------- Articles ----------------

  async function handleAjouterArticle(e) {
    e.preventDefault();
    setArticleEnCours(true);
    try {
      await api.createArticleCalcul(id, { libelle: libelleArticle });
      await rechargerDossier();
      setFormArticleOuvert(false);
      setLibelleArticle("");
    } catch (err) {
      setErreur(err.message);
    } finally {
      setArticleEnCours(false);
    }
  }

  async function handleEnregistrerLibelleArticle(e, articleId) {
    e.preventDefault();
    try {
      await api.patchArticleCalcul(articleId, { libelle: editArticleLibelle });
      await rechargerDossier();
      setEditingArticleId(null);
    } catch (err) {
      setErreur(err.message);
    }
  }

  async function handleSupprimerArticle(articleId) {
    if (typeof window !== "undefined" && !window.confirm(t("calcPrixDeleteArticleConfirm"))) return;
    try {
      await api.supprimerArticleCalcul(articleId);
      await rechargerDossier();
    } catch (err) {
      setErreur(err.message);
    }
  }

  // ---------------- Offres ----------------

  function handleOuvrirAjoutOffre(articleId) {
    setFormOffre(offreVierge());
    setFormOffreArticleId(articleId);
    setOffreEnEdition(null);
    setAjoutFournisseurOuvert(false);
    setAjoutTransitaireOuvert(false);
  }

  function handleOuvrirEditionOffre(offre) {
    setFormOffre({
      fournisseur_id: offre.fournisseur_id,
      transitaire_id: offre.transitaire_id || "",
      devise: offre.devise,
      prix_unitaire_devise: String(offre.prix_unitaire_devise),
      cours_devise: String(offre.cours_devise),
      quantite: String(offre.quantite),
      fret_alloue_xof: String(offre.fret_alloue_xof),
      frais_transit_xof: String(offre.frais_transit_xof),
      date_reception: offre.date_reception ? offre.date_reception.slice(0, 10) : "",
      marge_cible_pct: offre.marge_cible_pct != null ? String(Number(offre.marge_cible_pct) * 100) : "",
      notes: offre.notes || "",
    });
    setOffreEnEdition(offre);
    setFormOffreArticleId(null);
    setAjoutFournisseurOuvert(false);
    setAjoutTransitaireOuvert(false);
  }

  function handleFermerFormOffre() {
    setFormOffreArticleId(null);
    setOffreEnEdition(null);
  }

  async function handleSubmitOffre(e) {
    e.preventDefault();
    setOffreEnCours(true);
    try {
      const payload = {
        fournisseur_id: formOffre.fournisseur_id,
        transitaire_id: formOffre.transitaire_id || "",
        devise: formOffre.devise,
        prix_unitaire_devise: Number(formOffre.prix_unitaire_devise),
        cours_devise: formOffre.devise === "XOF" ? 1 : Number(formOffre.cours_devise) || 0,
        quantite: Number(formOffre.quantite),
        fret_alloue_xof: Number(formOffre.fret_alloue_xof) || 0,
        frais_transit_xof: Number(formOffre.frais_transit_xof) || 0,
        date_reception: formOffre.date_reception || "",
        marge_cible_pct: formOffre.marge_cible_pct === "" ? "" : Number(formOffre.marge_cible_pct) / 100,
        notes: formOffre.notes || "",
      };
      if (offreEnEdition) {
        await api.patchOffreCalcul(offreEnEdition.id, payload);
      } else {
        await api.createOffreCalcul(formOffreArticleId, payload);
      }
      await rechargerDossier();
      handleFermerFormOffre();
    } catch (err) {
      setErreur(err.message);
    } finally {
      setOffreEnCours(false);
    }
  }

  async function handleSupprimerOffre(offreId) {
    if (typeof window !== "undefined" && !window.confirm(t("calcPrixDeleteOfferConfirm"))) return;
    try {
      await api.supprimerOffreCalcul(offreId);
      await rechargerDossier();
    } catch (err) {
      setErreur(err.message);
    }
  }

  async function handleBasculerRetenue(offre) {
    try {
      await api.patchOffreCalcul(offre.id, { retenue: !offre.retenue });
      await rechargerDossier();
    } catch (err) {
      setErreur(err.message);
    }
  }

  function toggleDetails(offreId) {
    setDetailsOuverts((prev) => ({ ...prev, [offreId]: !prev[offreId] }));
  }

  // ---------------- Registre partenaires (ajout rapide) ----------------

  async function handleCreerFournisseur(e) {
    e.preventDefault();
    setPartenaireEnCours(true);
    try {
      const nouveau = await api.createFournisseurCalcul(nouveauFournisseur);
      setFournisseurs((prev) => [...prev, nouveau].sort((a, b) => a.nom.localeCompare(b.nom)));
      setFormOffre((f) => ({ ...f, fournisseur_id: nouveau.id }));
      setAjoutFournisseurOuvert(false);
      setNouveauFournisseur({ nom: "", pays: "" });
    } catch (err) {
      setErreur(err.message);
    } finally {
      setPartenaireEnCours(false);
    }
  }

  async function handleCreerTransitaire(e) {
    e.preventDefault();
    setPartenaireEnCours(true);
    try {
      const nouveau = await api.createTransitaireCalcul(nouveauTransitaire);
      setTransitaires((prev) => [...prev, nouveau].sort((a, b) => a.nom.localeCompare(b.nom)));
      setFormOffre((f) => ({ ...f, transitaire_id: nouveau.id }));
      setAjoutTransitaireOuvert(false);
      setNouveauTransitaire({ nom: "" });
    } catch (err) {
      setErreur(err.message);
    } finally {
      setPartenaireEnCours(false);
    }
  }

  // ---------------- Dossier ----------------

  async function handleSupprimerDossier() {
    if (typeof window !== "undefined" && !window.confirm(t("calcPrixDeleteDossierConfirm"))) return;
    try {
      await api.supprimerDossierCalcul(id);
      router.push("/calcul-prix");
    } catch (err) {
      setErreur(err.message);
    }
  }

  if (chargement) {
    return <div style={{ padding: 28 }}>{t("loading")}</div>;
  }

  if (erreur && !dossier) {
    return <div style={{ padding: 28, color: "var(--brique)" }}>{erreur}</div>;
  }

  const nombre = (n) => (n != null ? Number(n).toLocaleString(dict.dateLocale, { maximumFractionDigits: 2 }) : "—");
  const pourcentage = (n) => (n != null ? `${(Number(n) * 100).toLocaleString(dict.dateLocale, { maximumFractionDigits: 2 })}%` : "—");

  return (
    <AppShell backHref="/calcul-prix" backLabelKey="backToCalculPrix">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 20, gap: 16 }}>
        <div>
          <h1 style={{ fontSize: 19, color: "var(--petrol)" }}>{dossier.nom}</h1>
          <div className="mono" style={{ fontSize: 11.5, color: "var(--sub)", marginTop: 2 }}>
            {dossier.dossier_ao_id ? (
              <>
                {t("calcPrixRattachementAo")} · {dossier.dossier_ao_reference || dossier.dossier_ao_intitule}
              </>
            ) : (
              <>
                {t("calcPrixRattachementConsultation")} · {dossier.consultation_client_nom}
                {dossier.consultation_objet ? ` — ${dossier.consultation_objet}` : ""}
              </>
            )}
          </div>
        </div>
        <button onClick={handleSupprimerDossier} style={boutonDangerStyle}>
          {t("calcPrixDeleteDossierButton")}
        </button>
      </div>

      {erreur && <p style={{ color: "var(--brique)", fontSize: 12.5, marginBottom: 14 }}>{erreur}</p>}

      {/* ---------------- ARTICLES ---------------- */}
      <section style={{ marginBottom: 30 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
          <h2 style={{ fontSize: 15.5, color: "var(--petrol)" }}>{t("calcPrixArticlesSection")}</h2>
          <button onClick={() => setFormArticleOuvert((v) => !v)} style={boutonPrincipalStyle}>
            {formArticleOuvert ? t("cancel") : t("calcPrixAddArticleButton")}
          </button>
        </div>

        {formArticleOuvert && (
          <form onSubmit={handleAjouterArticle} className="card" style={{ marginBottom: 16, display: "flex", gap: 10, alignItems: "flex-end" }}>
            <div style={{ flex: 1 }}>
              <label style={labelStyle}>{t("calcPrixArticleLibelleLabel")}</label>
              <input required value={libelleArticle} onChange={(e) => setLibelleArticle(e.target.value)} style={inputStyle} />
            </div>
            <button type="submit" disabled={articleEnCours} style={boutonPrincipalStyle}>
              {t("save")}
            </button>
          </form>
        )}

        {dossier.articles.length === 0 ? (
          <p className="card" style={{ fontSize: 13, color: "var(--sub)" }}>
            {t("calcPrixNoArticles")}
          </p>
        ) : (
          <div style={{ display: "grid", gap: 20 }}>
            {dossier.articles.map((article) => (
              <div key={article.id} className="card">
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14, gap: 12 }}>
                  {editingArticleId === article.id ? (
                    <form
                      onSubmit={(e) => handleEnregistrerLibelleArticle(e, article.id)}
                      style={{ display: "flex", gap: 8, flex: 1 }}
                    >
                      <input
                        autoFocus
                        value={editArticleLibelle}
                        onChange={(e) => setEditArticleLibelle(e.target.value)}
                        style={{ ...inputStyle, flex: 1 }}
                      />
                      <button type="submit" style={boutonSecondaireStyle}>
                        {t("save")}
                      </button>
                      <button type="button" onClick={() => setEditingArticleId(null)} style={boutonSecondaireStyle}>
                        {t("cancel")}
                      </button>
                    </form>
                  ) : (
                    <h3
                      onClick={() => {
                        setEditingArticleId(article.id);
                        setEditArticleLibelle(article.libelle);
                      }}
                      style={{ fontSize: 14.5, color: "var(--ink)", cursor: "pointer", flex: 1 }}
                      title={t("calcPrixEditButton")}
                    >
                      {article.libelle}
                    </h3>
                  )}
                  <div style={{ display: "flex", gap: 8, flexShrink: 0 }}>
                    <button onClick={() => handleOuvrirAjoutOffre(article.id)} style={boutonSecondaireStyle}>
                      {t("calcPrixAddOfferButton")}
                    </button>
                    <button onClick={() => handleSupprimerArticle(article.id)} style={boutonDangerSecondaireStyle}>
                      {t("calcPrixDeleteArticleButton")}
                    </button>
                  </div>
                </div>

                {formOffreArticleId === article.id && (
                  <FormulaireOffre
                    t={t}
                    formOffre={formOffre}
                    setFormOffre={setFormOffre}
                    onSubmit={handleSubmitOffre}
                    onCancel={handleFermerFormOffre}
                    enCours={offreEnCours}
                    fournisseurs={fournisseurs}
                    transitaires={transitaires}
                    ajoutFournisseurOuvert={ajoutFournisseurOuvert}
                    setAjoutFournisseurOuvert={setAjoutFournisseurOuvert}
                    nouveauFournisseur={nouveauFournisseur}
                    setNouveauFournisseur={setNouveauFournisseur}
                    onCreerFournisseur={handleCreerFournisseur}
                    ajoutTransitaireOuvert={ajoutTransitaireOuvert}
                    setAjoutTransitaireOuvert={setAjoutTransitaireOuvert}
                    nouveauTransitaire={nouveauTransitaire}
                    setNouveauTransitaire={setNouveauTransitaire}
                    onCreerTransitaire={handleCreerTransitaire}
                    partenaireEnCours={partenaireEnCours}
                  />
                )}

                {article.offres.length === 0 ? (
                  <p style={{ fontSize: 12.5, color: "var(--sub)" }}>{t("calcPrixNoOffers")}</p>
                ) : (
                  <div style={{ overflowX: "auto" }}>
                    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12, minWidth: 900 }}>
                      <thead>
                        <tr>
                          <th style={thStyle}>{t("calcPrixColFournisseur")}</th>
                          <th style={thStyle}>{t("calcPrixColAchat")}</th>
                          <th style={thStyle}>{t("calcPrixColQuantite")}</th>
                          <th style={thStyle}>{t("calcPrixColCoutRevient")}</th>
                          <th style={thStyle}>{t("calcPrixColMargeCible")}</th>
                          <th style={thStyle}>{t("calcPrixColPrixVenteUnitaire")}</th>
                          <th style={thStyle}>{t("calcPrixColTotalTtc")}</th>
                          <th style={thStyle}>{t("calcPrixColMargeNette")}</th>
                          <th style={thStyle}>{t("calcPrixColMargeNettePct")}</th>
                          <th style={thStyle}>{t("calcPrixColRetenue")}</th>
                          <th style={thStyle}></th>
                        </tr>
                      </thead>
                      <tbody>
                        {article.offres.map((offre) => (
                          <Fragment key={offre.id}>
                            <tr
                              style={{
                                borderTop: "1px solid var(--line)",
                                background: offre.retenue ? "rgba(46,125,91,0.06)" : "transparent",
                              }}
                            >
                              <td style={{ ...tdStyle, textAlign: "left", fontWeight: 600 }}>
                                {offre.fournisseur_nom}
                                {offre.transitaire_nom && (
                                  <div style={{ fontSize: 10.5, color: "var(--sub)", fontWeight: 400 }}>{offre.transitaire_nom}</div>
                                )}
                              </td>
                              <td className="mono" style={tdStyle}>
                                {nombre(offre.prix_unitaire_devise)} {offre.devise}
                              </td>
                              <td className="mono" style={tdStyle}>
                                {nombre(offre.quantite)}
                              </td>
                              <td className="mono" style={tdStyle}>
                                {nombre(offre.calcul.coutDeRevientHt)}
                              </td>
                              <td className="mono" style={tdStyle}>
                                {pourcentage(offre.calcul.margeCiblePct)}
                              </td>
                              <td className="mono" style={tdStyle}>
                                {nombre(offre.calcul.prixUnitaireArrondi)}
                              </td>
                              <td className="mono" style={tdStyle}>
                                {nombre(offre.calcul.totalTtc)}
                              </td>
                              <td
                                className="mono"
                                style={{
                                  ...tdStyle,
                                  fontWeight: 700,
                                  color: offre.calcul.margeNetteReelle >= 0 ? "var(--vert)" : "var(--brique)",
                                }}
                              >
                                {nombre(offre.calcul.margeNetteReelle)}
                              </td>
                              <td
                                className="mono"
                                style={{
                                  ...tdStyle,
                                  fontWeight: 700,
                                  color: offre.calcul.margeNetteReellePct >= 0 ? "var(--vert)" : "var(--brique)",
                                }}
                              >
                                {pourcentage(offre.calcul.margeNetteReellePct)}
                              </td>
                              <td style={tdStyle}>
                                {offre.retenue ? (
                                  <span className="chip ok">{t("calcPrixRetenueBadge")}</span>
                                ) : (
                                  <button onClick={() => handleBasculerRetenue(offre)} style={boutonSecondaireStyle}>
                                    {t("calcPrixRetenirButton")}
                                  </button>
                                )}
                              </td>
                              <td style={{ ...tdStyle, whiteSpace: "nowrap" }}>
                                <button onClick={() => toggleDetails(offre.id)} style={{ ...boutonSecondaireStyle, marginRight: 6 }}>
                                  {detailsOuverts[offre.id] ? t("calcPrixHideDetailsButton") : t("calcPrixDetailsButton")}
                                </button>
                                <button onClick={() => handleOuvrirEditionOffre(offre)} style={{ ...boutonSecondaireStyle, marginRight: 6 }}>
                                  {t("calcPrixEditButton")}
                                </button>
                                <button onClick={() => handleSupprimerOffre(offre.id)} style={boutonDangerSecondaireStyle}>
                                  ×
                                </button>
                              </td>
                            </tr>
                            {offreEnEdition?.id === offre.id && (
                              <tr>
                                <td colSpan={11} style={{ padding: "12px 0" }}>
                                  <FormulaireOffre
                                    t={t}
                                    formOffre={formOffre}
                                    setFormOffre={setFormOffre}
                                    onSubmit={handleSubmitOffre}
                                    onCancel={handleFermerFormOffre}
                                    enCours={offreEnCours}
                                    fournisseurs={fournisseurs}
                                    transitaires={transitaires}
                                    ajoutFournisseurOuvert={ajoutFournisseurOuvert}
                                    setAjoutFournisseurOuvert={setAjoutFournisseurOuvert}
                                    nouveauFournisseur={nouveauFournisseur}
                                    setNouveauFournisseur={setNouveauFournisseur}
                                    onCreerFournisseur={handleCreerFournisseur}
                                    ajoutTransitaireOuvert={ajoutTransitaireOuvert}
                                    setAjoutTransitaireOuvert={setAjoutTransitaireOuvert}
                                    nouveauTransitaire={nouveauTransitaire}
                                    setNouveauTransitaire={setNouveauTransitaire}
                                    onCreerTransitaire={handleCreerTransitaire}
                                    partenaireEnCours={partenaireEnCours}
                                  />
                                </td>
                              </tr>
                            )}
                            {detailsOuverts[offre.id] && (
                              <tr>
                                <td colSpan={11} style={{ padding: "4px 10px 16px" }}>
                                  <DetailOffre t={t} nombre={nombre} pourcentage={pourcentage} calcul={offre.calcul} />
                                </td>
                              </tr>
                            )}
                          </Fragment>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </section>

      {/* ---------------- SYNTHESE PAR ARTICLE ---------------- */}
      {dossier.articles.length > 0 && (
        <section>
          <h2 style={{ fontSize: 15.5, color: "var(--petrol)", marginBottom: 12 }}>{t("calcPrixSyntheseSection")}</h2>
          <div className="card" style={{ overflowX: "auto", padding: 0 }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5, minWidth: 760 }}>
              <thead>
                <tr>
                  <th style={thStyle}>{t("calcPrixSyntheseColArticle")}</th>
                  <th style={thStyle}>{t("calcPrixSyntheseColFournisseur")}</th>
                  <th style={thStyle}>{t("calcPrixSyntheseColPrixUnitaire")}</th>
                  <th style={thStyle}>{t("calcPrixSyntheseColMontantHt")}</th>
                  <th style={thStyle}>{t("calcPrixSyntheseColTvaVente")}</th>
                  <th style={thStyle}>{t("calcPrixSyntheseColTotalTtc")}</th>
                  <th style={thStyle}>{t("calcPrixSyntheseColMarge")}</th>
                </tr>
              </thead>
              <tbody>
                {dossier.syntheseParArticle.map((ligne) => (
                  <tr key={ligne.calcul_article_id} style={{ borderTop: "1px solid var(--line)" }}>
                    <td style={{ ...tdStyle, textAlign: "left", fontWeight: 600 }}>{ligne.libelle}</td>
                    {ligne.offre_retenue ? (
                      <>
                        <td style={tdStyle}>{ligne.offre_retenue.fournisseur_nom}</td>
                        <td className="mono" style={tdStyle}>{nombre(ligne.offre_retenue.prixUnitaireArrondi)}</td>
                        <td className="mono" style={tdStyle}>{nombre(ligne.offre_retenue.montantTotalArrondiHt)}</td>
                        <td className="mono" style={tdStyle}>{nombre(ligne.offre_retenue.tvaVente)}</td>
                        <td className="mono" style={tdStyle}>{nombre(ligne.offre_retenue.totalTtc)}</td>
                        <td
                          className="mono"
                          style={{
                            ...tdStyle,
                            fontWeight: 700,
                            color: ligne.offre_retenue.margeNetteReelle >= 0 ? "var(--vert)" : "var(--brique)",
                          }}
                        >
                          {nombre(ligne.offre_retenue.margeNetteReelle)} ({pourcentage(ligne.offre_retenue.margeNetteReellePct)})
                        </td>
                      </>
                    ) : (
                      <td colSpan={6} style={{ ...tdStyle, color: "var(--sub)" }}>
                        {t("calcPrixSyntheseNoRetenue")}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </AppShell>
  );
}

// Formulaire d'ajout/edition d'une offre (registre offres partenaires) -
// partage entre les deux modes (voir formOffreArticleId/offreEnEdition dans
// le composant parent). Extrait en sous-composant car reutilise deux fois
// dans le JSX (ajout sous l'article, edition inline dans la ligne du
// tableau).
function FormulaireOffre({
  t,
  formOffre,
  setFormOffre,
  onSubmit,
  onCancel,
  enCours,
  fournisseurs,
  transitaires,
  ajoutFournisseurOuvert,
  setAjoutFournisseurOuvert,
  nouveauFournisseur,
  setNouveauFournisseur,
  onCreerFournisseur,
  ajoutTransitaireOuvert,
  setAjoutTransitaireOuvert,
  nouveauTransitaire,
  setNouveauTransitaire,
  onCreerTransitaire,
  partenaireEnCours,
}) {
  return (
    <form onSubmit={onSubmit} className="card" style={{ marginBottom: 16, background: "var(--line-soft)" }}>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
        <div>
          <label style={labelStyle}>{t("calcPrixOfferFournisseurLabel")}</label>
          <select
            required
            value={formOffre.fournisseur_id}
            onChange={(e) => setFormOffre((f) => ({ ...f, fournisseur_id: e.target.value }))}
            style={inputStyle}
          >
            <option value=""></option>
            {fournisseurs.map((f) => (
              <option key={f.id} value={f.id}>
                {f.nom}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={() => setAjoutFournisseurOuvert((v) => !v)}
            style={{ ...boutonLienStyle, marginTop: 4 }}
          >
            {t("calcPrixQuickAddFournisseur")}
          </button>
          {ajoutFournisseurOuvert && (
            <div style={{ display: "flex", gap: 6, marginTop: 6 }}>
              <input
                placeholder={t("calcPrixNewFournisseurNomLabel")}
                value={nouveauFournisseur.nom}
                onChange={(e) => setNouveauFournisseur((f) => ({ ...f, nom: e.target.value }))}
                style={{ ...inputStyle, fontSize: 11.5, padding: "5px 8px" }}
              />
              <input
                placeholder={t("calcPrixNewFournisseurPaysLabel")}
                value={nouveauFournisseur.pays}
                onChange={(e) => setNouveauFournisseur((f) => ({ ...f, pays: e.target.value }))}
                style={{ ...inputStyle, fontSize: 11.5, padding: "5px 8px", maxWidth: 100 }}
              />
              <button
                type="button"
                onClick={onCreerFournisseur}
                disabled={partenaireEnCours || !nouveauFournisseur.nom.trim()}
                style={boutonSecondaireStyle}
              >
                {t("save")}
              </button>
            </div>
          )}
        </div>

        <div>
          <label style={labelStyle}>{t("calcPrixOfferTransitaireLabel")}</label>
          <select
            value={formOffre.transitaire_id}
            onChange={(e) => setFormOffre((f) => ({ ...f, transitaire_id: e.target.value }))}
            style={inputStyle}
          >
            <option value="">{t("calcPrixOfferNoTransitaire")}</option>
            {transitaires.map((tr) => (
              <option key={tr.id} value={tr.id}>
                {tr.nom}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={() => setAjoutTransitaireOuvert((v) => !v)}
            style={{ ...boutonLienStyle, marginTop: 4 }}
          >
            {t("calcPrixQuickAddTransitaire")}
          </button>
          {ajoutTransitaireOuvert && (
            <div style={{ display: "flex", gap: 6, marginTop: 6 }}>
              <input
                placeholder={t("calcPrixNewTransitaireNomLabel")}
                value={nouveauTransitaire.nom}
                onChange={(e) => setNouveauTransitaire({ nom: e.target.value })}
                style={{ ...inputStyle, fontSize: 11.5, padding: "5px 8px" }}
              />
              <button
                type="button"
                onClick={onCreerTransitaire}
                disabled={partenaireEnCours || !nouveauTransitaire.nom.trim()}
                style={boutonSecondaireStyle}
              >
                {t("save")}
              </button>
            </div>
          )}
        </div>

        <div>
          <label style={labelStyle}>{t("calcPrixOfferDateReceptionLabel")}</label>
          <input
            type="date"
            value={formOffre.date_reception}
            onChange={(e) => setFormOffre((f) => ({ ...f, date_reception: e.target.value }))}
            style={inputStyle}
          />
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 12, marginTop: 12 }}>
        <div>
          <label style={labelStyle}>{t("calcPrixOfferDeviseLabel")}</label>
          <select
            value={formOffre.devise}
            onChange={(e) =>
              setFormOffre((f) => ({
                ...f,
                devise: e.target.value,
                cours_devise: e.target.value === "XOF" ? "1" : f.cours_devise,
              }))
            }
            style={inputStyle}
          >
            {DEVISES.map((d) => (
              <option key={d.code} value={d.code}>
                {d.libelle}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label style={labelStyle}>{t("calcPrixOfferPrixUnitaireDeviseLabel")}</label>
          <input
            required
            type="number"
            step="any"
            value={formOffre.prix_unitaire_devise}
            onChange={(e) => setFormOffre((f) => ({ ...f, prix_unitaire_devise: e.target.value }))}
            style={inputStyle}
          />
        </div>
        <div>
          <label style={labelStyle}>{t("calcPrixOfferCoursDeviseLabel")}</label>
          <input
            type="number"
            step="any"
            disabled={formOffre.devise === "XOF"}
            value={formOffre.devise === "XOF" ? "1" : formOffre.cours_devise}
            onChange={(e) => setFormOffre((f) => ({ ...f, cours_devise: e.target.value }))}
            style={{ ...inputStyle, ...(formOffre.devise === "XOF" ? { background: "var(--line)" } : {}) }}
          />
        </div>
        <div>
          <label style={labelStyle}>{t("calcPrixOfferQuantiteLabel")}</label>
          <input
            required
            type="number"
            step="any"
            value={formOffre.quantite}
            onChange={(e) => setFormOffre((f) => ({ ...f, quantite: e.target.value }))}
            style={inputStyle}
          />
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12, marginTop: 12 }}>
        <div>
          <label style={labelStyle}>{t("calcPrixOfferFretAlloueLabel")}</label>
          <input
            type="number"
            step="any"
            value={formOffre.fret_alloue_xof}
            onChange={(e) => setFormOffre((f) => ({ ...f, fret_alloue_xof: e.target.value }))}
            style={inputStyle}
          />
        </div>
        <div>
          <label style={labelStyle}>{t("calcPrixOfferFraisTransitLabel")}</label>
          <input
            type="number"
            step="any"
            value={formOffre.frais_transit_xof}
            onChange={(e) => setFormOffre((f) => ({ ...f, frais_transit_xof: e.target.value }))}
            style={inputStyle}
          />
        </div>
        <div>
          <label style={labelStyle}>{t("calcPrixOfferMargeCibleLabel")}</label>
          <input
            type="number"
            step="any"
            value={formOffre.marge_cible_pct}
            onChange={(e) => setFormOffre((f) => ({ ...f, marge_cible_pct: e.target.value }))}
            style={inputStyle}
          />
        </div>
      </div>

      <label style={{ ...labelStyle, marginTop: 12 }}>{t("calcPrixOfferNotesLabel")}</label>
      <textarea
        value={formOffre.notes}
        onChange={(e) => setFormOffre((f) => ({ ...f, notes: e.target.value }))}
        style={{ ...inputStyle, minHeight: 50 }}
      />

      <div style={{ display: "flex", gap: 10, marginTop: 14 }}>
        <button type="submit" disabled={enCours} style={boutonPrincipalStyle}>
          {t("save")}
        </button>
        <button type="button" onClick={onCancel} style={boutonSecondaireStyle}>
          {t("cancel")}
        </button>
      </div>
    </form>
  );
}

// Panneau de detail complet d'une offre (toutes les colonnes calculees,
// groupees dans le meme ordre que le tableau Excel de Steeve : Achat ->
// Douane -> Cout de revient & marge -> Prix de vente -> Frais bancaires ->
// Decision). Affiche a la demande (bouton "Details") pour ne pas alourdir
// le tableau de comparaison principal avec 25+ colonnes en permanence.
function DetailOffre({ t, nombre, pourcentage, calcul }) {
  const groupes = [
    {
      titre: t("calcPrixDetailAchatSection"),
      champs: [
        ["calcPrixPrixAchatUnitaireXofLabel", nombre(calcul.prixAchatUnitaireXof)],
        ["calcPrixPrixAchatTotalXofLabel", nombre(calcul.prixAchatTotalXof)],
      ],
    },
    {
      titre: t("calcPrixDetailDouaneSection"),
      champs: [
        ["calcPrixAssuranceLabel", nombre(calcul.assurance)],
        ["calcPrixValeurEnDouaneLabel", nombre(calcul.valeurEnDouane)],
        ["calcPrixDroitDouaneLabel", nombre(calcul.droitDouane)],
        ["calcPrixRedevanceStatistiqueLabel", nombre(calcul.redevanceStatistique)],
        ["calcPrixPcsLabel", nombre(calcul.pcs)],
        ["calcPrixPccCosecLabel", nombre(calcul.pccCosec)],
        ["calcPrixBaseTvaImportLabel", nombre(calcul.baseTvaImport)],
        ["calcPrixTvaImportLabel", nombre(calcul.tvaImport)],
        ["calcPrixTotalDroitsTaxesDouaneLabel", nombre(calcul.totalDroitsTaxesDouane)],
      ],
    },
    {
      titre: t("calcPrixDetailCoutMargeSection"),
      champs: [
        ["calcPrixCoutDeRevientHtLabel", nombre(calcul.coutDeRevientHt)],
        ["calcPrixMargeCiblePctLabel", pourcentage(calcul.margeCiblePct)],
        ["calcPrixMargeBruteLabel", nombre(calcul.margeBrute)],
        ["calcPrixPrixVenteTotalHtLabel", nombre(calcul.prixVenteTotalHt)],
      ],
    },
    {
      titre: t("calcPrixDetailVenteSection"),
      champs: [
        ["calcPrixPrixUnitaireHtLabel", nombre(calcul.prixUnitaireHt)],
        ["calcPrixPrixUnitaireArrondiLabel", nombre(calcul.prixUnitaireArrondi)],
        ["calcPrixMontantTotalArrondiHtLabel", nombre(calcul.montantTotalArrondiHt)],
        ["calcPrixTvaVenteLabel", nombre(calcul.tvaVente)],
        ["calcPrixTotalTtcLabel", nombre(calcul.totalTtc)],
      ],
    },
    {
      titre: t("calcPrixDetailBancaireSection"),
      champs: [
        ["calcPrixMontantATransfererFournisseurLabel", nombre(calcul.montantATransfererFournisseur)],
        ["calcPrixCommissionTthuLabel", nombre(calcul.commissionTthu)],
        ["calcPrixCommissionDbsLabel", nombre(calcul.commissionDbs)],
        ["calcPrixTafDbsLabel", nombre(calcul.tafDbs)],
        ["calcPrixSwiftLabel", nombre(calcul.swift)],
        ["calcPrixTafSwiftLabel", nombre(calcul.tafSwift)],
        ["calcPrixTimbreLabel", nombre(calcul.timbre)],
        ["calcPrixTotalFraisBancairesLabel", nombre(calcul.totalFraisBancaires)],
      ],
    },
    {
      titre: t("calcPrixDetailDecisionSection"),
      champs: [
        ["calcPrixMargeNetteReelleLabel", nombre(calcul.margeNetteReelle)],
        ["calcPrixMargeNetteReellePctLabel", pourcentage(calcul.margeNetteReellePct)],
      ],
    },
  ];

  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 16 }}>
      {groupes.map((groupe) => (
        <div key={groupe.titre}>
          <div style={{ fontSize: 10.5, fontWeight: 700, color: "var(--petrol)", textTransform: "uppercase", marginBottom: 6 }}>
            {groupe.titre}
          </div>
          <div style={{ display: "grid", gap: 3 }}>
            {groupe.champs.map(([cle, valeur]) => (
              <div key={cle} style={{ display: "flex", justifyContent: "space-between", fontSize: 11.5, gap: 8 }}>
                <span style={{ color: "var(--sub)" }}>{t(cle)}</span>
                <span className="mono">{valeur}</span>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
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
  textDecoration: "none",
  display: "inline-block",
};
const boutonSecondaireStyle = {
  background: "transparent",
  color: "var(--petrol)",
  border: "1px solid var(--line)",
  borderRadius: 8,
  padding: "6px 12px",
  fontSize: 12,
  fontWeight: 600,
  whiteSpace: "nowrap",
};
const boutonDangerStyle = {
  background: "transparent",
  color: "var(--brique)",
  border: "1px solid var(--brique)",
  borderRadius: 8,
  padding: "7px 14px",
  fontSize: 12,
  fontWeight: 600,
  whiteSpace: "nowrap",
};
const boutonDangerSecondaireStyle = {
  background: "transparent",
  color: "var(--brique)",
  border: "1px solid var(--line)",
  borderRadius: 8,
  padding: "6px 10px",
  fontSize: 12,
  fontWeight: 600,
  whiteSpace: "nowrap",
};
const boutonLienStyle = {
  background: "none",
  border: "none",
  color: "var(--petrol)",
  fontSize: 11,
  fontWeight: 600,
  padding: 0,
  textDecoration: "underline",
  cursor: "pointer",
};
const thStyle = {
  padding: "8px 10px",
  textAlign: "left",
  color: "var(--sub)",
  fontWeight: 600,
  fontSize: 10.5,
  borderBottom: "1px solid var(--line)",
  whiteSpace: "nowrap",
};
const tdStyle = { padding: "8px 10px", textAlign: "center", verticalAlign: "top" };
