"use client";

import { useEffect, useState, useCallback } from "react";
import { api } from "../../../lib/api";
import { useLangue } from "../../../lib/i18n/LanguageContext";
import AppShell from "../../../lib/components/AppShell";
import FiscaliteSousNav from "../../../lib/components/FiscaliteSousNav";
import { inputStyle, labelStyle, thStyle, tdStyle, boutonPrincipalStyle, boutonSecondaireStyle, pastilleStyle } from "../../../lib/fiscaliteUi";

const REGIMES = ["NON_RENSEIGNE", "CGU", "REEL", "REEL_SIMPLIFIE", "REEL_NORMAL", "AUTRE"];
const STYLE_REGIME = {
  CGU: { color: "#8A6200", background: "rgba(214,160,40,0.16)" },
  REEL: { color: "#1F5F8B", background: "rgba(40,110,170,0.12)" },
  REEL_SIMPLIFIE: { color: "#1F5F8B", background: "rgba(40,110,170,0.12)" },
  REEL_NORMAL: { color: "#1F5F8B", background: "rgba(40,110,170,0.12)" },
  AUTRE: { color: "var(--sub)", background: "rgba(91,106,108,0.1)" },
  NON_RENSEIGNE: { color: "var(--sub)", background: "rgba(91,106,108,0.08)" },
};

