"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "../../lib/api";
import { useLangue } from "../../lib/i18n/LanguageContext";
import AppShell from "../../lib/components/AppShell";
import { labelStyle, inputStyle, boutonPrincipalStyle, boutonSecondaireStyle, boutonDangerStyle, thStyle, tdStyle, numStyle } from "../../lib/comptaUi";

const fmt = (n) => Math.round(Number(n) || 0).toLocaleString("fr-FR").replace(/[  ]/g, " ");
const fmtQ = (n) => (Number(n) || 0).toLocaleString("fr-FR", { maximumFractionDigits: 3 }).replace(/[  ]/g, " ");
const sub = (txt, vars) => String(txt).replace(/\{(\w+)\}/g, (_, k) => (vars && vars[k] !== undefined ? vars[k] : `{${k}}`));
const aujourdhui = () => new Date().toISOString().slice(0, 10);
const il = (d) => (d ? String(d).slice(0, 10).split("-").reverse().join("/") : "—");
const ETAT_STYLE = {
  OK: { bg: "var(--vert-bg, #e3f1e8)", fg: "var(--vert)" },
  FAIBLE: { bg: "var(--ocre-bg)", fg: "var(--ocre)" },
  RUPTURE: { bg: "var(--brique-bg)", fg: "var(--brique)" },
};

function Pastille({ etat, t }) {
  const s = ETAT_STYLE[etat] || ETAT_STYLE.OK;
  const lib = etat === "OK" ? t("stkEtatOk") : etat === "FAIBLE" ? t("stkEtatFaible") : t("stkEtatRupture");
  return <span style={{ background: s.bg, color: s.fg, borderRadius: 999, padding: "2px 10px", fontSize: 11.5, fontWeight: 700 }}>{lib}</span>;
}

