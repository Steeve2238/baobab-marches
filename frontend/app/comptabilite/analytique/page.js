"use client";

import { Fragment, useEffect, useState } from "react";
import Link from "next/link";
import { api } from "../../../lib/api";
import { useLangue } from "../../../lib/i18n/LanguageContext";
import AppShell from "../../../lib/components/AppShell";
import ComptaSousNav from "../../../lib/components/ComptaSousNav";
import { useComptaStatut, labelStyle, inputStyle, boutonPrincipalStyle, boutonSecondaireStyle, thStyle, tdStyle, numStyle, formaterMontant } from "../../../lib/comptaUi";

const jour = (v) => String(v || "").slice(0, 10);

// Comptabilite analytique par dossier : resultat de chaque dossier (AO,
// consultation restreinte, affaire libre), gestion des sections et ecran
// "A ventiler" pour rattacher les lignes de charges / produits restantes.
export default function AnalytiquePage() {
  const { t } = useLangue();
  const locale = t("dateLocale");
  const { statut } = useComptaStatut();
  const peutEcrire = !!statut?.droits?.ecriture;
  const [onglet, setOnglet] = useState("resultats");
  const [erreur, setErreur] = useState("");
  const [info, setInfo] = useState("");
  const [sections, setSections] = useState([]);

  async function chargerSections() {
    try {
      setSections(await api.comptaAnalytiqueSections());
    } catch (e) {
      setErreur(e.message);
    }
  }
  useEffect(() => {
    chargerSections();
  }, []);

  const onglets = [
    ["resultats", "comptaAnaOngletResultats"],
    ["dossiers", "comptaAnaOngletDossiers"],
    ["aventiler", "comptaAnaOngletAVentiler"],
  ];

  return (
    <AppShell title={t("comptaAnaTitre")} subNav={<ComptaSousNav />}>
      {erreur && <p style={{ color: "var(--brique)", fontSize: 12.5, marginBottom: 12 }}>{erreur}</p>}
      {info && <p style={{ color: "var(--vert)", fontSize: 12.5, marginBottom: 12 }}>{info}</p>}
      <p style={{ fontSize: 12, color: "var(--sub)", marginBottom: 12, maxWidth: 820, lineHeight: 1.5 }}>{t("comptaAnaAide")}</p>
      <div style={{ display: "flex", gap: 6, marginBottom: 14, flexWrap: "wrap" }} role="tablist">
        {onglets.map(([c, cle]) => (
          <button
            key={c}
            role="tab"
            aria-selected={onglet === c}
            onClick={() => {
              setOnglet(c);
              setErreur("");
              setInfo("");
            }}
            style={{ ...boutonSecondaireStyle, ...(onglet === c ? { background: "var(--petrol)", color: "#fff", borderColor: "var(--petrol)" } : {}) }}
          >
            {t(cle)}
          </button>
        ))}
      </div>
      {onglet === "resultats" && <Resultats t={t} locale={locale} setErreur={setErreur} />}
      {onglet === "dossiers" && <Dossiers t={t} locale={locale} sections={sections} recharger={chargerSections} peutEcrire={peutEcrire} setErreur={setErreur} setInfo={setInfo} />}
      {onglet === "aventiler" && <AVentiler t={t} locale={locale} sections={sections} peutEcrire={peutEcrire} setErreur={setErreur} setInfo={setInfo} recharger={chargerSections} />}
    </AppShell>
  );
}

