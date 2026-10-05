"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "../../lib/api";
import { useLangue } from "../../lib/i18n/LanguageContext";
import AppShell from "../../lib/components/AppShell";
import { TYPES_COUT, REPARTITIONS, repartirCouts, typesDejaInclus } from "../../lib/receptionCouts";

// Saisie / controle d'une reception de marchandises (facture fournisseur).
// Brouillon modifiable -> "Valider" cree ou met a jour les articles (avec NOTRE
// reference interne), memorise la correspondance des references du fournisseur
// et fait entrer les quantites en stock (back : routes/receptions.js,
// 05/10/2026). Rien n'est ecrit en stock avant la validation.

const INCOTERMS = ["EXW", "FCA", "FAS", "FOB", "CFR", "CIF", "CPT", "CIP", "DAP", "DPU", "DDP"];
const LIGNE_VIDE = { reference_fournisseur: "", designation: "", unite: "U", quantite: 1, prix_unitaire_devise: "", produit_id: "", reference_interne: "", poids_unitaire_kg: "", article_reconnu: null };
const COUT_VIDE = { type_cout: "FRET", libelle: "", montant: "", en_devise_facture: false, repartition: "VALEUR" };
const arr2 = (n) => Math.round(n * 100) / 100;
const num = (v) => {
  const n = Number(String(v ?? "").replace(/[\s  ]/g, "").replace(",", "."));
  return Number.isFinite(n) ? n : 0;
};

