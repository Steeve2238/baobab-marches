"use client";

import { useEffect, useState } from "react";
import { api } from "../../api";
import { useLangue } from "../../i18n/LanguageContext";
import { Champ, Section, grille, inputStyle, boutonPrincipal, boutonLeger, boutonDanger, cellule, enteteCellule, droite, fmt, fmtDec, Pastille, useStatut, Statut, aujourdhui } from "../paieUi";

export default function ParamImpot({ peutModifier }) {
  const { t } = useLangue();
  const [bar, setBar] = useState(null);
  const [formule, setFormule] = useState(null);
  const [imp, setImp] = useState({ type: "IR_MENSUEL", annee: String(new Date().getFullYear()), feuille: "", fichier: null });
  const [ctl, setCtl] = useState({ imposable: "211236", parts: "1", annee: String(new Date().getFullYear()) });
  const [res, setRes] = useState(null);
  const [edit, setEdit] = useState(null); // { date_effet, formule }
  const sb = useStatut();
  const sf = useStatut();

  const charger = () => {
    api.paieBaremes().then(setBar).catch(sb.ko);
    api.paieFormuleIr().then(setFormule).catch(sf.ko);
  };
  useEffect(() => { charger(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  if (!bar || !formule) return <p style={{ fontSize: 12.5, color: "var(--sub)" }}>{t("loading")}</p>;

  async function importer() {
    if (!imp.fichier) { sb.ko(new Error(t("paieChoisirFichier"))); return; }
    const fd = new FormData();
    fd.append("type", imp.type); fd.append("annee", imp.annee); if (imp.feuille) fd.append("feuille", imp.feuille); fd.append("fichier", imp.fichier);
    try {
      const r = await api.paieImporterBareme(fd);
      sb.ok(`${t("paieBarImporte")} (${r.nb_lignes} ${t("paieLignes")})`);
      setImp({ ...imp, fichier: null });
      charger();
    } catch (e) { sb.ko(e); }
  }
  async function supprimerBareme(b) {
    if (!window.confirm(t("paieConfirmSuppr"))) return;
    try { await api.paieSupprimerBareme(b.id); sb.ok(t("paieSupprime")); charger(); } catch (e) { sb.ko(e); }
  }
  async function controler() {
    try { setRes(await api.paieControleBareme(ctl)); sb.raz(); } catch (e) { sb.ko(e); }
  }
  const libSource = (x) => (x.source === "OFFICIEL" ? t("paieBarOfficiel") : t("paieBarEntreprise"));

  // --- formule
  const ouvrir = (v) => setEdit({ date_effet: v ? v.date_effet : aujourdhui(), note: v?.note || "", formule: JSON.parse(JSON.stringify(v ? v.formule : formule.defaut)) });
  async function enregistrerFormule() {
    try {
      await api.paieEnregistrerFormuleIr({ date_effet: edit.date_effet, formule: edit.formule, note: edit.note });
      sf.ok(t("paieEnregistre")); setEdit(null); charger();
    } catch (e) { sf.ko(e); }
  }
  async function supprimerFormule(v) {
    if (!window.confirm(t("paieConfirmSuppr"))) return;
    try { await api.paieSupprimerFormuleIr(v.id); sf.ok(t("paieSupprime")); charger(); } catch (e) { sf.ko(e); }
  }
  const majTranche = (i, k, val) => {
    const tr = edit.formule.tranches.map((x, j) => (j === i ? { ...x, [k]: val === "" ? null : Number(val) } : x));
    // chaine les tranches : le debut d'une tranche = la fin de la precedente
    for (let j = 1; j < tr.length; j++) tr[j] = { ...tr[j], de: tr[j - 1].a };
    setEdit({ ...edit, formule: { ...edit.formule, tranches: tr } });
  };
  const ajouterTranche = () => {
    const tr = edit.formule.tranches.map((x) => ({ ...x }));
    const der = tr[tr.length - 1];
    const borne = (der.de || 0) + 1000000;
    der.a = borne;
    tr.push({ de: borne, a: null, taux: der.taux });
    setEdit({ ...edit, formule: { ...edit.formule, tranches: tr } });
  };
  const retirerTranche = () => {
    if (edit.formule.tranches.length < 2) return;
    const tr = edit.formule.tranches.slice(0, -1).map((x) => ({ ...x }));
    tr[tr.length - 1].a = null;
    setEdit({ ...edit, formule: { ...edit.formule, tranches: tr } });
  };
  const majRed = (i, k, val) => setEdit({ ...edit, formule: { ...edit.formule, reductions: edit.formule.reductions.map((x, j) => (j === i ? { ...x, [k]: Number(val) } : x)) } });

  return (
    <div style={{ display: "grid", gap: 14 }}>
      <Section titre={t("paieBarTitre")} aide={t("paieBarAide")}>
        <Statut s={sb} />
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 640 }}>
            <thead>
              <tr>
                <th style={enteteCellule}>{t("paieBarType")}</th>
                <th style={enteteCellule}>{t("paieBarAnnee")}</th>
                <th style={{ ...enteteCellule, ...droite }}>{t("paieBarLignes")}</th>
                <th style={enteteCellule}>{t("paieBarOrigine")}</th>
                <th style={enteteCellule}></th>
                {peutModifier && <th style={enteteCellule}></th>}
              </tr>
            </thead>
            <tbody>
              {bar.officiels.map((o) => (
                <tr key={o.type}>
                  <td style={cellule}>{t(`paieBarType_${o.type}`)}<div style={{ fontSize: 11, color: "var(--sub)" }}>{o.libelle}</div></td>
                  <td style={cellule}>{o.annee}</td>
                  <td style={{ ...cellule, ...droite }}>{fmt(o.nb_lignes)}</td>
                  <td style={cellule}>{t("paieBarOfficiel")}</td>
                  <td style={cellule}>{bar.effectif[o.type === "IR_MENSUEL" ? "ir" : "trimf"].source === "OFFICIEL" && <Pastille ton="ok">{t("paieEnVigueur")}</Pastille>}</td>
                  {peutModifier && <td style={cellule}></td>}
                </tr>
              ))}
              {bar.importes.map((b) => (
                <tr key={b.id}>
                  <td style={cellule}>{t(`paieBarType_${b.type}`)}<div style={{ fontSize: 11, color: "var(--sub)" }}>{b.libelle}</div></td>
                  <td style={cellule}>{b.annee}</td>
                  <td style={{ ...cellule, ...droite }}>{fmt(b.nb_lignes)}</td>
                  <td style={cellule}>{t("paieBarEntreprise")}<div style={{ fontSize: 11, color: "var(--sub)" }}>{b.source}</div></td>
                  <td style={cellule}>{bar.effectif[b.type === "IR_MENSUEL" ? "ir" : "trimf"].source === "ENTREPRISE" && bar.effectif[b.type === "IR_MENSUEL" ? "ir" : "trimf"].annee === b.annee && <Pastille ton="ok">{t("paieEnVigueur")}</Pastille>}</td>
                  {peutModifier && <td style={cellule}><button style={boutonDanger} onClick={() => supprimerBareme(b)}>{t("paieSupprimer")}</button></td>}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {peutModifier && (
          <div style={{ marginTop: 16, borderTop: "1px solid var(--line-soft)", paddingTop: 14 }}>
            <h3 style={{ fontSize: 13, margin: "0 0 4px" }}>{t("paieBarImportTitre")}</h3>
            <p style={{ fontSize: 11.5, color: "var(--sub)", margin: "0 0 10px", lineHeight: 1.5 }}>{t("paieBarImportAide")}</p>
            <div style={grille}>
              <Champ label={t("paieBarType")}>
                <select style={inputStyle} value={imp.type} onChange={(e) => setImp({ ...imp, type: e.target.value })}>
                  <option value="IR_MENSUEL">{t("paieBarType_IR_MENSUEL")}</option>
                  <option value="TRIMF_ANNUEL">{t("paieBarType_TRIMF_ANNUEL")}</option>
                </select>
              </Champ>
              <Champ label={t("paieBarAnneeApplication")}><input type="number" style={inputStyle} value={imp.annee} onChange={(e) => setImp({ ...imp, annee: e.target.value })} /></Champ>
              <Champ label={t("paieBarFeuille")}><input style={inputStyle} value={imp.feuille} onChange={(e) => setImp({ ...imp, feuille: e.target.value })} placeholder="Trimf Mensuel" /></Champ>
              <Champ label={t("paieFichierExcel")}><input type="file" accept=".xlsx,.xlsm,.xls" onChange={(e) => setImp({ ...imp, fichier: e.target.files[0] || null })} style={{ fontSize: 12 }} /></Champ>
            </div>
            <div style={{ marginTop: 12 }}><button style={boutonPrincipal} onClick={importer}>{t("paieImporter")}</button></div>
          </div>
        )}
      </Section>

      <Section titre={t("paieCtlTitre")} aide={t("paieCtlAide")}>
        <div style={grille}>
          <Champ label={t("paieCtlImposable")}><input type="number" style={inputStyle} value={ctl.imposable} onChange={(e) => setCtl({ ...ctl, imposable: e.target.value })} /></Champ>
          <Champ label={t("paieCtlParts")}>
            <select style={inputStyle} value={ctl.parts} onChange={(e) => setCtl({ ...ctl, parts: e.target.value })}>
              {[1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5].map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
          </Champ>
          <Champ label={t("paieBarAnnee")}><input type="number" style={inputStyle} value={ctl.annee} onChange={(e) => setCtl({ ...ctl, annee: e.target.value })} /></Champ>
        </div>
        <div style={{ marginTop: 12 }}><button style={boutonLeger} onClick={controler}>{t("paieCtlCalculer")}</button></div>
        {res && (
          <div style={{ marginTop: 12, display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))", gap: 10 }}>
            <div className="card"><div style={{ fontSize: 11, color: "var(--sub)" }}>{t("paieCtlIrTable")} ({res.ir_table.source === "TABLE" ? t("paieCtlSourceTable") : res.ir_table.source === "SOUS_TABLE" ? t("paieCtlSousTable") : t("paieCtlSourceFormule")})</div><div style={{ fontSize: 20, fontWeight: 700 }}>{fmt(res.ir_table.montant)} F</div></div>
            <div className="card"><div style={{ fontSize: 11, color: "var(--sub)" }}>{t("paieCtlIrFormule")}</div><div style={{ fontSize: 20, fontWeight: 700 }}>{fmt(res.ir_formule)} F</div></div>
            <div className="card"><div style={{ fontSize: 11, color: "var(--sub)" }}>{t("paieCtlTrimf")}</div><div style={{ fontSize: 20, fontWeight: 700 }}>{fmt(res.trimf.mensuel)} F</div><div style={{ fontSize: 11, color: "var(--sub)" }}>{t("paieCtlTrimfAnnuel")} : {fmt(res.trimf.annuel)} F</div></div>
          </div>
        )}
      </Section>

      <Section titre={t("paieFormTitre")} aide={t("paieFormAide")}>
        <Statut s={sf} />
        {!edit && (
          <>
            {formule.versions.map((v) => (
              <div key={v.id} style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", padding: "8px 0", borderBottom: "1px solid var(--line-soft)", fontSize: 12.5 }}>
                <b>{t("paieCotDateEffet")} {v.date_effet}</b>
                <span style={{ color: "var(--sub)" }}>{t("paieFormAbattement")} {v.formule.abattement_taux} % ({t("paieFormPlafond")} {fmt(v.formule.abattement_plafond)}) · {v.formule.tranches.length} {t("paieFormTranches")}</span>
                <span style={{ flex: 1 }} />
                {peutModifier && <><button style={boutonLeger} onClick={() => ouvrir(v)}>{t("paieModifier")}</button><button style={boutonDanger} onClick={() => supprimerFormule(v)}>{t("paieSupprimer")}</button></>}
              </div>
            ))}
            {peutModifier && <div style={{ marginTop: 12 }}><button style={boutonLeger} onClick={() => ouvrir(null)}>{t("paieFormNouvelle")}</button></div>}
          </>
        )}
        {edit && (
          <div>
            <div style={grille}>
              <Champ label={t("paieCotDateEffet")}><input type="date" style={inputStyle} value={edit.date_effet} onChange={(e) => setEdit({ ...edit, date_effet: e.target.value })} /></Champ>
              <Champ label={t("paieFormAbattementTaux")}><input type="number" style={inputStyle} value={edit.formule.abattement_taux} onChange={(e) => setEdit({ ...edit, formule: { ...edit.formule, abattement_taux: Number(e.target.value) } })} /></Champ>
              <Champ label={t("paieFormAbattementPlafond")}><input type="number" style={inputStyle} value={edit.formule.abattement_plafond} onChange={(e) => setEdit({ ...edit, formule: { ...edit.formule, abattement_plafond: Number(e.target.value) } })} /></Champ>
            </div>
            <h4 style={{ fontSize: 12.5, margin: "14px 0 6px" }}>{t("paieFormBareme")}</h4>
            <table style={{ borderCollapse: "collapse" }}>
              <thead><tr><th style={enteteCellule}>{t("paieFormDe")}</th><th style={enteteCellule}>{t("paieFormA")}</th><th style={enteteCellule}>{t("paieFormTaux")}</th></tr></thead>
              <tbody>
                {edit.formule.tranches.map((x, i) => (
                  <tr key={i}>
                    <td style={cellule}><input type="number" style={{ ...inputStyle, width: 130 }} value={x.de} disabled /></td>
                    <td style={cellule}>{x.a == null ? <span style={{ fontSize: 12, color: "var(--sub)" }}>{t("paieFormAuDela")}</span> : <input type="number" style={{ ...inputStyle, width: 130 }} value={x.a} onChange={(e) => majTranche(i, "a", e.target.value)} />}</td>
                    <td style={cellule}><input type="number" style={{ ...inputStyle, width: 80 }} value={x.taux} onChange={(e) => majTranche(i, "taux", e.target.value)} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div style={{ display: "flex", gap: 8, marginTop: 8 }}><button style={boutonLeger} onClick={ajouterTranche}>{t("paieFormAjouterTranche")}</button><button style={boutonLeger} onClick={retirerTranche}>{t("paieFormRetirerTranche")}</button></div>
            <h4 style={{ fontSize: 12.5, margin: "14px 0 6px" }}>{t("paieFormReductions")}</h4>
            <table style={{ borderCollapse: "collapse" }}>
              <thead><tr><th style={enteteCellule}>{t("paieCtlParts")}</th><th style={enteteCellule}>{t("paieFormTauxRed")}</th><th style={enteteCellule}>{t("paieFormMin")}</th><th style={enteteCellule}>{t("paieFormMax")}</th></tr></thead>
              <tbody>
                {edit.formule.reductions.map((x, i) => (
                  <tr key={i}>
                    <td style={cellule}>{fmtDec(x.parts, 1)}</td>
                    <td style={cellule}><input type="number" style={{ ...inputStyle, width: 80 }} value={x.taux} onChange={(e) => majRed(i, "taux", e.target.value)} /></td>
                    <td style={cellule}><input type="number" style={{ ...inputStyle, width: 120 }} value={x.minimum} onChange={(e) => majRed(i, "minimum", e.target.value)} /></td>
                    <td style={cellule}><input type="number" style={{ ...inputStyle, width: 120 }} value={x.maximum} onChange={(e) => majRed(i, "maximum", e.target.value)} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div style={{ display: "flex", gap: 8, marginTop: 14 }}><button style={boutonPrincipal} onClick={enregistrerFormule}>{t("paieEnregistrer")}</button><button style={boutonLeger} onClick={() => setEdit(null)}>{t("paieAnnuler")}</button></div>
          </div>
        )}
      </Section>
    </div>
  );
}
