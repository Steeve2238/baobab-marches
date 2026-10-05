"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { api } from "../../lib/api";
import { useLangue } from "../../lib/i18n/LanguageContext";
import AppShell from "../../lib/components/AppShell";
import { prixVenteDepuisCout } from "../../lib/prixLigne";

// Catalogue "Produits" = base de calcul globale (demande de Steeve du
// 05/10/2026) : chaque produit porte son cout de revient unitaire et sa marge ;
// le devis les propose dans une liste deroulante (voir
// lib/components/LigneProduitOutils.js). Alimentation : import des offres
// "retenues" des dossiers de calcul (AO et consultations restreintes) ou saisie
// manuelle. Back : routes/produits.js. La marge est stockee en fraction
// (0.25) ; l'ecran travaille en pourcentage (25).

const FORM_VIDE = { reference: "", designation: "", unite: "U", categorie: "", cout: "", margePct: "", notes: "", actif: true };

function nombreSaisi(v) {
  const n = Number(String(v ?? "").replace(/[\s  ]/g, "").replace(",", "."));
  return Number.isFinite(n) ? n : NaN;
}

export default function ProduitsPage() {
  const { t, dict } = useLangue();
  const [produits, setProduits] = useState([]);
  const [chargement, setChargement] = useState(true);
  const [erreur, setErreur] = useState("");
  const [info, setInfo] = useState("");
  const [recherche, setRecherche] = useState("");
  const [voirInactifs, setVoirInactifs] = useState(false);

  const [formOuvert, setFormOuvert] = useState(false);
  const [editionId, setEditionId] = useState(null);
  const [form, setForm] = useState(FORM_VIDE);
  const [enregistrement, setEnregistrement] = useState(false);
  const [details, setDetails] = useState({ refs: [], mouvements: [] });
  const [ajust, setAjust] = useState({ quantite: "", motif: "" });

  const [importOuvert, setImportOuvert] = useState(false);
  const [candidats, setCandidats] = useState([]);
  const [selection, setSelection] = useState([]);
  const [importEnCours, setImportEnCours] = useState(false);

  const charger = useCallback(() => {
    const params = {};
    if (recherche.trim()) params.q = recherche.trim();
    if (voirInactifs) params.inclure_inactifs = "1";
    return api
      .getProduits(params)
      .then(setProduits)
      .catch((err) => setErreur(err.message || t("defaultLoadError")))
      .finally(() => setChargement(false));
  }, [recherche, voirInactifs, t]);

  useEffect(() => {
    const id = setTimeout(charger, 200);
    return () => clearTimeout(id);
  }, [charger]);

  function ouvrirCreation() {
    setEditionId(null);
    setForm(FORM_VIDE);
    setFormOuvert(true);
    setImportOuvert(false);
  }

  function ouvrirEdition(p) {
    setEditionId(p.id);
    setForm({
      reference: p.reference || "",
      designation: p.designation,
      unite: p.unite || "U",
      categorie: p.categorie || "",
      cout: String(Number(p.cout_revient_unitaire_xof)),
      margePct: String(Math.round(Number(p.marge_pct) * 10000) / 100),
      notes: p.notes || "",
      actif: p.actif,
    });
    setFormOuvert(true);
    setImportOuvert(false);
    setAjust({ quantite: "", motif: "" });
    setDetails({ refs: [], mouvements: [] });
    Promise.all([api.getReferencesFournisseursProduit(p.id), api.getMouvementsProduit(p.id)])
      .then(([refs, mouvements]) => setDetails({ refs, mouvements }))
      .catch(() => {});
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function ajusterStock(e) {
    e.preventDefault();
    setErreur("");
    setInfo("");
    const quantite = nombreSaisi(ajust.quantite);
    try {
      await api.ajusterStockProduit(editionId, { quantite, motif: ajust.motif });
      setInfo(t("produitsAjustementOk"));
      setAjust({ quantite: "", motif: "" });
      setDetails((d) => d);
      const mouvements = await api.getMouvementsProduit(editionId);
      setDetails((d) => ({ ...d, mouvements }));
      await charger();
    } catch (err) {
      setErreur(err.message);
    }
  }

  async function enregistrer(e) {
    e.preventDefault();
    setErreur("");
    setInfo("");
    const cout = form.cout === "" ? 0 : nombreSaisi(form.cout);
    const marge = form.margePct === "" ? 0 : nombreSaisi(form.margePct);
    if (!Number.isFinite(cout) || !Number.isFinite(marge)) {
      setErreur(t("defaultLoadError"));
      return;
    }
    const data = {
      reference: form.reference,
      designation: form.designation,
      unite: form.unite,
      categorie: form.categorie,
      cout_revient_unitaire_xof: cout,
      marge_pct: marge / 100,
      notes: form.notes,
    };
    setEnregistrement(true);
    try {
      if (editionId) await api.patchProduit(editionId, { ...data, actif: form.actif });
      else await api.createProduit(data);
      setFormOuvert(false);
      await charger();
    } catch (err) {
      setErreur(err.message);
    } finally {
      setEnregistrement(false);
    }
  }

  async function supprimer(p) {
    if (!window.confirm(t("produitsSupprimerConfirm"))) return;
    setErreur("");
    try {
      await api.supprimerProduit(p.id);
      await charger();
    } catch (err) {
      setErreur(err.message);
    }
  }

  async function actualiser(p) {
    setErreur("");
    setInfo("");
    try {
      await api.actualiserProduit(p.id);
      setInfo(t("produitsMajOk"));
      await charger();
    } catch (err) {
      setErreur(err.message);
    }
  }

  async function ouvrirImport() {
    setImportOuvert(true);
    setFormOuvert(false);
    setSelection([]);
    setErreur("");
    try {
      setCandidats(await api.getProduitsCandidats());
    } catch (err) {
      setErreur(err.message);
    }
  }

  function basculer(offreId) {
    setSelection((prev) => (prev.includes(offreId) ? prev.filter((i) => i !== offreId) : [...prev, offreId]));
  }

  async function importer() {
    setImportEnCours(true);
    setErreur("");
    try {
      const r = await api.importerProduits(selection);
      setInfo(t("produitsImportOk").replace("{crees}", r.crees));
      setImportOuvert(false);
      await charger();
    } catch (err) {
      setErreur(err.message);
    } finally {
      setImportEnCours(false);
    }
  }

  const coutForm = nombreSaisi(form.cout || 0);
  const margeForm = nombreSaisi(form.margePct || 0);
  const apercuPrix = Number.isFinite(coutForm) && Number.isFinite(margeForm) ? prixVenteDepuisCout(coutForm, margeForm / 100) : 0;
  const importables = candidats.filter((c) => !c.deja_importe);

  return (
    <AppShell title={t("produitsTitle")}>
      <p style={{ fontSize: 12.5, color: "var(--sub)", marginBottom: 14 }}>{t("produitsSubtitle")}</p>

      <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center", marginBottom: 14 }}>
        <input
          value={recherche}
          onChange={(e) => setRecherche(e.target.value)}
          placeholder={t("produitsRecherche")}
          style={{ ...inputStyle, maxWidth: 320 }}
        />
        <label style={{ fontSize: 12, color: "var(--sub)", display: "inline-flex", gap: 6, alignItems: "center" }}>
          <input type="checkbox" checked={voirInactifs} onChange={(e) => setVoirInactifs(e.target.checked)} />
          {t("produitsToutVoir")}
        </label>
        <span style={{ flex: 1 }} />
        <button type="button" onClick={ouvrirImport} style={boutonSecondaireStyle}>
          {t("produitsImportTitre")}
        </button>
        <button type="button" onClick={ouvrirCreation} style={boutonPrincipalStyle}>
          {t("produitsAjouter")}
        </button>
      </div>

      {erreur && <p style={{ color: "var(--brique)", fontSize: 12.5, marginBottom: 12 }}>{erreur}</p>}
      {info && <p style={{ color: "var(--vert)", fontSize: 12.5, marginBottom: 12 }}>{info}</p>}

      {importOuvert && (
        <section className="card" style={{ marginBottom: 16 }}>
          <h2 style={{ fontSize: 14.5, color: "var(--petrol)", marginBottom: 4 }}>{t("produitsImportTitre")}</h2>
          <p style={{ fontSize: 12, color: "var(--sub)", marginBottom: 10 }}>{t("produitsImportAide")}</p>
          {candidats.length === 0 ? (
            <p style={{ fontSize: 12.5, color: "var(--sub)" }}>{t("produitsImportAucun")}</p>
          ) : (
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5, minWidth: 760 }}>
                <thead>
                  <tr>
                    <th style={thStyle}></th>
                    <th style={thStyle}>{t("produitsImportColArticle")}</th>
                    <th style={thStyle}>{t("produitsImportColDossier")}</th>
                    <th style={thStyle}>{t("produitsImportColFournisseur")}</th>
                    <th style={{ ...thStyle, textAlign: "right" }}>{t("produitsColCout")}</th>
                    <th style={{ ...thStyle, textAlign: "right" }}>{t("produitsColMarge")}</th>
                    <th style={{ ...thStyle, textAlign: "right" }}>{t("produitsColPrixVente")}</th>
                  </tr>
                </thead>
                <tbody>
                  {candidats.map((c) => (
                    <tr key={c.offre_id} style={{ borderTop: "1px solid var(--line)", opacity: c.deja_importe ? 0.55 : 1 }}>
                      <td style={tdStyle}>
                        <input
                          type="checkbox"
                          disabled={c.deja_importe}
                          checked={selection.includes(c.offre_id)}
                          onChange={() => basculer(c.offre_id)}
                        />
                      </td>
                      <td style={{ ...tdStyle, fontWeight: 600 }}>
                        {c.libelle}
                        {c.deja_importe && <span style={{ marginLeft: 8, fontSize: 11, color: "var(--sub)", fontWeight: 400 }}>· {t("produitsImportDeja")}</span>}
                      </td>
                      <td style={tdStyle}>
                        <Link href={`/calcul-prix/${c.dossier_calcul_id}`} style={{ color: "var(--petrol)" }}>
                          {c.dossier_nom}
                        </Link>
                      </td>
                      <td style={tdStyle}>{c.fournisseur_nom}</td>
                      <td className="mono" style={{ ...tdStyle, textAlign: "right" }}>{Number(c.cout_revient_unitaire_xof).toLocaleString()}</td>
                      <td className="mono" style={{ ...tdStyle, textAlign: "right" }}>{Math.round(c.marge_pct * 10000) / 100} %</td>
                      <td className="mono" style={{ ...tdStyle, textAlign: "right", fontWeight: 600 }}>{Number(c.prix_vente_xof).toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <div style={{ display: "flex", gap: 10, marginTop: 12 }}>
            <button
              type="button"
              disabled={selection.length === 0 || importEnCours}
              onClick={importer}
              style={{ ...boutonPrincipalStyle, opacity: selection.length === 0 ? 0.5 : 1 }}
            >
              {t("produitsImportBouton").replace("{n}", selection.length)}
            </button>
            {importables.length > 1 && (
              <button type="button" onClick={() => setSelection(importables.map((c) => c.offre_id))} style={boutonSecondaireStyle}>
                {t("produitsToutSelectionner")} ({importables.length})
              </button>
            )}
            <button type="button" onClick={() => setImportOuvert(false)} style={boutonSecondaireStyle}>
              {t("produitsAnnuler")}
            </button>
          </div>
        </section>
      )}

      {formOuvert && (
        <form onSubmit={enregistrer} className="card" style={{ marginBottom: 16 }}>
          <h2 style={{ fontSize: 14.5, color: "var(--petrol)", marginBottom: 12 }}>
            {editionId ? t("produitsModifierTitre") : t("produitsNouveauTitre")}
          </h2>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))", gap: 12 }}>
            <div>
              <label style={labelStyle}>{t("produitsReferenceInterne")}</label>
              <input value={form.reference} onChange={(e) => setForm((f) => ({ ...f, reference: e.target.value }))} style={inputStyle} />
            </div>
            <div style={{ gridColumn: "span 2" }}>
              <label style={labelStyle}>{t("produitsColDesignation")}</label>
              <input required value={form.designation} onChange={(e) => setForm((f) => ({ ...f, designation: e.target.value }))} style={inputStyle} />
            </div>
            <div>
              <label style={labelStyle}>{t("produitsColUnite")}</label>
              <input value={form.unite} onChange={(e) => setForm((f) => ({ ...f, unite: e.target.value }))} style={inputStyle} />
            </div>
            <div>
              <label style={labelStyle}>{t("produitsColCategorie")}</label>
              <input value={form.categorie} onChange={(e) => setForm((f) => ({ ...f, categorie: e.target.value }))} style={inputStyle} />
            </div>
            <div>
              <label style={labelStyle}>{t("produitsColCout")}</label>
              <input inputMode="decimal" value={form.cout} onChange={(e) => setForm((f) => ({ ...f, cout: e.target.value }))} style={inputStyle} />
            </div>
            <div>
              <label style={labelStyle}>{t("produitsColMarge")}</label>
              <input inputMode="decimal" value={form.margePct} onChange={(e) => setForm((f) => ({ ...f, margePct: e.target.value }))} style={inputStyle} />
            </div>
            <div>
              <label style={labelStyle}>{t("produitsColPrixVente")}</label>
              <div className="mono" style={{ ...inputStyle, background: "var(--bg, #f6f6f3)", fontWeight: 700 }}>{apercuPrix.toLocaleString()}</div>
            </div>
          </div>
          <p style={{ fontSize: 11.5, color: "var(--sub)", margin: "8px 0 0" }}>{t("produitsAideMarge")}</p>
          <p style={{ fontSize: 11.5, color: "var(--sub)", margin: "4px 0 0" }}>{t("produitsAideReference")}</p>
          {editionId && (
            <label style={{ fontSize: 12.5, display: "inline-flex", gap: 6, alignItems: "center", marginTop: 10 }}>
              <input type="checkbox" checked={form.actif} onChange={(e) => setForm((f) => ({ ...f, actif: e.target.checked }))} />
              {t("produitsActifLabel")}
            </label>
          )}
          <div style={{ display: "flex", gap: 10, marginTop: 14 }}>
            <button type="submit" disabled={enregistrement} style={boutonPrincipalStyle}>
              {t("produitsEnregistrer")}
            </button>
            <button type="button" onClick={() => setFormOuvert(false)} style={boutonSecondaireStyle}>
              {t("produitsAnnuler")}
            </button>
          </div>
          {editionId && (
            <div style={{ marginTop: 18, borderTop: "1px solid var(--line)", paddingTop: 14, display: "grid", gap: 16 }}>
              <div>
                <h3 style={{ fontSize: 13, color: "var(--petrol)", marginBottom: 8 }}>{t("produitsAjusterStock")}</h3>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "flex-end" }}>
                  <div>
                    <label style={labelStyle}>{t("produitsAjustementQuantite")}</label>
                    <input inputMode="decimal" value={ajust.quantite} onChange={(e) => setAjust((a) => ({ ...a, quantite: e.target.value }))} style={{ ...inputStyle, width: 170 }} />
                  </div>
                  <div style={{ flex: 1, minWidth: 220 }}>
                    <label style={labelStyle}>{t("produitsAjustementMotif")}</label>
                    <input value={ajust.motif} onChange={(e) => setAjust((a) => ({ ...a, motif: e.target.value }))} style={inputStyle} />
                  </div>
                  <button type="button" onClick={ajusterStock} style={boutonSecondaireStyle}>
                    {t("produitsAjusterStock")}
                  </button>
                </div>
              </div>
              <div>
                <h3 style={{ fontSize: 13, color: "var(--petrol)", marginBottom: 6 }}>{t("produitsRefsFournisseurs")}</h3>
                {details.refs.length === 0 ? (
                  <p style={{ fontSize: 12, color: "var(--sub)" }}>{t("produitsRefsAucune")}</p>
                ) : (
                  details.refs.map((r) => (
                    <div key={r.id} style={{ fontSize: 12.5 }}>
                      <span style={{ fontWeight: 600 }}>{r.fournisseur_nom}</span> · <span className="mono">{r.reference_fournisseur}</span>
                      {r.designation_fournisseur ? <span style={{ color: "var(--sub)" }}> — {r.designation_fournisseur}</span> : null}
                    </div>
                  ))
                )}
              </div>
              <div>
                <h3 style={{ fontSize: 13, color: "var(--petrol)", marginBottom: 6 }}>{t("produitsMouvements")}</h3>
                {details.mouvements.length === 0 ? (
                  <p style={{ fontSize: 12, color: "var(--sub)" }}>{t("produitsMouvementsAucun")}</p>
                ) : (
                  details.mouvements.slice(0, 10).map((m) => (
                    <div key={m.id} style={{ fontSize: 12.5, display: "flex", gap: 12 }}>
                      <span className="mono" style={{ color: "var(--sub)" }}>{new Date(m.date_mouvement).toLocaleDateString(dict.dateLocale)}</span>
                      <span className="mono" style={{ width: 70, textAlign: "right", color: m.quantite < 0 ? "var(--brique)" : "var(--vert)" }}>
                        {m.quantite > 0 ? "+" : ""}
                        {Number(m.quantite).toLocaleString()}
                      </span>
                      <span>{m.libelle || m.type_mouvement}</span>
                    </div>
                  ))
                )}
              </div>
            </div>
          )}
        </form>
      )}

      {chargement ? (
        <p style={{ fontSize: 12.5, color: "var(--sub)" }}>{t("loading")}</p>
      ) : produits.length === 0 ? (
        <p className="card" style={{ fontSize: 13, color: "var(--sub)" }}>{t("produitsVide")}</p>
      ) : (
        <div className="card" style={{ overflowX: "auto", padding: 0 }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5, minWidth: 980 }}>
            <thead>
              <tr>
                <th style={thStyle}>{t("produitsColReference")}</th>
                <th style={thStyle}>{t("produitsColDesignation")}</th>
                <th style={thStyle}>{t("produitsColUnite")}</th>
                <th style={{ ...thStyle, textAlign: "right" }}>{t("produitsColStock")}</th>
                <th style={{ ...thStyle, textAlign: "right" }}>{t("produitsColCout")}</th>
                <th style={{ ...thStyle, textAlign: "right" }}>{t("produitsColMarge")}</th>
                <th style={{ ...thStyle, textAlign: "right" }}>{t("produitsColPrixVente")}</th>
                <th style={thStyle}>{t("produitsColSource")}</th>
                <th style={thStyle}>{t("produitsColActions")}</th>
              </tr>
            </thead>
            <tbody>
              {produits.map((p) => (
                <tr key={p.id} style={{ borderTop: "1px solid var(--line)", opacity: p.actif ? 1 : 0.55 }}>
                  <td className="mono" style={{ ...tdStyle, whiteSpace: "nowrap" }}>{p.reference || "—"}</td>
                  <td style={{ ...tdStyle, fontWeight: 600 }}>
                    {p.designation}
                    {p.categorie && <div style={{ fontSize: 11, color: "var(--sub)", fontWeight: 400 }}>{p.categorie}</div>}
                    {!p.actif && <div style={{ fontSize: 11, color: "var(--brique)", fontWeight: 400 }}>{t("produitsInactif")}</div>}
                  </td>
                  <td style={tdStyle}>{p.unite}</td>
                  <td className="mono" style={{ ...tdStyle, textAlign: "right", fontWeight: 600, color: Number(p.stock_quantite) < 0 ? "var(--brique)" : "inherit" }}>
                    {Number(p.stock_quantite || 0).toLocaleString()}
                  </td>
                  <td className="mono" style={{ ...tdStyle, textAlign: "right" }}>{Number(p.cout_revient_unitaire_xof).toLocaleString()}</td>
                  <td className="mono" style={{ ...tdStyle, textAlign: "right" }}>{Math.round(Number(p.marge_pct) * 10000) / 100} %</td>
                  <td className="mono" style={{ ...tdStyle, textAlign: "right", fontWeight: 700 }}>{Number(p.prix_vente_xof).toLocaleString()}</td>
                  <td style={{ ...tdStyle, color: "var(--sub)", fontSize: 11.5 }}>
                    {p.source_libelle || t("produitsOrigineManuelle")}
                    {p.date_cout && (
                      <div className="mono" style={{ fontSize: 10.5 }}>{new Date(p.date_cout).toLocaleDateString(dict.dateLocale)}</div>
                    )}
                  </td>
                  <td style={{ ...tdStyle, whiteSpace: "nowrap" }}>
                    <button type="button" onClick={() => ouvrirEdition(p)} style={lienStyle}>{t("produitsModifier")}</button>
                    {p.source_offre_id && (
                      <button type="button" onClick={() => actualiser(p)} title={t("produitsActualiserAide")} style={{ ...lienStyle, marginLeft: 10 }}>
                        {t("produitsActualiser")}
                      </button>
                    )}
                    <button type="button" onClick={() => supprimer(p)} style={{ ...lienStyle, marginLeft: 10, color: "var(--brique)" }}>
                      {t("produitsSupprimer")}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </AppShell>
  );
}

const labelStyle = { fontSize: 11.5, fontWeight: 600, display: "block", marginBottom: 5 };
const inputStyle = { width: "100%", padding: "8px 10px", border: "1px solid var(--line)", borderRadius: 8, fontSize: 13, fontFamily: "inherit" };
const boutonPrincipalStyle = { background: "var(--petrol)", color: "#fff", border: "none", borderRadius: 8, padding: "9px 18px", fontSize: 12.5, fontWeight: 600, cursor: "pointer" };
const boutonSecondaireStyle = { background: "transparent", color: "var(--petrol)", border: "1px solid var(--line)", borderRadius: 8, padding: "8px 14px", fontSize: 12, fontWeight: 600, cursor: "pointer" };
const lienStyle = { background: "transparent", border: "none", color: "var(--petrol)", fontSize: 12, fontWeight: 600, cursor: "pointer", padding: 0, textDecoration: "underline" };
const thStyle = { padding: "8px 10px", textAlign: "left", color: "var(--sub)", fontWeight: 600, fontSize: 11, borderBottom: "1px solid var(--line)", whiteSpace: "nowrap" };
const tdStyle = { padding: "8px 10px", verticalAlign: "top" };