// ---------------------------------------------------------------------------------------------
// Onglet 1 : etat du stock valorise
// ---------------------------------------------------------------------------------------------
function EtatStock({ t }) {
  const [au, setAu] = useState("");
  const [data, setData] = useState(null);
  const [q, setQ] = useState("");
  const [etat, setEtat] = useState("");
  const [erreur, setErreur] = useState("");
  const [edition, setEdition] = useState(null); // { id, valeur }

  const charger = useCallback(() => {
    api.stockValorisation(au).then(setData).catch((e) => setErreur(e.message));
  }, [au]);
  useEffect(() => { charger(); }, [charger]);

  const lignes = useMemo(() => {
    if (!data) return [];
    const needle = q.trim().toLowerCase();
    return data.lignes.filter((l) => l.actif !== false || l.quantite !== 0)
      .filter((l) => (!etat || l.etat === etat) && (!needle || `${l.reference || ""} ${l.designation} ${l.categorie || ""}`.toLowerCase().includes(needle)));
  }, [data, q, etat]);

  async function enregistrerSeuil(l) {
    try {
      const v = edition.valeur === "" ? null : Number(String(edition.valeur).replace(",", "."));
      await api.stockSeuil(l.produit_id, v);
      setEdition(null);
      charger();
    } catch (e) { setErreur(e.message); }
  }

  if (!data) return erreur ? <p style={{ color: "var(--brique)", fontSize: 12.5 }}>{erreur}</p> : null;
  return (
    <div>
      <p className="no-print" style={{ fontSize: 12.5, color: "var(--sub)", margin: "0 0 12px", maxWidth: 760 }}>{t("stkAideEtat")}</p>
      {erreur && <p style={{ color: "var(--brique)", fontSize: 12.5 }}>{erreur}</p>}
      <div className="no-print" style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "flex-end", marginBottom: 12 }}>
        <div><label style={labelStyle}>{t("stkRecherche")}</label><input value={q} onChange={(e) => setQ(e.target.value)} style={{ ...inputStyle, width: 240 }} /></div>
        <div>
          <label style={labelStyle}>{t("stkColEtat")}</label>
          <select value={etat} onChange={(e) => setEtat(e.target.value)} style={{ ...inputStyle, width: 170 }}>
            <option value="">{t("stkTous")}</option>
            <option value="OK">{t("stkEtatOk")}</option>
            <option value="FAIBLE">{t("stkEtatFaible")}</option>
            <option value="RUPTURE">{t("stkEtatRupture")}</option>
          </select>
        </div>
        <div><label style={labelStyle}>{t("stkValoriseAu")}</label><input type="date" max={aujourdhui()} value={au} onChange={(e) => setAu(e.target.value)} style={{ ...inputStyle, width: 160 }} /></div>
        <button type="button" onClick={() => window.print()} style={boutonSecondaireStyle}>{t("stkExporter")}</button>
        <div style={{ marginLeft: "auto", textAlign: "right" }}>
          <div style={{ fontSize: 11, color: "var(--sub)", textTransform: "uppercase", fontWeight: 700 }}>{t("stkTotalValeur")}</div>
          <div style={{ fontFamily: "Space Grotesk", fontWeight: 700, fontSize: 22 }}>{fmt(data.total_valeur)} F</div>
          <div style={{ fontSize: 11.5, color: "var(--sub)" }}>{sub(t("stkMethodeEnCours"), { m: t("stkMethode" + data.methode) })}</div>
        </div>
      </div>
      <div className="card print-letter" style={{ padding: 0, overflowX: "auto" }}>
        <div style={{ display: "none" }} className="print-titre" />
        {lignes.length === 0 ? <p style={{ padding: 16, margin: 0, fontSize: 12.5, color: "var(--sub)" }}>{t("stkAucun")}</p> : (
          <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 760 }}>
            <thead><tr>
              <th style={thStyle}>{t("stkColRef")}</th><th style={thStyle}>{t("stkColDesignation")}</th>
              <th style={{ ...thStyle, textAlign: "right" }}>{t("stkColQte")}</th><th style={{ ...thStyle, textAlign: "right" }}>{t("stkColCout")}</th>
              <th style={{ ...thStyle, textAlign: "right" }}>{t("stkColValeur")}</th><th style={{ ...thStyle, textAlign: "right" }}>{t("stkColSeuil")}</th><th style={thStyle}>{t("stkColEtat")}</th>
            </tr></thead>
            <tbody>
              {lignes.map((l) => (
                <tr key={l.produit_id} style={{ opacity: l.actif === false ? 0.6 : 1 }}>
                  <td style={{ ...tdStyle, color: "var(--sub)" }}>{l.reference || "—"}</td>
                  <td style={tdStyle}>{l.designation}{l.categorie ? <span style={{ color: "var(--sub)" }}> · {l.categorie}</span> : null}</td>
                  <td style={{ ...tdStyle, ...numStyle, color: l.quantite < 0 ? "var(--brique)" : "inherit", fontWeight: 600 }}>{fmtQ(l.quantite)} <span style={{ color: "var(--sub)", fontWeight: 400 }}>{l.unite}</span></td>
                  <td style={{ ...tdStyle, ...numStyle }}>{fmt(l.cout_unitaire)}</td>
                  <td style={{ ...tdStyle, ...numStyle, fontWeight: 600 }}>{fmt(l.valeur)}</td>
                  <td style={{ ...tdStyle, ...numStyle }}>
                    {edition && edition.id === l.produit_id ? (
                      <span className="no-print" style={{ display: "inline-flex", gap: 4 }}>
                        <input autoFocus inputMode="decimal" value={edition.valeur} placeholder={String(data.seuil_defaut)} onChange={(e) => setEdition({ ...edition, valeur: e.target.value })}
                          onKeyDown={(e) => { if (e.key === "Enter") enregistrerSeuil(l); if (e.key === "Escape") setEdition(null); }} style={{ ...inputStyle, width: 70, padding: "3px 6px", textAlign: "right" }} />
                        <button type="button" onClick={() => enregistrerSeuil(l)} style={{ ...boutonPrincipalStyle, padding: "3px 8px" }}>OK</button>
                      </span>
                    ) : (
                      <button type="button" onClick={() => setEdition({ id: l.produit_id, valeur: l.seuil_personnalise ? String(l.seuil) : "" })}
                        style={{ background: "none", border: "none", cursor: "pointer", color: l.seuil_personnalise ? "inherit" : "var(--sub)", fontSize: 13, textDecoration: "underline dotted" }}>
                        {fmtQ(l.seuil)}{l.seuil_personnalise ? "" : ` (${t("stkSeuilDefaut")})`}
                      </button>
                    )}
                  </td>
                  <td style={tdStyle}><Pastille etat={l.etat} t={t} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// Onglet 2 : journal des mouvements
// ---------------------------------------------------------------------------------------------
function Mouvements({ t }) {
  const [f, setF] = useState({ du: "", au: "", type: "" });
  const [rows, setRows] = useState([]);
  const [erreur, setErreur] = useState("");
  useEffect(() => {
    const p = {};
    if (f.du) p.du = f.du;
    if (f.au) p.au = f.au;
    if (f.type) p.type = f.type;
    api.stockMouvements(p).then((r) => setRows(r.mouvements || [])).catch((e) => setErreur(e.message));
  }, [f]);
  return (
    <div>
      {erreur && <p style={{ color: "var(--brique)", fontSize: 12.5 }}>{erreur}</p>}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 12, marginBottom: 12 }}>
        <div><label style={labelStyle}>{t("stkMvtDu")}</label><input type="date" value={f.du} onChange={(e) => setF({ ...f, du: e.target.value })} style={{ ...inputStyle, width: 160 }} /></div>
        <div><label style={labelStyle}>{t("stkMvtAu")}</label><input type="date" value={f.au} onChange={(e) => setF({ ...f, au: e.target.value })} style={{ ...inputStyle, width: 160 }} /></div>
        <div>
          <label style={labelStyle}>{t("stkMvtType")}</label>
          <select value={f.type} onChange={(e) => setF({ ...f, type: e.target.value })} style={{ ...inputStyle, width: 180 }}>
            <option value="">{t("stkMvtTous")}</option>
            {["ENTREE", "SORTIE", "AJUSTEMENT", "ANNULATION"].map((x) => <option key={x} value={x}>{t("stkType" + x)}</option>)}
          </select>
        </div>
      </div>
      <div className="card" style={{ padding: 0, overflowX: "auto" }}>
        {rows.length === 0 ? <p style={{ padding: 16, margin: 0, fontSize: 12.5, color: "var(--sub)" }}>{t("stkMvtAucun")}</p> : (
          <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 760 }}>
            <thead><tr>
              <th style={thStyle}>{t("stkColDate")}</th><th style={thStyle}>{t("stkColType")}</th><th style={thStyle}>{t("stkColDesignation")}</th>
              <th style={{ ...thStyle, textAlign: "right" }}>{t("stkColQte")}</th><th style={{ ...thStyle, textAlign: "right" }}>{t("stkColCout")}</th><th style={thStyle}>{t("stkColLibelle")}</th>
            </tr></thead>
            <tbody>
              {rows.map((m) => (
                <tr key={m.id}>
                  <td style={tdStyle}>{il(m.date_mouvement)}</td>
                  <td style={tdStyle}>{t("stkType" + m.type_mouvement)}</td>
                  <td style={tdStyle}>{m.designation}{m.reference ? <span style={{ color: "var(--sub)" }}> · {m.reference}</span> : null}</td>
                  <td style={{ ...tdStyle, ...numStyle, color: m.quantite < 0 ? "var(--brique)" : "var(--vert)", fontWeight: 600 }}>{m.quantite > 0 ? "+" : ""}{fmtQ(m.quantite)}</td>
                  <td style={{ ...tdStyle, ...numStyle }}>{m.cout_unitaire_xof === null ? "—" : fmt(m.cout_unitaire_xof)}</td>
                  <td style={tdStyle}>{m.libelle || m.origine_type || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// Onglet 3 : inventaires
// ---------------------------------------------------------------------------------------------
function InventaireDetail({ id, retour, t, peutValider }) {
  const [inv, setInv] = useState(null);
  const [saisie, setSaisie] = useState({});
  const [erreur, setErreur] = useState("");
  const [info, setInfo] = useState("");
  const [filtre, setFiltre] = useState("");

  const charger = useCallback(() => {
    api.inventaire(id).then((r) => {
      setInv(r);
      const s = {};
      r.lignes.forEach((l) => { s[l.produit_id] = l.quantite_comptee === null ? "" : String(l.quantite_comptee); });
      setSaisie(s);
    }).catch((e) => setErreur(e.message));
  }, [id]);
  useEffect(() => { charger(); }, [charger]);

  const brouillon = inv && inv.statut === "BROUILLON";
  const lignesVisibles = useMemo(() => {
    if (!inv) return [];
    const n = filtre.trim().toLowerCase();
    return inv.lignes.filter((l) => !n || `${l.reference || ""} ${l.designation} ${l.categorie || ""}`.toLowerCase().includes(n));
  }, [inv, filtre]);

  function corps() {
    return Object.entries(saisie).map(([produit_id, v]) => ({ produit_id, quantite_comptee: v === "" ? null : Number(String(v).replace(/\s/g, "").replace(",", ".")) }));
  }
  async function enregistrer() {
    setErreur(""); setInfo("");
    try { const r = await api.inventaireSaisir(id, corps()); setInv(r); setInfo(t("stkInvEnregistre")); } catch (e) { setErreur(e.message); }
  }
  async function valider() {
    if (!window.confirm(t("stkInvValiderConfirm"))) return;
    setErreur(""); setInfo("");
    try {
      await api.inventaireSaisir(id, corps());
      const r = await api.inventaireValider(id);
      setInv(r); setInfo(sub(t("stkInvValide"), { n: r.nb_ajustements }));
    } catch (e) { setErreur(e.message); }
  }
  async function annuler() {
    if (!window.confirm(t("stkInvAnnulerConfirm"))) return;
    try { setInv(await api.inventaireAnnuler(id)); } catch (e) { setErreur(e.message); }
  }

  if (!inv) return erreur ? <p style={{ color: "var(--brique)", fontSize: 12.5 }}>{erreur}</p> : null;
  // Ecart affiche en direct pendant la saisie.
  const ecartDe = (l) => {
    if (!brouillon) return l.ecart;
    const v = saisie[l.produit_id];
    if (v === "" || v === undefined) return null;
    const n = Number(String(v).replace(/\s/g, "").replace(",", "."));
    return Number.isFinite(n) ? Math.round((n - l.quantite_theorique) * 1000) / 1000 : null;
  };
  return (
    <div>
      <button type="button" onClick={retour} className="no-print" style={{ ...boutonSecondaireStyle, marginBottom: 12 }}>{t("stkInvRetour")}</button>
      <div className="print-letter">
        <h2 style={{ fontSize: 16, color: "var(--petrol)", margin: "0 0 4px" }}>{inv.numero}{inv.libelle ? ` — ${inv.libelle}` : ""}</h2>
        <p style={{ fontSize: 12.5, color: "var(--sub)", margin: "0 0 10px" }}>
          {il(inv.date_inventaire)} · {t("stkInvStatut" + inv.statut)}{inv.categorie ? ` · ${inv.categorie}` : ""} · {sub(t("stkInvResume"), { c: inv.resume.nb_comptees, n: inv.resume.nb_lignes, e: inv.resume.nb_ecarts })}
        </p>
        {erreur && <p className="no-print" style={{ color: "var(--brique)", fontSize: 12.5 }}>{erreur}</p>}
        {info && <p className="no-print" style={{ color: "var(--vert)", fontSize: 12.5 }}>{info}</p>}
        {brouillon && <p className="no-print" style={{ fontSize: 12.5, color: "var(--sub)", maxWidth: 760 }}>{t("stkInvAide")} {t("stkInvTheoriqueNote")}</p>}
        <div className="no-print" style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "flex-end", marginBottom: 12 }}>
          <div><label style={labelStyle}>{t("stkRecherche")}</label><input value={filtre} onChange={(e) => setFiltre(e.target.value)} style={{ ...inputStyle, width: 240 }} /></div>
          <button type="button" onClick={() => window.print()} style={boutonSecondaireStyle}>{t("stkInvImprimer")}</button>
          {brouillon && <button type="button" onClick={enregistrer} style={boutonPrincipalStyle}>{t("stkInvEnregistrer")}</button>}
          {brouillon && peutValider && <button type="button" onClick={valider} style={{ ...boutonPrincipalStyle, background: "var(--vert)" }}>{t("stkInvValider")}</button>}
          {brouillon && <button type="button" onClick={annuler} style={boutonDangerStyle}>{t("stkInvAnnuler")}</button>}
        </div>
        <div className="card" style={{ padding: 0, overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 720 }}>
            <thead><tr>
              <th style={thStyle}>{t("stkColRef")}</th><th style={thStyle}>{t("stkColDesignation")}</th>
              <th style={{ ...thStyle, textAlign: "right" }}>{t("stkInvColTheorique")}</th><th style={{ ...thStyle, textAlign: "right" }}>{t("stkInvColCompte")}</th>
              <th style={{ ...thStyle, textAlign: "right" }}>{t("stkInvColEcart")}</th><th style={{ ...thStyle, textAlign: "right" }}>{t("stkInvColValeurEcart")}</th>
            </tr></thead>
            <tbody>
              {lignesVisibles.map((l) => {
                const e = ecartDe(l);
                return (
                  <tr key={l.id}>
                    <td style={{ ...tdStyle, color: "var(--sub)" }}>{l.reference || "—"}</td>
                    <td style={tdStyle}>{l.designation}{l.categorie ? <span style={{ color: "var(--sub)" }}> · {l.categorie}</span> : null}</td>
                    <td style={{ ...tdStyle, ...numStyle }}>{fmtQ(l.quantite_theorique)} <span style={{ color: "var(--sub)" }}>{l.unite}</span></td>
                    <td style={{ ...tdStyle, textAlign: "right" }}>
                      {brouillon ? (
                        <input inputMode="decimal" value={saisie[l.produit_id] ?? ""} onChange={(ev) => setSaisie({ ...saisie, [l.produit_id]: ev.target.value })} style={{ ...inputStyle, width: 90, padding: "4px 8px", textAlign: "right" }} />
                      ) : (l.quantite_comptee === null ? "—" : fmtQ(l.quantite_comptee))}
                    </td>
                    <td style={{ ...tdStyle, ...numStyle, fontWeight: 600, color: e === null ? "var(--sub)" : e < 0 ? "var(--brique)" : e > 0 ? "var(--vert)" : "inherit" }}>{e === null ? "—" : (e > 0 ? "+" : "") + fmtQ(e)}</td>
                    <td style={{ ...tdStyle, ...numStyle }}>{e === null ? "—" : fmt(e * l.cout_unitaire_xof)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function Inventaires({ t, peutValider }) {
  const [liste, setListe] = useState([]);
  const [ouvert, setOuvert] = useState(null);
  const [categories, setCategories] = useState([]);
  const [form, setForm] = useState({ libelle: "", date_inventaire: aujourdhui(), categorie: "" });
  const [erreur, setErreur] = useState("");

  const charger = useCallback(() => { api.inventaires().then((r) => setListe(r.inventaires || [])).catch((e) => setErreur(e.message)); }, []);
  useEffect(() => { charger(); }, [charger, ouvert]);
  useEffect(() => {
    api.getProduits().then((r) => {
      const l = Array.isArray(r) ? r : r.produits || [];
      setCategories([...new Set(l.map((p) => p.categorie).filter(Boolean))].sort());
    }).catch(() => {});
  }, []);

  async function creer(e) {
    e.preventDefault();
    setErreur("");
    try {
      const r = await api.inventaireCreer({ libelle: form.libelle, date_inventaire: form.date_inventaire, categorie: form.categorie });
      setOuvert(r.id);
    } catch (err) { setErreur(err.message); }
  }

  if (ouvert) return <InventaireDetail id={ouvert} retour={() => setOuvert(null)} t={t} peutValider={peutValider} />;
  return (
    <div>
      {erreur && <p style={{ color: "var(--brique)", fontSize: 12.5 }}>{erreur}</p>}
      <form onSubmit={creer} className="card" style={{ marginBottom: 16 }}>
        <h2 style={{ fontSize: 14.5, color: "var(--petrol)", margin: "0 0 12px" }}>{t("stkInvNouveau")}</h2>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "flex-end" }}>
          <div><label style={labelStyle}>{t("stkInvLibelle")}</label><input value={form.libelle} onChange={(e) => setForm({ ...form, libelle: e.target.value })} style={{ ...inputStyle, width: 260 }} /></div>
          <div><label style={labelStyle}>{t("stkInvDate")}</label><input type="date" max={aujourdhui()} required value={form.date_inventaire} onChange={(e) => setForm({ ...form, date_inventaire: e.target.value })} style={{ ...inputStyle, width: 160 }} /></div>
          <div>
            <label style={labelStyle}>{t("stkInvCategorie")}</label>
            <select value={form.categorie} onChange={(e) => setForm({ ...form, categorie: e.target.value })} style={{ ...inputStyle, width: 200 }}>
              <option value="">{t("stkInvToutes")}</option>
              {categories.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <button type="submit" style={boutonPrincipalStyle}>{t("stkInvCreer")}</button>
        </div>
      </form>
      <h2 style={{ fontSize: 14.5, color: "var(--petrol)", margin: "0 0 8px" }}>{t("stkInvListe")}</h2>
      <div className="card" style={{ padding: 0, overflowX: "auto" }}>
        {liste.length === 0 ? <p style={{ padding: 16, margin: 0, fontSize: 12.5, color: "var(--sub)" }}>{t("stkInvAucun")}</p> : (
          <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 680 }}>
            <thead><tr>
              <th style={thStyle}>{t("stkInvColNumero")}</th><th style={thStyle}>{t("stkInvColDate")}</th><th style={thStyle}>{t("stkInvColStatut")}</th>
              <th style={{ ...thStyle, textAlign: "right" }}>{t("stkInvColAvancement")}</th><th style={{ ...thStyle, textAlign: "right" }}>{t("stkInvColEcarts")}</th><th style={{ ...thStyle, textAlign: "right" }}>{t("stkInvColValeur")}</th><th style={thStyle} />
            </tr></thead>
            <tbody>
              {liste.map((i) => (
                <tr key={i.id}>
                  <td style={tdStyle}>{i.numero}{i.libelle ? <span style={{ color: "var(--sub)" }}> · {i.libelle}</span> : null}</td>
                  <td style={tdStyle}>{il(i.date_inventaire)}</td>
                  <td style={tdStyle}>{t("stkInvStatut" + i.statut)}</td>
                  <td style={{ ...tdStyle, ...numStyle }}>{i.nb_comptees} / {i.nb_lignes}</td>
                  <td style={{ ...tdStyle, ...numStyle }}>{i.nb_ecarts}</td>
                  <td style={{ ...tdStyle, ...numStyle, color: i.valeur_ecart < 0 ? "var(--brique)" : "inherit" }}>{i.statut === "VALIDE" ? fmt(i.valeur_ecart) : "—"}</td>
                  <td style={tdStyle}><button type="button" onClick={() => setOuvert(i.id)} style={{ ...boutonSecondaireStyle, padding: "3px 10px" }}>{t("stkInvOuvrir")}</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// Onglet 4 : parametres de valorisation
// ---------------------------------------------------------------------------------------------
function Parametres({ t }) {
  const [p, setP] = useState(null);
  const [form, setForm] = useState({ methode: "DERNIER_COUT", date_effet: aujourdhui(), seuil_defaut: "5" });
  const [erreur, setErreur] = useState("");
  const [info, setInfo] = useState("");
  const charger = useCallback(() => {
    api.stockParametres().then((r) => {
      setP(r);
      setForm({ methode: r.methode, date_effet: r.date_effet || aujourdhui(), seuil_defaut: String(r.seuil_defaut) });
    }).catch((e) => setErreur(e.message));
  }, []);
  useEffect(() => { charger(); }, [charger]);

  async function enregistrer(e) {
    e.preventDefault();
    setErreur(""); setInfo("");
    try {
      await api.stockEnregistrerParametres({ methode: form.methode, date_effet: form.date_effet, seuil_defaut: Number(String(form.seuil_defaut).replace(",", ".")) });
      setInfo(t("stkParamEnregistre"));
      charger();
    } catch (err) { setErreur(err.message); }
  }
  if (!p) return erreur ? <p style={{ color: "var(--brique)", fontSize: 12.5 }}>{erreur}</p> : null;
  const lecture = !p.peut_modifier;
  return (
    <div style={{ maxWidth: 760 }}>
      <form onSubmit={enregistrer} className="card">
        <h2 style={{ fontSize: 14.5, color: "var(--petrol)", margin: "0 0 6px" }}>{t("stkParamTitre")}</h2>
        <p style={{ fontSize: 12.5, color: "var(--sub)", margin: "0 0 14px" }}>{t("stkParamAide")}</p>
        {lecture && <p style={{ fontSize: 12.5, color: "var(--ocre)" }}>{t("stkParamLecture")}</p>}
        {erreur && <p style={{ color: "var(--brique)", fontSize: 12.5 }}>{erreur}</p>}
        {info && <p style={{ color: "var(--vert)", fontSize: 12.5 }}>{info}</p>}
        <div style={{ display: "grid", gap: 10, marginBottom: 14 }}>
          {["CMUP", "FIFO", "DERNIER_COUT"].map((m) => (
            <label key={m} style={{ display: "flex", gap: 10, alignItems: "flex-start", border: "1px solid var(--line)", borderRadius: 10, padding: "10px 12px", background: form.methode === m ? "var(--petrol-bg, #e8f0f2)" : "#fff", cursor: lecture ? "default" : "pointer" }}>
              <input type="radio" name="methode" disabled={lecture} checked={form.methode === m} onChange={() => setForm({ ...form, methode: m })} style={{ marginTop: 3 }} />
              <span>
                <strong style={{ fontSize: 13 }}>{t("stkMethode" + m)}</strong>
                <span style={{ display: "block", fontSize: 12, color: m === "DERNIER_COUT" ? "var(--ocre)" : "var(--sub)", marginTop: 2 }}>{t(m === "CMUP" ? "stkParamCmupAide" : m === "FIFO" ? "stkParamFifoAide" : "stkParamDernierAide")}</span>
              </span>
            </label>
          ))}
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "flex-end" }}>
          <div><label style={labelStyle}>{t("stkParamDateEffet")}</label><input type="date" disabled={lecture} value={form.date_effet} onChange={(e) => setForm({ ...form, date_effet: e.target.value })} style={{ ...inputStyle, width: 170 }} /></div>
          <div><label style={labelStyle}>{t("stkParamSeuilDefaut")}</label><input inputMode="decimal" disabled={lecture} value={form.seuil_defaut} onChange={(e) => setForm({ ...form, seuil_defaut: e.target.value })} style={{ ...inputStyle, width: 170, textAlign: "right" }} /></div>
          {!lecture && <button type="submit" style={boutonPrincipalStyle}>{t("stkParamEnregistrer")}</button>}
        </div>
      </form>
      {p.historique.length > 0 && (
        <div style={{ marginTop: 18 }}>
          <h3 style={{ fontSize: 13.5, color: "var(--petrol)", margin: "0 0 8px" }}>{t("stkParamHistorique")}</h3>
          <div className="card" style={{ padding: 0 }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead><tr><th style={thStyle}>{t("stkParamColDate")}</th><th style={thStyle}>{t("stkParamColMethode")}</th><th style={thStyle}>{t("stkParamColPar")}</th></tr></thead>
              <tbody>
                {p.historique.map((h, i) => (
                  <tr key={i}><td style={tdStyle}>{il(h.date_effet)}</td><td style={tdStyle}>{t("stkMethode" + h.methode)}</td><td style={{ ...tdStyle, color: "var(--sub)" }}>{h.par || "—"}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
export default function StockPage() {
  const { t } = useLangue();
  const [onglet, setOnglet] = useState("etat");
  const [peutValider, setPeutValider] = useState(true);
  useEffect(() => { api.stockParametres().then((r) => setPeutValider(!!r.peut_modifier)).catch(() => {}); }, []);
  const onglets = [["etat", "stkOngletEtat"], ["mouvements", "stkOngletMouvements"], ["inventaires", "stkOngletInventaires"], ["parametres", "stkOngletParametres"]];
  return (
    <AppShell title={t("stkTitre")}>
      <div className="no-print" style={{ display: "flex", gap: 8, marginBottom: 14, flexWrap: "wrap" }}>
        {onglets.map(([k, cle]) => (
          <button key={k} type="button" onClick={() => setOnglet(k)} style={{ border: "1px solid var(--line)", background: onglet === k ? "var(--petrol)" : "#fff", color: onglet === k ? "#fff" : "var(--ink)", borderRadius: 999, padding: "6px 16px", fontSize: 12.5, fontWeight: 600, cursor: "pointer" }}>{t(cle)}</button>
        ))}
      </div>
      {onglet === "etat" && <EtatStock t={t} />}
      {onglet === "mouvements" && <Mouvements t={t} />}
      {onglet === "inventaires" && <Inventaires t={t} peutValider={peutValider} />}
      {onglet === "parametres" && <Parametres t={t} />}
    </AppShell>
  );
}
