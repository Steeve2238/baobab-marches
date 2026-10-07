"use client";

import { useEffect, useState, useCallback } from "react";
import { api } from "../../../lib/api";
import { useLangue } from "../../../lib/i18n/LanguageContext";
import AppShell from "../../../lib/components/AppShell";
import FiscaliteSousNav from "../../../lib/components/FiscaliteSousNav";
import { inputStyle, labelStyle, thStyle, tdStyle, boutonPrincipalStyle, formaterXof, texteAlerte } from "../../../lib/fiscaliteUi";

export default function FiscaliteProfilPage() {
  const { t } = useLangue();
  const locale = t("dateLocale");
  const [form, setForm] = useState(null);
  const [contribuable, setContribuable] = useState(null);
  const [regime, setRegime] = useState(null);
  const [erreur, setErreur] = useState("");
  const [info, setInfo] = useState("");
  const annee = new Date().getFullYear();

  const chargerRegime = useCallback(() => api.fiscaliteRegime(annee).then(setRegime).catch(() => {}), [annee]);

  useEffect(() => {
    api
      .fiscaliteProfil()
      .then(({ profil, contribuable: c }) => {
        setContribuable(c);
        setForm({
          ...profil,
          ca: { [annee - 1]: profil.ca_historique?.[annee - 1] ?? "", [annee - 2]: profil.ca_historique?.[annee - 2] ?? "", [annee - 3]: profil.ca_historique?.[annee - 3] ?? "" },
        });
      })
      .catch((e) => setErreur(e.message));
    chargerRegime();
  }, [chargerRegime, annee]);

  async function enregistrer(e) {
    e.preventDefault();
    setErreur("");
    setInfo("");
    try {
      await api.fiscaliteEnregistrerProfil({
        assujetti_tva: form.assujetti_tva,
        exigibilite_tva: form.exigibilite_tva,
        prorata_deduction_pct: form.prorata_deduction_pct,
        regime_is: form.regime_is,
        forme_juridique: form.forme_juridique,
        cofi: form.cofi || "",
        centre_fiscal: form.centre_fiscal || "",
        cloture_mois: form.cloture_mois,
        taux_tva_normal: form.taux_tva_normal,
        taux_tva_reduit: form.taux_tva_reduit,
        ca_historique: form.ca,
      });
      setInfo(t("fiscProfilEnregistre"));
      chargerRegime();
    } catch (err) {
      setErreur(err.message);
    }
  }

  if (!form) return <AppShell title={t("fiscProfilTitre")} subNav={<FiscaliteSousNav />}>{erreur ? <p style={{ color: "var(--brique)", fontSize: 12.5 }}>{erreur}</p> : <p>{t("loading")}</p>}</AppShell>;

  const maj = (k, v) => setForm({ ...form, [k]: v });
  const champ = (libelle, contenu) => (
    <div>
      <label style={labelStyle}>{libelle}</label>
      {contenu}
    </div>
  );

  return (
    <AppShell title={t("fiscProfilTitre")} subNav={<FiscaliteSousNav />}>
      {erreur && <p style={{ color: "var(--brique)", fontSize: 12.5, marginBottom: 12 }}>{erreur}</p>}
      {info && <p style={{ color: "#2E7D5B", fontSize: 12.5, marginBottom: 12 }}>{info}</p>}
      <p style={{ fontSize: 12, color: "var(--sub)", marginBottom: 14, maxWidth: 820, lineHeight: 1.5 }}>{t("fiscProfilAide")}</p>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(380px, 1fr))", gap: 14, alignItems: "start" }}>
        <form className="card" onSubmit={enregistrer}>
          <h3 style={{ fontSize: 13.5, color: "var(--petrol)", marginBottom: 4 }}>{contribuable?.raison_sociale}</h3>
          <p style={{ fontSize: 11.5, color: "var(--sub)", marginTop: 0, marginBottom: 12 }}>
            NINEA {contribuable?.ninea || "—"} · {t("fiscNineaEntrepriseAide")}
          </p>
          <div style={{ display: "grid", gap: 12 }}>
            {champ("COFI", <input value={form.cofi || ""} onChange={(e) => maj("cofi", e.target.value.toUpperCase())} placeholder="2G3" maxLength={5} style={{ ...inputStyle, width: 100, fontFamily: "IBM Plex Mono, monospace" }} />)}
            {champ(t("fiscFormeJuridique"), (
              <select value={form.forme_juridique} onChange={(e) => maj("forme_juridique", e.target.value)} style={{ ...inputStyle, maxWidth: 260 }}>
                <option value="PERSONNE_MORALE">{t("fiscPersonneMorale")}</option>
                <option value="PERSONNE_PHYSIQUE">{t("fiscPersonnePhysique")}</option>
              </select>
            ))}
            {champ(t("fiscRegimeDeclareLabel"), (
              <select value={form.regime_is} onChange={(e) => maj("regime_is", e.target.value)} style={{ ...inputStyle, maxWidth: 260 }}>
                <option value="REEL_NORMAL">{t("fiscRegime_REEL_NORMAL")}</option>
                <option value="REEL_SIMPLIFIE">{t("fiscRegime_REEL_SIMPLIFIE")}</option>
                <option value="CGU">{t("fiscRegime_CGU")}</option>
              </select>
            ))}
            <label style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 12.5 }}>
              <input type="checkbox" checked={form.assujetti_tva} onChange={(e) => maj("assujetti_tva", e.target.checked)} />
              {t("fiscAssujettiTvaEntreprise")}
            </label>
            {champ(t("fiscExigibilite"), (
              <select value={form.exigibilite_tva} onChange={(e) => maj("exigibilite_tva", e.target.value)} style={{ ...inputStyle, maxWidth: 340 }}>
                <option value="FACTURATION">{t("fiscExigFacturation")}</option>
                <option value="ENCAISSEMENT">{t("fiscExigEncaissement")}</option>
              </select>
            ))}
            <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
              {champ(t("fiscTauxNormal"), <input type="number" min="0" max="100" step="0.01" value={form.taux_tva_normal} onChange={(e) => maj("taux_tva_normal", e.target.value)} style={{ ...inputStyle, width: 100 }} />)}
              {champ(t("fiscTauxReduit"), <input type="number" min="0" max="100" step="0.01" value={form.taux_tva_reduit} onChange={(e) => maj("taux_tva_reduit", e.target.value)} style={{ ...inputStyle, width: 100 }} />)}
              {champ(t("fiscProrata"), <input type="number" min="0" max="100" step="0.01" value={form.prorata_deduction_pct} onChange={(e) => maj("prorata_deduction_pct", e.target.value)} style={{ ...inputStyle, width: 100 }} />)}
            </div>
            {champ(t("fiscCentreFiscal"), <input value={form.centre_fiscal || ""} onChange={(e) => maj("centre_fiscal", e.target.value)} style={{ ...inputStyle, maxWidth: 300 }} />)}
            {champ(t("fiscCloture"), (
              <select value={form.cloture_mois} onChange={(e) => maj("cloture_mois", Number(e.target.value))} style={{ ...inputStyle, maxWidth: 200 }}>
                {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => <option key={m} value={m}>{m}</option>)}
              </select>
            ))}
            <div>
              <label style={labelStyle}>{t("fiscCaHistorique")}</label>
              <p style={{ fontSize: 11.5, color: "var(--sub)", margin: "0 0 6px", lineHeight: 1.45 }}>{t("fiscCaHistoriqueAide")}</p>
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                {Object.keys(form.ca).sort().map((a) => (
                  <div key={a}>
                    <div style={{ fontSize: 11, color: "var(--sub)", marginBottom: 3 }}>{a}</div>
                    <input type="number" min="0" value={form.ca[a]} onChange={(e) => setForm({ ...form, ca: { ...form.ca, [a]: e.target.value } })} style={{ ...inputStyle, width: 150, textAlign: "right" }} />
                  </div>
                ))}
              </div>
            </div>
          </div>
          <div style={{ marginTop: 16 }}><button type="submit" style={boutonPrincipalStyle}>{t("fiscEnregistrer")}</button></div>
        </form>

        <div className="card">
          <h3 style={{ fontSize: 13.5, color: "var(--petrol)", marginBottom: 8 }}>{t("fiscDetecteurTitre")}</h3>
          {!regime && <p style={{ fontSize: 12.5, color: "var(--sub)" }}>{t("loading")}</p>}
          {regime && (
            <>
              <div style={{ fontSize: 12.5, lineHeight: 1.75 }}>
                <div>{t("fiscRegimeDeclare")} : <strong>{regime.regime_declare_libelle || t("fiscNonRenseigne")}</strong></div>
                <div>{t("fiscRegimeAttendu")} {regime.annee} : <strong>{regime.regime_attendu_libelle}</strong> <span style={{ color: "var(--sub)" }}>({regime.regime_attendu.article})</span></div>
                {regime.cofi_decode?.format_valide && (
                  <>
                    <div>{t("fiscRegimeCofi")} : <strong>{regime.cofi_decode.regime ? regime.cofi_decode.regime.libelle : t("fiscCofiNonReconnu")}</strong></div>
                    <div>{t("fiscCofiCentre")} : <strong>{regime.cofi_decode.centre.libelle || regime.cofi_decode.centre.code}</strong></div>
                    <div>{t("fiscCofiForme")} : <strong>{regime.cofi_decode.forme_juridique.libelle || regime.cofi_decode.forme_juridique.code}</strong></div>
                  </>
                )}
              </div>
              <table style={{ borderCollapse: "collapse", marginTop: 12, width: "100%" }}>
                <thead>
                  <tr>
                    <th style={thStyle}>{t("fiscAnnee")}</th>
                    <th style={{ ...thStyle, textAlign: "right" }}>{t("fiscCaTtc")}</th>
                    <th style={thStyle}>{t("fiscSource")}</th>
                  </tr>
                </thead>
                <tbody>
                  {regime.ca_par_annee.map((c) => (
                    <tr key={c.annee}>
                      <td style={tdStyle}>{c.annee}</td>
                      <td style={{ ...tdStyle, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{formaterXof(c.ca_ttc, locale)}</td>
                      <td style={{ ...tdStyle, color: "var(--sub)" }}>{c.source === "SAISIE" ? t("fiscCaSaisi") : t("fiscCaPlateforme")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {regime.alertes.length > 0 && (
                <ul style={{ margin: "12px 0 0", paddingLeft: 18, fontSize: 12, lineHeight: 1.55 }}>
                  {regime.alertes.map((a, i) => <li key={i}>{texteAlerte(t, "fiscReg_", a, locale)}</li>)}
                </ul>
              )}
              <p style={{ fontSize: 11.5, color: "var(--sub)", marginTop: 12, marginBottom: 0, lineHeight: 1.5 }}>{t("fiscDetecteurNote")}</p>
            </>
          )}
        </div>
      </div>
    </AppShell>
  );
}
