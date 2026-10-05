"use client";

import { Fragment, useEffect, useState } from "react";
import { api } from "../../../lib/api";
import { useLangue } from "../../../lib/i18n/LanguageContext";
import AppShell from "../../../lib/components/AppShell";
import ComptaSousNav from "../../../lib/components/ComptaSousNav";
import { useComptaStatut, labelStyle, inputStyle, boutonPrincipalStyle, boutonSecondaireStyle, boutonDangerStyle, thStyle, tdStyle, numStyle, formaterMontant } from "../../../lib/comptaUi";

const jour = (v) => String(v || "").slice(0, 10);
const mono = { fontFamily: "IBM Plex Mono, monospace" };

// Immobilisations et amortissements : biens (fiches), lignes de classe 2 a
// immobiliser, dotations de l'exercice (en lot) et tableau des immobilisations.
export default function ImmobilisationsPage() {
  const { t } = useLangue();
  const locale = t("dateLocale");
  const { statut } = useComptaStatut();
  const peutEcrire = !!statut?.droits?.ecriture;
  const [onglet, setOnglet] = useState("biens");
  const [erreur, setErreur] = useState("");
  const [info, setInfo] = useState("");
  const [comptes, setComptes] = useState([]);
  const [exercices, setExercices] = useState([]);
  const [exerciceId, setExerciceId] = useState("");
  const [version, setVersion] = useState(0); // incremente apres chaque ecriture pour recharger les onglets

  useEffect(() => {
    api.comptaComptes({ limit: 5000, actif: "true" }).then((c) => setComptes(c.filter((x) => [2, 6].includes(x.classe)))).catch(() => {});
    api
      .comptaExercices()
      .then((x) => {
        setExercices(x);
        const courant = x.find((e) => e.statut === "OUVERT") || x[0];
        if (courant) setExerciceId(courant.id);
      })
      .catch((e) => setErreur(e.message));
  }, []);

  const onglets = [
    ["biens", "comptaImmoOngletBiens"],
    ["aimmobiliser", "comptaImmoOngletAImmobiliser"],
    ["dotations", "comptaImmoOngletDotations"],
    ["tableau", "comptaImmoOngletTableau"],
  ];
  const props = { t, locale, comptes, exercices, exerciceId, setExerciceId, peutEcrire, setErreur, setInfo, version, recharger: () => setVersion((v) => v + 1) };

  return (
    <AppShell title={t("comptaNavImmobilisations")} subNav={<ComptaSousNav />}>
      {erreur && <p style={{ color: "var(--brique)", fontSize: 12.5, marginBottom: 12 }}>{erreur}</p>}
      {info && <p style={{ color: "var(--vert)", fontSize: 12.5, marginBottom: 12 }}>{info}</p>}
      <p style={{ fontSize: 12, color: "var(--sub)", marginBottom: 12, maxWidth: 860, lineHeight: 1.5 }}>{t("comptaImmoAide")}</p>
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
      <datalist id="comptes-immo">
        {comptes.filter((c) => c.classe === 2 && /^2[1-7]/.test(c.numero) && !/^2[89]/.test(c.numero)).map((c) => (
          <option key={c.id} value={c.numero}>{c.libelle}</option>
        ))}
      </datalist>
      <datalist id="comptes-amort">
        {comptes.filter((c) => /^28/.test(c.numero)).map((c) => (
          <option key={c.id} value={c.numero}>{c.libelle}</option>
        ))}
      </datalist>
      <datalist id="comptes-dotation">
        {comptes.filter((c) => /^68/.test(c.numero)).map((c) => (
          <option key={c.id} value={c.numero}>{c.libelle}</option>
        ))}
      </datalist>
      {onglet === "biens" && <Biens {...props} />}
      {onglet === "aimmobiliser" && <AImmobiliser {...props} />}
      {onglet === "dotations" && <Dotations {...props} />}
      {onglet === "tableau" && <Tableau {...props} />}
    </AppShell>
  );
}

// ---------------------------------------------------------------------------
// Formulaire de fiche (creation depuis une ligne, reprise manuelle, modification)
// ---------------------------------------------------------------------------
const FICHE_VIDE = {
  libelle: "",
  compte_immo_numero: "",
  valeur_origine: "",
  date_acquisition: "",
  date_mise_en_service: "",
  valeur_residuelle: "",
  amortissable: true,
  duree_mois: "60",
  compte_amort_numero: "",
  compte_dotation_numero: "",
  amort_ouverture: "",
  date_ouverture: "",
};

