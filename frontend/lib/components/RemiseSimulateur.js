"use client";

import { Fragment, useEffect, useRef, useState } from "react";
import { api, estAdmin } from "../api";
import { useLangue } from "../i18n/LanguageContext";

// Fenetre « Negocier une remise » (09/10/2026) : le client accepte le devis mais demande une remise. La simulation
// (rien n'est enregistre) montre la marge avant / apres ; « Appliquer » enregistre la remise sur le devis, qui sera
// facture exactement a ce montant. Le calcul est fait cote serveur (GET /ventes/devis/:id/simulation-remise).

const MODES = [
  ["POURCENTAGE", "remiseModePourcentage"],
  ["MONTANT", "remiseModeMontant"],
  ["NET_TTC", "remiseModeNetTtc"],
];

export default function RemiseSimulateur({ devis, onClose, onApplied }) {
  const { t, dict } = useLangue();
  const locale = dict.dateLocale;
  const nf = (x, max = 2) => (x === null || x === undefined || Number.isNaN(Number(x)) ? "—" : Number(x) === 0 ? "0" : Number(x).toLocaleString(locale, { maximumFractionDigits: max }));
  const [mode, setMode] = useState("POURCENTAGE");
  const [valeur, setValeur] = useState(String(Math.round(Number(devis.pourcentage_remise || 0) * 100) / 100));
  const [sim, setSim] = useState(null);
  const [erreur, setErreur] = useState("");
  const [chargement, setChargement] = useState(false);
  const [application, setApplication] = useState(false);
  const [motif, setMotif] = useState("");
  const [historique, setHistorique] = useState([]);
  const [historiqueOuvert, setHistoriqueOuvert] = useState(false);
  const compteur = useRef(0);
  const [details, setDetails] = useState({});

  // Simulation recalculee a chaque saisie (petit delai pour ne pas appeler l'API a chaque touche).
  useEffect(() => {
    if (valeur === "" || Number.isNaN(Number(valeur))) {
      setSim(null);
      return undefined;
    }
    const numero = ++compteur.current;
    setChargement(true);
    const minuteur = setTimeout(() => {
      api
        .simulerRemiseDevis(devis.id, mode, valeur)
        .then((r) => {
          if (numero !== compteur.current) return;
          setSim(r);
          setErreur("");
        })
        .catch((err) => {
          if (numero !== compteur.current) return;
          setSim(null);
          setErreur(err.message);
        })
        .finally(() => numero === compteur.current && setChargement(false));
    }, 350);
    return () => clearTimeout(minuteur);
  }, [mode, valeur, devis.id]);

  useEffect(() => {
    api.getRemisesDevis(devis.id).then(setHistorique).catch(() => {});
  }, [devis.id]);

  // Echap ferme la fenetre.
  useEffect(() => {
    const onKey = (e) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  function changerMode(nouveau) {
    // Convertit la valeur affichee pour rester sur la meme remise en changeant d'unite.
    if (sim && sim.simule) {
      const s = sim.simule;
      const v = nouveau === "POURCENTAGE" ? Math.round(s.pourcentage_remise * 100) / 100 : nouveau === "MONTANT" ? s.montant_remise : s.total_ttc;
      setValeur(String(v));
    } else setValeur("");
    setMode(nouveau);
  }

  const facturesExistantes = sim ? sim.factures_existantes : 0;
  const bloqueFacture = facturesExistantes > 0 && !estAdmin();
  const inchange = sim && Math.abs(sim.simule.total_ttc - sim.actuel.total_ttc) < 0.005;

  async function appliquer() {
    if (!sim) return;
    setApplication(true);
    setErreur("");
    try {
      const maj = await api.appliquerRemiseDevis(devis.id, { mode, valeur: Number(valeur), total_ttc_attendu: sim.simule.total_ttc, motif: motif.trim() || undefined });
      onApplied(maj);
    } catch (err) {
      setErreur(err.message);
    } finally {
      setApplication(false);
    }
  }

  const couleurMarge = (m) => (m === null || m === undefined ? "var(--sub)" : m < 0 ? "var(--brique)" : "var(--ink)");
  const ecart = (a, b) => (a === null || b === null || a === undefined || b === undefined ? null : Math.round((b - a) * 100) / 100);
  const lignesCout = sim ? sim.lignes.filter((l) => !l.non_chiffre) : [];

  return (
    <div role="dialog" aria-modal="true" style={fondStyle} onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div style={fenetreStyle}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
          <div>
            <h2 style={{ fontSize: 17, color: "var(--petrol)", margin: 0 }}>{t("remiseTitre")}</h2>
            <div style={{ fontSize: 12, color: "var(--sub)", marginTop: 3 }}>
              {devis.numero} · {devis.client_nom}
            </div>
          </div>
          <button type="button" onClick={onClose} aria-label={t("cancel")} style={{ background: "none", border: "none", fontSize: 22, lineHeight: 1, cursor: "pointer", color: "var(--sub)" }}>×</button>
        </div>
        <p style={{ fontSize: 12.5, color: "var(--sub)", margin: "10px 0 14px" }}>{t("remiseIntro")}</p>

        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end" }}>
          <div>
            <label style={labelStyle}>{t("remiseSaisirEn")}</label>
            <select value={mode} onChange={(e) => changerMode(e.target.value)} style={inputStyle}>
              {MODES.map(([cle, libelle]) => (
                <option key={cle} value={cle}>{t(libelle)}</option>
              ))}
            </select>
          </div>
          <div>
            <label style={labelStyle}>{mode === "POURCENTAGE" ? "%" : "XOF"}</label>
            <input type="number" min="0" step={mode === "POURCENTAGE" ? "0.1" : "1"} value={valeur} onChange={(e) => setValeur(e.target.value)} style={{ ...inputStyle, width: 150 }} autoFocus />
          </div>
          {mode !== "POURCENTAGE" ? null : (
            <div style={{ display: "flex", gap: 6 }}>
              {[2, 5, 10].map((p) => (
                <button key={p} type="button" onClick={() => setValeur(String(p))} style={pastilleStyle}>{p} %</button>
              ))}
            </div>
          )}
          {chargement && <span style={{ fontSize: 11.5, color: "var(--sub)" }}>…</span>}
        </div>

        {erreur && <p style={{ color: "var(--brique)", fontSize: 12.5, margin: "12px 0 0" }}>{erreur}</p>}

        {sim && (
          <>
            <table style={{ width: "100%", borderCollapse: "collapse", marginTop: 16, fontSize: 12.5 }}>
              <thead>
                <tr style={{ color: "var(--sub)", fontSize: 11 }}>
                  <th style={{ ...thStyle, textAlign: "left" }} />
                  <th style={thStyle}>{t("remiseColActuel")}</th>
                  <th style={{ ...thStyle, color: "var(--petrol)" }}>{t("remiseColSimule")}</th>
                  <th style={thStyle}>{t("remiseColEcart")}</th>
                </tr>
              </thead>
              <tbody>
                <LigneRecap libelle={t("remiseTotalHt")} a={sim.total_ht} b={sim.total_ht} nf={nf} />
                <LigneRecap libelle={`${t("venteRemiseLabel")} (${nf(sim.actuel.pourcentage_remise)} % → ${nf(sim.simule.pourcentage_remise)} %)`} a={-sim.actuel.montant_remise} b={-sim.simule.montant_remise} nf={nf} ecartInverse />
                <LigneRecap libelle={t("venteTotalHtNetLabel")} a={sim.actuel.total_ht_net} b={sim.simule.total_ht_net} nf={nf} />
                {sim.taux_tva > 0 && <LigneRecap libelle={`${t("venteTvaLabel")} (${nf(sim.taux_tva)} %)`} a={sim.actuel.montant_tva} b={sim.simule.montant_tva} nf={nf} discret />}
                <LigneRecap libelle={t("venteTotalTtcLabel")} a={sim.actuel.total_ttc} b={sim.simule.total_ttc} nf={nf} fort />
                <LigneRecap libelle={t("remiseMarge")} a={sim.actuel.marge} b={sim.simule.marge} nf={nf} fort couleurB={couleurMarge(sim.simule.marge)} />
                <LigneRecap libelle={t("remiseMargePct")} a={sim.actuel.marge_pct} b={sim.simule.marge_pct} nf={nf} suffixe=" %" fort couleurB={couleurMarge(sim.simule.marge)} />
              </tbody>
            </table>

            {sim.couverture.lignes_avec_cout === 0 ? (
              <p style={avertStyle}>{t("remiseAucunCout")}</p>
            ) : (
              <p style={{ fontSize: 12.5, margin: "12px 0 0", color: couleurMarge(sim.simule.marge), fontWeight: 600 }}>
                {t("remiseMargePasse")
                  .replace("{a}", nf(sim.actuel.marge_pct))
                  .replace("{b}", nf(sim.simule.marge_pct))
                  .replace("{d}", nf(ecart(sim.actuel.marge, sim.simule.marge), 0))}
              </p>
            )}
            {sim.couverture.lignes_avec_cout > 0 && sim.couverture.lignes_avec_cout < sim.couverture.lignes_chiffrees && (
              <p style={avertStyle}>
                {t("remiseCouverturePartielle").replace("{a}", String(sim.couverture.lignes_avec_cout)).replace("{b}", String(sim.couverture.lignes_chiffrees))}
              </p>
            )}

            <div style={{ overflowX: "auto", marginTop: 14 }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                <thead>
                  <tr style={{ color: "var(--sub)", fontSize: 11 }}>
                    <th style={{ ...thStyle, textAlign: "left" }}>{t("venteDesignationLabel")}</th>
                    <th style={thStyle}>{t("remiseColQte")}</th>
                    <th style={thStyle}>{t("remiseColPuHt")}</th>
                    <th style={thStyle}>{t("remiseColPuNet")}</th>
                    <th style={thStyle}>{t("remiseColCout")}</th>
                    <th style={thStyle}>{t("remiseColMargeActuelle")}</th>
                    <th style={{ ...thStyle, color: "var(--petrol)" }}>{t("remiseColMargeApres")}</th>
                  </tr>
                </thead>
                <tbody>
                  {lignesCout.map((l) => {
                    const sousCible = l.cout_calculable && l.marge_cible_pct !== null && l.marge_pct_apres !== null && l.marge_pct_apres < l.marge_cible_pct;
                    const d = l.detail_cout;
                    const ouvert = !!details[l.id];
                    return (
                      <Fragment key={l.id}>
                      <tr style={{ borderTop: "1px solid var(--line)" }}>
                        <td style={{ padding: "6px 4px" }}>
                          {l.designation}
                          {l.cout_calculable && l.produit_id && (
                            <div>
                              <button type="button" onClick={() => setDetails((o) => ({ ...o, [l.id]: !o[l.id] }))} style={{ background: "none", border: "none", padding: 0, color: "var(--petrol)", fontSize: 11, cursor: "pointer", fontFamily: "inherit" }}>
                                {ouvert ? "▾" : "▸"} {t("remiseDetailCout")}
                              </button>
                            </div>
                          )}
                          {l.cout_calculable && l.ecart_cout_actuel_pct !== null && Math.abs(l.ecart_cout_actuel_pct) >= 0.5 && (
                            <div style={{ fontSize: 10.5, color: "var(--ocre)" }}>
                              {t("remiseCoutChange").replace("{c}", nf(l.cout_actuel_unitaire, 0)).replace("{p}", `${l.ecart_cout_actuel_pct > 0 ? "+" : ""}${nf(l.ecart_cout_actuel_pct)}`)}
                            </div>
                          )}
                        </td>
                        <td className="mono" style={tdStyle}>{nf(l.quantite)}</td>
                        <td className="mono" style={tdStyle}>{nf(l.prix_unitaire_ht, 0)}</td>
                        <td className="mono" style={tdStyle}>{l.quantite > 0 ? nf(l.montant_ht_net / l.quantite, 0) : "—"}</td>
                        {l.cout_calculable ? (
                          <>
                            <td className="mono" style={tdStyle}>{nf(l.cout_unitaire, 0)}</td>
                            <td className="mono" style={tdStyle}>{nf(l.marge_pct_actuelle)} %</td>
                            <td className="mono" style={{ ...tdStyle, fontWeight: 700, color: l.marge_apres < 0 ? "var(--brique)" : sousCible ? "var(--ocre)" : "var(--ink)" }}>
                              {nf(l.marge_pct_apres)} %
                              {sousCible && <div style={{ fontSize: 10, fontWeight: 400 }}>{t("remiseSousCible").replace("{c}", nf(l.marge_cible_pct, 1))}</div>}
                            </td>
                          </>
                        ) : (
                          <td colSpan={3} style={{ ...tdStyle, fontStyle: "italic", color: "var(--sub)" }}>{t("remiseLigneSansCout")}</td>
                        )}
                      </tr>
                      {ouvert && l.cout_calculable && (
                        <tr>
                          <td colSpan={7} style={{ padding: "2px 4px 10px 18px", background: "var(--bg)" }}>
                            {d ? (
                              <div style={{ fontSize: 11.5 }}>
                                <div style={{ color: "var(--sub)", marginBottom: 4 }}>
                                  {t("remiseDetailReception").replace("{n}", d.reception_numero).replace("{d}", new Date(d.date_reception).toLocaleDateString(locale))}
                                </div>
                                <table style={{ borderCollapse: "collapse" }}>
                                  <tbody>
                                    {Object.entries(d.composantes).map(([type, montant]) => (
                                      <tr key={type}>
                                        <td style={{ padding: "2px 16px 2px 0" }}>{type === "ACHAT" ? t("remiseCoutAchat") : t(`receptionsCoutType${type}`)}</td>
                                        <td className="mono" style={{ padding: "2px 0", textAlign: "right" }}>{nf(montant)}</td>
                                        <td className="mono" style={{ padding: "2px 0 2px 10px", textAlign: "right", color: "var(--sub)" }}>{d.total > 0 ? nf((montant / d.total) * 100, 1) : "—"} %</td>
                                      </tr>
                                    ))}
                                    <tr style={{ borderTop: "1px solid var(--line)", fontWeight: 700 }}>
                                      <td style={{ padding: "3px 16px 2px 0" }}>{t("remiseCoutTotalUnitaire")}</td>
                                      <td className="mono" style={{ padding: "3px 0 2px", textAlign: "right" }}>{nf(d.total)}</td>
                                      <td />
                                    </tr>
                                  </tbody>
                                </table>
                                {!d.frais_paiement_saisis && (
                                  <div style={{ color: "var(--ocre)", marginTop: 4 }}>
                                    {t("remiseFraisPaiementAbsents")}
                                    {d.frais_paiement_estime_unitaire > 0 && ` ${t("remiseFraisPaiementEstime").replace("{m}", nf(d.frais_paiement_estime_unitaire))}`}
                                  </div>
                                )}
                                {Math.abs(Number(d.total) - Number(l.cout_unitaire)) > 1 && (
                                  <div style={{ color: "var(--ocre)", marginTop: 4 }}>{t("remiseDetailEcart").replace("{a}", nf(l.cout_unitaire, 0)).replace("{b}", nf(d.total, 0))}</div>
                                )}
                              </div>
                            ) : (
                              <div style={{ fontSize: 11.5, color: "var(--sub)", fontStyle: "italic" }}>{t("remiseDetailIndispo")}</div>
                            )}
                          </td>
                        </tr>
                      )}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <p style={{ fontSize: 11, color: "var(--sub)", margin: "8px 0 0" }}>{t("remiseNoteCout")}</p>
          </>
        )}

        {sim && facturesExistantes > 0 && <p style={avertStyle}>{bloqueFacture ? t("remiseFactureBloque") : t("remiseFactureAdmin")}</p>}

        <div style={{ marginTop: 14 }}>
          <button type="button" onClick={() => setHistoriqueOuvert((v) => !v)} style={{ background: "none", border: "none", padding: 0, color: "var(--petrol)", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>
            {historiqueOuvert ? "▾" : "▸"} {t("remiseHistorique")} ({historique.length})
          </button>
          {historiqueOuvert && (
            <div style={{ marginTop: 8, display: "grid", gap: 6 }}>
              {historique.length === 0 && <span style={{ fontSize: 12, color: "var(--sub)" }}>{t("remiseHistoriqueVide")}</span>}
              {historique.map((h) => (
                <div key={h.id} style={{ fontSize: 12, padding: "6px 8px", background: "var(--bg)", borderRadius: 6 }}>
                  <strong>{new Date(h.date_application).toLocaleString(locale)}</strong> · {h.utilisateur_nom || "—"} · {nf(h.remise_avant_pct)} % → {nf(h.remise_apres_pct)} % · TTC {nf(h.total_ttc_avant, 0)} → {nf(h.total_ttc_apres, 0)}
                  {h.marge_pct_apres !== null && <> · {t("remiseMargePct")} {nf(h.marge_pct_avant)} % → {nf(h.marge_pct_apres)} %</>}
                  {h.motif && <div style={{ color: "var(--sub)" }}>{h.motif}</div>}
                </div>
              ))}
            </div>
          )}
        </div>

        <div style={{ marginTop: 16, borderTop: "1px solid var(--line)", paddingTop: 14 }}>
          <label style={labelStyle}>{t("remiseMotif")}</label>
          <input value={motif} onChange={(e) => setMotif(e.target.value)} placeholder={t("remiseMotifPlaceholder")} style={{ ...inputStyle, width: "100%" }} maxLength={300} />
          {sim && !inchange && <p style={{ fontSize: 12.5, margin: "10px 0 0" }}>{t("remiseEngagement").replace("{m}", `${nf(sim.simule.total_ttc)} XOF`)}</p>}
          <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", marginTop: 12, flexWrap: "wrap" }}>
            <button type="button" onClick={onClose} disabled={application} style={boutonSecondaireStyle}>{t("remiseFermer")}</button>
            <button type="button" onClick={appliquer} disabled={application || !sim || inchange || bloqueFacture} style={{ ...boutonPrincipalStyle, opacity: application || !sim || inchange || bloqueFacture ? 0.5 : 1 }}>
              {t("remiseAppliquer")}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function LigneRecap({ libelle, a, b, nf, suffixe = "", fort, discret, couleurB, ecartInverse }) {
  const e = a === null || b === null || a === undefined || b === undefined ? null : Math.round((b - a) * 100) / 100;
  return (
    <tr style={{ borderTop: "1px solid var(--line)", fontWeight: fort ? 700 : 400, color: discret ? "var(--sub)" : "var(--ink)" }}>
      <td style={{ padding: "6px 4px" }}>{libelle}</td>
      <td className="mono" style={tdStyle}>{nf(a)}{a === null || a === undefined ? "" : suffixe}</td>
      <td className="mono" style={{ ...tdStyle, color: couleurB || "inherit" }}>{nf(b)}{b === null || b === undefined ? "" : suffixe}</td>
      <td className="mono" style={{ ...tdStyle, color: e === null || e === 0 ? "var(--sub)" : e < 0 && !ecartInverse ? "var(--brique)" : "var(--sub)" }}>
        {e === null || e === 0 ? "—" : `${e > 0 ? "+" : ""}${nf(e)}${suffixe}`}
      </td>
    </tr>
  );
}

const fondStyle = { position: "fixed", inset: 0, background: "rgba(14,58,64,0.45)", zIndex: 1000, display: "flex", alignItems: "flex-start", justifyContent: "center", padding: "4vh 14px", overflowY: "auto" };
const fenetreStyle = { background: "#fff", borderRadius: 12, padding: "20px 22px", width: "100%", maxWidth: 880, boxShadow: "0 12px 40px rgba(0,0,0,0.25)" };
const labelStyle = { fontSize: 11.5, fontWeight: 600, display: "block", marginBottom: 5 };
const inputStyle = { padding: "8px 10px", border: "1px solid var(--line)", borderRadius: 8, fontSize: 13, fontFamily: "inherit" };
const thStyle = { padding: "4px 4px", textAlign: "right", fontWeight: 600 };
const tdStyle = { padding: "6px 4px", textAlign: "right", whiteSpace: "nowrap" };
const avertStyle = { fontSize: 12, color: "var(--ocre)", margin: "10px 0 0", fontWeight: 600 };
const pastilleStyle = { border: "1px solid var(--line)", background: "#fff", borderRadius: 999, padding: "6px 12px", fontSize: 12, cursor: "pointer", fontFamily: "inherit" };
const boutonPrincipalStyle = { background: "var(--petrol)", color: "#fff", border: "none", borderRadius: 8, padding: "9px 18px", fontSize: 12.5, fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap" };
const boutonSecondaireStyle = { background: "transparent", color: "var(--petrol)", border: "1px solid var(--line)", borderRadius: 8, padding: "8px 16px", fontSize: 12.5, fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap" };