// ---------------------------------------------------------------------------
// Resultat par dossier + detail par compte + grand livre analytique
// ---------------------------------------------------------------------------
function Resultats({ t, locale, setErreur }) {
  const [f, setF] = useState({ exercice_id: "", date_debut: "", date_fin: "", inclure_instance: false });
  const [exercices, setExercices] = useState([]);
  const [data, setData] = useState(null);
  const [chargement, setChargement] = useState(false);
  const [sel, setSel] = useState(null); // { section, detail, grandLivre }
  const [glOuvert, setGlOuvert] = useState(false);

  const params = (courant = f, extra = {}) => {
    const p = { ...extra };
    for (const [k, v] of Object.entries(courant)) if (v) p[k] = v === true ? "1" : v;
    return p;
  };

  async function afficher(courant = f) {
    setErreur("");
    setSel(null);
    setGlOuvert(false);
    setChargement(true);
    try {
      setData(await api.comptaAnalytiqueResultats(params(courant)));
    } catch (e) {
      setErreur(e.message);
      setData(null);
    } finally {
      setChargement(false);
    }
  }

  useEffect(() => {
    api
      .comptaExercices()
      .then((x) => {
        setExercices(x);
        const courant = x.find((e) => e.statut === "OUVERT") || x[0];
        const n = courant ? { ...f, exercice_id: courant.id } : f;
        setF(n);
        afficher(n);
      })
      .catch((e) => setErreur(e.message));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function ouvrir(ligne) {
    if (sel?.section.section_id === ligne.section_id) {
      setSel(null);
      setGlOuvert(false);
      return;
    }
    setErreur("");
    setGlOuvert(false);
    try {
      const detail = await api.comptaAnalytiqueDossier(params(f, { section_id: ligne.section_id }));
      setSel({ section: ligne, detail, grandLivre: null });
    } catch (e) {
      setErreur(e.message);
    }
  }

  async function basculerGrandLivre() {
    if (glOuvert) return setGlOuvert(false);
    try {
      const gl = sel.grandLivre || (await api.comptaAnalytiqueGrandLivre(params(f, { section_id: sel.section.section_id })));
      setSel((s) => ({ ...s, grandLivre: gl }));
      setGlOuvert(true);
    } catch (e) {
      setErreur(e.message);
    }
  }

  async function exporter(etat, format, extra = {}) {
    setErreur("");
    try {
      await api.comptaExporter(etat, format, params(f, extra));
    } catch (e) {
      setErreur(e.message);
    }
  }

  const m = (v) => formaterMontant(v, locale, true);
  const mm = (v) => formaterMontant(v, locale);
  const pct = (v) => (v === null || v === undefined ? "" : `${Number(v).toLocaleString(locale, { maximumFractionDigits: 1 })} %`);
  const couleurResultat = (v) => (Number(v) < 0 ? "var(--brique)" : Number(v) > 0 ? "var(--vert)" : undefined);
  const ctl = data?.controle;
  const ecartOk = ctl && Number(ctl.ecart_charges) === 0 && Number(ctl.ecart_produits) === 0;

  return (
    <>
      <div className="card" style={{ marginBottom: 14, display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end" }}>
        <div>
          <label style={labelStyle}>{t("comptaExercice")}</label>
          <select value={f.exercice_id} onChange={(e) => setF({ ...f, exercice_id: e.target.value, date_debut: "", date_fin: "" })} style={{ ...inputStyle, width: 160 }}>
            {exercices.map((x) => (
              <option key={x.id} value={x.id}>{x.libelle}</option>
            ))}
          </select>
        </div>
        <div>
          <label style={labelStyle}>{t("comptaAnaDateDu")}</label>
          <input type="date" value={f.date_debut} onChange={(e) => setF({ ...f, date_debut: e.target.value })} style={{ ...inputStyle, width: 145 }} />
        </div>
        <div>
          <label style={labelStyle}>{t("comptaAnaDateAu")}</label>
          <input type="date" value={f.date_fin} onChange={(e) => setF({ ...f, date_fin: e.target.value })} style={{ ...inputStyle, width: 145 }} />
        </div>
        <label style={{ fontSize: 12, display: "flex", gap: 6, alignItems: "center", paddingBottom: 8 }}>
          <input type="checkbox" checked={f.inclure_instance} onChange={(e) => setF({ ...f, inclure_instance: e.target.checked })} />
          {t("comptaInclureInstance")}
        </label>
        <button style={boutonPrincipalStyle} onClick={() => afficher()}>{t("comptaAfficher")}</button>
        <button style={boutonSecondaireStyle} onClick={() => exporter("analytique/resultats", "pdf")} disabled={!data}>PDF</button>
        <button style={boutonSecondaireStyle} onClick={() => exporter("analytique/resultats", "xlsx")} disabled={!data}>Excel</button>
      </div>
      {chargement && <p style={{ fontSize: 12.5, color: "var(--sub)" }}>{t("loading")}</p>}
      {data && (
        <>
          <div className="card" style={{ padding: 0, overflowX: "auto", marginBottom: 12 }}>
            <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 760 }}>
              <thead>
                <tr>
                  <th style={thStyle}>{t("comptaAnaCode")}</th>
                  <th style={thStyle}>{t("comptaAnaLibelle")}</th>
                  <th style={thStyle}>{t("comptaAnaType")}</th>
                  <th style={{ ...thStyle, textAlign: "right" }}>{t("comptaAnaProduits")}</th>
                  <th style={{ ...thStyle, textAlign: "right" }}>{t("comptaAnaCharges")}</th>
                  <th style={{ ...thStyle, textAlign: "right" }}>{t("comptaAnaResultat")}</th>
                  <th style={{ ...thStyle, textAlign: "right" }}>{t("comptaAnaMarge")}</th>
                </tr>
              </thead>
              <tbody>
                {data.lignes.length === 0 && (
                  <tr>
                    <td colSpan={7} style={{ ...tdStyle, color: "var(--sub)" }}>{t("comptaAnaAucunDossier")}</td>
                  </tr>
                )}
                {data.lignes.map((l) => {
                  const ouvert = sel?.section.section_id === l.section_id;
                  return (
                    <Fragment key={l.section_id}>
                      <tr onClick={() => ouvrir(l)} style={{ cursor: "pointer", background: ouvert ? "var(--line-soft)" : undefined, opacity: l.actif ? 1 : 0.6 }}>
                        <td style={{ ...tdStyle, fontFamily: "IBM Plex Mono, monospace", fontWeight: 600 }}>{l.code}</td>
                        <td style={tdStyle}>{l.libelle}</td>
                        <td style={{ ...tdStyle, fontSize: 11.5, color: "var(--sub)" }}>{t(`comptaAnaType${l.type_section}`)}</td>
                        <td style={{ ...tdStyle, ...numStyle }}>{m(l.produits)}</td>
                        <td style={{ ...tdStyle, ...numStyle }}>{m(l.charges)}</td>
                        <td style={{ ...tdStyle, ...numStyle, fontWeight: 700, color: couleurResultat(l.resultat) }}>{mm(l.resultat)}</td>
                        <td style={{ ...tdStyle, ...numStyle }}>{pct(l.marge_pct)}</td>
                      </tr>
                      {ouvert && (
                        <tr>
                          <td colSpan={7} style={{ ...tdStyle, background: "var(--line-soft)", padding: 14 }}>
                            <DetailDossier t={t} locale={locale} sel={sel} glOuvert={glOuvert} basculerGrandLivre={basculerGrandLivre} fermer={() => { setSel(null); setGlOuvert(false); }} exporter={exporter} sectionId={l.section_id} />
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
                <tr>
                  <td colSpan={3} style={{ ...tdStyle, fontStyle: "italic" }}>{t("comptaAnaNonAffecte")}</td>
                  <td style={{ ...tdStyle, ...numStyle }}>{m(data.non_affecte.produits)}</td>
                  <td style={{ ...tdStyle, ...numStyle }}>{m(data.non_affecte.charges)}</td>
                  <td style={{ ...tdStyle, ...numStyle, color: couleurResultat(data.non_affecte.resultat) }}>{mm(data.non_affecte.resultat)}</td>
                  <td style={tdStyle}></td>
                </tr>
                <tr style={{ background: "var(--line-soft)", fontWeight: 600 }}>
                  <td colSpan={3} style={tdStyle}>{t("comptaAnaTotalDossiers")}</td>
                  <td style={{ ...tdStyle, ...numStyle }}>{mm(data.totaux.produits_dossiers)}</td>
                  <td style={{ ...tdStyle, ...numStyle }}>{mm(data.totaux.charges_dossiers)}</td>
                  <td style={{ ...tdStyle, ...numStyle }}>{mm(data.totaux.resultat_dossiers)}</td>
                  <td style={tdStyle}></td>
                </tr>
                <tr style={{ background: "var(--line)", fontWeight: 700 }}>
                  <td colSpan={3} style={tdStyle}>{t("comptaAnaTotalGeneral")}</td>
                  <td style={{ ...tdStyle, ...numStyle }}>{mm(data.totaux.produits)}</td>
                  <td style={{ ...tdStyle, ...numStyle }}>{mm(data.totaux.charges)}</td>
                  <td style={{ ...tdStyle, ...numStyle }}>{mm(data.totaux.resultat)}</td>
                  <td style={tdStyle}></td>
                </tr>
              </tbody>
            </table>
          </div>
          <p style={{ fontSize: 12, color: ecartOk ? "var(--vert)" : "var(--brique)", marginBottom: 6 }}>
            {ecartOk ? t("comptaAnaControleOk") : `${t("comptaAnaControleKo")} ${mm(ctl.ecart_charges)} — ${t("comptaAnaControleKoProduits")} ${mm(ctl.ecart_produits)}`}
          </p>
          {data.lignes.length > 0 && <p style={{ fontSize: 11.5, color: "var(--sub)" }}>{t("comptaAnaVoirDetail")}</p>}
        </>
      )}
    </>
  );
}

function DetailDossier({ t, locale, sel, glOuvert, basculerGrandLivre, fermer, exporter, sectionId }) {
  const d = sel.detail;
  const mm = (v) => formaterMontant(v, locale);
  const bloc = (titre, lignes, total, cleTotal) => (
    <div style={{ flex: "1 1 320px", minWidth: 280 }}>
      <div style={{ fontWeight: 700, fontSize: 12.5, marginBottom: 6 }}>{titre}</div>
      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <tbody>
          {lignes.map((x) => (
            <tr key={x.numero}>
              <td style={{ ...tdStyle, fontFamily: "IBM Plex Mono, monospace", width: 90 }}>{x.numero}</td>
              <td style={tdStyle}>{x.libelle}</td>
              <td style={{ ...tdStyle, ...numStyle }}>{mm(x.montant)}</td>
            </tr>
          ))}
          <tr style={{ fontWeight: 700 }}>
            <td colSpan={2} style={tdStyle}>{t(cleTotal)}</td>
            <td style={{ ...tdStyle, ...numStyle }}>{mm(total)}</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
  return (
    <div>
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginBottom: 10 }}>
        <strong>{t("comptaAnaDetailTitre")} {d.section.code}</strong>
        <span style={{ color: "var(--sub)", fontSize: 12 }}>{d.section.libelle}</span>
        <span style={{ flex: 1 }} />
        <button style={boutonSecondaireStyle} onClick={basculerGrandLivre}>{glOuvert ? t("comptaAnaMasquerGrandLivre") : t("comptaAnaGrandLivreDossier")}</button>
        <button style={boutonSecondaireStyle} onClick={() => exporter("analytique/dossier", "pdf", { section_id: sectionId })}>PDF</button>
        <button style={boutonSecondaireStyle} onClick={() => exporter("analytique/dossier", "xlsx", { section_id: sectionId })}>Excel</button>
        <button style={boutonSecondaireStyle} onClick={fermer}>{t("comptaAnaFermer")}</button>
      </div>
      <div style={{ display: "flex", gap: 24, flexWrap: "wrap" }}>
        {bloc(t("comptaAnaProduits"), d.produits, d.total_produits, "comptaAnaTotalProduits")}
        {bloc(t("comptaAnaCharges"), d.charges, d.total_charges, "comptaAnaTotalCharges")}
      </div>
      <p style={{ fontWeight: 700, margin: "10px 0 0", color: Number(d.resultat) < 0 ? "var(--brique)" : "var(--vert)" }}>
        {t("comptaAnaResultat")} : {mm(d.resultat)}
        {d.marge_pct !== null && d.marge_pct !== undefined ? ` (${Number(d.marge_pct).toLocaleString(locale, { maximumFractionDigits: 1 })} %)` : ""}
      </p>
      {glOuvert && sel.grandLivre && (
        <div style={{ marginTop: 12, overflowX: "auto" }}>
          <div style={{ display: "flex", gap: 8, marginBottom: 6, alignItems: "center" }}>
            <strong style={{ fontSize: 12.5 }}>{t("comptaAnaGrandLivreDossier")}</strong>
            <button style={boutonSecondaireStyle} onClick={() => exporter("analytique/grand-livre", "pdf", { section_id: sectionId })}>PDF</button>
            <button style={boutonSecondaireStyle} onClick={() => exporter("analytique/grand-livre", "xlsx", { section_id: sectionId })}>Excel</button>
          </div>
          <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 760, background: "#fff" }}>
            <thead>
              <tr>
                <th style={thStyle}>{t("comptaDate")}</th>
                <th style={thStyle}>{t("comptaJournal")}</th>
                <th style={thStyle}>{t("comptaPiece")}</th>
                <th style={thStyle}>{t("comptaAnaCompte")}</th>
                <th style={thStyle}>{t("comptaLibelle")}</th>
                <th style={{ ...thStyle, textAlign: "right" }}>{t("comptaDebit")}</th>
                <th style={{ ...thStyle, textAlign: "right" }}>{t("comptaCredit")}</th>
              </tr>
            </thead>
            <tbody>
              {sel.grandLivre.lignes.map((l) => (
                <tr key={`${l.ligne_id}`}>
                  <td style={{ ...tdStyle, whiteSpace: "nowrap" }}>{l.date}</td>
                  <td style={tdStyle}>{l.journal}</td>
                  <td style={tdStyle}>{l.piece}</td>
                  <td style={{ ...tdStyle, fontFamily: "IBM Plex Mono, monospace" }}>{l.compte_numero}</td>
                  <td style={tdStyle}>
                    <Link href={`/comptabilite/ecritures/${l.ecriture_id}`} style={{ color: "var(--petrol)" }}>{l.libelle}</Link>
                    {l.statut !== "VALIDEE" && <span style={{ marginLeft: 6, fontSize: 10.5, color: "var(--ocre)" }}>({t("comptaStatutEnInstance")})</span>}
                  </td>
                  <td style={{ ...tdStyle, ...numStyle }}>{formaterMontant(l.debit, locale, true)}</td>
                  <td style={{ ...tdStyle, ...numStyle }}>{formaterMontant(l.credit, locale, true)}</td>
                </tr>
              ))}
              <tr style={{ fontWeight: 700, background: "var(--line)" }}>
                <td colSpan={5} style={tdStyle}>{t("comptaAnaSolde")} : {mm(sel.grandLivre.totaux.solde)}</td>
                <td style={{ ...tdStyle, ...numStyle }}>{mm(sel.grandLivre.totaux.debit)}</td>
                <td style={{ ...tdStyle, ...numStyle }}>{mm(sel.grandLivre.totaux.credit)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Gestion des sections (dossiers)
// ---------------------------------------------------------------------------
function Dossiers({ t, locale, sections, recharger, peutEcrire, setErreur, setInfo }) {
  const [nouveau, setNouveau] = useState({ code: "", libelle: "" });
  const [edition, setEdition] = useState(null); // { id, libelle }

  async function creer() {
    setErreur("");
    setInfo("");
    try {
      await api.comptaAnalytiqueCreerSection({ code: nouveau.code.trim() || undefined, libelle: nouveau.libelle.trim() });
      setNouveau({ code: "", libelle: "" });
      setInfo(t("comptaAnaAffaireCreee"));
      recharger();
    } catch (e) {
      setErreur(e.message);
    }
  }

  async function modifier(id, patch) {
    setErreur("");
    setInfo("");
    try {
      await api.comptaAnalytiqueModifierSection(id, patch);
      setEdition(null);
      recharger();
    } catch (e) {
      setErreur(e.message);
    }
  }

  return (
    <>
      <p style={{ fontSize: 12, color: "var(--sub)", marginBottom: 12 }}>{t("comptaAnaAutoAide")}</p>
      {peutEcrire && (
        <div className="card" style={{ marginBottom: 14, display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end" }}>
          <div>
            <label style={labelStyle}>{t("comptaAnaCodeFacultatif")}</label>
            <input value={nouveau.code} onChange={(e) => setNouveau({ ...nouveau, code: e.target.value.toUpperCase() })} style={{ ...inputStyle, width: 200, fontFamily: "IBM Plex Mono, monospace" }} maxLength={20} />
          </div>
          <div style={{ flex: "1 1 260px" }}>
            <label style={labelStyle}>{t("comptaAnaNouvelleAffaire")}</label>
            <input value={nouveau.libelle} onChange={(e) => setNouveau({ ...nouveau, libelle: e.target.value })} style={inputStyle} placeholder={t("comptaAnaLibelle")} />
          </div>
          <button style={{ ...boutonPrincipalStyle, opacity: nouveau.libelle.trim() ? 1 : 0.5 }} disabled={!nouveau.libelle.trim()} onClick={creer}>{t("comptaAnaCreer")}</button>
        </div>
      )}
      <div className="card" style={{ padding: 0, overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 680 }}>
          <thead>
            <tr>
              <th style={thStyle}>{t("comptaAnaCode")}</th>
              <th style={thStyle}>{t("comptaAnaLibelle")}</th>
              <th style={thStyle}>{t("comptaAnaType")}</th>
              <th style={{ ...thStyle, textAlign: "right" }}>{t("comptaAnaNbLignes")}</th>
              <th style={thStyle}></th>
              <th style={thStyle}></th>
            </tr>
          </thead>
          <tbody>
            {sections.length === 0 && (
              <tr>
                <td colSpan={6} style={{ ...tdStyle, color: "var(--sub)" }}>{t("comptaAnaAucunDossier")}</td>
              </tr>
            )}
            {sections.map((s) => (
              <tr key={s.id} style={{ opacity: s.actif ? 1 : 0.6 }}>
                <td style={{ ...tdStyle, fontFamily: "IBM Plex Mono, monospace", fontWeight: 600 }}>{s.code}</td>
                <td style={tdStyle}>
                  {edition?.id === s.id ? (
                    <div style={{ display: "flex", gap: 6 }}>
                      <input value={edition.libelle} onChange={(e) => setEdition({ ...edition, libelle: e.target.value })} style={inputStyle} />
                      <button style={boutonPrincipalStyle} disabled={!edition.libelle.trim()} onClick={() => modifier(s.id, { libelle: edition.libelle.trim() })}>{t("comptaAnaEnregistrer")}</button>
                      <button style={boutonSecondaireStyle} onClick={() => setEdition(null)}>{t("comptaAnnuler")}</button>
                    </div>
                  ) : (
                    s.libelle
                  )}
                </td>
                <td style={{ ...tdStyle, fontSize: 11.5, color: "var(--sub)" }}>{t(`comptaAnaType${s.type_section}`)}</td>
                <td style={{ ...tdStyle, ...numStyle }}>{s.nb_lignes}</td>
                <td style={tdStyle}>
                  <span style={{ fontSize: 11, fontWeight: 700, padding: "2px 9px", borderRadius: 20, color: s.actif ? "var(--vert)" : "var(--sub)", background: s.actif ? "rgba(46,125,91,0.12)" : "rgba(91,106,108,0.12)" }}>
                    {s.actif ? t("comptaAnaActif") : t("comptaAnaInactif")}
                  </span>
                </td>
                <td style={{ ...tdStyle, whiteSpace: "nowrap" }}>
                  {peutEcrire && (
                    <>
                      {s.type_section === "LIBRE" && edition?.id !== s.id && (
                        <button style={{ ...boutonSecondaireStyle, marginRight: 6 }} onClick={() => setEdition({ id: s.id, libelle: s.libelle })}>{t("comptaAnaRenommer")}</button>
                      )}
                      <button style={boutonSecondaireStyle} onClick={() => modifier(s.id, { actif: !s.actif })}>{s.actif ? t("comptaAnaDesactiver") : t("comptaAnaActiver")}</button>
                    </>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// Lignes de charges / produits a ventiler
// ---------------------------------------------------------------------------
function AVentiler({ t, locale, sections, peutEcrire, setErreur, setInfo, recharger }) {
  const [lignes, setLignes] = useState(null);
  const [choisies, setChoisies] = useState(new Set());
  const [cible, setCible] = useState("");
  const [cibleLigne, setCibleLigne] = useState({}); // ligne.id -> section_id
  const [occupe, setOccupe] = useState(false);

  async function charger() {
    setErreur("");
    try {
      setLignes(await api.comptaAnalytiqueAVentiler());
      setChoisies(new Set());
    } catch (e) {
      setErreur(e.message);
    }
  }
  useEffect(() => {
    charger();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const actives = sections.filter((s) => s.actif);
  const m = (v) => formaterMontant(v, locale);

  async function ventiler(ids, sectionId) {
    if (!sectionId || ids.length === 0) return;
    setErreur("");
    setInfo("");
    setOccupe(true);
    try {
      const r = await api.comptaAnalytiqueVentilerLot({ ligne_ids: ids, section_id: sectionId });
      setInfo(`${r.lignes} ${t("comptaAnaVentileesN")}`);
      await charger();
      recharger();
    } catch (e) {
      setErreur(e.message);
    } finally {
      setOccupe(false);
    }
  }

  async function heritage() {
    setErreur("");
    setInfo("");
    setOccupe(true);
    try {
      const r = await api.comptaAnalytiqueHeritageVentes();
      setInfo(`${t("comptaAnaHeritageFait")} ${r.lignes}`);
      await charger();
    } catch (e) {
      setErreur(e.message);
    } finally {
      setOccupe(false);
    }
  }

  const bascule = (id) =>
    setChoisies((c) => {
      const n = new Set(c);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  return (
    <>
      <p style={{ fontSize: 12, color: "var(--sub)", marginBottom: 12, maxWidth: 820, lineHeight: 1.5 }}>{t("comptaAnaAVentilerAide")}</p>
      {peutEcrire && (
        <div className="card" style={{ marginBottom: 14, display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end" }}>
          <div style={{ minWidth: 260 }}>
            <label style={labelStyle}>{t("comptaAnaDossier")}</label>
            <select value={cible} onChange={(e) => setCible(e.target.value)} style={inputStyle}>
              <option value="">{t("comptaChoisir")}</option>
              {actives.map((s) => (
                <option key={s.id} value={s.id}>{s.code} — {s.libelle}</option>
              ))}
            </select>
          </div>
          <button style={{ ...boutonPrincipalStyle, opacity: cible && choisies.size ? 1 : 0.5 }} disabled={!cible || choisies.size === 0 || occupe} onClick={() => ventiler(Array.from(choisies), cible)}>
            {t("comptaAnaVentilerSelection")} ({choisies.size})
          </button>
          <span style={{ flex: 1 }} />
          <button style={boutonSecondaireStyle} disabled={occupe} onClick={heritage} title={t("comptaAnaHeritageAide")}>{t("comptaAnaHeritage")}</button>
        </div>
      )}
      {lignes && lignes.length === 0 && <p style={{ fontSize: 12.5, color: "var(--sub)" }}>{t("comptaAnaAucuneAVentiler")}</p>}
      {lignes && lignes.length > 0 && (
        <div className="card" style={{ padding: 0, overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 900 }}>
            <thead>
              <tr>
                <th style={{ ...thStyle, width: 30 }}>
                  <input type="checkbox" aria-label={t("comptaAnaTout")} checked={choisies.size === lignes.length} onChange={(e) => setChoisies(e.target.checked ? new Set(lignes.map((l) => l.id)) : new Set())} />
                </th>
                <th style={thStyle}>{t("comptaDate")}</th>
                <th style={thStyle}>{t("comptaJournal")}</th>
                <th style={thStyle}>{t("comptaPiece")}</th>
                <th style={thStyle}>{t("comptaAnaCompte")}</th>
                <th style={thStyle}>{t("comptaLibelle")}</th>
                <th style={{ ...thStyle, textAlign: "right" }}>{t("comptaDebit")}</th>
                <th style={{ ...thStyle, textAlign: "right" }}>{t("comptaCredit")}</th>
                <th style={{ ...thStyle, textAlign: "right" }}>{t("comptaAnaRestant")}</th>
                {peutEcrire && <th style={thStyle}>{t("comptaAnaDossier")}</th>}
              </tr>
            </thead>
            <tbody>
              {lignes.map((l) => (
                <tr key={l.id}>
                  <td style={tdStyle}><input type="checkbox" checked={choisies.has(l.id)} onChange={() => bascule(l.id)} /></td>
                  <td style={{ ...tdStyle, whiteSpace: "nowrap" }}>{jour(l.date_ecriture)}</td>
                  <td style={tdStyle}>{l.journal_code}</td>
                  <td style={tdStyle}>{l.numero_piece || ""}</td>
                  <td style={tdStyle}><span style={{ fontFamily: "IBM Plex Mono, monospace" }}>{l.compte_numero}</span><div style={{ fontSize: 11, color: "var(--sub)" }}>{l.compte_libelle}</div></td>
                  <td style={tdStyle}>
                    <Link href={`/comptabilite/ecritures/${l.ecriture_id}`} style={{ color: "var(--petrol)" }}>{l.ligne_libelle || l.ecriture_libelle}</Link>
                    {l.statut !== "VALIDEE" && <span style={{ marginLeft: 6, fontSize: 10.5, color: "var(--ocre)" }}>({t("comptaStatutEnInstance")})</span>}
                  </td>
                  <td style={{ ...tdStyle, ...numStyle }}>{formaterMontant(l.debit, locale, true)}</td>
                  <td style={{ ...tdStyle, ...numStyle }}>{formaterMontant(l.credit, locale, true)}</td>
                  <td style={{ ...tdStyle, ...numStyle, fontWeight: 700 }}>{m(l.restant)}</td>
                  {peutEcrire && (
                    <td style={{ ...tdStyle, whiteSpace: "nowrap" }}>
                      <select value={cibleLigne[l.id] || ""} onChange={(e) => setCibleLigne({ ...cibleLigne, [l.id]: e.target.value })} style={{ ...inputStyle, width: 170, padding: "5px 8px", fontSize: 12 }}>
                        <option value="">{t("comptaChoisir")}</option>
                        {actives.map((s) => (
                          <option key={s.id} value={s.id}>{s.code} — {s.libelle}</option>
                        ))}
                      </select>{" "}
                      <button style={boutonSecondaireStyle} disabled={!cibleLigne[l.id] || occupe} onClick={() => ventiler([l.id], cibleLigne[l.id])}>{t("comptaAnaVentiler")}</button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
