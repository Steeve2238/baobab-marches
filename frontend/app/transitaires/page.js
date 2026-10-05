"use client";

import { useEffect, useState } from "react";
import { api } from "../../lib/api";
import { useLangue } from "../../lib/i18n/LanguageContext";
import AppShell from "../../lib/components/AppShell";
import { useIncoterms } from "../../lib/incoterms";
import { TYPES_COUT, REPARTITIONS } from "../../lib/receptionCouts";

// Transitaires, cotations et performance (Lot 4, 05/10/2026).
// Une cotation = l'offre d'un transitaire pour un trajet et un incoterm. Elle est
// reprise sur la reception, qui mesure ensuite l'ecart avec la facture reelle et
// alimente les delais et retards. Back : routes/transitaires.js.

const MODES = ["MER", "AIR", "ROUTE", "MIXTE", "AUTRE"];
const nf = (n) => Number(n).toLocaleString(undefined, { maximumFractionDigits: 2 });
const jour = (d) => (d ? String(d).slice(0, 10) : "");

function Pastille({ children, couleur = "var(--sub)", fond = "transparent" }) {
  return (
    <span style={{ display: "inline-block", fontSize: 10.5, fontWeight: 700, padding: "2px 8px", borderRadius: 10, color: couleur, border: `1px solid ${couleur}`, background: fond, whiteSpace: "nowrap" }}>
      {children}
    </span>
  );
}

function StatutCotation({ c, t }) {
  const couleur = c.statut === "RETENUE" ? "var(--vert)" : c.statut === "REFUSEE" ? "var(--sub)" : "var(--petrol)";
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
      <Pastille couleur={couleur}>{t(`cotStatut${c.statut}`)}</Pastille>
      {c.statut_validite === "EXPIREE" && <Pastille couleur="var(--brique)">{t("cotExpiree")}</Pastille>}
    </div>
  );
}

export default function TransitairesPage() {
  const { t } = useLangue();
  const [onglet, setOnglet] = useState("transitaires");
  const [filtreComparer, setFiltreComparer] = useState({});

  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    const o = q.get("onglet");
    if (["transitaires", "cotations", "comparer"].includes(o)) setOnglet(o);
    setFiltreComparer({ incoterm: q.get("incoterm") || "", origine: q.get("origine") || "", destination: q.get("destination") || "", mode: q.get("mode") || "" });
  }, []);

  return (
    <AppShell title={t("transTitle")}>
      <p style={{ fontSize: 12.5, color: "var(--sub)", marginBottom: 12 }}>{t("transSubtitle")}</p>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 14 }} role="tablist">
        {["transitaires", "cotations", "comparer"].map((o) => (
          <button
            key={o}
            type="button"
            role="tab"
            aria-selected={onglet === o}
            onClick={() => setOnglet(o)}
            style={{ ...boutonSecondaireStyle, ...(onglet === o ? { background: "var(--petrol)", color: "#fff", borderColor: "var(--petrol)" } : {}) }}
          >
            {t(o === "transitaires" ? "transOngletTransitaires" : o === "cotations" ? "transOngletCotations" : "transOngletComparer")}
          </button>
        ))}
      </div>
      {onglet === "transitaires" && <ListeTransitaires t={t} />}
      {onglet === "cotations" && <Cotations t={t} />}
      {onglet === "comparer" && <Comparer t={t} initial={filtreComparer} />}
    </AppShell>
  );
}