function FicheForm({ t, initial, ligne, ficheId, onDone, onCancel, setErreur, verrouille = false }) {
  const [f, setF] = useState({ ...FICHE_VIDE, ...initial });
  const [envoi, setEnvoi] = useState(false);
  const maj = (k, v) => setF((x) => ({ ...x, [k]: v }));
  const enReprise = !ligne && !ficheId;

  async function enregistrer(e) {
    e.preventDefault();
    setErreur("");
    setEnvoi(true);
    try {
      const body = {
        libelle: f.libelle,
        date_acquisition: f.date_acquisition || undefined,
        date_mise_en_service: f.date_mise_en_service || f.date_acquisition || undefined,
        valeur_residuelle: f.valeur_residuelle || 0,
        duree_mois: f.amortissable ? Number(f.duree_mois) || null : null,
      };
      if (f.amortissable) {
        body.compte_amort_numero = f.compte_amort_numero;
        body.compte_dotation_numero = f.compte_dotation_numero;
        if (Number(String(f.amort_ouverture).replace(",", ".")) > 0) {
          body.amort_ouverture = String(f.amort_ouverture).replace(",", ".");
          body.date_ouverture = f.date_ouverture;
        }
      }
      if (ligne) body.ligne_ecriture_id = ligne.ligne_id;
      else {
        body.compte_immo_numero = f.compte_immo_numero;
        body.valeur_origine = String(f.valeur_origine).replace(",", ".");
      }
      if (ficheId) await api.comptaImmoModifier(ficheId, { ...body, compte_immo_numero: f.compte_immo_numero, valeur_origine: String(f.valeur_origine).replace(",", ".") });
      else await api.comptaImmoCreer(body);
      onDone();
    } catch (err) {
      setErreur(err.message);
    } finally {
      setEnvoi(false);
    }
  }

  const champ = (cle, libelle, extra = {}) => (
    <div style={{ minWidth: extra.largeur || 150, flex: extra.flex || "0 0 auto" }}>
      <label style={labelStyle}>{t(libelle)}</label>
      <input
        value={f[cle]}
        onChange={(e) => maj(cle, e.target.value)}
        type={extra.type || "text"}
        inputMode={extra.decimal ? "decimal" : undefined}
        list={extra.list}
        disabled={extra.disabled || (verrouille && cle !== "libelle")}
        required={extra.required}
        style={{ ...inputStyle, ...(extra.mono ? mono : {}), ...(extra.decimal ? { textAlign: "right" } : {}), ...(extra.disabled || (verrouille && cle !== "libelle") ? { background: "var(--line-soft)" } : {}) }}
      />
    </div>
  );

  return (
    <form onSubmit={enregistrer} className="card" style={{ marginBottom: 14, borderColor: "var(--petrol)" }}>
      <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 10 }}>{ficheId ? t("comptaImmoModifierFiche") : ligne ? t("comptaImmoCreerDepuisLigne") : t("comptaImmoNouvelleReprise")}</div>
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "flex-end" }}>
        {champ("libelle", "comptaImmoLibelle", { largeur: 260, flex: "1 1 260px", required: true })}
        {champ("compte_immo_numero", "comptaImmoCompte", { list: "comptes-immo", mono: true, disabled: !!ligne, required: true, largeur: 130 })}
        {champ("valeur_origine", "comptaImmoValeurOrigine", { decimal: true, disabled: !!ligne, required: true, largeur: 140 })}
        {champ("date_acquisition", "comptaImmoDateAcquisition", { type: "date", required: true, largeur: 150 })}
        {champ("date_mise_en_service", "comptaImmoDateService", { type: "date", largeur: 150 })}
      </div>
      <label style={{ fontSize: 12.5, display: "flex", gap: 6, alignItems: "center", margin: "12px 0 8px" }}>
        <input type="checkbox" checked={f.amortissable} disabled={verrouille} onChange={(e) => maj("amortissable", e.target.checked)} />
        {t("comptaImmoAmortissable")}
      </label>
      {f.amortissable && (
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "flex-end" }}>
          {champ("duree_mois", "comptaImmoDureeMois", { decimal: true, largeur: 110, required: true })}
          {champ("valeur_residuelle", "comptaImmoResiduelle", { decimal: true, largeur: 130 })}
          {champ("compte_amort_numero", "comptaImmoCompteAmort", { list: "comptes-amort", mono: true, largeur: 130, required: true })}
          {champ("compte_dotation_numero", "comptaImmoCompteDotation", { list: "comptes-dotation", mono: true, largeur: 130, required: true })}
          {champ("amort_ouverture", "comptaImmoAmortOuverture", { decimal: true, largeur: 150 })}
          {champ("date_ouverture", "comptaImmoDateSituation", { type: "date", largeur: 150 })}
        </div>
      )}
      {f.amortissable && <p style={{ fontSize: 11.5, color: "var(--sub)", margin: "8px 0 0", maxWidth: 820 }}>{t("comptaImmoAideReprise")}</p>}
      <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
        <button type="submit" disabled={envoi} style={boutonPrincipalStyle}>{t("comptaEnregistrer")}</button>
        <button type="button" onClick={onCancel} style={boutonSecondaireStyle}>{t("comptaAnnuler")}</button>
      </div>
      {enReprise && <p style={{ fontSize: 11.5, color: "var(--ocre)", margin: "8px 0 0" }}>{t("comptaImmoRepriseAttention")}</p>}
      {verrouille && <p style={{ fontSize: 11.5, color: "var(--ocre)", margin: "8px 0 0" }}>{t("comptaImmoSeulLibelle")}</p>}
    </form>
  );
}