export default function ReceptionEditeur({ id }) {
  const { t } = useLangue();
  const router = useRouter();
  const fichierRef = useRef(null);
  const [fournisseurs, setFournisseurs] = useState([]);
  const [produits, setProduits] = useState([]);
  const [reception, setReception] = useState(null);
  const [chargement, setChargement] = useState(!!id);
  const [erreur, setErreur] = useState("");
  const [info, setInfo] = useState("");
  const [avertissements, setAvertissements] = useState([]);
  const [enCours, setEnCours] = useState(false);
  const [form, setForm] = useState({
    fournisseur_id: "",
    reference_facture: "",
    date_facture: "",
    date_reception: new Date().toISOString().slice(0, 10),
    devise: "XOF",
    cours_devise: "1",
    incoterm: "",
    notes: "",
  });
  const [lignes, setLignes] = useState([{ ...LIGNE_VIDE }]);
  const [couts, setCouts] = useState([]);
  const [nouveauFournisseur, setNouveauFournisseur] = useState(null);

  const statut = reception ? reception.statut : "BROUILLON";
  const modifiable = statut === "BROUILLON";
  const coutsEditables = statut !== "ANNULEE";

  function appliquer(r) {
    setReception(r);
    setForm({
      fournisseur_id: r.fournisseur_id,
      reference_facture: r.reference_facture || "",
      date_facture: r.date_facture ? String(r.date_facture).slice(0, 10) : "",
      date_reception: r.date_reception ? String(r.date_reception).slice(0, 10) : "",
      devise: r.devise,
      cours_devise: String(r.cours_devise),
      incoterm: r.incoterm || "",
      notes: r.notes || "",
    });
    setLignes(
      r.lignes.length
        ? r.lignes.map((l) => ({
            reference_fournisseur: l.reference_fournisseur || "",
            designation: l.designation,
            unite: l.unite,
            quantite: l.quantite,
            prix_unitaire_devise: l.prix_unitaire_devise,
            produit_id: l.produit_id || "",
            reference_interne: l.reference_interne || "",
            poids_unitaire_kg: l.poids_unitaire_kg ?? "",
            article_reconnu: l.article_reconnu,
            produit_reference: l.produit_reference,
          }))
        : [{ ...LIGNE_VIDE }]
    );
    setCouts(
      (r.couts_approche || []).map((c) => ({
        type_cout: c.type_cout,
        libelle: c.libelle || "",
        montant: c.montant,
        en_devise_facture: !!c.en_devise_facture,
        repartition: c.repartition,
      }))
    );
  }

  useEffect(() => {
    api.getFournisseursReception().then(setFournisseurs).catch(() => {});
    api.getProduits().then(setProduits).catch(() => {});
    if (id) {
      api
        .getReception(id)
        .then(appliquer)
        .catch((err) => setErreur(err.message))
        .finally(() => setChargement(false));
    }
  }, [id]);

  function majLigne(index, champ, valeur) {
    setLignes((prev) => prev.map((l, i) => (i === index ? { ...l, [champ]: valeur } : l)));
  }

  const coursNum = form.devise.trim().toUpperCase() === "XOF" ? 1 : num(form.cours_devise);
  const totalDevise = arr2(lignes.reduce((s, l) => s + arr2(num(l.quantite) * num(l.prix_unitaire_devise)), 0));

  // Apercu en direct des couts d'approche (meme calcul que le serveur, qui
  // reste la reference apres enregistrement).
  const estUtile = (l) => l.designation.trim() || l.reference_fournisseur.trim();
  const indexUtiles = lignes.map((l, i) => (estUtile(l) ? i : -1)).filter((i) => i >= 0);
  const coutsNum = couts.map((c) => ({ ...c, montant: num(c.montant) })).filter((c) => c.montant > 0);
  const apercu = repartirCouts(
    indexUtiles.map((i) => ({ quantite: num(lignes[i].quantite), prix_unitaire_devise: num(lignes[i].prix_unitaire_devise), poids_unitaire_kg: num(lignes[i].poids_unitaire_kg) })),
    coutsNum,
    coursNum
  );
  const apercuLigne = (index) => {
    const k = indexUtiles.indexOf(index);
    return k >= 0 ? apercu.lignes[k] : null;
  };
  const afficherPoids = couts.some((c) => c.repartition === "POIDS") || lignes.some((l) => num(l.poids_unitaire_kg) > 0);
  const avertissementsCouts = [
    ...apercu.avertissements.map((a) => t(a.code === "POIDS_MANQUANT" ? "receptionsAvertPoidsManquant" : "receptionsAvertPoidsPartiel").replace("{type}", t(`receptionsCoutType${a.type_cout}`))),
    ...typesDejaInclus(form.incoterm, coutsNum).map((type) =>
      t("receptionsAvertIncoterm").replace("{type}", t(`receptionsCoutType${type}`)).replace("{incoterm}", form.incoterm)
    ),
  ];
  const majCout = (index, champ, valeur) => setCouts((prev) => prev.map((c, i) => (i === index ? { ...c, [champ]: valeur } : c)));

  function charge() {
    return {
      ...form,
      cours_devise: coursNum,
      lignes: lignes
        .filter((l) => l.designation.trim() || l.reference_fournisseur.trim())
        .map((l) => ({
          reference_fournisseur: l.reference_fournisseur,
          designation: l.designation,
          unite: l.unite,
          quantite: num(l.quantite),
          prix_unitaire_devise: num(l.prix_unitaire_devise),
          produit_id: l.produit_id || undefined,
          reference_interne: l.produit_id ? undefined : l.reference_interne || undefined,
          poids_unitaire_kg: num(l.poids_unitaire_kg) > 0 ? num(l.poids_unitaire_kg) : undefined,
        })),
      couts_approche: coutsNum,
    };
  }

  async function handleEstimer() {
    setErreur("");
    setInfo("");
    try {
      const fret = coutsNum.filter((c) => c.type_cout === "FRET").reduce((s, c) => s + (c.en_devise_facture ? c.montant * coursNum : c.montant), 0);
      const e = await api.estimerCoutsApprocheReception({ total_achat_xof: apercu.total_achat_xof, fret_xof: arr2(fret), incoterm: form.incoterm });
      setCouts((prev) => {
        const sans = prev.filter((c) => c.type_cout !== "ASSURANCE" && c.type_cout !== "DOUANE");
        const ajouts = [];
        if (e.assurance_xof > 0) ajouts.push({ type_cout: "ASSURANCE", libelle: "", montant: e.assurance_xof, en_devise_facture: false, repartition: "VALEUR" });
        if (e.droits_taxes_xof > 0) ajouts.push({ type_cout: "DOUANE", libelle: "", montant: e.droits_taxes_xof, en_devise_facture: false, repartition: "VALEUR" });
        return [...sans, ...ajouts];
      });
      let message = t("receptionsCoutsEstimeOk").replace("{valeur}", Number(e.valeur_en_douane_xof).toLocaleString());
      if (e.inclus.fret || e.inclus.assurance) message += " " + t("receptionsCoutsEstimeInclus").replace("{incoterm}", form.incoterm);
      setInfo(message);
    } catch (err) {
      setErreur(err.message);
    }
  }

  async function handleEnregistrerCouts() {
    setEnCours(true);
    setErreur("");
    setInfo("");
    try {
      appliquer(await api.enregistrerCoutsApprocheReception(id, coutsNum));
      setInfo(t("receptionsCoutsEnregistres"));
      api.getProduits().then(setProduits).catch(() => {});
    } catch (err) {
      setErreur(err.message);
    } finally {
      setEnCours(false);
    }
  }

  async function enregistrer() {
    if (!form.fournisseur_id) {
      setErreur(t("receptionsFournisseurRequis"));
      return null;
    }
    const data = charge();
    if (data.lignes.length === 0) {
      setErreur(t("receptionsLigneRequise"));
      return null;
    }
    setErreur("");
    setInfo("");
    const sauvee = id ? await api.patchReception(id, data) : await api.createReception(data);
    return sauvee;
  }

  async function handleEnregistrer() {
    setEnCours(true);
    try {
      const r = await enregistrer();
      if (!r) return;
      if (!id) router.replace(`/receptions/${r.id}`);
      else appliquer(r);
    } catch (err) {
      setErreur(err.message);
    } finally {
      setEnCours(false);
    }
  }

  async function handleValider() {
    if (!window.confirm(t("receptionsValiderConfirm"))) return;
    setEnCours(true);
    try {
      const r = await enregistrer();
      if (!r) return;
      const validee = await api.validerReception(r.id);
      setInfo(t("receptionsValideeOk").replace("{n}", validee.nouveaux_articles));
      if (!id) router.replace(`/receptions/${r.id}`);
      else appliquer(validee);
      api.getProduits().then(setProduits).catch(() => {});
    } catch (err) {
      setErreur(err.message);
    } finally {
      setEnCours(false);
    }
  }

  async function handleAnnuler() {
    if (!window.confirm(t("receptionsAnnulerConfirm"))) return;
    setEnCours(true);
    setErreur("");
    try {
      appliquer(await api.annulerReception(id));
    } catch (err) {
      setErreur(err.message);
    } finally {
      setEnCours(false);
    }
  }

  async function handleSupprimer() {
    if (!window.confirm(t("receptionsSupprimerConfirm"))) return;
    try {
      await api.supprimerReception(id);
      router.push("/receptions");
    } catch (err) {
      setErreur(err.message);
    }
  }

  async function handleImport(e) {
    const fichier = e.target.files && e.target.files[0];
    e.target.value = "";
    if (!fichier) return;
    setErreur("");
    setInfo("");
    try {
      const r = await api.importerExcelReception(fichier);
      setAvertissements(r.avertissements || []);
      setInfo(t("receptionsImportOk").replace("{n}", r.lignes.length));
      const nouvelles = r.lignes.map((l) => ({ ...LIGNE_VIDE, ...l, produit_id: "", reference_interne: "" }));
      setLignes((prev) => {
        const utiles = prev.filter((l) => l.designation.trim() || l.reference_fournisseur.trim());
        return [...utiles, ...nouvelles];
      });
    } catch (err) {
      setErreur(err.message);
    }
  }

  async function creerFournisseur(e) {
    e.preventDefault();
    try {
      const f = await api.createFournisseurReception({ nom: nouveauFournisseur });
      setFournisseurs((prev) => [...prev, f].sort((a, b) => a.nom.localeCompare(b.nom)));
      setForm((x) => ({ ...x, fournisseur_id: f.id }));
      setNouveauFournisseur(null);
    } catch (err) {
      setErreur(err.message);
    }
  }

  if (chargement) {
    return (
      <AppShell title={t("receptionsTitle")} backHref="/receptions" backLabelKey="receptionsRetour">
        <p style={{ fontSize: 12.5, color: "var(--sub)" }}>{t("loading")}</p>
      </AppShell>
    );
  }

  const titre = reception ? reception.numero : t("receptionsNouvelle");
  const desactive = !modifiable;

  return (
    <AppShell title={titre} backHref="/receptions" backLabelKey="receptionsRetour">
      {erreur && <p style={{ color: "var(--brique)", fontSize: 12.5, marginBottom: 12 }}>{erreur}</p>}
      {info && <p style={{ color: "var(--vert)", fontSize: 12.5, marginBottom: 12 }}>{info}</p>}
      {desactive && <p style={{ fontSize: 12.5, color: "var(--sub)", marginBottom: 12 }}>{t("receptionsLectureSeule")} ({t(`receptionsStatut${statut}`)})</p>}

      <section className="card" style={{ marginBottom: 16 }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 12 }}>
          <div>
            <label style={labelStyle}>{t("receptionsFournisseurLabel")}</label>
            <select disabled={desactive} value={form.fournisseur_id} onChange={(e) => setForm((f) => ({ ...f, fournisseur_id: e.target.value }))} style={inputStyle}>
              <option value="">{t("receptionsFournisseurChoisir")}</option>
              {fournisseurs.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.nom}
                </option>
              ))}
            </select>
            {modifiable && nouveauFournisseur === null && (
              <button type="button" onClick={() => setNouveauFournisseur("")} style={lienStyle}>
                + {t("receptionsNouveauFournisseur")}
              </button>
            )}
            {nouveauFournisseur !== null && (
              <form onSubmit={creerFournisseur} style={{ display: "flex", gap: 6, marginTop: 6 }}>
                <input autoFocus required value={nouveauFournisseur} onChange={(e) => setNouveauFournisseur(e.target.value)} placeholder={t("receptionsNomFournisseur")} style={inputStyle} />
                <button type="submit" style={boutonSecondaireStyle}>OK</button>
              </form>
            )}
          </div>
          <div>
            <label style={labelStyle}>{t("receptionsReferenceFacture")}</label>
            <input disabled={desactive} value={form.reference_facture} onChange={(e) => setForm((f) => ({ ...f, reference_facture: e.target.value }))} style={inputStyle} />
          </div>
          <div>
            <label style={labelStyle}>{t("receptionsDateFacture")}</label>
            <input disabled={desactive} type="date" value={form.date_facture} onChange={(e) => setForm((f) => ({ ...f, date_facture: e.target.value }))} style={inputStyle} />
          </div>
          <div>
            <label style={labelStyle}>{t("receptionsDateReception")}</label>
            <input disabled={desactive} type="date" value={form.date_reception} onChange={(e) => setForm((f) => ({ ...f, date_reception: e.target.value }))} style={inputStyle} />
          </div>
          <div>
            <label style={labelStyle}>{t("receptionsDevise")}</label>
            <input disabled={desactive} list="devises-reception" value={form.devise} onChange={(e) => setForm((f) => ({ ...f, devise: e.target.value.toUpperCase() }))} style={inputStyle} />
            <datalist id="devises-reception">
              {["XOF", "EUR", "USD", "CNY", "GBP", "AED"].map((d) => (
                <option key={d} value={d} />
              ))}
            </datalist>
          </div>
          <div>
            <label style={labelStyle}>{t("receptionsCours")}</label>
            <input disabled={desactive || form.devise.trim().toUpperCase() === "XOF"} inputMode="decimal" value={form.devise.trim().toUpperCase() === "XOF" ? "1" : form.cours_devise} onChange={(e) => setForm((f) => ({ ...f, cours_devise: e.target.value }))} style={inputStyle} />
          </div>
          <div>
            <label style={labelStyle}>{t("receptionsIncoterm")}</label>
            <select disabled={desactive} value={form.incoterm} onChange={(e) => setForm((f) => ({ ...f, incoterm: e.target.value }))} style={inputStyle}>
              <option value="">{t("receptionsIncotermAucun")}</option>
              {INCOTERMS.map((i) => (
                <option key={i} value={i}>
                  {i}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div style={{ marginTop: 12 }}>
          <label style={labelStyle}>{t("receptionsNotes")}</label>
          <input disabled={desactive} value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} style={inputStyle} />
        </div>
        {reception?.facture_fournisseur_numero && (
          <p style={{ fontSize: 12, color: "var(--sub)", marginTop: 8 }}>
            {t("receptionsFactureCompta")} : <span className="mono">{reception.facture_fournisseur_numero}</span>
          </p>
        )}
      </section>

      <section className="card" style={{ marginBottom: 16 }}>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center", marginBottom: 6 }}>
          <h2 style={{ fontSize: 14.5, color: "var(--petrol)", margin: 0 }}>{t("receptionsLignesTitre")}</h2>
          <span style={{ flex: 1 }} />
          {modifiable && (
            <>
              <input ref={fichierRef} type="file" accept=".xlsx,.xls,.csv" onChange={handleImport} style={{ display: "none" }} />
              <button type="button" onClick={() => fichierRef.current && fichierRef.current.click()} style={boutonSecondaireStyle}>
                {t("receptionsImporterExcel")}
              </button>
            </>
          )}
        </div>
        {modifiable && <p style={{ fontSize: 11.5, color: "var(--sub)", marginBottom: 10 }}>{t("receptionsImportAide")}</p>}
        {avertissements.length > 0 && (
          <div style={{ fontSize: 12, color: "var(--brique)", marginBottom: 10 }}>
            <strong>{t("receptionsAvertissements")}</strong>
            {avertissements.map((a, i) => (
              <div key={i}>{a}</div>
            ))}
          </div>
        )}

        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", minWidth: afficherPoids ? 1120 : 1040 }}>
            <thead>
              <tr style={{ fontSize: 11, color: "var(--sub)", textAlign: "left" }}>
                <th style={{ ...th, width: 92 }}>{t("receptionsColRefFournisseur")}</th>
                <th style={{ ...th, minWidth: 150 }}>{t("receptionsColDesignation")}</th>
                <th style={{ ...th, width: 50 }}>{t("receptionsColUnite")}</th>
                <th style={{ ...th, width: 66 }}>{t("receptionsColQuantite")}</th>
                <th style={{ ...th, width: 92 }}>{t("receptionsColPuDevise")}</th>
                <th style={{ ...th, width: 84, textAlign: "right" }}>{t("receptionsColMontant")}</th>
                <th style={{ ...th, width: 92, textAlign: "right" }}>{t("receptionsColCoutXof")}</th>
                {afficherPoids && <th style={{ ...th, width: 72 }}>{t("receptionsColPoids")}</th>}
                <th style={{ ...th, width: 96, textAlign: "right" }}>{t("receptionsColApproche")}</th>
                <th style={{ ...th, width: 110, textAlign: "right" }}>{t("receptionsColRevient")}</th>
                <th style={{ ...th, width: 190 }}>{t("receptionsColArticle")}</th>
                {modifiable && <th style={{ width: 28 }}></th>}
              </tr>
            </thead>
            <tbody>
              {lignes.map((l, index) => {
                const montant = arr2(num(l.quantite) * num(l.prix_unitaire_devise));
                const ap = apercuLigne(index);
                return (
                  <tr key={index} style={{ borderTop: "1px solid var(--line-soft, var(--line))" }}>
                    <td style={td}>
                      <input disabled={desactive} value={l.reference_fournisseur} onChange={(e) => majLigne(index, "reference_fournisseur", e.target.value)} style={inputCompact} />
                    </td>
                    <td style={td}>
                      <input disabled={desactive} value={l.designation} onChange={(e) => majLigne(index, "designation", e.target.value)} style={inputCompact} />
                    </td>
                    <td style={td}>
                      <input disabled={desactive} value={l.unite} onChange={(e) => majLigne(index, "unite", e.target.value)} style={inputCompact} />
                    </td>
                    <td style={td}>
                      <input disabled={desactive} inputMode="decimal" value={l.quantite} onChange={(e) => majLigne(index, "quantite", e.target.value)} style={inputCompact} />
                    </td>
                    <td style={td}>
                      <input disabled={desactive} inputMode="decimal" value={l.prix_unitaire_devise} onChange={(e) => majLigne(index, "prix_unitaire_devise", e.target.value)} style={inputCompact} />
                    </td>
                    <td className="mono" style={{ ...td, textAlign: "right", fontSize: 12.5 }}>{montant.toLocaleString()}</td>
                    <td className="mono" style={{ ...td, textAlign: "right", fontSize: 12.5 }}>{arr2(num(l.prix_unitaire_devise) * coursNum).toLocaleString()}</td>
                    {afficherPoids && (
                      <td style={td}>
                        <input disabled={desactive} inputMode="decimal" value={l.poids_unitaire_kg} onChange={(e) => majLigne(index, "poids_unitaire_kg", e.target.value)} style={inputCompact} />
                      </td>
                    )}
                    <td className="mono" style={{ ...td, textAlign: "right", fontSize: 12.5 }}>{ap ? ap.cout_approche_xof.toLocaleString() : "—"}</td>
                    <td className="mono" style={{ ...td, textAlign: "right", fontSize: 12.5, fontWeight: 700 }}>{ap ? ap.cout_revient_unitaire_xof.toLocaleString() : "—"}</td>
                    <td style={{ ...td, fontSize: 12 }}>
                      {desactive ? (
                        <span className="mono">{l.produit_reference || "—"}</span>
                      ) : l.produit_id ? (
                        <ArticleSelect produits={produits} valeur={l.produit_id} onChange={(v) => majLigne(index, "produit_id", v)} t={t} />
                      ) : l.article_reconnu ? (
                        <div>
                          <span style={{ color: "var(--vert)" }}>
                            {t("receptionsArticleReconnu")} <span className="mono">{l.article_reconnu.reference}</span>
                          </span>
                          <div style={{ fontSize: 11, color: "var(--sub)" }}>{l.article_reconnu.designation}</div>
                        </div>
                      ) : (
                        <div style={{ display: "grid", gap: 4 }}>
                          <input value={l.reference_interne} onChange={(e) => majLigne(index, "reference_interne", e.target.value)} placeholder={`${t("receptionsArticleNouveau")} — ${t("receptionsArticleRefSouhaitee")}`} style={inputCompact} />
                          <ArticleSelect produits={produits} valeur="" onChange={(v) => majLigne(index, "produit_id", v)} t={t} />
                        </div>
                      )}
                    </td>
                    {modifiable && (
                      <td style={td}>
                        <button type="button" onClick={() => setLignes((prev) => (prev.length > 1 ? prev.filter((_, i) => i !== index) : prev))} style={boutonSupprimerStyle}>
                          ×
                        </button>
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {modifiable && (
          <button type="button" onClick={() => setLignes((prev) => [...prev, { ...LIGNE_VIDE }])} style={{ ...boutonSecondaireStyle, marginTop: 10 }}>
            {t("receptionsAjouterLigne")}
          </button>
        )}
        <div style={{ marginTop: 14, marginLeft: "auto", maxWidth: 300, display: "grid", gap: 4 }}>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, fontWeight: 700 }}>
            <span>{t("receptionsTotal")}</span>
            <span className="mono">{totalDevise.toLocaleString()} {form.devise}</span>
          </div>
          {coursNum !== 1 && (
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12.5, color: "var(--sub)" }}>
              <span>XOF</span>
              <span className="mono">{arr2(totalDevise * coursNum).toLocaleString()}</span>
            </div>
          )}
        </div>
      </section>

      <section className="card" style={{ marginBottom: 16 }}>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center", marginBottom: 6 }}>
          <h2 style={{ fontSize: 14.5, color: "var(--petrol)", margin: 0 }}>{t("receptionsCoutsTitre")}</h2>
          <span style={{ flex: 1 }} />
          {coutsEditables && (
            <button type="button" onClick={handleEstimer} style={boutonSecondaireStyle}>
              {t("receptionsCoutsEstimer")}
            </button>
          )}
        </div>
        <p style={{ fontSize: 11.5, color: "var(--sub)", marginBottom: 10 }}>{statut === "VALIDEE" ? t("receptionsCoutsValideeAide") : t("receptionsCoutsAide")}</p>
        {avertissementsCouts.map((a, i) => (
          <p key={i} style={{ fontSize: 12, color: "var(--brique)", margin: "0 0 6px" }}>{a}</p>
        ))}
        {couts.length > 0 && (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 820 }}>
              <thead>
                <tr style={{ fontSize: 11, color: "var(--sub)", textAlign: "left" }}>
                  <th style={{ ...th, width: 190 }}>{t("receptionsCoutType")}</th>
                  <th style={{ ...th, minWidth: 170 }}>{t("receptionsCoutLibelle")}</th>
                  <th style={{ ...th, width: 130 }}>{t("receptionsCoutMontant")}</th>
                  <th style={{ ...th, width: 120 }}>{form.devise.trim().toUpperCase() === "XOF" ? "" : t("receptionsCoutDeviseFacture")}</th>
                  <th style={{ ...th, width: 120 }}>{t("receptionsCoutRepartition")}</th>
                  {coutsEditables && <th style={{ width: 28 }}></th>}
                </tr>
              </thead>
              <tbody>
                {couts.map((c, index) => (
                  <tr key={index} style={{ borderTop: "1px solid var(--line-soft, var(--line))" }}>
                    <td style={td}>
                      <select disabled={!coutsEditables} value={c.type_cout} onChange={(e) => majCout(index, "type_cout", e.target.value)} style={inputCompact}>
                        {TYPES_COUT.map((type) => (
                          <option key={type} value={type}>
                            {t(`receptionsCoutType${type}`)}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td style={td}>
                      <input disabled={!coutsEditables} value={c.libelle} onChange={(e) => majCout(index, "libelle", e.target.value)} style={inputCompact} />
                    </td>
                    <td style={td}>
                      <input disabled={!coutsEditables} inputMode="decimal" value={c.montant} onChange={(e) => majCout(index, "montant", e.target.value)} style={inputCompact} />
                    </td>
                    <td style={{ ...td, fontSize: 12 }}>
                      {form.devise.trim().toUpperCase() === "XOF" ? null : (
                        <label style={{ display: "flex", gap: 6, alignItems: "center", paddingTop: 6 }}>
                          <input disabled={!coutsEditables} type="checkbox" checked={c.en_devise_facture} onChange={(e) => majCout(index, "en_devise_facture", e.target.checked)} />
                          {c.en_devise_facture ? form.devise : "XOF"}
                        </label>
                      )}
                    </td>
                    <td style={td}>
                      <select disabled={!coutsEditables} value={c.repartition} onChange={(e) => majCout(index, "repartition", e.target.value)} style={inputCompact}>
                        {REPARTITIONS.map((r) => (
                          <option key={r} value={r}>
                            {t(`receptionsRep${r}`)}
                          </option>
                        ))}
                      </select>
                    </td>
                    {coutsEditables && (
                      <td style={td}>
                        <button type="button" onClick={() => setCouts((prev) => prev.filter((_, i) => i !== index))} style={boutonSupprimerStyle}>
                          ×
                        </button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {coutsEditables && (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 10, marginTop: 10 }}>
            <button type="button" onClick={() => setCouts((prev) => [...prev, { ...COUT_VIDE }])} style={boutonSecondaireStyle}>
              {t("receptionsCoutAjouter")}
            </button>
            {statut === "VALIDEE" && (
              <button type="button" disabled={enCours} onClick={handleEnregistrerCouts} style={boutonPrincipalStyle}>
                {t("receptionsCoutsEnregistrer")}
              </button>
            )}
          </div>
        )}
        <div style={{ marginTop: 14, marginLeft: "auto", maxWidth: 360, display: "grid", gap: 4 }}>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12.5, color: "var(--sub)" }}>
            <span>{t("receptionsTotal")} (XOF)</span>
            <span className="mono">{apercu.total_achat_xof.toLocaleString()}</span>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12.5, color: "var(--sub)" }}>
            <span>{t("receptionsCoutsTotal")}</span>
            <span className="mono">{apercu.total_couts_approche_xof.toLocaleString()}</span>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, fontWeight: 700 }}>
            <span>{t("receptionsCoutRevientTotal")}</span>
            <span className="mono">{arr2(apercu.total_achat_xof + apercu.total_couts_approche_xof).toLocaleString()}</span>
          </div>
        </div>
      </section>

      <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
        {modifiable && (
          <>
            <button type="button" disabled={enCours} onClick={handleEnregistrer} style={boutonSecondaireStyle}>
              {t("receptionsEnregistrer")}
            </button>
            <button type="button" disabled={enCours} onClick={handleValider} style={boutonPrincipalStyle}>
              {t("receptionsValider")}
            </button>
            {id && (
              <button type="button" onClick={handleSupprimer} style={{ ...boutonSecondaireStyle, color: "var(--brique)" }}>
                {t("receptionsSupprimer")}
              </button>
            )}
          </>
        )}
        {statut === "VALIDEE" && (
          <button type="button" disabled={enCours} onClick={handleAnnuler} style={{ ...boutonSecondaireStyle, color: "var(--brique)" }}>
            {t("receptionsAnnuler")}
          </button>
        )}
      </div>
    </AppShell>
  );
}

function ArticleSelect({ produits, valeur, onChange, t }) {
  return (
    <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
      <select value={valeur} onChange={(e) => onChange(e.target.value)} style={{ ...inputCompact, fontSize: 11.5 }}>
        <option value="">{t("receptionsArticleChoisir")}</option>
        {produits.map((p) => (
          <option key={p.id} value={p.id}>
            {p.reference ? `${p.reference} · ` : ""}
            {p.designation}
          </option>
        ))}
      </select>
      {valeur && (
        <button type="button" onClick={() => onChange("")} style={boutonSupprimerStyle} title="×">
          ×
        </button>
      )}
    </div>
  );
}

const labelStyle = { fontSize: 11.5, fontWeight: 600, display: "block", marginBottom: 5 };
const inputStyle = { width: "100%", padding: "8px 10px", border: "1px solid var(--line)", borderRadius: 8, fontSize: 13, fontFamily: "inherit" };
const inputCompact = { ...inputStyle, padding: "6px 8px", fontSize: 12.5 };
const boutonPrincipalStyle = { background: "var(--petrol)", color: "#fff", border: "none", borderRadius: 8, padding: "9px 18px", fontSize: 12.5, fontWeight: 600, cursor: "pointer" };
const boutonSecondaireStyle = { background: "transparent", color: "var(--petrol)", border: "1px solid var(--line)", borderRadius: 8, padding: "8px 14px", fontSize: 12, fontWeight: 600, cursor: "pointer" };
const boutonSupprimerStyle = { background: "transparent", color: "var(--brique)", border: "none", fontSize: 16, fontWeight: 700, cursor: "pointer", lineHeight: 1 };
const lienStyle = { background: "transparent", border: "none", color: "var(--petrol)", fontSize: 11.5, textDecoration: "underline", cursor: "pointer", padding: 0, marginTop: 4 };
const th = { padding: "4px 6px", fontWeight: 600 };
const td = { padding: "4px 6px", verticalAlign: "top" };