// ---------------------------------------------------------------------------
// Transitaires + fiche detaillee
// ---------------------------------------------------------------------------
function ListeTransitaires({ t }) {
  const [liste, setListe] = useState([]);
  const [erreur, setErreur] = useState("");
  const [form, setForm] = useState({ nom: "", email: "", telephone: "" });
  const [ouvert, setOuvert] = useState(null);

  const charger = () => api.getTransitairesPerf().then(setListe).catch((e) => setErreur(e.message));
  useEffect(() => {
    charger();
  }, []);

  async function ajouter(e) {
    e.preventDefault();
    setErreur("");
    try {
      await api.createTransitairePerf(form);
      setForm({ nom: "", email: "", telephone: "" });
      charger();
    } catch (err) {
      setErreur(err.message);
    }
  }

  if (ouvert) return <Fiche t={t} id={ouvert} onRetour={() => { setOuvert(null); charger(); }} />;

  return (
    <>
      {erreur && <p style={{ color: "var(--brique)", fontSize: 12.5, marginBottom: 10 }}>{erreur}</p>}
      <form onSubmit={ajouter} className="card" style={{ marginBottom: 14, display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))", gap: 12, alignItems: "end" }}>
        <div>
          <label style={labelStyle}>{t("transNom")}</label>
          <input required value={form.nom} onChange={(e) => setForm((f) => ({ ...f, nom: e.target.value }))} style={inputStyle} />
        </div>
        <div>
          <label style={labelStyle}>{t("transEmail")}</label>
          <input type="email" value={form.email} onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} style={inputStyle} />
        </div>
        <div>
          <label style={labelStyle}>{t("transTelephone")}</label>
          <input value={form.telephone} onChange={(e) => setForm((f) => ({ ...f, telephone: e.target.value }))} style={inputStyle} />
        </div>
        <button type="submit" style={boutonPrincipalStyle}>{t("transNouveau")}</button>
      </form>
      {liste.length === 0 ? (
        <p style={{ fontSize: 12.5, color: "var(--sub)" }}>{t("transAucun")}</p>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table className="card" style={{ width: "100%", borderCollapse: "collapse", minWidth: 880 }}>
            <thead>
              <tr>
                <th style={thStyle}>{t("transNom")}</th>
                <th style={{ ...thStyle, textAlign: "right" }}>{t("transExpeditions")}</th>
                <th style={{ ...thStyle, textAlign: "right" }}>{t("transDelaiMoyen")}</th>
                <th style={{ ...thStyle, textAlign: "right" }}>{t("transTauxRetard")}</th>
                <th style={{ ...thStyle, textAlign: "right" }}>{t("transCoutsFactures")}</th>
                <th style={{ ...thStyle, textAlign: "right" }}>{t("transEcartCote")}</th>
                <th style={{ ...thStyle, textAlign: "right" }}>{t("transCotationsValides")}</th>
              </tr>
            </thead>
            <tbody>
              {liste.map((tr) => (
                <tr key={tr.id} style={{ borderTop: "1px solid var(--line-soft, var(--line))" }}>
                  <td style={tdStyle}>
                    <button type="button" onClick={() => setOuvert(tr.id)} style={lienStyle}>{tr.nom}</button>
                    {!tr.actif && <span style={{ marginLeft: 8 }}><Pastille>{t("transInactif")}</Pastille></span>}
                    {(tr.email || tr.telephone) && <div style={{ fontSize: 11, color: "var(--sub)" }}>{[tr.email, tr.telephone].filter(Boolean).join(" · ")}</div>}
                  </td>
                  <td className="mono" style={{ ...tdStyle, textAlign: "right" }}>{tr.nb_expeditions}</td>
                  <td className="mono" style={{ ...tdStyle, textAlign: "right" }}>{tr.delai_moyen_jours != null ? t("transJours").replace("{n}", tr.delai_moyen_jours) : "—"}</td>
                  <td className="mono" style={{ ...tdStyle, textAlign: "right", color: tr.taux_retard_pct > 20 ? "var(--brique)" : "inherit" }}>{tr.taux_retard_pct != null ? `${tr.taux_retard_pct} %` : "—"}</td>
                  <td className="mono" style={{ ...tdStyle, textAlign: "right" }}>{nf(tr.total_couts_xof)}</td>
                  <td className="mono" style={{ ...tdStyle, textAlign: "right", color: tr.ecart_cote_reel_pct > 0 ? "var(--brique)" : tr.ecart_cote_reel_pct < 0 ? "var(--vert)" : "inherit" }}>
                    {tr.ecart_cote_reel_pct != null ? `${tr.ecart_cote_reel_pct > 0 ? "+" : ""}${tr.ecart_cote_reel_pct} %` : "—"}
                  </td>
                  <td className="mono" style={{ ...tdStyle, textAlign: "right" }}>{tr.nb_cotations_valides} / {tr.nb_cotations}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

function Fiche({ t, id, onRetour }) {
  const { dict } = useLangue();
  const [f, setF] = useState(null);
  const [edit, setEdit] = useState({});
  const [erreur, setErreur] = useState("");
  const [info, setInfo] = useState("");

  const charger = () =>
    api
      .getFicheTransitaire(id)
      .then((r) => {
        setF(r);
        setEdit({ nom: r.nom, email: r.email || "", telephone: r.telephone || "", notes: r.notes || "", actif: r.actif });
      })
      .catch((e) => setErreur(e.message));
  useEffect(() => {
    charger();
  }, [id]);

  async function enregistrer(e) {
    e.preventDefault();
    setErreur("");
    setInfo("");
    try {
      await api.patchTransitairePerf(id, edit);
      setInfo(t("cotEnregistree"));
      charger();
    } catch (err) {
      setErreur(err.message);
    }
  }

  if (!f) return <p style={{ fontSize: 12.5, color: erreur ? "var(--brique)" : "var(--sub)" }}>{erreur || "…"}</p>;

  return (
    <>
      <button type="button" onClick={onRetour} style={{ ...lienStyle, marginBottom: 12 }}>{t("transRetour")}</button>
      {erreur && <p style={{ color: "var(--brique)", fontSize: 12.5, marginBottom: 10 }}>{erreur}</p>}
      {info && <p style={{ color: "var(--vert)", fontSize: 12.5, marginBottom: 10 }}>{info}</p>}
      <form onSubmit={enregistrer} className="card" style={{ marginBottom: 14 }}>
        <h2 style={h2Style}>{t("transFicheTitre")}</h2>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))", gap: 12 }}>
          <div>
            <label style={labelStyle}>{t("transNom")}</label>
            <input required value={edit.nom} onChange={(e) => setEdit((x) => ({ ...x, nom: e.target.value }))} style={inputStyle} />
          </div>
          <div>
            <label style={labelStyle}>{t("transEmail")}</label>
            <input value={edit.email} onChange={(e) => setEdit((x) => ({ ...x, email: e.target.value }))} style={inputStyle} />
          </div>
          <div>
            <label style={labelStyle}>{t("transTelephone")}</label>
            <input value={edit.telephone} onChange={(e) => setEdit((x) => ({ ...x, telephone: e.target.value }))} style={inputStyle} />
          </div>
          <div>
            <label style={labelStyle}>{t("transNotes")}</label>
            <input value={edit.notes} onChange={(e) => setEdit((x) => ({ ...x, notes: e.target.value }))} style={inputStyle} />
          </div>
        </div>
        <div style={{ display: "flex", gap: 14, alignItems: "center", marginTop: 12 }}>
          <label style={{ fontSize: 12.5, display: "flex", gap: 6, alignItems: "center" }}>
            <input type="checkbox" checked={edit.actif} onChange={(e) => setEdit((x) => ({ ...x, actif: e.target.checked }))} />
            {t("transActif")}
          </label>
          <button type="submit" style={boutonPrincipalStyle}>{t("transEnregistrer")}</button>
        </div>
      </form>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 10, marginBottom: 14 }}>
        {[
          [t("transExpeditions"), f.nb_expeditions],
          [t("transDelaiMoyen"), f.delai_moyen_jours != null ? t("transJours").replace("{n}", f.delai_moyen_jours) : "—"],
          [t("transTauxRetard"), f.taux_retard_pct != null ? `${f.taux_retard_pct} %` : "—"],
          [t("transCoutsFactures"), nf(f.total_couts_xof)],
          [t("transEcartCote"), f.ecart_cote_reel_pct != null ? `${f.ecart_cote_reel_pct > 0 ? "+" : ""}${f.ecart_cote_reel_pct} %` : "—"],
        ].map(([label, valeur]) => (
          <div key={label} className="card">
            <div style={{ fontSize: 10, color: "var(--sub)", textTransform: "uppercase" }}>{label}</div>
            <div className="mono" style={{ fontSize: 17, fontWeight: 700, marginTop: 4 }}>{valeur}</div>
          </div>
        ))}
      </div>

      {f.couts_par_type.length > 0 && (
        <section className="card" style={{ marginBottom: 14 }}>
          <h2 style={h2Style}>{t("transCoutsParType")}</h2>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 18 }}>
            {f.couts_par_type.map((c) => (
              <div key={c.type_cout}>
                <div style={{ fontSize: 11, color: "var(--sub)" }}>{t(`receptionsCoutType${c.type_cout}`)}</div>
                <div className="mono" style={{ fontWeight: 700 }}>{nf(c.total_xof)}</div>
              </div>
            ))}
          </div>
        </section>
      )}

      <section className="card" style={{ marginBottom: 14 }}>
        <h2 style={h2Style}>{t("transExpeditionsTitre")}</h2>
        {f.expeditions.length === 0 ? (
          <p style={{ fontSize: 12.5, color: "var(--sub)" }}>{t("transAucuneExpedition")}</p>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 700 }}>
              <thead>
                <tr>
                  <th style={thStyle}>{t("transColReception")}</th>
                  <th style={thStyle}>{t("transColFournisseur")}</th>
                  <th style={thStyle}>{t("transColDate")}</th>
                  <th style={{ ...thStyle, textAlign: "right" }}>{t("transColDelai")}</th>
                  <th style={thStyle}>{t("transColRetard")}</th>
                  <th style={{ ...thStyle, textAlign: "right" }}>{t("transColCouts")}</th>
                </tr>
              </thead>
              <tbody>
                {f.expeditions.map((e) => (
                  <tr key={e.id} style={{ borderTop: "1px solid var(--line-soft, var(--line))" }}>
                    <td style={tdStyle}><a href={`/receptions/${e.id}`} className="mono" style={{ color: "var(--petrol)" }}>{e.numero}</a></td>
                    <td style={tdStyle}>{e.fournisseur_nom}</td>
                    <td style={tdStyle}>{new Date(e.date_reception).toLocaleDateString(dict.dateLocale)}</td>
                    <td className="mono" style={{ ...tdStyle, textAlign: "right" }}>{e.delai_jours != null ? t("transJours").replace("{n}", e.delai_jours) : "—"}</td>
                    <td style={tdStyle}>{e.retard === null ? "—" : e.retard ? <Pastille couleur="var(--brique)">{t("transRetardOui")}</Pastille> : <Pastille couleur="var(--vert)">{t("transRetardNon")}</Pastille>}</td>
                    <td className="mono" style={{ ...tdStyle, textAlign: "right" }}>{nf(e.couts_xof)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}

// ---------------------------------------------------------------------------
// Cotations : liste + formulaire
// ---------------------------------------------------------------------------
const COTATION_VIDE = {
  transitaire_id: "",
  reference: "",
  origine: "",
  destination: "",
  mode_transport: "MER",
  incoterm: "",
  devise: "XOF",
  cours_devise: "1",
  date_cotation: new Date().toISOString().slice(0, 10),
  date_validite: "",
  delai_jours: "",
  notes: "",
  lignes: [{ type_cout: "FRET", libelle: "", montant: "", repartition: "VALEUR" }],
};

function Cotations({ t }) {
  const incoterms = useIncoterms();
  const { dict } = useLangue();
  const [liste, setListe] = useState([]);
  const [transitaires, setTransitaires] = useState([]);
  const [edition, setEdition] = useState(null); // null | { id?, ...formulaire }
  const [erreur, setErreur] = useState("");
  const [info, setInfo] = useState("");
  const [filtre, setFiltre] = useState({ transitaire_id: "", statut: "" });

  const charger = () => {
    const params = {};
    if (filtre.transitaire_id) params.transitaire_id = filtre.transitaire_id;
    if (filtre.statut) params.statut = filtre.statut;
    return api.getCotationsTransitaires(params).then(setListe).catch((e) => setErreur(e.message));
  };
  useEffect(() => {
    api.getTransitairesPerf().then(setTransitaires).catch(() => {});
  }, []);
  useEffect(() => {
    charger();
  }, [filtre]);

  function ouvrir(c) {
    setErreur("");
    setInfo("");
    setEdition(
      c
        ? {
            id: c.id,
            transitaire_id: c.transitaire_id,
            reference: c.reference || "",
            origine: c.origine || "",
            destination: c.destination || "",
            mode_transport: c.mode_transport,
            incoterm: c.incoterm || "",
            devise: c.devise,
            cours_devise: String(c.cours_devise),
            date_cotation: jour(c.date_cotation),
            date_validite: jour(c.date_validite),
            delai_jours: c.delai_jours ?? "",
            notes: c.notes || "",
            lignes: c.lignes.map((l) => ({ type_cout: l.type_cout, libelle: l.libelle || "", montant: l.montant, repartition: l.repartition })),
          }
        : { ...COTATION_VIDE, transitaire_id: filtre.transitaire_id || "", lignes: [{ ...COTATION_VIDE.lignes[0] }] }
    );
  }

  async function enregistrer(e) {
    e.preventDefault();
    setErreur("");
    const { id, ...corps } = edition;
    corps.cours_devise = corps.devise.trim().toUpperCase() === "XOF" ? 1 : Number(String(corps.cours_devise).replace(",", "."));
    try {
      if (id) await api.patchCotationTransitaire(id, corps);
      else await api.createCotationTransitaire(corps);
      setEdition(null);
      setInfo(t("cotEnregistree"));
      charger();
    } catch (err) {
      setErreur(err.message);
    }
  }

  async function changerStatut(c, statut) {
    try {
      await api.statutCotationTransitaire(c.id, statut);
      charger();
    } catch (err) {
      setErreur(err.message);
    }
  }

  async function supprimer(c) {
    if (!window.confirm(t("cotSupprimerConfirm"))) return;
    try {
      await api.supprimerCotationTransitaire(c.id);
      charger();
    } catch (err) {
      setErreur(err.message);
    }
  }

  const maj = (champ, valeur) => setEdition((x) => ({ ...x, [champ]: valeur }));
  const majLigne = (i, champ, valeur) => setEdition((x) => ({ ...x, lignes: x.lignes.map((l, k) => (k === i ? { ...l, [champ]: valeur } : l)) }));
  const totalEdition = edition ? edition.lignes.reduce((s, l) => s + (Number(String(l.montant).replace(",", ".")) || 0), 0) : 0;

  return (
    <>
      {erreur && <p style={{ color: "var(--brique)", fontSize: 12.5, marginBottom: 10 }}>{erreur}</p>}
      {info && <p style={{ color: "var(--vert)", fontSize: 12.5, marginBottom: 10 }}>{info}</p>}

      {edition ? (
        <form onSubmit={enregistrer} className="card" style={{ marginBottom: 14 }}>
          <h2 style={h2Style}>{edition.id ? t("cotModifier") : t("cotNouvelle")}</h2>
          <p style={{ fontSize: 11.5, color: "var(--sub)", marginBottom: 12 }}>{t("cotAide")}</p>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: 12 }}>
            <div>
              <label style={labelStyle}>{t("cotTransitaire")}</label>
              <select required value={edition.transitaire_id} onChange={(e) => maj("transitaire_id", e.target.value)} style={inputStyle}>
                <option value="">—</option>
                {transitaires.map((tr) => (
                  <option key={tr.id} value={tr.id}>{tr.nom}</option>
                ))}
              </select>
            </div>
            <div>
              <label style={labelStyle}>{t("cotReference")}</label>
              <input value={edition.reference} onChange={(e) => maj("reference", e.target.value)} style={inputStyle} />
            </div>
            <div>
              <label style={labelStyle}>{t("cotOrigine")}</label>
              <input value={edition.origine} onChange={(e) => maj("origine", e.target.value)} style={inputStyle} />
            </div>
            <div>
              <label style={labelStyle}>{t("cotDestination")}</label>
              <input value={edition.destination} onChange={(e) => maj("destination", e.target.value)} style={inputStyle} />
            </div>
            <div>
              <label style={labelStyle}>{t("cotMode")}</label>
              <select value={edition.mode_transport} onChange={(e) => maj("mode_transport", e.target.value)} style={inputStyle}>
                {MODES.map((m) => (
                  <option key={m} value={m}>{t(`cotMode${m}`)}</option>
                ))}
              </select>
            </div>
            <div>
              <label style={labelStyle}>{t("cotIncoterm")}</label>
              <select value={edition.incoterm} onChange={(e) => maj("incoterm", e.target.value)} style={inputStyle}>
                <option value="">—</option>
                {incoterms.codes.map((i) => (
                  <option key={i} value={i}>{i}</option>
                ))}
              </select>
            </div>
            <div>
              <label style={labelStyle}>{t("cotDevise")}</label>
              <input list="devises-cotation" value={edition.devise} onChange={(e) => maj("devise", e.target.value.toUpperCase())} style={inputStyle} />
              <datalist id="devises-cotation">
                {["XOF", "EUR", "USD", "CNY", "GBP", "AED"].map((d) => (
                  <option key={d} value={d} />
                ))}
              </datalist>
            </div>
            <div>
              <label style={labelStyle}>{t("cotCours")}</label>
              <input disabled={edition.devise.trim().toUpperCase() === "XOF"} inputMode="decimal" value={edition.devise.trim().toUpperCase() === "XOF" ? "1" : edition.cours_devise} onChange={(e) => maj("cours_devise", e.target.value)} style={inputStyle} />
            </div>
            <div>
              <label style={labelStyle}>{t("cotDateCotation")}</label>
              <input type="date" value={edition.date_cotation} onChange={(e) => maj("date_cotation", e.target.value)} style={inputStyle} />
            </div>
            <div>
              <label style={labelStyle}>{t("cotDateValidite")}</label>
              <input type="date" value={edition.date_validite} onChange={(e) => maj("date_validite", e.target.value)} style={inputStyle} />
            </div>
            <div>
              <label style={labelStyle}>{t("cotDelai")}</label>
              <input inputMode="numeric" value={edition.delai_jours} onChange={(e) => maj("delai_jours", e.target.value)} style={inputStyle} />
            </div>
          </div>

          <h3 style={{ fontSize: 12.5, margin: "16px 0 8px" }}>{t("cotLignes")} ({edition.devise})</h3>
          <div style={{ display: "grid", gap: 8 }}>
            {edition.lignes.map((l, i) => (
              <div key={i} style={{ display: "grid", gridTemplateColumns: "180px minmax(140px, 1fr) 140px 130px 30px", gap: 8, alignItems: "center", overflowX: "auto" }}>
                <select value={l.type_cout} onChange={(e) => majLigne(i, "type_cout", e.target.value)} style={inputStyle}>
                  {TYPES_COUT.map((type) => (
                    <option key={type} value={type}>{t(`receptionsCoutType${type}`)}</option>
                  ))}
                </select>
                <input value={l.libelle} placeholder={t("receptionsCoutLibelle")} onChange={(e) => majLigne(i, "libelle", e.target.value)} style={inputStyle} />
                <input inputMode="decimal" value={l.montant} placeholder={t("receptionsCoutMontant")} onChange={(e) => majLigne(i, "montant", e.target.value)} style={inputStyle} />
                <select value={l.repartition} onChange={(e) => majLigne(i, "repartition", e.target.value)} style={inputStyle}>
                  {REPARTITIONS.map((r) => (
                    <option key={r} value={r}>{t(`receptionsRep${r}`)}</option>
                  ))}
                </select>
                <button type="button" onClick={() => setEdition((x) => ({ ...x, lignes: x.lignes.filter((_, k) => k !== i) }))} style={boutonSupprimerStyle}>×</button>
              </div>
            ))}
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center", marginTop: 10 }}>
            <button type="button" onClick={() => setEdition((x) => ({ ...x, lignes: [...x.lignes, { type_cout: "FRET", libelle: "", montant: "", repartition: "VALEUR" }] }))} style={boutonSecondaireStyle}>
              {t("cotAjouterLigne")}
            </button>
            <span style={{ flex: 1 }} />
            <span style={{ fontSize: 13, fontWeight: 700 }}>{t("cotTotal")} : <span className="mono">{nf(totalEdition)} {edition.devise}</span></span>
          </div>
          <div style={{ display: "flex", gap: 10, marginTop: 14 }}>
            <button type="submit" style={boutonPrincipalStyle}>{t("transEnregistrer")}</button>
            <button type="button" onClick={() => setEdition(null)} style={boutonSecondaireStyle}>{t("cotAnnuler")}</button>
          </div>
        </form>
      ) : (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "end", marginBottom: 14 }}>
          <button type="button" onClick={() => ouvrir(null)} style={boutonPrincipalStyle}>{t("cotNouvelle")}</button>
          <span style={{ flex: 1 }} />
          <div>
            <label style={labelStyle}>{t("cotTransitaire")}</label>
            <select value={filtre.transitaire_id} onChange={(e) => setFiltre((f) => ({ ...f, transitaire_id: e.target.value }))} style={{ ...inputStyle, minWidth: 180 }}>
              <option value="">{t("cmpTous")}</option>
              {transitaires.map((tr) => (
                <option key={tr.id} value={tr.id}>{tr.nom}</option>
              ))}
            </select>
          </div>
          <div>
            <label style={labelStyle}> </label>
            <select value={filtre.statut} onChange={(e) => setFiltre((f) => ({ ...f, statut: e.target.value }))} style={{ ...inputStyle, minWidth: 140 }}>
              <option value="">{t("cmpTous")}</option>
              {["RECUE", "RETENUE", "REFUSEE"].map((s) => (
                <option key={s} value={s}>{t(`cotStatut${s}`)}</option>
              ))}
            </select>
          </div>
        </div>
      )}

      {liste.length === 0 ? (
        <p style={{ fontSize: 12.5, color: "var(--sub)" }}>{t("cotAucune")}</p>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table className="card" style={{ width: "100%", borderCollapse: "collapse", minWidth: 940 }}>
            <thead>
              <tr>
                <th style={thStyle}>{t("cotTransitaire")}</th>
                <th style={thStyle}>{t("cotTrajet")}</th>
                <th style={thStyle}>{t("cotIncoterm")}</th>
                <th style={{ ...thStyle, textAlign: "right" }}>{t("cotTotal")} (XOF)</th>
                <th style={{ ...thStyle, textAlign: "right" }}>{t("cotDelai")}</th>
                <th style={thStyle}>{t("cotDateValidite")}</th>
                <th style={thStyle}></th>
                <th style={thStyle}></th>
              </tr>
            </thead>
            <tbody>
              {liste.map((c) => (
                <tr key={c.id} style={{ borderTop: "1px solid var(--line-soft, var(--line))", opacity: c.statut === "REFUSEE" ? 0.6 : 1 }}>
                  <td style={tdStyle}>
                    <span style={{ fontWeight: 600 }}>{c.transitaire_nom}</span>
                    {c.reference && <div style={{ fontSize: 11, color: "var(--sub)" }}>{c.reference}</div>}
                  </td>
                  <td style={tdStyle}>
                    {[c.origine, c.destination].filter(Boolean).join(" → ") || "—"}
                    <div style={{ fontSize: 11, color: "var(--sub)" }}>{t(`cotMode${c.mode_transport}`)}</div>
                  </td>
                  <td className="mono" style={tdStyle}>{c.incoterm || "—"}</td>
                  <td className="mono" style={{ ...tdStyle, textAlign: "right", fontWeight: 700 }}>
                    {nf(c.total_xof)}
                    {c.devise !== "XOF" && <div style={{ fontSize: 10.5, color: "var(--sub)", fontWeight: 400 }}>{nf(c.total_devise)} {c.devise}</div>}
                  </td>
                  <td className="mono" style={{ ...tdStyle, textAlign: "right" }}>{c.delai_jours ?? "—"}</td>
                  <td style={tdStyle}>
                    {c.date_validite ? new Date(c.date_validite).toLocaleDateString(dict.dateLocale) : t("cotSansEcheance")}
                    {c.statut_validite === "VALIDE" && c.jours_restants !== null && <div style={{ fontSize: 10.5, color: "var(--sub)" }}>{t("cotJoursRestants").replace("{n}", c.jours_restants)}</div>}
                  </td>
                  <td style={tdStyle}><StatutCotation c={c} t={t} /></td>
                  <td style={{ ...tdStyle, whiteSpace: "nowrap" }}>
                    <button type="button" onClick={() => ouvrir(c)} style={lienStyle}>{t("cotModifierBouton")}</button>
                    {c.statut !== "RETENUE" && <> · <button type="button" onClick={() => changerStatut(c, "RETENUE")} style={lienStyle}>{t("cotRetenir")}</button></>}
                    {c.statut !== "REFUSEE" && <> · <button type="button" onClick={() => changerStatut(c, "REFUSEE")} style={lienStyle}>{t("cotRefuser")}</button></>}
                    {" · "}
                    <button type="button" onClick={() => supprimer(c)} style={{ ...lienStyle, color: "var(--brique)" }}>{t("cotSupprimer")}</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Comparaison pour un trajet
// ---------------------------------------------------------------------------
function Comparer({ t, initial }) {
  const incoterms = useIncoterms();
  const [filtre, setFiltre] = useState({ origine: "", destination: "", incoterm: "", mode: "" });
  const [res, setRes] = useState(null);
  const [erreur, setErreur] = useState("");

  useEffect(() => {
    if (initial) setFiltre((f) => ({ ...f, ...initial }));
  }, [initial]);

  const lancer = () => {
    const params = {};
    Object.entries(filtre).forEach(([k, v]) => {
      if (v) params[k] = v;
    });
    api.comparerCotationsTransitaires(params).then(setRes).catch((e) => setErreur(e.message));
  };
  useEffect(() => {
    lancer();
  }, [filtre.incoterm, filtre.mode]);

  return (
    <>
      <p style={{ fontSize: 12, color: "var(--sub)", marginBottom: 10 }}>{t("cmpAide")}</p>
      {erreur && <p style={{ color: "var(--brique)", fontSize: 12.5, marginBottom: 10 }}>{erreur}</p>}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          lancer();
        }}
        className="card"
        style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 12, alignItems: "end", marginBottom: 14 }}
      >
        <div>
          <label style={labelStyle}>{t("cotOrigine")}</label>
          <input value={filtre.origine} onChange={(e) => setFiltre((f) => ({ ...f, origine: e.target.value }))} style={inputStyle} />
        </div>
        <div>
          <label style={labelStyle}>{t("cotDestination")}</label>
          <input value={filtre.destination} onChange={(e) => setFiltre((f) => ({ ...f, destination: e.target.value }))} style={inputStyle} />
        </div>
        <div>
          <label style={labelStyle}>{t("cotIncoterm")}</label>
          <select value={filtre.incoterm} onChange={(e) => setFiltre((f) => ({ ...f, incoterm: e.target.value }))} style={inputStyle}>
            <option value="">{t("cmpTous")}</option>
            {incoterms.codes.map((i) => (
              <option key={i} value={i}>{i}</option>
            ))}
          </select>
        </div>
        <div>
          <label style={labelStyle}>{t("cotMode")}</label>
          <select value={filtre.mode} onChange={(e) => setFiltre((f) => ({ ...f, mode: e.target.value }))} style={inputStyle}>
            <option value="">{t("cmpTous")}</option>
            {MODES.map((m) => (
              <option key={m} value={m}>{t(`cotMode${m}`)}</option>
            ))}
          </select>
        </div>
        <button type="submit" style={boutonPrincipalStyle}>{t("cmpFiltrer")}</button>
      </form>
      {res && res.length === 0 && <p style={{ fontSize: 12.5, color: "var(--sub)" }}>{t("cmpAucune")}</p>}
      {res && res.length > 0 && (
        <div style={{ display: "grid", gap: 10 }}>
          {res.map((c) => (
            <div key={c.id} className="card" style={{ display: "grid", gridTemplateColumns: "minmax(170px, 1.3fr) minmax(130px, 1fr) minmax(130px, 1fr) minmax(170px, 1.2fr)", gap: 14, alignItems: "start", borderColor: c.moins_chere ? "var(--vert)" : undefined }}>
              <div>
                <div style={{ fontWeight: 700, fontSize: 13.5 }}>{c.transitaire_nom}</div>
                <div style={{ fontSize: 11.5, color: "var(--sub)" }}>
                  {[c.reference, [c.origine, c.destination].filter(Boolean).join(" → "), c.incoterm].filter(Boolean).join(" · ")}
                </div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginTop: 6 }}>
                  {c.moins_chere && <Pastille couleur="var(--vert)">{t("cmpMoinsChere")}</Pastille>}
                  {c.plus_rapide && <Pastille couleur="var(--petrol)">{t("cmpPlusRapide")}</Pastille>}
                </div>
              </div>
              <div>
                <div style={miniLabelStyle}>{t("cotTotal")} (XOF)</div>
                <div className="mono" style={{ fontWeight: 700, fontSize: 15 }}>{nf(c.total_xof)}</div>
                {!c.moins_chere && c.ecart_vs_moins_chere_pct != null && (
                  <div style={{ fontSize: 11, color: "var(--brique)" }}>+{t("cmpEcartVs").replace("{p}", c.ecart_vs_moins_chere_pct)}</div>
                )}
              </div>
              <div>
                <div style={miniLabelStyle}>{t("cotDelai")}</div>
                <div className="mono" style={{ fontWeight: 700, fontSize: 15 }}>{c.delai_jours ?? "—"}</div>
                <div style={{ fontSize: 11, color: "var(--sub)" }}>
                  {c.jours_restants !== null ? t("cotJoursRestants").replace("{n}", c.jours_restants) : t("cotSansEcheance")}
                </div>
              </div>
              <div>
                <div style={miniLabelStyle}>{t("cmpFiabilite")}</div>
                {c.transitaire_nb_expeditions > 0 ? (
                  <div style={{ fontSize: 12 }}>
                    {c.transitaire_taux_retard_pct != null && <div>{t("cmpRetard").replace("{p}", c.transitaire_taux_retard_pct)}</div>}
                    {c.transitaire_ecart_cote_reel_pct != null && <div>{t("cmpEcartReel").replace("{p}", `${c.transitaire_ecart_cote_reel_pct > 0 ? "+" : ""}${c.transitaire_ecart_cote_reel_pct}`)}</div>}
                  </div>
                ) : (
                  <div style={{ fontSize: 12, color: "var(--sub)" }}>{t("cmpSansHistorique")}</div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  );
}

const h2Style = { fontSize: 14.5, color: "var(--petrol)", margin: "0 0 10px" };
const miniLabelStyle = { fontSize: 9.5, color: "var(--sub)", textTransform: "uppercase" };
const labelStyle = { fontSize: 11.5, fontWeight: 600, display: "block", marginBottom: 5 };
const inputStyle = { width: "100%", padding: "8px 10px", border: "1px solid var(--line)", borderRadius: 8, fontSize: 13, fontFamily: "inherit" };
const boutonPrincipalStyle = { background: "var(--petrol)", color: "#fff", border: "none", borderRadius: 8, padding: "9px 18px", fontSize: 12.5, fontWeight: 600, cursor: "pointer" };
const boutonSecondaireStyle = { background: "transparent", color: "var(--petrol)", border: "1px solid var(--line)", borderRadius: 8, padding: "8px 14px", fontSize: 12, fontWeight: 600, cursor: "pointer" };
const boutonSupprimerStyle = { background: "transparent", border: "none", color: "var(--brique)", fontSize: 18, cursor: "pointer", lineHeight: 1 };
const lienStyle = { background: "transparent", border: "none", color: "var(--petrol)", fontSize: 12, fontWeight: 600, cursor: "pointer", padding: 0, textDecoration: "underline" };
const thStyle = { textAlign: "left", fontSize: 11, color: "var(--sub)", padding: "10px 12px", fontWeight: 600, whiteSpace: "nowrap" };
const tdStyle = { padding: "9px 12px", verticalAlign: "top" };
