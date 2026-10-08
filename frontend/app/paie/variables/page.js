"use client";

import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { api } from "../../../lib/api";
import { useLangue } from "../../../lib/i18n/LanguageContext";
import AppShell from "../../../lib/components/AppShell";
import PaieSousNav from "../../../lib/components/PaieSousNav";
import { Pastille, inputStyle, boutonPrincipal, boutonLeger, boutonDanger, libelleHs, cellule, enteteCellule, droite, fmt, fmtDec, useStatut, Statut, tonStatut } from "../../../lib/components/paieUi";

const ligneStyle = { display: "flex", gap: 8, alignItems: "center", marginBottom: 6, flexWrap: "wrap" };

function Contenu() {
  const { t } = useLangue();
  const params = useSearchParams();
  const [periodes, setPeriodes] = useState(null);
  const [periodeId, setPeriodeId] = useState(params.get("periode") || "");
  const [emps, setEmps] = useState(null);
  const [refs, setRefs] = useState({ rubriques: [], absences: [], hs: [] });
  const [choisi, setChoisi] = useState(null);
  const [q, setQ] = useState("");
  const [panneau, setPanneau] = useState("");
  const [copie, setCopie] = useState({ GAIN: true, RETENUE: false });
  const [dem, setDem] = useState(null);
  const [codeHs, setCodeHs] = useState("HS_15");
  const [rapport, setRapport] = useState(null);
  const [version, setVersion] = useState(0);
  const fichier = useRef(null);
  const s = useStatut();

  useEffect(() => {
    api.paiePeriodes().then((d) => {
      setPeriodes(d.periodes);
      if (!periodeId) {
        const ouverte = d.periodes.find((p) => p.statut === "OUVERTE") || d.periodes[0];
        if (ouverte) setPeriodeId(ouverte.id);
      }
    }).catch(s.ko);
    api.paieReferentielsVariables().then(setRefs).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const rafraichir = (id = periodeId) => id && api.paiePeriodeEmployes(id).then((d) => setEmps(d.employes)).catch(s.ko);
  useEffect(() => { setEmps(null); setChoisi(null); setPanneau(""); setRapport(null); if (periodeId) rafraichir(periodeId); // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [periodeId]);

  const periode = periodes && periodes.find((p) => p.id === periodeId);
  const modifiable = periode && periode.statut === "OUVERTE";
  const nomMois = (p) => `${t(`paieMoisNom_${p.mois}`)} ${p.annee}`;
  const visibles = useMemo(() => {
    if (!emps) return [];
    const n = q.trim().toLowerCase();
    return emps.filter((e) => !n || `${e.nom || ""} ${e.prenom || ""} ${e.matricule || ""}`.toLowerCase().includes(n));
  }, [emps, q]);

  async function action(fn, message) {
    s.raz();
    try { const r = await fn(); if (message) s.ok(typeof message === "function" ? message(r) : message); await rafraichir(); setVersion((v) => v + 1); return r; } catch (e) { s.ko(e); return null; }
  }
  async function importer(e) {
    const f = e.target.files && e.target.files[0];
    e.target.value = "";
    if (!f) return;
    const fd = new FormData();
    fd.append("fichier", f);
    const r = await action(() => api.paieImporterVariables(periodeId, fd));
    if (r) { setRapport(r); if (!r.erreurs.length) s.ok(t("paieImportOk").replace("{n}", r.lignes_importees)); }
  }
  async function ouvrirDemandes() {
    setPanneau(panneau === "demandes" ? "" : "demandes");
    if (panneau !== "demandes") { try { setDem(await api.paieDemandesRh(periodeId)); } catch (e) { s.ko(e); } }
  }

  return (
    <AppShell title={t("paieVariablesTitre")} subNav={<PaieSousNav />}>
      <p style={{ fontSize: 12.5, color: "var(--sub)", marginBottom: 14, maxWidth: 800, lineHeight: 1.5 }}>{t("paieVariablesAide")}</p>
      <Statut s={s} />
      {periodes && periodes.length === 0 && (
        <div className="card"><p style={{ fontSize: 12.5, margin: "0 0 10px" }}>{t("paieAucunePeriodeOuverte")}</p><Link href="/paie/mois" style={{ ...boutonPrincipal, textDecoration: "none", display: "inline-block" }}>{t("paieAllerPaieDuMois")}</Link></div>
      )}
      {periodes && periodes.length > 0 && (
        <>
          <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", marginBottom: 12 }}>
            <select style={{ ...inputStyle, width: 220 }} value={periodeId} onChange={(e) => setPeriodeId(e.target.value)}>
              {periodes.map((p) => <option key={p.id} value={p.id}>{nomMois(p)} — {t(`paieStatutPeriode_${p.statut}`)}</option>)}
            </select>
            {periode && <Pastille ton={tonStatut[periode.statut]}>{t(`paieStatutPeriode_${periode.statut}`)}</Pastille>}
            {periode && <Link href={`/paie/mois/${periode.id}`} style={{ fontSize: 12.5, color: "var(--petrol)" }}>{t("paieVoirPaieDuMois")} →</Link>}
          </div>
          {periode && !modifiable && <p style={{ fontSize: 12.5, color: "#B26A00", marginBottom: 12 }}>{t("paieVariablesFigees")}</p>}

          {modifiable && (
            <div className="card" style={{ marginBottom: 14 }}>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <button style={boutonLeger} onClick={() => api.paieGabaritVariables(periodeId).catch(s.ko)}>{t("paieModeleExcel")}</button>
                <button style={boutonLeger} onClick={() => fichier.current && fichier.current.click()}>{t("paieImporterExcel")}</button>
                <input ref={fichier} type="file" accept=".xlsx,.xls" style={{ display: "none" }} onChange={importer} />
                <button style={boutonLeger} onClick={() => setPanneau(panneau === "copie" ? "" : "copie")}>{t("paieCopierPrecedent")}</button>
                <button style={boutonLeger} onClick={ouvrirDemandes}>{t("paieReprendreDemandes")}</button>
                <button style={boutonLeger} onClick={() => action(() => api.paieGenerer(periodeId), t("paieRecalcule"))}>{t("paieRecalculer")}</button>
              </div>
              {panneau === "copie" && (
                <div style={{ marginTop: 12, paddingTop: 12, borderTop: "1px solid var(--line-soft)" }}>
                  <p style={{ fontSize: 12.5, margin: "0 0 8px", color: "var(--sub)" }}>{t("paieCopieAide")}</p>
                  <label style={{ fontSize: 12.5, marginRight: 14 }}><input type="checkbox" checked={copie.GAIN} onChange={(e) => setCopie({ ...copie, GAIN: e.target.checked })} /> {t("paieCopiePrimes")}</label>
                  <label style={{ fontSize: 12.5, marginRight: 14 }}><input type="checkbox" checked={copie.RETENUE} onChange={(e) => setCopie({ ...copie, RETENUE: e.target.checked })} /> {t("paieCopieRetenues")}</label>
                  <button style={boutonPrincipal} onClick={() => action(() => api.paieCopierVariables(periodeId, Object.keys(copie).filter((k) => copie[k])), (r) => t("paieCopieFait").replace("{n}", r.copiees))}>{t("paieCopierMaintenant")}</button>
                </div>
              )}
              {panneau === "demandes" && dem && (
                <div style={{ marginTop: 12, paddingTop: 12, borderTop: "1px solid var(--line-soft)" }}>
                  <p style={{ fontSize: 12.5, margin: "0 0 8px", color: "var(--sub)" }}>{t("paieDemandesAide")}</p>
                  <p style={{ fontSize: 12.5, margin: "0 0 8px" }}>{t("paieDemandesResume").replace("{c}", dem.conges.length).replace("{h}", dem.heures.length)}</p>
                  {dem.heures.length > 0 && (
                    <label style={{ fontSize: 12.5, display: "block", marginBottom: 8 }}>{t("paieDemandesCodeHs")}{" "}
                      <select style={{ ...inputStyle, width: 260, display: "inline-block" }} value={codeHs} onChange={(e) => setCodeHs(e.target.value)}>{refs.hs.map((h) => <option key={h.code} value={h.code}>{libelleHs(h)}</option>)}</select>
                    </label>
                  )}
                  <button style={boutonPrincipal} disabled={!dem.conges.length && !dem.heures.length} onClick={() => action(() => api.paieAppliquerDemandesRh(periodeId, codeHs), (r) => t("paieDemandesFait").replace("{n}", r.appliquees))}>{t("paieDemandesAppliquer")}</button>
                </div>
              )}
              {rapport && rapport.erreurs.length > 0 && (
                <div style={{ marginTop: 12, paddingTop: 12, borderTop: "1px solid var(--line-soft)" }}>
                  <p style={{ fontSize: 12.5, margin: "0 0 6px" }}>{t("paieImportRapport").replace("{n}", rapport.lignes_importees).replace("{e}", rapport.erreurs.length)}</p>
                  {rapport.erreurs.slice(0, 15).map((e, i) => <div key={i} style={{ fontSize: 12, color: "var(--brique)" }}>{t("paieImportLigne")} {e.ligne} : {t(`paieImportErr_${e.raison}`) === `paieImportErr_${e.raison}` ? e.raison : t(`paieImportErr_${e.raison}`)}{e.valeur ? ` (${e.valeur})` : ""}</div>)}
                </div>
              )}
            </div>
          )}

          <div style={{ display: "grid", gridTemplateColumns: choisi ? "minmax(360px, 1fr) minmax(380px, 1.1fr)" : "1fr", gap: 14, alignItems: "start" }} className="paie-var">
            <div style={{ minWidth: 0 }}>
              <input style={{ ...inputStyle, maxWidth: 280, marginBottom: 10 }} placeholder={t("paieRechercher")} value={q} onChange={(e) => setQ(e.target.value)} />
              {!emps ? <p style={{ fontSize: 12.5, color: "var(--sub)" }}>{t("loading")}</p> : (
                <div className="card" style={{ overflowX: "auto", padding: 0 }}>
                  <table style={{ width: "100%", borderCollapse: "collapse" }}>
                    <thead><tr>
                      <th style={enteteCellule}>{t("paieSalarie")}</th><th style={enteteCellule}>{t("paieVariablesSaisies")}</th>
                      <th style={{ ...enteteCellule, ...droite }}>{t("paieNetEstime")}</th><th style={enteteCellule}></th>
                    </tr></thead>
                    <tbody>
                      {visibles.map((e) => (
                        <tr key={e.id} style={{ background: choisi && choisi.id === e.id ? "rgba(15,76,92,0.07)" : "transparent" }}>
                          <td style={cellule}><b>{e.nom} {e.prenom}</b><div style={{ fontSize: 11, color: "var(--sub)" }}>{e.matricule}{e.poste ? ` · ${e.poste}` : ""}</div></td>
                          <td style={cellule}>
                            {!e.dossier_complet ? <Pastille ton="erreur">{t("paieDossierIncomplet")}</Pastille> : e.exclu ? <Pastille ton="neutre">{t("paieExcluPaie")}</Pastille> : e.nb_variables === 0 ? <span style={{ fontSize: 11.5, color: "var(--sub)" }}>—</span> : (
                              <span style={{ display: "inline-flex", gap: 4, flexWrap: "wrap" }}>
                                {e.variables.HS > 0 && <Pastille ton="neutre">{t("paieVarHs")} {e.variables.HS}</Pastille>}
                                {e.variables.ABSENCE > 0 && <Pastille ton="neutre">{t("paieVarAbs")} {e.variables.ABSENCE}</Pastille>}
                                {e.variables.GAIN > 0 && <Pastille ton="neutre">{t("paieVarGains")} {e.variables.GAIN}</Pastille>}
                                {e.variables.RETENUE > 0 && <Pastille ton="neutre">{t("paieVarRet")} {e.variables.RETENUE}</Pastille>}
                              </span>
                            )}
                          </td>
                          <td style={{ ...cellule, ...droite }}>{e.net_a_payer == null ? "—" : fmt(e.net_a_payer)} {e.avertissements > 0 && <Pastille ton="alerte">!</Pastille>}</td>
                          <td style={{ ...cellule, textAlign: "right" }}>{e.dossier_complet && !e.exclu && <button style={boutonLeger} onClick={() => setChoisi(e)}>{modifiable ? t("paieSaisir") : t("paieVoir")}</button>}
                            {!e.dossier_complet && <Link href={`/paie/dossiers/${e.id}`} style={{ fontSize: 12, color: "var(--petrol)" }}>{t("paieCompleterDossier")}</Link>}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
            {choisi && <Editeur key={`${periodeId}-${choisi.id}-${version}`} periodeId={periodeId} employe={choisi} refs={refs} modifiable={modifiable} t={t} onFermer={() => setChoisi(null)} onSauve={() => rafraichir()} />}
          </div>
        </>
      )}
      <style>{`@media (max-width: 1000px) { .paie-var { grid-template-columns: 1fr !important; } }`}</style>
    </AppShell>
  );
}

function Editeur({ periodeId, employe, refs, modifiable, t, onFermer, onSauve }) {
  const [d, setD] = useState(null);
  const [hs, setHs] = useState([]);
  const [absences, setAbsences] = useState([]);
  const [gains, setGains] = useState([]);
  const [retenues, setRetenues] = useState([]);
  const [sale, setSale] = useState(false);
  const s = useStatut();

  function appliquer(r) {
    setD(r);
    const v = r.variables;
    setHs(v.hs.map((x) => ({ code: x.code, heures: String(x.heures) })));
    setAbsences(v.absences.map((x) => ({ type: x.type, jours: String(x.jours) })));
    setGains(v.gains.map((x) => ({ rubrique_code: x.rubrique_code, montant: x.montant == null ? "" : String(x.montant), quantite: x.quantite == null ? "" : String(x.quantite) })));
    setRetenues(v.retenues.map((x) => ({ rubrique_code: x.rubrique_code, montant: String(x.montant) })));
    setSale(false);
  }
  useEffect(() => { api.paieVariablesEmploye(periodeId, employe.id).then(appliquer).catch(s.ko); // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [periodeId, employe.id]);

  if (!d) return <div className="card"><Statut s={s} /><p style={{ fontSize: 12.5, color: "var(--sub)" }}>{t("loading")}</p></div>;
  const majs = d.majorations && d.majorations.length ? d.majorations : refs.hs;
  const rubGains = refs.rubriques.filter((r) => r.sens !== "RETENUE");
  const rubRet = refs.rubriques.filter((r) => r.sens === "RETENUE");
  const rubDe = (code) => refs.rubriques.find((r) => r.code === code);
  const maj = (liste, setListe, i, k, v) => { setSale(true); setListe(liste.map((l, j) => (j === i ? { ...l, [k]: v } : l))); };
  const retirer = (liste, setListe, i) => { setSale(true); setListe(liste.filter((_, j) => j !== i)); };
  const ajouter = (liste, setListe, ligne) => { setSale(true); setListe([...liste, ligne]); };
  const dis = !modifiable;

  async function enregistrer() {
    s.raz();
    try {
      const r = await api.paieEnregistrerVariables(periodeId, employe.id, {
        hs: hs.map((x) => ({ code: x.code, heures: x.heures })), absences: absences.map((x) => ({ type: x.type, jours: x.jours })),
        gains: gains.map((x) => ({ rubrique_code: x.rubrique_code, montant: x.montant, quantite: x.quantite })), retenues: retenues.map((x) => ({ rubrique_code: x.rubrique_code, montant: x.montant })),
      });
      const detail = await api.paieVariablesEmploye(periodeId, employe.id);
      appliquer({ ...detail, bulletin: r.bulletin || detail.bulletin });
      s.ok(t("paieVariablesEnregistrees"));
      onSauve();
    } catch (e) { s.ko(e); }
  }
  const b = d.bulletin;
  const bouton = (libelle, fn) => !dis && <button style={boutonLeger} onClick={fn}>+ {libelle}</button>;
  const rubChoix = (liste, valeur, onChange) => (
    <select style={{ ...inputStyle, flex: "1 1 210px", minWidth: 0 }} value={valeur} onChange={onChange} disabled={dis}>{liste.map((r) => <option key={r.code} value={r.code}>{r.libelle}</option>)}</select>
  );

  return (
    <div className="card" style={{ position: "sticky", top: 12 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 10 }}>
        <div><h3 style={{ fontSize: 14, margin: 0 }}>{d.employe.nom} {d.employe.prenom}</h3><div style={{ fontSize: 11.5, color: "var(--sub)" }}>{d.employe.matricule} · {d.employe.convention_libelle || "—"}</div></div>
        <button style={boutonLeger} onClick={onFermer}>{t("paieFermer")}</button>
      </div>
      <Statut s={s} />

      <h4 style={{ fontSize: 12, margin: "0 0 6px" }}>{t("paieSimHs")}</h4>
      {hs.map((l, i) => (
        <div key={i} style={ligneStyle}>
          <select style={{ ...inputStyle, flex: "1 1 210px", minWidth: 0 }} value={l.code} onChange={(e) => maj(hs, setHs, i, "code", e.target.value)} disabled={dis}>{majs.map((m) => <option key={m.code} value={m.code}>{libelleHs(m)}</option>)}</select>
          <input type="number" step="0.25" style={{ ...inputStyle, width: 90 }} value={l.heures} onChange={(e) => maj(hs, setHs, i, "heures", e.target.value)} placeholder={t("paieHeures")} disabled={dis} />
          {!dis && <button style={boutonDanger} onClick={() => retirer(hs, setHs, i)}>×</button>}
        </div>
      ))}
      {bouton(t("paieSimAjouterHs"), () => ajouter(hs, setHs, { code: majs[0] ? majs[0].code : "", heures: "" }))}

      <h4 style={{ fontSize: 12, margin: "14px 0 6px" }}>{t("paieSimAbsences")}</h4>
      {absences.map((l, i) => (
        <div key={i} style={ligneStyle}>
          <select style={{ ...inputStyle, flex: "1 1 210px", minWidth: 0 }} value={l.type} onChange={(e) => maj(absences, setAbsences, i, "type", e.target.value)} disabled={dis}>{refs.absences.map((a) => <option key={a.code} value={a.code}>{a.libelle}</option>)}</select>
          <input type="number" step="0.5" style={{ ...inputStyle, width: 90 }} value={l.jours} onChange={(e) => maj(absences, setAbsences, i, "jours", e.target.value)} placeholder={t("paieJours")} disabled={dis} />
          {!dis && <button style={boutonDanger} onClick={() => retirer(absences, setAbsences, i)}>×</button>}
        </div>
      ))}
      {bouton(t("paieSimAjouterAbsence"), () => ajouter(absences, setAbsences, { type: refs.absences[0] ? refs.absences[0].code : "", jours: "" }))}

      <h4 style={{ fontSize: 12, margin: "14px 0 6px" }}>{t("paieSimGains")}</h4>
      {gains.map((l, i) => {
        const r = rubDe(l.rubrique_code);
        const qte = r && r.mode === "QUANTITE";
        return (
          <div key={i} style={ligneStyle}>
            {rubChoix(rubGains, l.rubrique_code, (e) => { const n = rubDe(e.target.value); setSale(true); setGains(gains.map((g, j) => (j === i ? { ...g, rubrique_code: e.target.value, montant: n && n.montant_defaut != null && n.mode !== "QUANTITE" ? String(n.montant_defaut) : g.montant } : g))); })}
            {qte && <input type="number" step="0.01" style={{ ...inputStyle, width: 80 }} value={l.quantite} onChange={(e) => maj(gains, setGains, i, "quantite", e.target.value)} placeholder={t("paieQuantite")} disabled={dis} />}
            <input type="number" style={{ ...inputStyle, width: 150 }} value={l.montant} onChange={(e) => maj(gains, setGains, i, "montant", e.target.value)} placeholder={qte ? `${t("paieMontantUnitaire")}${r.montant_defaut != null ? ` (${fmt(r.montant_defaut)})` : ""}` : t("paieMontant")} disabled={dis} />
            {!dis && <button style={boutonDanger} onClick={() => retirer(gains, setGains, i)}>×</button>}
          </div>
        );
      })}
      {bouton(t("paieSimAjouterGain"), () => ajouter(gains, setGains, { rubrique_code: rubGains[0] ? rubGains[0].code : "", montant: rubGains[0] && rubGains[0].montant_defaut != null && rubGains[0].mode !== "QUANTITE" ? String(rubGains[0].montant_defaut) : "", quantite: "" }))}

      <h4 style={{ fontSize: 12, margin: "14px 0 6px" }}>{t("paieSimRetenues")}</h4>
      {retenues.map((l, i) => (
        <div key={i} style={ligneStyle}>
          {rubChoix(rubRet, l.rubrique_code, (e) => maj(retenues, setRetenues, i, "rubrique_code", e.target.value))}
          <input type="number" style={{ ...inputStyle, width: 110 }} value={l.montant} onChange={(e) => maj(retenues, setRetenues, i, "montant", e.target.value)} placeholder={t("paieMontant")} disabled={dis} />
          {!dis && <button style={boutonDanger} onClick={() => retirer(retenues, setRetenues, i)}>×</button>}
        </div>
      ))}
      {bouton(t("paieSimAjouterRetenue"), () => ajouter(retenues, setRetenues, { rubrique_code: rubRet[0] ? rubRet[0].code : "", montant: "" }))}

      {!dis && <div style={{ marginTop: 16 }}><button style={boutonPrincipal} onClick={enregistrer}>{t("paieEnregistrerVariables")}</button>{sale && <span style={{ fontSize: 11.5, color: "#B26A00", marginLeft: 10 }}>{t("paieNonEnregistre")}</span>}</div>}

      {b && (
        <div style={{ marginTop: 16, padding: "12px 14px", background: "rgba(15,76,92,0.06)", borderRadius: 8 }}>
          <div style={{ display: "flex", gap: 18, flexWrap: "wrap", fontSize: 12.5 }}>
            <span>{t("paieBullBrut")} : <b>{fmt(b.totaux.brut)}</b></span>
            <span>{t("paieBullTotalRetenues")} : <b>{fmt(b.total_retenues)}</b></span>
            <span>{t("paieBullNet")} : <b style={{ color: "var(--petrol)" }}>{fmt(b.net_a_payer)} F</b></span>
          </div>
          {b.jours && b.jours.absences_retenues > 0 && <div style={{ fontSize: 11.5, color: "var(--sub)", marginTop: 4 }}>{t("paieJoursAbsences")} : {fmtDec(b.jours.absences_retenues, 1)} · {t("paieJoursPayes")} : {fmtDec(b.jours.payes, 1)}</div>}
          {b.avertissements.filter((a) => a.niveau !== "INFO").map((a, i) => <div key={i} style={{ fontSize: 12, marginTop: 4 }}><Pastille ton={a.niveau === "BLOQUANT" ? "erreur" : "alerte"}>{t(`paieAvert_${a.niveau}`)}</Pastille> {t(`paieAvert_${a.code}`)}{a.valeur ? ` (${a.valeur})` : ""}</div>)}
          <div style={{ marginTop: 6 }}><Link href={`/paie/mois/${periodeId}?tab=bulletins&employe=${employe.id}`} style={{ fontSize: 12, color: "var(--petrol)" }}>{t("paieVoirBulletin")} →</Link></div>
        </div>
      )}
    </div>
  );
}

export default function VariablesPage() {
  return (
    <Suspense fallback={null}>
      <Contenu />
    </Suspense>
  );
}