export default function FiscaliteTiersPage() {
  const { t } = useLangue();
  const [tiers, setTiers] = useState(null);
  const [erreur, setErreur] = useState("");
  const [info, setInfo] = useState("");
  const [filtre, setFiltre] = useState("TOUS");
  const [recherche, setRecherche] = useState("");
  const [edition, setEdition] = useState(null); // { type, id, nom, ninea, cofi, regime_fiscal, assujetti_tva, apercu }

  const charger = useCallback(() => {
    api.fiscaliteTiers().then(setTiers).catch((e) => setErreur(e.message));
  }, []);
  useEffect(charger, [charger]);

  // Lecture du COFI pendant la saisie (le serveur applique les tables de lecture, rien n'est enregistre).
  useEffect(() => {
    if (!edition) return;
    const minuteur = setTimeout(() => {
      api.fiscaliteDecoderCofi(edition.ninea, edition.cofi).then((r) => setEdition((e) => (e ? { ...e, apercu: r } : e))).catch(() => {});
    }, 250);
    return () => clearTimeout(minuteur);
  }, [edition?.ninea, edition?.cofi]); // eslint-disable-line react-hooks/exhaustive-deps

  async function enregistrer() {
    setErreur("");
    setInfo("");
    try {
      const corps = { ninea: edition.ninea, cofi: edition.cofi };
      if (edition.regime_manuel) {
        corps.regime_fiscal = edition.regime_fiscal;
        corps.regime_source = edition.regime_source;
        if (edition.assujetti_tva !== null && edition.assujetti_tva !== undefined) corps.assujetti_tva = edition.assujetti_tva;
      }
      await api.fiscaliteMajTiers(edition.type, edition.id, corps);
      setEdition(null);
      charger();
    } catch (e) {
      setErreur(e.message);
    }
  }

  async function deduire() {
    setErreur("");
    setInfo("");
    try {
      const r = await api.fiscaliteDeduireRegimes();
      setInfo(`${r.mis_a_jour} ${t("fiscTiersDeduits")}`);
      charger();
    } catch (e) {
      setErreur(e.message);
    }
  }

  const visibles = (tiers || []).filter((x) => {
    if (filtre === "CLIENT" && x.type !== "CLIENT") return false;
    if (filtre === "FOURNISSEUR" && x.type !== "FOURNISSEUR") return false;
    if (filtre === "SANS_NINEA" && x.ninea) return false;
    if (filtre === "SANS_REGIME" && x.regime_fiscal !== "NON_RENSEIGNE") return false;
    if (recherche && !x.nom.toLowerCase().includes(recherche.toLowerCase()) && !String(x.ninea).includes(recherche)) return false;
    return true;
  });
  const manquants = (tiers || []).filter((x) => !x.ninea).length;

  const apercu = edition?.apercu;
  const dec = apercu?.decode;

  return (
    <AppShell title={t("fiscTiersTitre")} subNav={<FiscaliteSousNav />}>
      {erreur && <p style={{ color: "var(--brique)", fontSize: 12.5, marginBottom: 12 }}>{erreur}</p>}
      {info && <p style={{ color: "#2E7D5B", fontSize: 12.5, marginBottom: 12 }}>{info}</p>}
      <p style={{ fontSize: 12, color: "var(--sub)", marginBottom: 12, maxWidth: 820, lineHeight: 1.5 }}>{t("fiscTiersAide")}</p>

      <div className="card" style={{ marginBottom: 14, display: "flex", gap: 10, alignItems: "flex-end", flexWrap: "wrap" }}>
        <div>
          <label style={labelStyle}>{t("fiscAfficher")}</label>
          <select value={filtre} onChange={(e) => setFiltre(e.target.value)} style={{ ...inputStyle, width: 200 }}>
            <option value="TOUS">{t("fiscTiersTous")}</option>
            <option value="CLIENT">{t("fiscTiersClients")}</option>
            <option value="FOURNISSEUR">{t("fiscTiersFournisseurs")}</option>
            <option value="SANS_NINEA">{t("fiscTiersSansNinea")} ({manquants})</option>
            <option value="SANS_REGIME">{t("fiscTiersSansRegime")}</option>
          </select>
        </div>
        <div>
          <label style={labelStyle}>{t("fiscRecherche")}</label>
          <input value={recherche} onChange={(e) => setRecherche(e.target.value)} style={{ ...inputStyle, width: 220 }} />
        </div>
        <button style={boutonSecondaireStyle} onClick={deduire}>{t("fiscDeduireRegimes")}</button>
      </div>

      {edition && (
        <div className="card" style={{ marginBottom: 14 }}>
          <h3 style={{ fontSize: 13, color: "var(--petrol)", marginBottom: 10 }}>{edition.nom}</h3>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end" }}>
            <div>
              <label style={labelStyle}>NINEA</label>
              <input value={edition.ninea} onChange={(e) => setEdition({ ...edition, ninea: e.target.value })} placeholder="0001462 2G3" style={{ ...inputStyle, width: 170, fontFamily: "IBM Plex Mono, monospace" }} />
            </div>
            <div>
              <label style={labelStyle}>COFI</label>
              <input value={edition.cofi} onChange={(e) => setEdition({ ...edition, cofi: e.target.value.toUpperCase() })} placeholder="2G3" maxLength={5} style={{ ...inputStyle, width: 90, fontFamily: "IBM Plex Mono, monospace" }} />
            </div>
            <div>
              <label style={labelStyle}>{t("fiscRegimeFiscal")}</label>
              <select
                value={edition.regime_manuel ? edition.regime_fiscal : "COFI"}
                onChange={(e) => (e.target.value === "COFI" ? setEdition({ ...edition, regime_manuel: false }) : setEdition({ ...edition, regime_manuel: true, regime_fiscal: e.target.value, regime_source: "SAISIE" }))}
                style={{ ...inputStyle, width: 250 }}
              >
                <option value="COFI">{t("fiscRegimeDepuisCofi")}</option>
                {REGIMES.map((r) => <option key={r} value={r}>{t(`fiscRegime_${r}`)}</option>)}
              </select>
            </div>
            {edition.regime_manuel && (
              <>
                <div>
                  <label style={labelStyle}>{t("fiscAssujettiTva")}</label>
                  <select value={edition.assujetti_tva === null || edition.assujetti_tva === undefined ? "" : String(edition.assujetti_tva)} onChange={(e) => setEdition({ ...edition, assujetti_tva: e.target.value === "" ? null : e.target.value === "true" })} style={{ ...inputStyle, width: 140 }}>
                    <option value="">{t("fiscInconnu")}</option>
                    <option value="true">{t("fiscOui")}</option>
                    <option value="false">{t("fiscNon")}</option>
                  </select>
                </div>
                <label style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 12, paddingBottom: 8 }}>
                  <input type="checkbox" checked={edition.regime_source === "ATTESTATION"} onChange={(e) => setEdition({ ...edition, regime_source: e.target.checked ? "ATTESTATION" : "SAISIE" })} />
                  {t("fiscSourceAttestation")}
                </label>
              </>
            )}
            <button style={boutonPrincipalStyle} onClick={enregistrer}>{t("fiscEnregistrer")}</button>
            <button style={boutonSecondaireStyle} onClick={() => setEdition(null)}>{t("fiscAnnuler")}</button>
          </div>
          {apercu && (apercu.ninea || apercu.cofi) && (
            <div style={{ marginTop: 10, fontSize: 12, lineHeight: 1.7, background: "var(--line-soft)", borderRadius: 8, padding: "8px 12px" }}>
              <div>NINEA : <strong>{apercu.ninea || "—"}</strong> {apercu.ninea && (apercu.ninea_valide ? "✓" : <span style={{ color: "var(--brique)" }}>{t("fiscNineaFormat")}</span>)}</div>
              {dec?.present && !dec.format_valide && <div style={{ color: "var(--brique)" }}>{t("fiscCofiFormat")}</div>}
              {dec?.format_valide && (
                <>
                  <div>{t("fiscCofiRegime")} : <strong>{dec.regime ? dec.regime.libelle : t("fiscCofiNonReconnu")}</strong></div>
                  <div>{t("fiscCofiCentre")} : <strong>{dec.centre.libelle || `${dec.centre.code} — ${t("fiscCofiNonReconnu")}`}</strong>{dec.centre.libelle && !dec.centre.confirme ? ` (${t("fiscAConfirmer")})` : ""}</div>
                  <div>{t("fiscCofiForme")} : <strong>{dec.forme_juridique.libelle || `${dec.forme_juridique.code} — ${t("fiscCofiNonReconnu")}`}</strong>{dec.forme_juridique.libelle && !dec.forme_juridique.confirme ? ` (${t("fiscAConfirmer")})` : ""}</div>
                </>
              )}
            </div>
          )}
        </div>
      )}

      <div className="card" style={{ padding: 0, overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 860 }}>
          <thead>
            <tr>
              <th style={thStyle}>{t("fiscTiersType")}</th>
              <th style={thStyle}>{t("fiscNom")}</th>
              <th style={thStyle}>NINEA</th>
              <th style={thStyle}>COFI</th>
              <th style={thStyle}>{t("fiscRegimeFiscal")}</th>
              <th style={thStyle}>{t("fiscAssujetti")}</th>
              <th style={thStyle}></th>
            </tr>
          </thead>
          <tbody>
            {!tiers && <tr><td colSpan={7} style={{ ...tdStyle, color: "var(--sub)" }}>{t("loading")}</td></tr>}
            {tiers && visibles.length === 0 && <tr><td colSpan={7} style={{ ...tdStyle, color: "var(--sub)" }}>{t("fiscTiersAucun")}</td></tr>}
            {visibles.map((x) => (
              <tr key={`${x.type}-${x.id}`}>
                <td style={{ ...tdStyle, color: "var(--sub)" }}>{x.type === "CLIENT" ? t("fiscTiersClient") : t("fiscTiersFournisseur")}</td>
                <td style={{ ...tdStyle, fontWeight: 600 }}>{x.nom}{x.exonere_tva ? <span style={{ fontSize: 11, color: "var(--sub)", fontWeight: 400 }}> · {t("fiscExonere")}</span> : null}</td>
                <td style={{ ...tdStyle, fontFamily: "IBM Plex Mono, monospace", color: x.ninea ? "inherit" : "var(--brique)" }}>{x.ninea || t("fiscManquant")}</td>
                <td style={{ ...tdStyle, fontFamily: "IBM Plex Mono, monospace" }}>{x.cofi || ""}</td>
                <td style={tdStyle}>
                  <span style={pastilleStyle(STYLE_REGIME[x.regime_fiscal])}>{t(`fiscRegime_${x.regime_fiscal}`)}</span>
                  {x.regime_source && <span style={{ fontSize: 10.5, color: "var(--sub)", marginLeft: 6 }}>{t(`fiscSource_${x.regime_source}`)}</span>}
                </td>
                <td style={{ ...tdStyle, fontSize: 12 }}>{x.assujetti_tva === null ? "" : x.assujetti_tva ? t("fiscAssujetti") : t("fiscNonAssujetti")}</td>
                <td style={{ ...tdStyle, textAlign: "right" }}>
                  <button
                    style={boutonSecondaireStyle}
                    onClick={() => setEdition({ type: x.type, id: x.id, nom: x.nom, ninea: x.ninea, cofi: x.cofi, regime_fiscal: x.regime_fiscal, regime_source: x.regime_source || "SAISIE", assujetti_tva: x.assujetti_tva, regime_manuel: !!x.regime_source && x.regime_source !== "COFI" })}
                  >
                    {t("fiscModifier")}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </AppShell>
  );
}