// ---------------------------------------------------------------------------
// Onglet "Biens"
// ---------------------------------------------------------------------------
function Biens({ t, locale, peutEcrire, setErreur, setInfo, version, recharger }) {
  const [liste, setListe] = useState(null);
  const [statutFiltre, setStatutFiltre] = useState("");
  const [q, setQ] = useState("");
  const [forme, setForme] = useState(null); // null | { mode: 'reprise' } | { mode: 'modifier', fiche }
  const [sortie, setSortie] = useState(null); // fiche en cours de sortie
  const [detail, setDetail] = useState(null);
  const m = (v) => formaterMontant(v, locale, true);

  async function charger() {
    try {
      const p = {};
      if (statutFiltre) p.statut = statutFiltre;
      if (q) p.q = q;
      setListe(await api.comptaImmobilisations(p));
    } catch (e) {
      setErreur(e.message);
    }
  }
  useEffect(() => {
    charger();
  }, [version, statutFiltre]); // eslint-disable-line react-hooks/exhaustive-deps

  async function supprimer(f) {
    if (!window.confirm(`${t("comptaImmoConfirmerSuppression")} ${f.code} ?`)) return;
    setErreur("");
    try {
      await api.comptaImmoSupprimer(f.id);
      setInfo(t("comptaImmoSupprimee"));
      recharger();
    } catch (e) {
      setErreur(e.message);
    }
  }
  async function annulerSortie(f) {
    setErreur("");
    try {
      await api.comptaImmoAnnulerSortie(f.id);
      setInfo(t("comptaImmoSortieAnnulee"));
      recharger();
    } catch (e) {
      setErreur(e.message);
    }
  }
  async function voir(f) {
    if (detail?.id === f.id) return setDetail(null);
    try {
      setDetail(await api.comptaImmoDetail(f.id));
    } catch (e) {
      setErreur(e.message);
    }
  }

  return (
    <>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end", marginBottom: 12 }}>
        <div>
          <label style={labelStyle}>{t("comptaImmoStatut")}</label>
          <select value={statutFiltre} onChange={(e) => setStatutFiltre(e.target.value)} style={{ ...inputStyle, width: 160 }}>
            <option value="">{t("comptaImmoTous")}</option>
            <option value="EN_SERVICE">{t("comptaImmoEnService")}</option>
            <option value="SORTIE">{t("comptaImmoSortie")}</option>
          </select>
        </div>
        <div>
          <label style={labelStyle}>{t("comptaRechercher")}</label>
          <input value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === "Enter" && charger()} style={{ ...inputStyle, width: 200 }} />
        </div>
        <button style={boutonSecondaireStyle} onClick={charger}>{t("comptaAfficher")}</button>
        {peutEcrire && <button style={boutonPrincipalStyle} onClick={() => setForme({ mode: "reprise" })}>+ {t("comptaImmoNouvelleReprise")}</button>}
      </div>
      {forme?.mode === "reprise" && (
        <FicheForm t={t} setErreur={setErreur} onCancel={() => setForme(null)} onDone={() => { setForme(null); setInfo(t("comptaImmoCreee")); recharger(); }} />
      )}
      {forme?.mode === "modifier" && (
        <FicheForm
          t={t}
          setErreur={setErreur}
          ficheId={forme.fiche.id}
          verrouille={!forme.fiche.modifiable}
          initial={{
            libelle: forme.fiche.libelle,
            compte_immo_numero: forme.fiche.compte_immo_numero,
            valeur_origine: String(forme.fiche.valeur_origine),
            date_acquisition: jour(forme.fiche.date_acquisition),
            date_mise_en_service: jour(forme.fiche.date_mise_en_service),
            valeur_residuelle: forme.fiche.valeur_residuelle ? String(forme.fiche.valeur_residuelle) : "",
            amortissable: forme.fiche.amortissable,
            duree_mois: forme.fiche.duree_mois ? String(forme.fiche.duree_mois) : "60",
            compte_amort_numero: forme.fiche.compte_amort_numero || "",
            compte_dotation_numero: forme.fiche.compte_dotation_numero || "",
            amort_ouverture: forme.fiche.amort_ouverture ? String(forme.fiche.amort_ouverture) : "",
            date_ouverture: jour(forme.fiche.date_ouverture),
          }}
          onCancel={() => setForme(null)}
          onDone={() => { setForme(null); setInfo(t("comptaImmoModifiee")); recharger(); }}
        />
      )}
      {sortie && <SortieForm t={t} fiche={sortie} setErreur={setErreur} onCancel={() => setSortie(null)} onDone={(r) => { setSortie(null); setInfo(`${t("comptaImmoSortieOk")} — ${t("comptaImmoPlusMoinsValue")} : ${formaterMontant(r.plus_ou_moins_value, locale)}`); recharger(); }} locale={locale} />}
      <div className="card" style={{ padding: 0, overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 900 }}>
          <thead>
            <tr>
              <th style={thStyle}>{t("comptaImmoCode")}</th>
              <th style={thStyle}>{t("comptaImmoLibelle")}</th>
              <th style={thStyle}>{t("comptaImmoCompte")}</th>
              <th style={thStyle}>{t("comptaImmoDateService")}</th>
              <th style={{ ...thStyle, ...numStyle }}>{t("comptaImmoValeurOrigine")}</th>
              <th style={{ ...thStyle, ...numStyle }}>{t("comptaImmoAmortComptabilise")}</th>
              <th style={{ ...thStyle, ...numStyle }}>{t("comptaImmoVnc")}</th>
              <th style={thStyle}>{t("comptaImmoStatut")}</th>
              <th style={thStyle}></th>
            </tr>
          </thead>
          <tbody>
            {(liste || []).map((f) => (
              <Fragment key={f.id}>
                <tr>
                  <td style={{ ...tdStyle, ...mono }}>{f.code}</td>
                  <td style={tdStyle}>
                    <button onClick={() => voir(f)} style={{ border: "none", background: "transparent", color: "var(--petrol)", fontWeight: 600, padding: 0, textAlign: "left", fontSize: 12.5 }}>{f.libelle}</button>
                    <div style={{ fontSize: 11, color: "var(--sub)" }}>{f.amortissable ? `${f.duree_mois} ${t("comptaImmoMois")}` : t("comptaImmoNonAmortissable")}</div>
                  </td>
                  <td style={{ ...tdStyle, ...mono }}>{f.compte_immo_numero}</td>
                  <td style={tdStyle}>{jour(f.date_mise_en_service)}</td>
                  <td style={{ ...tdStyle, ...numStyle }}>{m(f.valeur_origine)}</td>
                  <td style={{ ...tdStyle, ...numStyle }}>{m(f.amort_comptabilise)}</td>
                  <td style={{ ...tdStyle, ...numStyle }}>{formaterMontant(f.vnc_comptable, locale)}</td>
                  <td style={tdStyle}>
                    {f.statut === "SORTIE" ? (
                      <span style={{ color: "var(--ocre)", fontWeight: 600 }}>{f.type_sortie === "CESSION" ? t("comptaImmoCede") : t("comptaImmoRebut")} {jour(f.date_sortie)}</span>
                    ) : (
                      t("comptaImmoEnService")
                    )}
                  </td>
                  <td style={{ ...tdStyle, whiteSpace: "nowrap" }}>
                    {peutEcrire && f.statut === "EN_SERVICE" && (
                      <>
                        <button style={boutonSecondaireStyle} onClick={() => setForme({ mode: "modifier", fiche: f })} title={f.modifiable ? "" : t("comptaImmoSeulLibelle")}>{t("comptaModifier")}</button>{" "}
                        <button style={boutonSecondaireStyle} onClick={() => setSortie(f)}>{t("comptaImmoSortir")}</button>{" "}
                        {f.modifiable && <button style={boutonDangerStyle} onClick={() => supprimer(f)}>{t("comptaSupprimer")}</button>}
                      </>
                    )}
                    {peutEcrire && f.statut === "SORTIE" && <button style={boutonSecondaireStyle} onClick={() => annulerSortie(f)}>{t("comptaImmoAnnulerSortie")}</button>}
                  </td>
                </tr>
                {detail?.id === f.id && (
                  <tr>
                    <td colSpan={9} style={{ ...tdStyle, background: "var(--line-soft)" }}>
                      <div style={{ display: "flex", gap: 28, flexWrap: "wrap", fontSize: 12 }}>
                        <div>
                          <div style={{ fontWeight: 700 }}>{t("comptaImmoAmortissement")}</div>
                          <div>{t("comptaImmoCompteAmort")} : <span style={mono}>{detail.compte_amort_numero || "—"}</span></div>
                          <div>{t("comptaImmoCompteDotation")} : <span style={mono}>{detail.compte_dotation_numero || "—"}</span></div>
                          <div>{t("comptaImmoResiduelle")} : {formaterMontant(detail.valeur_residuelle, locale)}</div>
                          {detail.date_ouverture && <div>{t("comptaImmoAmortOuverture")} : {formaterMontant(detail.amort_ouverture, locale)} ({jour(detail.date_ouverture)})</div>}
                          {detail.cumul_theorique !== null && <div>{t("comptaImmoCumulTheorique")} : {formaterMontant(detail.cumul_theorique, locale)}</div>}
                        </div>
                        <div>
                          <div style={{ fontWeight: 700 }}>{t("comptaImmoHistoriqueDotations")}</div>
                          {detail.dotations.length === 0 && <div style={{ color: "var(--sub)" }}>—</div>}
                          {detail.dotations.map((d, i) => (
                            <div key={i}>{d.exercice_libelle}{d.nature === "SORTIE" ? ` (${t("comptaImmoSortie")})` : ""} : {formaterMontant(d.montant, locale)} <span style={{ color: "var(--sub)" }}>[{d.ecriture_statut || "—"}]</span></div>
                          ))}
                        </div>
                        {detail.statut === "SORTIE" && (
                          <div>
                            <div style={{ fontWeight: 700 }}>{t("comptaImmoSortie")}</div>
                            <div>{t("comptaImmoVnc")} : {formaterMontant(detail.vnc_sortie, locale)}</div>
                            {detail.produit_cession !== null && <div>{t("comptaImmoProduitCession")} : {formaterMontant(detail.produit_cession, locale)}</div>}
                            <div>{t("comptaImmoPlusMoinsValue")} : {formaterMontant((detail.produit_cession || 0) - (detail.vnc_sortie || 0), locale)}</div>
                          </div>
                        )}
                      </div>
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
            {liste && liste.length === 0 && (
              <tr>
                <td colSpan={9} style={{ ...tdStyle, color: "var(--sub)", textAlign: "center", padding: 20 }}>{t("comptaImmoAucune")}</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}

function SortieForm({ t, fiche, onDone, onCancel, setErreur, locale }) {
  const [type, setType] = useState("CESSION");
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [prix, setPrix] = useState("");
  const [contrepartie, setContrepartie] = useState("");
  const [envoi, setEnvoi] = useState(false);
  async function valider(e) {
    e.preventDefault();
    setErreur("");
    setEnvoi(true);
    try {
      const body = { type_sortie: type, date_sortie: date };
      if (type === "CESSION") {
        body.produit_cession = String(prix).replace(",", ".");
        if (contrepartie) body.compte_contrepartie_numero = contrepartie;
      }
      onDone(await api.comptaImmoSortie(fiche.id, body));
    } catch (err) {
      setErreur(err.message);
    } finally {
      setEnvoi(false);
    }
  }
  return (
    <form onSubmit={valider} className="card" style={{ marginBottom: 14, borderColor: "var(--ocre)" }}>
      <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 10 }}>{t("comptaImmoSortirBien")} — {fiche.code} {fiche.libelle} ({t("comptaImmoVnc")} {formaterMontant(fiche.vnc_comptable, locale)})</div>
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "flex-end" }}>
        <div>
          <label style={labelStyle}>{t("comptaImmoTypeSortie")}</label>
          <select value={type} onChange={(e) => setType(e.target.value)} style={{ ...inputStyle, width: 170 }}>
            <option value="CESSION">{t("comptaImmoCession")}</option>
            <option value="REBUT">{t("comptaImmoMiseRebut")}</option>
          </select>
        </div>
        <div>
          <label style={labelStyle}>{t("comptaImmoDateSortie")}</label>
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} required style={{ ...inputStyle, width: 150 }} />
        </div>
        {type === "CESSION" && (
          <>
            <div>
              <label style={labelStyle}>{t("comptaImmoPrixCession")}</label>
              <input inputMode="decimal" value={prix} onChange={(e) => setPrix(e.target.value)} required style={{ ...inputStyle, width: 150, textAlign: "right" }} />
            </div>
            <div>
              <label style={labelStyle}>{t("comptaImmoContrepartie")}</label>
              <input value={contrepartie} onChange={(e) => setContrepartie(e.target.value.replace(/\D/g, ""))} placeholder="485…" style={{ ...inputStyle, width: 130, ...mono }} />
            </div>
          </>
        )}
        <button type="submit" disabled={envoi} style={boutonPrincipalStyle}>{t("comptaImmoGenererSortie")}</button>
        <button type="button" onClick={onCancel} style={boutonSecondaireStyle}>{t("comptaAnnuler")}</button>
      </div>
      <p style={{ fontSize: 11.5, color: "var(--sub)", margin: "8px 0 0", maxWidth: 820 }}>{t("comptaImmoAideSortie")}</p>
    </form>
  );
}

// ---------------------------------------------------------------------------
// Onglet "A immobiliser"
// ---------------------------------------------------------------------------
function AImmobiliser({ t, locale, peutEcrire, setErreur, setInfo, version, recharger }) {
  const [lignes, setLignes] = useState(null);
  const [avecIgnorees, setAvecIgnorees] = useState(false);
  const [creation, setCreation] = useState(null);
  const m = (v) => formaterMontant(v, locale);

  async function charger() {
    try {
      setLignes(await api.comptaImmoAImmobiliser(avecIgnorees ? { inclure_ignorees: "true" } : {}));
    } catch (e) {
      setErreur(e.message);
    }
  }
  useEffect(() => {
    charger();
  }, [version, avecIgnorees]); // eslint-disable-line react-hooks/exhaustive-deps

  async function ignorer(l, ignorer = true) {
    setErreur("");
    try {
      await api.comptaImmoIgnorerLigne(l.ligne_id, ignorer);
      recharger();
    } catch (e) {
      setErreur(e.message);
    }
  }

  function ouvrir(l) {
    const s = l.suggestion;
    setCreation({
      ligne: l,
      initial: {
        libelle: l.libelle || "",
        compte_immo_numero: l.compte_numero,
        valeur_origine: String(l.montant),
        date_acquisition: jour(l.date),
        date_mise_en_service: jour(l.date),
        amortissable: s.amortissable,
        duree_mois: s.duree_mois ? String(s.duree_mois) : "60",
        compte_amort_numero: s.compte_amort_numero || "",
        compte_dotation_numero: s.compte_dotation_numero || "",
        date_ouverture: l.a_nouveaux ? jour(s.date_ouverture) : "",
      },
    });
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  return (
    <>
      <p style={{ fontSize: 12, color: "var(--sub)", marginBottom: 10, maxWidth: 860, lineHeight: 1.5 }}>{t("comptaImmoAImmobiliserAide")}</p>
      <label style={{ fontSize: 12, display: "flex", gap: 6, alignItems: "center", marginBottom: 10 }}>
        <input type="checkbox" checked={avecIgnorees} onChange={(e) => setAvecIgnorees(e.target.checked)} />
        {t("comptaImmoVoirIgnorees")}
      </label>
      {creation && (
        <FicheForm
          t={t}
          setErreur={setErreur}
          ligne={creation.ligne}
          initial={creation.initial}
          onCancel={() => setCreation(null)}
          onDone={() => { setCreation(null); setInfo(t("comptaImmoCreee")); recharger(); }}
        />
      )}
      <div className="card" style={{ padding: 0, overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 760 }}>
          <thead>
            <tr>
              <th style={thStyle}>{t("comptaImmoDate")}</th>
              <th style={thStyle}>{t("comptaImmoCompte")}</th>
              <th style={thStyle}>{t("comptaImmoLibelle")}</th>
              <th style={{ ...thStyle, ...numStyle }}>{t("comptaImmoMontant")}</th>
              <th style={thStyle}></th>
            </tr>
          </thead>
          <tbody>
            {(lignes || []).map((l) => (
              <tr key={l.ligne_id} style={l.ignoree ? { opacity: 0.55 } : undefined}>
                <td style={tdStyle}>{jour(l.date)}</td>
                <td style={tdStyle}>
                  <span style={mono}>{l.compte_numero}</span>
                  <div style={{ fontSize: 11, color: "var(--sub)" }}>{l.compte_libelle}</div>
                </td>
                <td style={tdStyle}>
                  {l.libelle}
                  <div style={{ fontSize: 11, color: "var(--sub)" }}>
                    {l.numero_piece || ""} {l.a_nouveaux ? `— ${t("comptaImmoANouveaux")}` : ""} {l.statut === "EN_INSTANCE" ? `— ${t("comptaStatutEnInstance")}` : ""}
                  </div>
                </td>
                <td style={{ ...tdStyle, ...numStyle }}>{m(l.montant)}</td>
                <td style={{ ...tdStyle, whiteSpace: "nowrap" }}>
                  {peutEcrire && !l.ignoree && <button style={boutonPrincipalStyle} onClick={() => ouvrir(l)}>{t("comptaImmoCreerFiche")}</button>}{" "}
                  {peutEcrire && (l.ignoree ? <button style={boutonSecondaireStyle} onClick={() => ignorer(l, false)}>{t("comptaImmoRestaurer")}</button> : <button style={boutonSecondaireStyle} onClick={() => ignorer(l, true)}>{t("comptaImmoIgnorer")}</button>)}
                </td>
              </tr>
            ))}
            {lignes && lignes.length === 0 && (
              <tr>
                <td colSpan={5} style={{ ...tdStyle, color: "var(--sub)", textAlign: "center", padding: 20 }}>{t("comptaImmoRienAImmobiliser")}</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// Onglet "Dotations"
// ---------------------------------------------------------------------------
function Dotations({ t, locale, exercices, exerciceId, setExerciceId, peutEcrire, setErreur, setInfo, version, recharger }) {
  const [data, setData] = useState(null);
  const [envoi, setEnvoi] = useState(false);
  const m = (v) => formaterMontant(v, locale, true);

  async function charger() {
    if (!exerciceId) return;
    try {
      setData(await api.comptaImmoApercuDotations({ exercice_id: exerciceId }));
    } catch (e) {
      setErreur(e.message);
      setData(null);
    }
  }
  useEffect(() => {
    charger();
  }, [exerciceId, version]); // eslint-disable-line react-hooks/exhaustive-deps

  async function generer() {
    setErreur("");
    setInfo("");
    setEnvoi(true);
    try {
      const r = await api.comptaImmoGenererDotations(exerciceId);
      setInfo(r.statut === "RIEN_A_GENERER" ? t("comptaImmoRienAGenerer") : `${t("comptaImmoDotationsGenerees")} : ${r.nombre} — ${formaterMontant(r.total, locale)}`);
      recharger();
    } catch (e) {
      setErreur(e.message);
    } finally {
      setEnvoi(false);
    }
  }
  async function annuler() {
    if (!window.confirm(t("comptaImmoConfirmerAnnulerDotations"))) return;
    setErreur("");
    try {
      await api.comptaImmoAnnulerDotations(exerciceId);
      setInfo(t("comptaImmoDotationsAnnulees"));
      recharger();
    } catch (e) {
      setErreur(e.message);
    }
  }

  const aGenerer = data?.nombre_a_generer || 0;
  const dejaPassees = (data?.lignes || []).some((l) => l.deja_comptabilisee);
  return (
    <>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end", marginBottom: 12 }}>
        <div>
          <label style={labelStyle}>{t("comptaExercice")}</label>
          <select value={exerciceId} onChange={(e) => setExerciceId(e.target.value)} style={{ ...inputStyle, width: 180 }}>
            {exercices.map((x) => (
              <option key={x.id} value={x.id}>{x.libelle}</option>
            ))}
          </select>
        </div>
        {peutEcrire && (
          <button style={{ ...boutonPrincipalStyle, opacity: aGenerer > 0 ? 1 : 0.5 }} disabled={envoi || aGenerer === 0 || data?.exercice.statut === "CLOTURE"} onClick={generer}>
            {t("comptaImmoCalculerDotations")}
          </button>
        )}
        {peutEcrire && dejaPassees && <button style={boutonDangerStyle} onClick={annuler}>{t("comptaImmoAnnulerDotations")}</button>}
      </div>
      <p style={{ fontSize: 12, color: "var(--sub)", marginBottom: 10, maxWidth: 860, lineHeight: 1.5 }}>{t("comptaImmoDotationsAide")}</p>
      <div className="card" style={{ padding: 0, overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 760 }}>
          <thead>
            <tr>
              <th style={thStyle}>{t("comptaImmoCode")}</th>
              <th style={thStyle}>{t("comptaImmoLibelle")}</th>
              <th style={thStyle}>{t("comptaImmoCompteAmort")}</th>
              <th style={{ ...thStyle, ...numStyle }}>{t("comptaImmoDotationExercice")}</th>
              <th style={thStyle}>{t("comptaImmoStatut")}</th>
            </tr>
          </thead>
          <tbody>
            {(data?.lignes || []).map((l) => (
              <tr key={l.immobilisation_id}>
                <td style={{ ...tdStyle, ...mono }}>{l.code}</td>
                <td style={tdStyle}>{l.libelle}</td>
                <td style={{ ...tdStyle, ...mono }}>{l.compte_amort_numero}</td>
                <td style={{ ...tdStyle, ...numStyle }}>{m(l.montant)}</td>
                <td style={tdStyle}>
                  {l.sortie ? <span style={{ color: "var(--ocre)" }}>{t("comptaImmoSortie")}</span> : l.deja_comptabilisee ? <span style={{ color: "var(--vert)", fontWeight: 600 }}>{t("comptaImmoDejaPassee")}</span> : l.montant > 0 ? t("comptaImmoAGenerer") : "—"}
                </td>
              </tr>
            ))}
            {data && data.lignes.length === 0 && (
              <tr>
                <td colSpan={5} style={{ ...tdStyle, color: "var(--sub)", textAlign: "center", padding: 20 }}>{t("comptaImmoAucuneDotation")}</td>
              </tr>
            )}
          </tbody>
          {data && data.lignes.length > 0 && (
            <tfoot>
              <tr>
                <td colSpan={3} style={{ ...tdStyle, fontWeight: 700 }}>{t("comptaImmoTotalAGenerer")}</td>
                <td style={{ ...tdStyle, ...numStyle, fontWeight: 700 }}>{formaterMontant(data.total_a_generer, locale)}</td>
                <td style={tdStyle}></td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// Onglet "Tableau"
// ---------------------------------------------------------------------------
function Tableau({ t, locale, exercices, exerciceId, setExerciceId, setErreur, version }) {
  const [data, setData] = useState(null);
  const [instance, setInstance] = useState(false);
  const m = (v) => formaterMontant(v, locale, true);

  async function charger() {
    if (!exerciceId) return;
    setErreur("");
    try {
      const p = { exercice_id: exerciceId };
      if (instance) p.inclure_instance = "1";
      setData(await api.comptaImmoTableau(p));
    } catch (e) {
      setErreur(e.message);
      setData(null);
    }
  }
  useEffect(() => {
    charger();
  }, [exerciceId, instance, version]); // eslint-disable-line react-hooks/exhaustive-deps

  async function exporter(format) {
    try {
      const p = { exercice_id: exerciceId };
      if (instance) p.inclure_instance = "1";
      await api.comptaExporter("immobilisations/tableau", format, p);
    } catch (e) {
      setErreur(e.message);
    }
  }

  const COLS = ["brut_debut", "acquisitions", "sorties", "brut_fin", "amort_debut", "dotations", "amort_sorties", "amort_fin", "vnc_fin"];
  const cellules = (o, style) => COLS.map((c) => (
    <td key={c} style={{ ...tdStyle, ...numStyle, ...style }}>{m(o[c])}</td>
  ));
  const c = data?.controle;
  const okBrut = c && Math.abs(c.ecart_brut) < 0.005;
  const okAmort = c && Math.abs(c.ecart_amort) < 0.005;

  return (
    <>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end", marginBottom: 12 }}>
        <div>
          <label style={labelStyle}>{t("comptaExercice")}</label>
          <select value={exerciceId} onChange={(e) => setExerciceId(e.target.value)} style={{ ...inputStyle, width: 180 }}>
            {exercices.map((x) => (
              <option key={x.id} value={x.id}>{x.libelle}</option>
            ))}
          </select>
        </div>
        <label style={{ fontSize: 12, display: "flex", gap: 6, alignItems: "center", paddingBottom: 8 }}>
          <input type="checkbox" checked={instance} onChange={(e) => setInstance(e.target.checked)} />
          {t("comptaInclureInstance")}
        </label>
        <button style={boutonSecondaireStyle} onClick={() => exporter("pdf")}>PDF</button>
        <button style={boutonSecondaireStyle} onClick={() => exporter("xlsx")}>Excel</button>
      </div>
      {data && (
        <>
          <div className="card" style={{ padding: 0, overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 1100 }}>
              <thead>
                <tr>
                  <th style={thStyle}>{t("comptaImmoCompte")}</th>
                  <th style={thStyle}>{t("comptaImmoLibelle")}</th>
                  <th style={{ ...thStyle, ...numStyle }}>{t("comptaImmoBrutDebut")}</th>
                  <th style={{ ...thStyle, ...numStyle }}>{t("comptaImmoAcquisitions")}</th>
                  <th style={{ ...thStyle, ...numStyle }}>{t("comptaImmoSorties")}</th>
                  <th style={{ ...thStyle, ...numStyle }}>{t("comptaImmoBrutFin")}</th>
                  <th style={{ ...thStyle, ...numStyle }}>{t("comptaImmoAmortDebut")}</th>
                  <th style={{ ...thStyle, ...numStyle }}>{t("comptaImmoDotations")}</th>
                  <th style={{ ...thStyle, ...numStyle }}>{t("comptaImmoAmortSortis")}</th>
                  <th style={{ ...thStyle, ...numStyle }}>{t("comptaImmoAmortFin")}</th>
                  <th style={{ ...thStyle, ...numStyle }}>{t("comptaImmoVncFin")}</th>
                </tr>
              </thead>
              <tbody>
                {data.groupes.map((g) => (
                  <Fragment key={g.groupe}>
                    <tr style={{ background: "var(--line-soft)" }}>
                      <td style={{ ...tdStyle, ...mono, fontWeight: 700 }}>{g.groupe}</td>
                      <td style={{ ...tdStyle, fontWeight: 700 }}>{g.libelle}</td>
                      {cellules(g, { fontWeight: 700 })}
                    </tr>
                    {g.lignes.map((l) => (
                      <tr key={l.immobilisation_id}>
                        <td style={{ ...tdStyle, ...mono, fontSize: 11.5, color: "var(--sub)" }}>{l.code}</td>
                        <td style={{ ...tdStyle, paddingLeft: 20 }}>{l.libelle}{l.statut === "SORTIE" ? ` (${t("comptaImmoSortie").toLowerCase()})` : ""}</td>
                        {cellules(l)}
                      </tr>
                    ))}
                  </Fragment>
                ))}
                {data.groupes.length === 0 && (
                  <tr>
                    <td colSpan={11} style={{ ...tdStyle, color: "var(--sub)", textAlign: "center", padding: 20 }}>{t("comptaImmoAucune")}</td>
                  </tr>
                )}
              </tbody>
              {data.groupes.length > 0 && (
                <tfoot>
                  <tr>
                    <td colSpan={2} style={{ ...tdStyle, fontWeight: 700 }}>{t("comptaImmoTotal")}</td>
                    {cellules(data.totaux, { fontWeight: 700 })}
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
          <div className="card" style={{ marginTop: 14, borderColor: okBrut && okAmort ? "var(--vert)" : "var(--ocre)" }}>
            <div style={{ fontSize: 12.5, fontWeight: 700, marginBottom: 6, color: okBrut && okAmort ? "var(--vert)" : "var(--ocre)" }}>{t("comptaImmoControle")}</div>
            <div style={{ fontSize: 12.5, lineHeight: 1.7 }}>
              {t("comptaImmoControleBrut")} : {formaterMontant(c.brut_fiches, locale)} / {formaterMontant(c.brut_comptabilite, locale)} — {t("comptaImmoEcart")} {formaterMontant(c.ecart_brut, locale)}
              <br />
              {t("comptaImmoControleAmort")} : {formaterMontant(c.amort_fiches, locale)} / {formaterMontant(c.amort_comptabilite, locale)} — {t("comptaImmoEcart")} {formaterMontant(c.ecart_amort, locale)}
            </div>
            {!(okBrut && okAmort) && <p style={{ fontSize: 12, color: "var(--sub)", margin: "6px 0 0" }}>{t("comptaImmoControleAide")}</p>}
          </div>
        </>
      )}
    </>
  );
}
