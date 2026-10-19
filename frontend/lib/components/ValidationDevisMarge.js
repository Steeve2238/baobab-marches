"use client";

import { useEffect, useState } from "react";
import { api } from "../api";
import { useLangue } from "../i18n/LanguageContext";

// Fenetre d'analyse de marge a la validation d'un devis (19/10/2026) : avant que le responsable valide, on lui montre la
// marge brute et la marge nette du devis, ligne par ligne, puis on lui demande de confirmer. Lecture seule : rien n'est
// enregistre tant qu'il ne clique pas sur « Valider » (la validation est faite par la page, via onConfirmer).
// Marge brute = prix de vente net - cout d'achat ; marge nette = prix de vente net - cout de revient complet.

export default function ValidationDevisMarge({ devis, onFermer, onNegocier, onConfirmer }) {
  const { t, dict } = useLangue();
  const locale = dict.dateLocale;
  const nf = (x, max = 2) => (x === null || x === undefined || Number.isNaN(Number(x)) ? "—" : Number(x) === 0 ? "0" : Number(x).toLocaleString(locale, { maximumFractionDigits: max }));
  const [sim, setSim] = useState(null);
  const [erreur, setErreur] = useState("");
  const [enCours, setEnCours] = useState(false);

  useEffect(() => {
    let annule = false;
    api
      .simulerRemiseDevis(devis.id, "POURCENTAGE", String(Number(devis.pourcentage_remise) || 0))
      .then((r) => !annule && setSim(r))
      .catch((e) => !annule && setErreur(e.message));
    return () => {
      annule = true;
    };
  }, [devis.id, devis.pourcentage_remise]);

  useEffect(() => {
    const onKey = (e) => e.key === "Escape" && !enCours && onFermer();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onFermer, enCours]);

  const s = sim ? sim.simule : null;
  const couv = sim ? sim.couverture : null;
  const aucunCout = !!couv && couv.lignes_avec_cout === 0;
  const perte = !!s && s.marge !== null && s.marge < 0;
  const lignes = sim ? sim.lignes.filter((l) => !l.non_chiffre) : [];
  const nbSousCible = lignes.filter((l) => l.cout_calculable && l.marge_cible_pct !== null && l.marge_pct_apres !== null && l.marge_pct_apres < l.marge_cible_pct).length;
  const nbCoutChange = lignes.filter((l) => l.cout_calculable && l.ecart_cout_actuel_pct !== null && Math.abs(l.ecart_cout_actuel_pct) >= 0.5).length;
  const brute = sim ? sim.brute : null;

  async function confirmer() {
    setEnCours(true);
    setErreur("");
    try {
      await onConfirmer();
    } catch (e) {
      setErreur(e.message);
      setEnCours(false);
    }
  }

  const couleur = (m) => (m === null || m === undefined ? "var(--sub)" : m < 0 ? "var(--brique)" : "var(--ink)");

  return (
    <div role="dialog" aria-modal="true" style={fondStyle}>
      <div style={fenetreStyle}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
          <div>
            <h2 style={{ fontSize: 17, color: "var(--petrol)", margin: 0 }}>{t("vmgTitre")}</h2>
            <div style={{ fontSize: 12, color: "var(--sub)", marginTop: 3 }}>{devis.numero} · {devis.client_nom}</div>
          </div>
          <button type="button" onClick={onFermer} disabled={enCours} aria-label={t("cancel")} style={{ background: "none", border: "none", fontSize: 22, lineHeight: 1, cursor: "pointer", color: "var(--sub)" }}>×</button>
        </div>
        <p style={{ fontSize: 12.5, color: "var(--sub)", margin: "10px 0 14px" }}>{t("vmgIntro")}</p>

        {erreur && <p style={{ color: "var(--brique)", fontSize: 12.5, margin: "0 0 12px" }}>{erreur}</p>}
        {!sim && !erreur && <p style={{ fontSize: 12.5, color: "var(--sub)" }}>{t("vmgChargement")}</p>}

        {sim && (
          <>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))", gap: 10 }}>
              <Carte titre={t("vmgHtNet")} valeur={`${nf(s.total_ht_net)} XOF`} sous={`${t("venteTotalTtcLabel")} ${nf(s.total_ttc)} XOF${s.pourcentage_remise > 0 ? ` · ${t("vmgRemise")} ${nf(s.pourcentage_remise)} %` : ""}`} />
              <Carte
                titre={t("vmgMargeBrute")}
                aide={t("vmgBruteAide")}
                valeur={brute ? `${nf(brute.simule.marge, 0)} XOF` : "—"}
                sous={brute ? `${nf(brute.simule.marge_pct)} %${brute.lignes_avec_detail < brute.lignes_avec_cout ? ` · ${t("vmgBaseBrute").replace("{ht}", nf(brute.simule.ht_net, 0))}` : ""}` : t("vmgBruteIndispo")}
                couleur={brute ? couleur(brute.simule.marge) : "var(--sub)"}
                petit={!brute}
              />
              <Carte
                titre={t("vmgMargeNette")}
                aide={t("vmgNetteAide")}
                valeur={aucunCout ? "—" : `${nf(s.marge, 0)} XOF`}
                sous={aucunCout ? "" : `${nf(s.marge_pct)} %`}
                couleur={couleur(s.marge)}
                fort
              />
            </div>

            {aucunCout && <p style={avertStyle}>{t("vmgAucunCout")}</p>}
            {perte && <p style={{ ...avertStyle, color: "var(--brique)" }}>{t("vmgPerte")}</p>}
            {!aucunCout && couv.lignes_avec_cout < couv.lignes_chiffrees && <p style={avertStyle}>{t("vmgPartiel").replace("{a}", String(couv.lignes_avec_cout)).replace("{b}", String(couv.lignes_chiffrees))}</p>}
            {brute && brute.lignes_avec_detail < brute.lignes_avec_cout && <p style={avertStyle}>{t("vmgBrutePartielle").replace("{a}", String(brute.lignes_avec_detail)).replace("{b}", String(brute.lignes_avec_cout))}</p>}
            {nbSousCible > 0 && <p style={avertStyle}>{t("vmgSousCible").replace("{n}", String(nbSousCible))}</p>}
            {nbCoutChange > 0 && <p style={avertStyle}>{t("vmgCoutChange").replace("{n}", String(nbCoutChange))}</p>}

            {!aucunCout && (
              <div style={{ overflowX: "auto", marginTop: 14 }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                  <thead>
                    <tr style={{ color: "var(--sub)", fontSize: 11 }}>
                      <th style={{ ...thStyle, textAlign: "left" }}>{t("venteDesignationLabel")}</th>
                      <th style={thStyle}>{t("vmgColQte")}</th>
                      <th style={thStyle}>{t("vmgColPuNet")}</th>
                      <th style={thStyle}>{t("vmgColAchat")}</th>
                      <th style={thStyle}>{t("vmgColRevient")}</th>
                      <th style={thStyle}>{t("vmgColBrute")}</th>
                      <th style={thStyle}>{t("vmgColNette")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {lignes.map((l) => {
                      const sousCible = l.cout_calculable && l.marge_cible_pct !== null && l.marge_pct_apres !== null && l.marge_pct_apres < l.marge_cible_pct;
                      return (
                        <tr key={l.id} style={{ borderTop: "1px solid var(--line)" }}>
                          <td style={{ padding: "6px 4px" }}>{l.designation}</td>
                          <td className="mono" style={tdStyle}>{nf(l.quantite)}</td>
                          <td className="mono" style={tdStyle}>{l.quantite > 0 ? nf(l.montant_ht_net / l.quantite, 0) : "—"}</td>
                          {l.cout_calculable ? (
                            <>
                              <td className="mono" style={tdStyle}>{l.cout_achat_unitaire != null ? nf(l.cout_achat_unitaire, 0) : "—"}</td>
                              <td className="mono" style={tdStyle}>{nf(l.cout_unitaire, 0)}</td>
                              <td className="mono" style={{ ...tdStyle, color: l.marge_brute_pct_apres != null && l.marge_brute_pct_apres < 0 ? "var(--brique)" : "var(--ink)" }}>{l.marge_brute_pct_apres != null ? `${nf(l.marge_brute_pct_apres)} %` : "—"}</td>
                              <td className="mono" style={{ ...tdStyle, fontWeight: 700, color: l.marge_apres < 0 ? "var(--brique)" : sousCible ? "var(--ocre)" : "var(--ink)" }}>{nf(l.marge_pct_apres)} %</td>
                            </>
                          ) : (
                            <td colSpan={4} style={{ ...tdStyle, fontStyle: "italic", color: "var(--sub)" }}>{t("vmgLigneSansCout")}</td>
                          )}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
            <p style={{ fontSize: 11, color: "var(--sub)", margin: "8px 0 0" }}>{t("vmgNote")}</p>
          </>
        )}

        <div style={{ marginTop: 16, borderTop: "1px solid var(--line)", paddingTop: 14 }}>
          <p style={{ fontSize: 13.5, fontWeight: 700, color: "var(--petrol)", margin: "0 0 12px" }}>{t("vmgQuestion")}</p>
          <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", flexWrap: "wrap" }}>
            <button type="button" onClick={onFermer} disabled={enCours} style={boutonSecondaireStyle}>{t("vmgAnnuler")}</button>
            {onNegocier && (
              <button type="button" onClick={onNegocier} disabled={enCours} style={boutonSecondaireStyle}>{t("vmgNegocier")}</button>
            )}
            <button
              type="button"
              onClick={confirmer}
              disabled={enCours || (!sim && !erreur)}
              style={{ ...boutonPrincipalStyle, ...(perte ? { background: "var(--brique)" } : {}), opacity: enCours || (!sim && !erreur) ? 0.5 : 1 }}
            >
              {enCours ? t("vmgEnCours") : perte ? t("vmgValiderPerte") : t("vmgValider")}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function Carte({ titre, valeur, sous, aide, couleur, fort, petit }) {
  return (
    <div style={{ border: "1px solid var(--line)", borderRadius: 10, padding: "10px 12px", background: fort ? "rgba(14,58,64,0.04)" : "#fff" }} title={aide || undefined}>
      <div style={{ fontSize: 11, color: "var(--sub)", fontWeight: 600 }}>{titre}</div>
      <div className="mono" style={{ fontSize: 19, fontWeight: 700, color: couleur || "var(--ink)", marginTop: 4 }}>{valeur}</div>
      <div style={{ fontSize: petit ? 11 : 13, color: petit ? "var(--sub)" : couleur || "var(--ink)", marginTop: 2, fontWeight: petit ? 400 : 600 }}>{sous}</div>
      {aide && !petit && <div style={{ fontSize: 10.5, color: "var(--sub)", marginTop: 4 }}>{aide}</div>}
    </div>
  );
}

const fondStyle = { position: "fixed", inset: 0, background: "rgba(14,58,64,0.45)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center", padding: "3vh 14px", overflow: "hidden" };
const fenetreStyle = { background: "#fff", borderRadius: 12, padding: "20px 22px", width: "100%", maxWidth: 900, maxHeight: "94vh", overflowY: "auto", overscrollBehavior: "contain", boxShadow: "0 12px 40px rgba(0,0,0,0.25)" };
const thStyle = { padding: "4px 4px", textAlign: "right", fontWeight: 600 };
const tdStyle = { padding: "6px 4px", textAlign: "right", whiteSpace: "nowrap" };
const avertStyle = { fontSize: 12, color: "var(--ocre)", margin: "10px 0 0", fontWeight: 600 };
const boutonPrincipalStyle = { background: "var(--petrol)", color: "#fff", border: "none", borderRadius: 8, padding: "9px 18px", fontSize: 12.5, fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap" };
const boutonSecondaireStyle = { background: "transparent", color: "var(--petrol)", border: "1px solid var(--line)", borderRadius: 8, padding: "8px 16px", fontSize: 12.5, fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap" };
