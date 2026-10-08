"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { api } from "../../lib/api";
import { useLangue } from "../../lib/i18n/LanguageContext";
import AppShell from "../../lib/components/AppShell";
import EcheancierEditor from "../../lib/components/EcheancierEditor";
import { echeancierValide, pourApi } from "../../lib/echeancier";
import { useIncoterms, codesAvec } from "../../lib/incoterms";

// Saisie / suivi d'une commande fournisseur (Lot 5, 05/10/2026).
// Brouillon modifiable -> "Confirmer" (commande envoyee au fournisseur) -> les
// receptions s'y rattachent. Back : routes/commandes.js.

const LIGNE_VIDE = { reference_fournisseur: "", designation: "", unite: "U", quantite: 1, prix_unitaire_devise: "", produit_id: "", calcul_offre_id: "" };
const arr2 = (n) => Math.round(n * 100) / 100;
const nf = (n) => Number(n).toLocaleString(undefined, { maximumFractionDigits: 2 });
const num = (v) => {
  const n = Number(String(v ?? "").replace(/[\s  ]/g, "").replace(",", "."));
  return Number.isFinite(n) ? n : 0;
};
const jour = (d) => (d ? String(d).slice(0, 10) : "");

export default function CommandeEditeur({ id }) {
  const { t, dict } = useLangue();
  const incoterms = useIncoterms();
  const router = useRouter();
  const [commande, setCommande] = useState(null);
  const [chargement, setChargement] = useState(!!id);
  const [erreur, setErreur] = useState("");
  const [info, setInfo] = useState("");
  const [enCours, setEnCours] = useState(false);
  const [fournisseurs, setFournisseurs] = useState([]);
  const [transitaires, setTransitaires] = useState([]);
  const [cotations, setCotations] = useState([]);
  const [parents, setParents] = useState({ dossiers_ao: [], consultations: [] });
  const [rattachement, setRattachement] = useState("STOCK"); // STOCK | AO | CONSULTATION
  const [form, setForm] = useState({
    fournisseur_id: "",
    devise: "XOF",
    cours_devise: "1",
    incoterm: "",
    date_commande: new Date().toISOString().slice(0, 10),
    date_livraison_prevue: "",
    transitaire_id: "",
    cotation_id: "",
    dossier_ao_id: "",
    consultation_id: "",
    notes: "",
  });
  const [lignes, setLignes] = useState([{ ...LIGNE_VIDE }]);
  const [echeancier, setEcheancier] = useState([]);
  // Correction administrateur d'une commande confirmee (prix, Incoterm, quantites, suppression de lignes) avec motif + historique.
  const [estAdmin, setEstAdmin] = useState(false);
  const [modeCorrection, setModeCorrection] = useState(false);
  const [motif, setMotif] = useState("");

  const statut = commande ? commande.statut : "BROUILLON";
  const brouillon = statut === "BROUILLON";
  const confirmee = statut === "CONFIRMEE";
  const editable = brouillon;

  function appliquer(c) {
    setCommande(c);
    setForm({
      fournisseur_id: c.fournisseur_id,
      devise: c.devise,
      cours_devise: String(c.cours_devise),
      incoterm: c.incoterm || "",
      date_commande: jour(c.date_commande),
      date_livraison_prevue: jour(c.date_livraison_prevue),
      transitaire_id: c.transitaire_id || "",
      cotation_id: c.cotation_id || "",
      dossier_ao_id: c.dossier_ao_id || "",
      consultation_id: c.consultation_id || "",
      notes: c.notes || "",
    });
    setEcheancier(Array.isArray(c.echeancier_json) ? c.echeancier_json.map((l) => ({ ...l })) : []);
    setRattachement(c.dossier_ao_id ? "AO" : c.consultation_id ? "CONSULTATION" : "STOCK");
    setLignes(
      c.lignes.length
        ? c.lignes.map((l) => ({
            id: l.id,
            reference_fournisseur: l.reference_fournisseur || "",
            designation: l.designation,
            unite: l.unite,
            quantite: l.quantite,
            prix_unitaire_devise: l.prix_unitaire_devise,
            produit_id: l.produit_id || "",
            calcul_offre_id: l.calcul_offre_id || "",
            quantite_recue: l.quantite_recue,
            quantite_restante: l.quantite_restante,
            prix_offert_devise: l.prix_offert_devise ?? null,
            prix_paye_devise: l.prix_paye_devise ?? null,
          }))
        : [{ ...LIGNE_VIDE }]
    );
  }

  useEffect(() => {
    api.getPermissions().then((p) => setEstAdmin(!!(p && p.admin))).catch(() => {});
    api.getFournisseursReception().then(setFournisseurs).catch(() => {});
    api.getTransitairesPerf().then(setTransitaires).catch(() => {});
    api.getCotationsTransitaires().then(setCotations).catch(() => {});
    api.getParentsDossierCalcul().then(setParents).catch(() => {});
    if (id) {
      api
        .getCommande(id)
        .then(appliquer)
        .catch((e) => setErreur(e.message))
        .finally(() => setChargement(false));
    }
  }, [id]);

  const coursNum = form.devise.trim().toUpperCase() === "XOF" ? 1 : num(form.cours_devise);
  const totalDevise = arr2(lignes.filter((l) => !l.supprimee).reduce((s, l) => s + arr2(num(l.quantite) * num(l.prix_unitaire_devise)), 0));
  const majLigne = (i, champ, valeur) => setLignes((prev) => prev.map((l, k) => (k === i ? { ...l, [champ]: valeur } : l)));
  const maj = (champ, valeur) => setForm((f) => ({ ...f, [champ]: valeur }));
  const cotationsProposees = cotations.filter(
    (c) => (!form.transitaire_id || c.transitaire_id === form.transitaire_id) && (c.statut !== "REFUSEE" || c.id === form.cotation_id)
  );

  // Choix du fournisseur : ses conditions de paiement sont reprises, modifiables pour cette commande.
  function choisirFournisseur(idFournisseur) {
    maj("fournisseur_id", idFournisseur);
    const f = fournisseurs.find((x) => x.id === idFournisseur);
    setEcheancier(f && Array.isArray(f.echeancier_json) ? f.echeancier_json.map((l) => ({ ...l })) : []);
  }

  function charge() {
    return {
      ...form,
      ...(echeancier.length > 0 ? { echeancier: pourApi(echeancier) } : {}),
      cours_devise: coursNum,
      dossier_ao_id: rattachement === "AO" ? form.dossier_ao_id || null : null,
      consultation_id: rattachement === "CONSULTATION" ? form.consultation_id || null : null,
      lignes: lignes
        .filter((l) => l.designation.trim())
        .map((l) => ({
          reference_fournisseur: l.reference_fournisseur,
          designation: l.designation,
          unite: l.unite,
          quantite: num(l.quantite),
          prix_unitaire_devise: num(l.prix_unitaire_devise),
          produit_id: l.produit_id || undefined,
          calcul_offre_id: l.calcul_offre_id || undefined,
        })),
    };
  }

  async function enregistrer() {
    if (!form.fournisseur_id) {
      setErreur(t("cmdFournisseurRequis"));
      return null;
    }
    if (echeancier.length > 0 && !echeancierValide(echeancier)) {
      setErreur(t("echObligatoire"));
      return null;
    }
    const data = charge();
    if (editable && data.lignes.length === 0) {
      setErreur(t("cmdLigneRequise"));
      return null;
    }
    setErreur("");
    setInfo("");
    return id ? api.patchCommande(id, data) : api.createCommande(data);
  }

  async function handleEnregistrer() {
    setEnCours(true);
    try {
      const c = await enregistrer();
      if (!c) return;
      if (!id) router.replace(`/commandes/${c.id}`);
      else {
        appliquer(c);
        setInfo(t("cmdEnregistree"));
      }
    } catch (e) {
      setErreur(e.message);
    } finally {
      setEnCours(false);
    }
  }

  async function handleConfirmer() {
    if (!window.confirm(t("cmdConfirmerConfirm"))) return;
    setEnCours(true);
    try {
      const c = await enregistrer();
      if (!c) return;
      const confirmee2 = await api.confirmerCommande(c.id);
      if (!id) router.replace(`/commandes/${c.id}`);
      else appliquer(confirmee2);
      setInfo(t("cmdConfirmeeOk"));
    } catch (e) {
      setErreur(e.message);
    } finally {
      setEnCours(false);
    }
  }

  async function handleAnnuler() {
    if (!window.confirm(t("cmdAnnulerConfirm"))) return;
    setErreur("");
    try {
      appliquer(await api.annulerCommande(id));
    } catch (e) {
      setErreur(e.message);
    }
  }

  async function handleSupprimer() {
    if (!window.confirm(t("cmdSupprimerConfirm"))) return;
    try {
      await api.supprimerCommande(id);
      router.push("/commandes");
    } catch (e) {
      setErreur(e.message);
    }
  }

  function demarrerCorrection() {
    setErreur("");
    setInfo("");
    setMotif("");
    setModeCorrection(true);
  }

  function annulerCorrection() {
    setModeCorrection(false);
    setMotif("");
    appliquer(commande);
  }

  async function handleCorriger() {
    if (motif.trim().length < 3) {
      setErreur(t("cmdCorrMotifRequis"));
      return;
    }
    const lignesEnvoyees = lignes
      .filter((l) => l.id)
      .map((l) => (l.supprimee ? { id: l.id, supprimer: true } : { id: l.id, prix_unitaire_devise: num(l.prix_unitaire_devise), quantite: num(l.quantite) }));
    const msg = t("cmdCorrConfirm") + (commande.receptions && commande.receptions.some((r) => r.statut === "VALIDEE") ? `\n\n${t("cmdCorrAvertReceptions")}` : "");
    if (!window.confirm(msg)) return;
    setEnCours(true);
    setErreur("");
    try {
      const c = await api.corrigerCommande(id, { motif: motif.trim(), incoterm: form.incoterm, lignes: lignesEnvoyees });
      setModeCorrection(false);
      setMotif("");
      appliquer(c);
      setInfo(t("cmdCorrOk"));
    } catch (e) {
      setErreur(e.message);
    } finally {
      setEnCours(false);
    }
  }

  if (chargement) {
    return (
      <AppShell title={t("cmdTitle")} backHref="/commandes" backLabelKey="cmdRetour">
        <p style={{ fontSize: 12.5, color: "var(--sub)" }}>{t("loading")}</p>
      </AppShell>
    );
  }

  const desactiveEntete = !editable;
  const enCorrection = confirmee && modeCorrection;
  const titre = commande ? commande.numero : t("cmdNouvelle");

  return (
    <AppShell title={titre} backHref="/commandes" backLabelKey="cmdRetour">
      {erreur && <p style={{ color: "var(--brique)", fontSize: 12.5, marginBottom: 12 }}>{erreur}</p>}
      {info && <p style={{ color: "var(--vert)", fontSize: 12.5, marginBottom: 12 }}>{info}</p>}
      {commande && (
        <p style={{ fontSize: 12.5, color: "var(--sub)", marginBottom: 12 }}>
          {t(`cmdStatut${statut}`)}
          {commande.statut_reception ? ` · ${t(`cmdRec${commande.statut_reception}`)}` : ""}
          {confirmee ? ` — ${t("cmdLectureSeule")}` : ""}
        </p>
      )}

      <section className="card" style={{ marginBottom: 16 }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 12 }}>
          <div>
            <label style={labelStyle}>{t("cmdColFournisseur")}</label>
            <select disabled={desactiveEntete} value={form.fournisseur_id} onChange={(e) => choisirFournisseur(e.target.value)} style={inputStyle}>
              <option value="">—</option>
              {fournisseurs.map((f) => (
                <option key={f.id} value={f.id}>{f.nom}</option>
              ))}
            </select>
          </div>
          <div>
            <label style={labelStyle}>{t("cmdRattachement")}</label>
            <select disabled={desactiveEntete} value={rattachement} onChange={(e) => setRattachement(e.target.value)} style={inputStyle}>
              <option value="STOCK">{t("cmdRattStock")}</option>
              <option value="AO">{t("cmdRattAo")}</option>
              <option value="CONSULTATION">{t("cmdRattConsultation")}</option>
            </select>
          </div>
          {rattachement === "AO" && (
            <div>
              <label style={labelStyle}>{t("cmdRattAo")}</label>
              <select disabled={desactiveEntete} value={form.dossier_ao_id} onChange={(e) => maj("dossier_ao_id", e.target.value)} style={inputStyle}>
                <option value="">{t("cmdDossierChoisir")}</option>
                {parents.dossiers_ao.map((d) => (
                  <option key={d.id} value={d.id}>{[d.reference_externe, d.intitule].filter(Boolean).join(" · ")}</option>
                ))}
              </select>
            </div>
          )}
          {rattachement === "CONSULTATION" && (
            <div>
              <label style={labelStyle}>{t("cmdRattConsultation")}</label>
              <select disabled={desactiveEntete} value={form.consultation_id} onChange={(e) => maj("consultation_id", e.target.value)} style={inputStyle}>
                <option value="">{t("cmdDossierChoisir")}</option>
                {parents.consultations.map((c) => (
                  <option key={c.id} value={c.id}>{[c.client_nom, c.objet].filter(Boolean).join(" · ")}</option>
                ))}
              </select>
            </div>
          )}
          <div>
            <label style={labelStyle}>{t("cmdDateCommande")}</label>
            <input disabled={desactiveEntete} type="date" value={form.date_commande} onChange={(e) => maj("date_commande", e.target.value)} style={inputStyle} />
          </div>
          <div>
            <label style={labelStyle}>{t("cmdDateLivraison")}</label>
            <input type="date" value={form.date_livraison_prevue} onChange={(e) => maj("date_livraison_prevue", e.target.value)} style={inputStyle} disabled={statut === "ANNULEE"} />
          </div>
          <div>
            <label style={labelStyle}>{t("receptionsDevise")}</label>
            <input disabled={desactiveEntete} list="devises-commande" value={form.devise} onChange={(e) => maj("devise", e.target.value.toUpperCase())} style={inputStyle} />
            <datalist id="devises-commande">
              {["XOF", "EUR", "USD", "CNY", "GBP", "AED"].map((d) => (
                <option key={d} value={d} />
              ))}
            </datalist>
          </div>
          <div>
            <label style={labelStyle}>{t("receptionsCours")}</label>
            <input disabled={desactiveEntete || form.devise.trim().toUpperCase() === "XOF"} inputMode="decimal" value={form.devise.trim().toUpperCase() === "XOF" ? "1" : form.cours_devise} onChange={(e) => maj("cours_devise", e.target.value)} style={inputStyle} />
          </div>
          <div>
            <label style={labelStyle}>{t("receptionsIncoterm")}</label>
            <select disabled={desactiveEntete && !enCorrection} value={form.incoterm} onChange={(e) => maj("incoterm", e.target.value)} style={inputStyle}>
              <option value="">{t("receptionsIncotermAucun")}</option>
              {codesAvec(incoterms.codes, form.incoterm).map((i) => (
                <option key={i} value={i}>{i}</option>
              ))}
            </select>
          </div>
          <div>
            <label style={labelStyle}>{t("receptionsTransitaire")}</label>
            <select disabled={statut === "ANNULEE"} value={form.transitaire_id} onChange={(e) => setForm((f) => ({ ...f, transitaire_id: e.target.value, cotation_id: "" }))} style={inputStyle}>
              <option value="">{t("receptionsTransitaireAucun")}</option>
              {transitaires.map((tr) => (
                <option key={tr.id} value={tr.id}>{tr.nom}</option>
              ))}
            </select>
          </div>
          <div>
            <label style={labelStyle}>{t("receptionsCotation")}</label>
            <select disabled={statut === "ANNULEE"} value={form.cotation_id} onChange={(e) => maj("cotation_id", e.target.value)} style={inputStyle}>
              <option value="">{t("receptionsAucuneCotation")}</option>
              {cotationsProposees.map((c) => (
                <option key={c.id} value={c.id}>
                  {[c.transitaire_nom, c.reference, c.incoterm, `${nf(c.total_xof)} XOF`].filter(Boolean).join(" · ")}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div style={{ marginTop: 12 }}>
          <label style={labelStyle}>{t("receptionsNotes")}</label>
          <input disabled={statut === "ANNULEE"} value={form.notes} onChange={(e) => maj("notes", e.target.value)} style={inputStyle} />
        </div>
      </section>

      <section style={{ marginBottom: 16 }}>
        <EcheancierEditor sens="FOURNISSEUR" valeur={echeancier} onChange={setEcheancier} aide={t("echReprisFiche")} lectureSeule={statut === "ANNULEE"} />
      </section>

      <section className="card" style={{ marginBottom: 16 }}>
        <h2 style={h2Style}>{t("cmdLignes")}</h2>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", minWidth: confirmee || !brouillon ? 980 : 760 }}>
            <thead>
              <tr style={{ fontSize: 11, color: "var(--sub)", textAlign: "left" }}>
                <th style={{ ...th, width: 110 }}>{t("cmdColRef")}</th>
                <th style={{ ...th, minWidth: 190 }}>{t("cmdColDesignation")}</th>
                <th style={{ ...th, width: 56 }}>{t("cmdColUnite")}</th>
                <th style={{ ...th, width: 76 }}>{t("cmdColQuantite")}</th>
                <th style={{ ...th, width: 110 }}>{t("cmdColPu")}</th>
                <th style={{ ...th, width: 110, textAlign: "right" }}>{t("cmdColMontant")}</th>
                {!brouillon && <th style={{ ...th, width: 96, textAlign: "right" }}>{t("cmdColPaye")}</th>}
                {!brouillon && <th style={{ ...th, width: 76, textAlign: "right" }}>{t("cmdColRecue")}</th>}
                {!brouillon && <th style={{ ...th, width: 76, textAlign: "right" }}>{t("cmdColRestant")}</th>}
                {(editable || enCorrection) && <th style={{ width: 28 }}></th>}
              </tr>
            </thead>
            <tbody>
              {lignes.map((l, i) => (
                <tr key={i} style={{ borderTop: "1px solid var(--line-soft, var(--line))", ...(l.supprimee ? { opacity: 0.45, textDecoration: "line-through" } : {}) }}>
                  <td style={td}><input disabled={!editable} value={l.reference_fournisseur} onChange={(e) => majLigne(i, "reference_fournisseur", e.target.value)} style={inputCompact} /></td>
                  <td style={td}><input disabled={!editable} value={l.designation} onChange={(e) => majLigne(i, "designation", e.target.value)} style={inputCompact} /></td>
                  <td style={td}><input disabled={!editable} value={l.unite} onChange={(e) => majLigne(i, "unite", e.target.value)} style={inputCompact} /></td>
                  <td style={td}><input disabled={!editable && !(enCorrection && !l.supprimee)} inputMode="decimal" value={l.quantite} onChange={(e) => majLigne(i, "quantite", e.target.value)} style={inputCompact} /></td>
                  <td style={td}>
                    <input disabled={!editable && !(enCorrection && !l.supprimee)} inputMode="decimal" value={l.prix_unitaire_devise} onChange={(e) => majLigne(i, "prix_unitaire_devise", e.target.value)} style={inputCompact} />
                    {l.prix_offert_devise != null && (
                      <div style={{ fontSize: 10.5, color: "var(--sub)", marginTop: 3, whiteSpace: "nowrap" }}>
                        {t("cmdColOffert")} {nf(l.prix_offert_devise)}
                      </div>
                    )}
                  </td>
                  <td className="mono" style={{ ...td, textAlign: "right", paddingTop: 11 }}>{nf(arr2(num(l.quantite) * num(l.prix_unitaire_devise)))}</td>
                  {!brouillon && (
                    <td className="mono" style={{ ...td, textAlign: "right", paddingTop: 11 }}>
                      {l.prix_paye_devise == null ? (
                        "—"
                      ) : (
                        <>
                          {nf(l.prix_paye_devise)}
                          {num(l.prix_unitaire_devise) > 0 && Math.abs(l.prix_paye_devise - num(l.prix_unitaire_devise)) > 0.0005 && (
                            <div style={{ fontSize: 10.5, fontWeight: 600, color: l.prix_paye_devise > num(l.prix_unitaire_devise) ? "var(--brique)" : "var(--vert)" }}>
                              {l.prix_paye_devise > num(l.prix_unitaire_devise) ? "▲ +" : "▼ "}
                              {Math.round(((l.prix_paye_devise - num(l.prix_unitaire_devise)) / num(l.prix_unitaire_devise)) * 10000) / 100} %
                            </div>
                          )}
                        </>
                      )}
                    </td>
                  )}
                  {!brouillon && <td className="mono" style={{ ...td, textAlign: "right", paddingTop: 11 }}>{nf(l.quantite_recue ?? 0)}</td>}
                  {!brouillon && (
                    <td className="mono" style={{ ...td, textAlign: "right", paddingTop: 11, color: (l.quantite_restante ?? 0) > 0 ? "var(--brique)" : "var(--vert)" }}>
                      {nf(l.quantite_restante ?? 0)}
                    </td>
                  )}
                  {enCorrection && (
                    <td style={td}>
                      <button
                        type="button"
                        disabled={(l.quantite_recue ?? 0) > 0}
                        title={(l.quantite_recue ?? 0) > 0 ? t("cmdCorrLigneRecue") : t("cmdCorrSupprimerLigne")}
                        onClick={() => majLigne(i, "supprimee", !l.supprimee)}
                        style={{ ...boutonSupprimerStyle, opacity: (l.quantite_recue ?? 0) > 0 ? 0.3 : 1 }}
                      >
                        {l.supprimee ? "↺" : "×"}
                      </button>
                    </td>
                  )}
                  {editable && (
                    <td style={td}>
                      <button type="button" onClick={() => setLignes((prev) => (prev.length > 1 ? prev.filter((_, k) => k !== i) : [{ ...LIGNE_VIDE }]))} style={boutonSupprimerStyle}>×</button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {editable && (
          <button type="button" onClick={() => setLignes((prev) => [...prev, { ...LIGNE_VIDE }])} style={{ ...boutonSecondaireStyle, marginTop: 10 }}>
            {t("cmdAjouterLigne")}
          </button>
        )}
        <div style={{ marginTop: 14, marginLeft: "auto", maxWidth: 340, display: "grid", gap: 4 }}>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, fontWeight: 700 }}>
            <span>{t("cmdTotalDevise")} ({form.devise})</span>
            <span className="mono">{nf(totalDevise)}</span>
          </div>
          {coursNum !== 1 && (
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12.5, color: "var(--sub)" }}>
              <span>XOF</span>
              <span className="mono">{nf(arr2(totalDevise * coursNum))}</span>
            </div>
          )}
        </div>
      </section>

      {commande && commande.receptions && (confirmee || commande.receptions.length > 0) && (
        <section className="card" style={{ marginBottom: 16 }}>
          <h2 style={h2Style}>{t("cmdReceptions")}</h2>
          {commande.receptions.length === 0 ? (
            <p style={{ fontSize: 12.5, color: "var(--sub)" }}>{t("cmdAucuneReception")}</p>
          ) : (
            <div style={{ display: "grid", gap: 6 }}>
              {commande.receptions.map((r) => (
                <div key={r.id} style={{ display: "flex", gap: 14, fontSize: 12.5, alignItems: "center" }}>
                  <Link href={`/receptions/${r.id}`} className="mono" style={{ color: "var(--petrol)", fontWeight: 600 }}>{r.numero}</Link>
                  <span>{new Date(r.date_reception).toLocaleDateString(dict.dateLocale)}</span>
                  <span style={{ color: "var(--sub)" }}>{t(`receptionsStatut${r.statut}`)}</span>
                  <span className="mono" style={{ marginLeft: "auto" }}>{nf(r.total_xof)} XOF</span>
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      {enCorrection && (
        <section className="card" style={{ marginBottom: 16, borderLeft: "3px solid var(--ocre)" }}>
          <h2 style={h2Style}>{t("cmdCorrTitre")}</h2>
          <p style={{ fontSize: 12, color: "var(--sub)", marginTop: 0 }}>{t("cmdCorrAide")}</p>
          <label style={labelStyle}>{t("cmdCorrMotif")}</label>
          <input value={motif} onChange={(e) => setMotif(e.target.value)} placeholder={t("cmdCorrMotifPlaceholder")} style={inputStyle} />
          <div style={{ display: "flex", gap: 10, marginTop: 12 }}>
            <button type="button" disabled={enCours} onClick={handleCorriger} style={boutonPrincipalStyle}>{t("cmdCorrEnregistrer")}</button>
            <button type="button" disabled={enCours} onClick={annulerCorrection} style={boutonSecondaireStyle}>{t("cancel")}</button>
          </div>
        </section>
      )}

      {commande && commande.historique && commande.historique.length > 0 && (
        <section className="card" style={{ marginBottom: 16 }}>
          <h2 style={h2Style}>{t("cmdHistoriqueTitre")}</h2>
          <div style={{ display: "grid", gap: 14 }}>
            {commande.historique.map((h) => (
              <div key={h.id} style={{ fontSize: 12.5 }}>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "baseline" }}>
                  <strong>{new Date(h.date_correction).toLocaleString(dict.dateLocale)}</strong>
                  <span style={{ color: "var(--sub)" }}>{h.utilisateur_nom || "—"}</span>
                  <span className="mono" style={{ marginLeft: "auto", color: "var(--sub)" }}>
                    {t("cmdTotalDevise")} : {nf(h.total_avant_devise)} → {nf(h.total_apres_devise)} {commande.devise}
                  </span>
                </div>
                <div style={{ color: "var(--sub)", margin: "2px 0 4px" }}>{t("cmdCorrMotif")} : {h.motif}</div>
                <ul style={{ margin: 0, paddingLeft: 18 }}>
                  {(h.modifications || []).map((m, k) => (
                    <li key={k}>
                      {m.type === "INCOTERM" && `${t("receptionsIncoterm")} : ${m.avant || "—"} → ${m.apres || "—"}`}
                      {m.type === "PRIX" && `${m.designation} — ${t("cmdColPu")} : ${nf(m.avant)} → ${nf(m.apres)}`}
                      {m.type === "QUANTITE" && `${m.designation} — ${t("cmdColQuantite")} : ${nf(m.avant)} → ${nf(m.apres)}`}
                      {m.type === "LIGNE_SUPPRIMEE" && `${m.designation} — ${t("cmdCorrLigneSupprimee")}`}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </section>
      )}

      <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
        {confirmee && estAdmin && !modeCorrection && (
          <button type="button" onClick={demarrerCorrection} style={{ ...boutonSecondaireStyle, borderColor: "var(--ocre)", color: "var(--ocre)" }}>{t("cmdCorrBouton")}</button>
        )}
        {statut !== "ANNULEE" && !enCorrection && (
          <button type="button" disabled={enCours} onClick={handleEnregistrer} style={boutonSecondaireStyle}>{t("cmdEnregistrer")}</button>
        )}
        {brouillon && (
          <button type="button" disabled={enCours} onClick={handleConfirmer} style={boutonPrincipalStyle} title={t("cmdAideConfirmation")}>{t("cmdConfirmer")}</button>
        )}
        {confirmee && commande.statut_reception !== "COMPLETE" && (
          <Link href={`/receptions/nouvelle?commande=${commande.id}`} style={{ ...boutonPrincipalStyle, textDecoration: "none" }}>{t("cmdRecevoir")}</Link>
        )}
        {id && brouillon && (
          <button type="button" onClick={handleSupprimer} style={{ ...boutonSecondaireStyle, color: "var(--brique)" }}>{t("cmdSupprimer")}</button>
        )}
        {id && statut !== "ANNULEE" && (
          <button type="button" onClick={handleAnnuler} style={{ ...boutonSecondaireStyle, color: "var(--brique)" }}>{t("cmdAnnuler")}</button>
        )}
      </div>
    </AppShell>
  );
}

const h2Style = { fontSize: 14.5, color: "var(--petrol)", margin: "0 0 10px" };
const labelStyle = { fontSize: 11.5, fontWeight: 600, display: "block", marginBottom: 5 };
const inputStyle = { width: "100%", padding: "8px 10px", border: "1px solid var(--line)", borderRadius: 8, fontSize: 13, fontFamily: "inherit" };
const inputCompact = { width: "100%", padding: "6px 8px", border: "1px solid var(--line)", borderRadius: 6, fontSize: 12.5, fontFamily: "inherit" };
const boutonPrincipalStyle = { background: "var(--petrol)", color: "#fff", border: "none", borderRadius: 8, padding: "9px 18px", fontSize: 12.5, fontWeight: 600, cursor: "pointer" };
const boutonSecondaireStyle = { background: "transparent", color: "var(--petrol)", border: "1px solid var(--line)", borderRadius: 8, padding: "8px 14px", fontSize: 12, fontWeight: 600, cursor: "pointer" };
const boutonSupprimerStyle = { background: "transparent", border: "none", color: "var(--brique)", fontSize: 18, cursor: "pointer", lineHeight: 1 };
const th = { padding: "8px 6px", fontWeight: 600, whiteSpace: "nowrap" };
const td = { padding: "5px 6px", verticalAlign: "top" };
