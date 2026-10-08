"use client";

import { useEffect, useState } from "react";
import { api } from "../../api";
import { useLangue } from "../../i18n/LanguageContext";
import { Champ, Section, grille, inputStyle, boutonPrincipal, boutonLeger, boutonDanger, cellule, enteteCellule, droite, fmt, fmtDec, Pastille, useStatut, Statut, aujourdhui } from "../paieUi";

const CLASSIFS = ["OUVRIER", "EMPLOYE", "AGENT_MAITRISE", "CADRE"];

export default function ParamConventions({ peutModifier }) {
  const { t } = useLangue();
  const [convs, setConvs] = useState(null);
  const [sel, setSel] = useState(null);
  const [onglet, setOnglet] = useState("grille");
  const [nouv, setNouv] = useState({ code: "", libelle: "" });
  const s = useStatut();

  const charger = (garder) =>
    api.paieConventions().then((c) => { setConvs(c); if (!garder && c.length && !sel) setSel(c[0].id); }).catch(s.ko);
  useEffect(() => { charger(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  if (!convs) return <p style={{ fontSize: 12.5, color: "var(--sub)" }}>{t("loading")}</p>;
  const conv = convs.find((c) => c.id === sel) || null;

  async function creer() {
    try {
      const r = await api.paieCreerConvention(nouv);
      s.ok(t("paieConvCreee")); setNouv({ code: "", libelle: "" });
      await charger(true); setSel(r.id); setOnglet("grille");
    } catch (e) { s.ko(e); }
  }

  return (
    <div style={{ display: "grid", gridTemplateColumns: "minmax(220px, 280px) 1fr", gap: 14, alignItems: "start" }} className="paie-conv">
      <div style={{ display: "grid", gap: 8 }}>
        {convs.map((c) => (
          <button key={c.id} onClick={() => { setSel(c.id); s.raz(); }} className="card" style={{ textAlign: "left", cursor: "pointer", fontFamily: "inherit", border: c.id === sel ? "2px solid var(--petrol)" : "1px solid var(--line)", opacity: c.actif ? 1 : 0.55 }}>
            <div style={{ fontWeight: 700, fontSize: 13.5 }}>{c.libelle}</div>
            <div style={{ fontSize: 11.5, color: "var(--sub)" }}>{c.nb_categories} {t("paieConvCategories")} · {c.nb_salaries} {t("paieConvSalaries")}</div>
          </button>
        ))}
        {peutModifier && (
          <div className="card">
            <div style={{ fontWeight: 700, fontSize: 12.5, marginBottom: 8 }}>{t("paieConvNouvelle")}</div>
            <Champ label={t("paieCotCode")}><input style={inputStyle} value={nouv.code} onChange={(e) => setNouv({ ...nouv, code: e.target.value })} placeholder="TEXTILE" /></Champ>
            <div style={{ height: 8 }} />
            <Champ label={t("paieLibelle")}><input style={inputStyle} value={nouv.libelle} onChange={(e) => setNouv({ ...nouv, libelle: e.target.value })} /></Champ>
            <div style={{ marginTop: 10 }}><button style={boutonPrincipal} onClick={creer}>{t("paieCreer")}</button></div>
          </div>
        )}
      </div>

      <div style={{ minWidth: 0 }}>
        <Statut s={s} />
        {!conv && <p style={{ fontSize: 12.5, color: "var(--sub)" }}>{t("paieConvAucune")}</p>}
        {conv && (
          <>
            <div style={{ display: "flex", gap: 4, marginBottom: 12, flexWrap: "wrap" }}>
              {["grille", "anciennete", "heures", "infos"].map((o) => (
                <button key={o} onClick={() => setOnglet(o)} style={{ padding: "6px 14px", borderRadius: 20, border: "none", cursor: "pointer", fontFamily: "inherit", fontSize: 12.5, fontWeight: onglet === o ? 700 : 500, background: onglet === o ? "var(--petrol)" : "transparent", color: onglet === o ? "#fff" : "var(--petrol)" }}>{t(`paieConvOnglet_${o}`)}</button>
              ))}
            </div>
            {onglet === "grille" && <Grille conv={conv} peutModifier={peutModifier} s={s} t={t} />}
            {onglet === "anciennete" && <Anciennete conv={conv} peutModifier={peutModifier} s={s} t={t} recharger={() => charger(true)} />}
            {onglet === "heures" && <Heures conv={conv} peutModifier={peutModifier} s={s} t={t} recharger={() => charger(true)} />}
            {onglet === "infos" && <Infos conv={conv} peutModifier={peutModifier} s={s} t={t} recharger={(supprimee) => { if (supprimee) setSel(null); charger(true); }} />}
          </>
        )}
      </div>
      <style>{`@media (max-width: 800px) { .paie-conv { grid-template-columns: 1fr !important; } }`}</style>
    </div>
  );
}

function Grille({ conv, peutModifier, s, t }) {
  const [data, setData] = useState(null);
  const [date, setDate] = useState("");
  const [f, setF] = useState({ code: "", libelle: "", classification: "EMPLOYE", salaire_base: "", date_effet: aujourdhui() });
  const [rev, setRev] = useState({ date_effet: aujourdhui(), taux: "5", arrondi: "1", classifications: [] });
  const [imp, setImp] = useState({ date_effet: aujourdhui(), fichier: null });

  const charger = (d) => api.paieGrille(conv.id, d || undefined).then((r) => { setData(r); if (!d) setDate(r.date); }).catch(s.ko);
  useEffect(() => { setData(null); setDate(""); charger(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [conv.id]);

  if (!data) return <p style={{ fontSize: 12.5, color: "var(--sub)" }}>{t("loading")}</p>;
  const maj = (k) => (e) => setF({ ...f, [k]: e.target.value });

  async function sauver() {
    try { await api.paieSauverCategorie(conv.id, f); s.ok(t("paieEnregistre")); setF({ ...f, code: "", libelle: "", salaire_base: "" }); charger(date); } catch (e) { s.ko(e); }
  }
  async function supprimer(k) {
    if (!window.confirm(t("paieConfirmSuppr"))) return;
    try { await api.paieSupprimerCategorie(k.id); s.ok(t("paieSupprime")); charger(date); } catch (e) { s.ko(e); }
  }
  async function revaloriser() {
    try {
      const r = await api.paieRevaloriser(conv.id, { ...rev, classifications: rev.classifications.length ? rev.classifications : undefined });
      s.ok(`${t("paieRevaloOk")} (${r.nb_categories})`); charger(rev.date_effet);
    } catch (e) { s.ko(e); }
  }
  async function importer() {
    if (!imp.fichier) { s.ko(new Error(t("paieChoisirFichier"))); return; }
    const fd = new FormData(); fd.append("date_effet", imp.date_effet); fd.append("fichier", imp.fichier);
    try {
      const r = await api.paieImporterGrille(conv.id, fd);
      s.ok(`${t("paieImporte")} : ${r.nb_categories} ${t("paieConvCategories")}${r.erreurs && r.erreurs.length ? ` (${r.erreurs.length} ${t("paieLignesIgnorees")})` : ""}`);
      charger(imp.date_effet);
    } catch (e) { s.ko(e); }
  }
  const basculerClassif = (c) => setRev({ ...rev, classifications: rev.classifications.includes(c) ? rev.classifications.filter((x) => x !== c) : [...rev.classifications, c] });

  return (
    <div style={{ display: "grid", gap: 14 }}>
      <Section titre={`${conv.libelle} — ${t("paieGrilleTitre")}`} aide={t("paieGrilleAide")}>
        <div style={{ display: "flex", gap: 10, alignItems: "end", flexWrap: "wrap", marginBottom: 10 }}>
          <Champ label={t("paieGrilleValeursAu")}>
            <select style={{ ...inputStyle, width: 180 }} value={date} onChange={(e) => { setDate(e.target.value); charger(e.target.value); }}>
              {[...new Set([data.date, ...data.dates])].sort().reverse().map((d) => <option key={d} value={d}>{d}</option>)}
            </select>
          </Champ>
          <button style={boutonLeger} onClick={() => api.paieTelechargerGabarit(conv.id, conv.code).catch(s.ko)}>{t("paieGabaritTelecharger")}</button>
        </div>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 560 }}>
            <thead><tr><th style={enteteCellule}>{t("paieCotCode")}</th><th style={enteteCellule}>{t("paieLibelle")}</th><th style={enteteCellule}>{t("paieClassification")}</th><th style={{ ...enteteCellule, ...droite }}>{t("paieSalaireBase")}</th><th style={enteteCellule}>{t("paieCotDateEffet")}</th>{peutModifier && <th style={enteteCellule}></th>}</tr></thead>
            <tbody>
              {data.grille.map((k) => (
                <tr key={k.id}>
                  <td style={cellule} className="mono">{k.code}</td>
                  <td style={cellule}>{k.libelle}</td>
                  <td style={cellule}>{t(`paieClassif_${k.classification}`)}</td>
                  <td style={{ ...cellule, ...droite }}>{fmt(k.salaire_base)}</td>
                  <td style={cellule}>{k.date_effet}</td>
                  {peutModifier && <td style={{ ...cellule, whiteSpace: "nowrap" }}><button style={boutonLeger} onClick={() => setF({ code: k.code, libelle: k.libelle, classification: k.classification, salaire_base: String(k.salaire_base), date_effet: aujourdhui() })}>{t("paieModifier")}</button> <button style={boutonDanger} onClick={() => supprimer(k)}>{t("paieSupprimer")}</button></td>}
                </tr>
              ))}
              {data.grille.length === 0 && <tr><td colSpan={6} style={{ ...cellule, color: "var(--sub)" }}>{t("paieGrilleVide")}</td></tr>}
            </tbody>
          </table>
        </div>
      </Section>
      {peutModifier && (
        <>
          <Section titre={t("paieCatFormTitre")} aide={t("paieCatFormAide")}>
            <div style={grille}>
              <Champ label={t("paieCotCode")}><input style={inputStyle} value={f.code} onChange={maj("code")} /></Champ>
              <Champ label={t("paieLibelle")}><input style={inputStyle} value={f.libelle} onChange={maj("libelle")} /></Champ>
              <Champ label={t("paieClassification")}>
                <select style={inputStyle} value={f.classification} onChange={maj("classification")}>{CLASSIFS.map((c) => <option key={c} value={c}>{t(`paieClassif_${c}`)}</option>)}</select>
              </Champ>
              <Champ label={t("paieSalaireBase")}><input type="number" style={inputStyle} value={f.salaire_base} onChange={maj("salaire_base")} /></Champ>
              <Champ label={t("paieCotDateEffet")}><input type="date" style={inputStyle} value={f.date_effet} onChange={maj("date_effet")} /></Champ>
            </div>
            <div style={{ marginTop: 12 }}><button style={boutonPrincipal} onClick={sauver}>{t("paieEnregistrer")}</button></div>
          </Section>
          <Section titre={t("paieRevaloTitre")} aide={t("paieRevaloAide")}>
            <div style={grille}>
              <Champ label={t("paieCotDateEffet")}><input type="date" style={inputStyle} value={rev.date_effet} onChange={(e) => setRev({ ...rev, date_effet: e.target.value })} /></Champ>
              <Champ label={t("paieRevaloTaux")}><input type="number" step="0.1" style={inputStyle} value={rev.taux} onChange={(e) => setRev({ ...rev, taux: e.target.value })} /></Champ>
              <Champ label={t("paieRevaloArrondi")}>
                <select style={inputStyle} value={rev.arrondi} onChange={(e) => setRev({ ...rev, arrondi: e.target.value })}>{[1, 5, 10, 100, 1000].map((n) => <option key={n} value={n}>{n} F</option>)}</select>
              </Champ>
            </div>
            <div style={{ display: "flex", gap: 14, flexWrap: "wrap", margin: "10px 0", fontSize: 12.5 }}>
              <span style={{ color: "var(--sub)" }}>{t("paieRevaloClassifs")}</span>
              {CLASSIFS.map((c) => <label key={c} style={{ display: "flex", gap: 5, alignItems: "center" }}><input type="checkbox" checked={rev.classifications.includes(c)} onChange={() => basculerClassif(c)} />{t(`paieClassif_${c}`)}</label>)}
            </div>
            <button style={boutonPrincipal} onClick={revaloriser}>{t("paieRevaloAppliquer")}</button>
          </Section>
          <Section titre={t("paieImportGrilleTitre")} aide={t("paieImportGrilleAide")}>
            <div style={grille}>
              <Champ label={t("paieCotDateEffet")}><input type="date" style={inputStyle} value={imp.date_effet} onChange={(e) => setImp({ ...imp, date_effet: e.target.value })} /></Champ>
              <Champ label={t("paieFichierExcel")}><input type="file" accept=".xlsx,.xlsm,.xls" onChange={(e) => setImp({ ...imp, fichier: e.target.files[0] || null })} style={{ fontSize: 12 }} /></Champ>
            </div>
            <div style={{ marginTop: 12 }}><button style={boutonPrincipal} onClick={importer}>{t("paieImporter")}</button></div>
          </Section>
        </>
      )}
    </div>
  );
}

function Anciennete({ conv, peutModifier, s, t, recharger }) {
  const [lignes, setLignes] = useState(conv.anciennete);
  useEffect(() => setLignes(conv.anciennete), [conv.id, conv.anciennete]);
  const maj = (i, k, v) => setLignes(lignes.map((l, j) => (j === i ? { ...l, [k]: v === "" ? "" : Number(v) } : l)));
  async function sauver() {
    try { await api.paieModifierConvention(conv.id, { anciennete: lignes }); s.ok(t("paieEnregistre")); recharger(); } catch (e) { s.ko(e); }
  }
  return (
    <Section titre={t("paieAncTitre")} aide={t("paieAncAide")}>
      <table style={{ borderCollapse: "collapse" }}>
        <thead><tr><th style={enteteCellule}>{t("paieAncAnnees")}</th><th style={enteteCellule}>{t("paieAncTaux")}</th><th style={enteteCellule}></th></tr></thead>
        <tbody>
          {lignes.map((l, i) => (
            <tr key={i}>
              <td style={cellule}><input type="number" style={{ ...inputStyle, width: 90 }} value={l.annees} onChange={(e) => maj(i, "annees", e.target.value)} disabled={!peutModifier} /></td>
              <td style={cellule}><input type="number" step="0.1" style={{ ...inputStyle, width: 90 }} value={l.taux} onChange={(e) => maj(i, "taux", e.target.value)} disabled={!peutModifier} /></td>
              <td style={cellule}>{peutModifier && <button style={boutonDanger} onClick={() => setLignes(lignes.filter((_, j) => j !== i))}>{t("paieSupprimer")}</button>}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {peutModifier && (
        <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
          <button style={boutonLeger} onClick={() => setLignes([...lignes, { annees: (lignes[lignes.length - 1]?.annees || 0) + 1, taux: lignes[lignes.length - 1]?.taux || 0 }])}>{t("paieAjouterLigne")}</button>
          <button style={boutonPrincipal} onClick={sauver}>{t("paieEnregistrer")}</button>
        </div>
      )}
    </Section>
  );
}

function Heures({ conv, peutModifier, s, t, recharger }) {
  const [lignes, setLignes] = useState(conv.majorations);
  useEffect(() => setLignes(conv.majorations), [conv.id, conv.majorations]);
  const maj = (i, k, v) => setLignes(lignes.map((l, j) => (j === i ? { ...l, [k]: k === "taux" ? (v === "" ? "" : Number(v)) : v } : l)));
  async function sauver() {
    try { await api.paieModifierConvention(conv.id, { majorations: lignes }); s.ok(t("paieEnregistre")); recharger(); } catch (e) { s.ko(e); }
  }
  return (
    <Section titre={t("paieHsTitre")} aide={t("paieHsAide")}>
      <table style={{ borderCollapse: "collapse", width: "100%" }}>
        <thead><tr><th style={enteteCellule}>{t("paieCotCode")}</th><th style={enteteCellule}>{t("paieLibelle")}</th><th style={enteteCellule}>{t("paieHsMajoration")}</th><th style={enteteCellule}></th></tr></thead>
        <tbody>
          {lignes.map((l, i) => (
            <tr key={i}>
              <td style={cellule}><input style={{ ...inputStyle, width: 110 }} value={l.code} onChange={(e) => maj(i, "code", e.target.value)} disabled={!peutModifier} /></td>
              <td style={cellule}><input style={inputStyle} value={l.libelle} onChange={(e) => maj(i, "libelle", e.target.value)} disabled={!peutModifier} /></td>
              <td style={cellule}><input type="number" style={{ ...inputStyle, width: 90 }} value={l.taux} onChange={(e) => maj(i, "taux", e.target.value)} disabled={!peutModifier} /></td>
              <td style={cellule}>{peutModifier && <button style={boutonDanger} onClick={() => setLignes(lignes.filter((_, j) => j !== i))}>{t("paieSupprimer")}</button>}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {peutModifier && (
        <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
          <button style={boutonLeger} onClick={() => setLignes([...lignes, { code: `HS_${lignes.length + 1}`, libelle: t("paieHsNouvelle"), taux: 25 }])}>{t("paieAjouterLigne")}</button>
          <button style={boutonPrincipal} onClick={sauver}>{t("paieEnregistrer")}</button>
        </div>
      )}
    </Section>
  );
}

function Infos({ conv, peutModifier, s, t, recharger }) {
  const [f, setF] = useState({ libelle: conv.libelle, notes: conv.notes || "", actif: conv.actif });
  useEffect(() => setF({ libelle: conv.libelle, notes: conv.notes || "", actif: conv.actif }), [conv.id, conv.libelle, conv.notes, conv.actif]);
  async function sauver() {
    try { await api.paieModifierConvention(conv.id, f); s.ok(t("paieEnregistre")); recharger(); } catch (e) { s.ko(e); }
  }
  async function supprimer() {
    if (!window.confirm(t("paieConfirmSuppr"))) return;
    try { await api.paieSupprimerConvention(conv.id); s.ok(t("paieSupprime")); recharger(true); } catch (e) { s.ko(e); }
  }
  return (
    <Section titre={t("paieConvInfos")}>
      <div style={grille}>
        <Champ label={t("paieLibelle")}><input style={inputStyle} value={f.libelle} onChange={(e) => setF({ ...f, libelle: e.target.value })} disabled={!peutModifier} /></Champ>
        <Champ label={t("paieConvActive")}><label style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 12.5 }}><input type="checkbox" checked={f.actif} onChange={(e) => setF({ ...f, actif: e.target.checked })} disabled={!peutModifier} />{t("paieConvActiveTexte")}</label></Champ>
        <Champ label={t("paieNotes")} large><textarea style={{ ...inputStyle, minHeight: 70 }} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} disabled={!peutModifier} /></Champ>
      </div>
      {peutModifier && (
        <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
          <button style={boutonPrincipal} onClick={sauver}>{t("paieEnregistrer")}</button>
          <button style={boutonDanger} onClick={supprimer}>{t("paieConvSupprimer")}</button>
        </div>
      )}
    </Section>
  );
}
