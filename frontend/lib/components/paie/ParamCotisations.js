"use client";

import { useEffect, useState } from "react";
import { api } from "../../api";
import { useLangue } from "../../i18n/LanguageContext";
import { Champ, Section, grille, inputStyle, boutonPrincipal, boutonLeger, boutonDanger, cellule, enteteCellule, droite, fmt, fmtDec, Pastille, useStatut, Statut, aujourdhui } from "../paieUi";

const VIDE = { code: "", libelle: "", section: "SOCIAL", taux_salarie: "0", taux_patronal: "0", plafond_mensuel: "", public: "TOUS", date_effet: "", note: "" };

export default function ParamCotisations({ peutModifier }) {
  const { t } = useLangue();
  const [lignes, setLignes] = useState(null);
  const [f, setF] = useState({ ...VIDE, date_effet: aujourdhui() });
  const s = useStatut();

  const charger = () => api.paieCotisations().then(setLignes).catch(s.ko);
  useEffect(() => { charger(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  if (!lignes) return <p style={{ fontSize: 12.5, color: "var(--sub)" }}>{t("loading")}</p>;
  const maj = (k) => (e) => setF({ ...f, [k]: e.target.value });

  async function enregistrer() {
    try {
      await api.paieSauverCotisation({ ...f, plafond_mensuel: f.plafond_mensuel === "" ? null : f.plafond_mensuel });
      s.ok(t("paieEnregistre"));
      setF({ ...VIDE, date_effet: aujourdhui() });
      charger();
    } catch (e) { s.ko(e); }
  }
  async function supprimer(l) {
    if (!window.confirm(t("paieConfirmSuppr"))) return;
    try { await api.paieSupprimerCotisation(l.id); s.ok(t("paieSupprime")); charger(); } catch (e) { s.ko(e); }
  }
  const modifier = (l) => { setF({ code: l.code, libelle: l.libelle, section: l.section, taux_salarie: String(l.taux_salarie), taux_patronal: String(l.taux_patronal), plafond_mensuel: l.plafond_mensuel == null ? "" : String(l.plafond_mensuel), public: l.public, date_effet: l.date_effet, note: l.note || "" }); window.scrollTo({ top: 0, behavior: "smooth" }); };
  const nouvelleVersion = (l) => { modifier(l); setF((x) => ({ ...x, date_effet: aujourdhui() })); };

  return (
    <div style={{ display: "grid", gap: 14 }}>
      <Section titre={t("paieCotTitre")} aide={t("paieCotAide")}>
        <p style={{ fontSize: 12, color: "#B26A00", background: "rgba(230,150,0,0.12)", padding: "8px 10px", borderRadius: 8, margin: "0 0 12px", lineHeight: 1.5 }}>{t("paieCotProvisoire")}</p>
        <Statut s={s} />
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 760 }}>
            <thead>
              <tr>
                <th style={enteteCellule}>{t("paieCotCode")}</th>
                <th style={{ ...enteteCellule, ...droite }}>{t("paieCotSalarie")}</th>
                <th style={{ ...enteteCellule, ...droite }}>{t("paieCotPatronal")}</th>
                <th style={{ ...enteteCellule, ...droite }}>{t("paieCotPlafond")}</th>
                <th style={enteteCellule}>{t("paieCotPublic")}</th>
                <th style={enteteCellule}>{t("paieCotDateEffet")}</th>
                <th style={enteteCellule}></th>
                {peutModifier && <th style={enteteCellule}></th>}
              </tr>
            </thead>
            <tbody>
              {lignes.map((l) => (
                <tr key={l.id} style={{ opacity: l.en_vigueur ? 1 : 0.6 }}>
                  <td style={cellule}><div style={{ fontWeight: 600 }}>{l.libelle}</div><div className="mono" style={{ fontSize: 11, color: "var(--sub)" }}>{l.code}</div></td>
                  <td style={{ ...cellule, ...droite }}>{fmtDec(l.taux_salarie, 3)} %</td>
                  <td style={{ ...cellule, ...droite }}>{fmtDec(l.taux_patronal, 3)} %</td>
                  <td style={{ ...cellule, ...droite }}>{l.plafond_mensuel == null ? t("paieCotSansPlafond") : fmt(l.plafond_mensuel)}</td>
                  <td style={cellule}>{l.public === "CADRES" ? t("paieCotCadres") : t("paieCotTous")}</td>
                  <td style={cellule}>{l.date_effet}</td>
                  <td style={cellule}>{l.en_vigueur ? <Pastille ton="ok">{t("paieEnVigueur")}</Pastille> : null}</td>
                  {peutModifier && (
                    <td style={{ ...cellule, whiteSpace: "nowrap" }}>
                      <button style={boutonLeger} onClick={() => nouvelleVersion(l)}>{t("paieNouvelleVersion")}</button>{" "}
                      <button style={boutonLeger} onClick={() => modifier(l)}>{t("paieModifier")}</button>{" "}
                      <button style={boutonDanger} onClick={() => supprimer(l)}>{t("paieSupprimer")}</button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>
      {peutModifier && (
        <Section titre={t("paieCotFormTitre")} aide={t("paieCotFormAide")}>
          <div style={grille}>
            <Champ label={t("paieCotCode")}><input style={inputStyle} value={f.code} onChange={maj("code")} placeholder="IPM" /></Champ>
            <Champ label={t("paieLibelle")}><input style={inputStyle} value={f.libelle} onChange={maj("libelle")} /></Champ>
            <Champ label={t("paieCotSalarie")}><input type="number" step="0.001" style={inputStyle} value={f.taux_salarie} onChange={maj("taux_salarie")} /></Champ>
            <Champ label={t("paieCotPatronal")}><input type="number" step="0.001" style={inputStyle} value={f.taux_patronal} onChange={maj("taux_patronal")} /></Champ>
            <Champ label={t("paieCotPlafond")}><input type="number" style={inputStyle} value={f.plafond_mensuel} onChange={maj("plafond_mensuel")} placeholder={t("paieCotSansPlafond")} /></Champ>
            <Champ label={t("paieCotPublic")}>
              <select style={inputStyle} value={f.public} onChange={maj("public")}>
                <option value="TOUS">{t("paieCotTous")}</option>
                <option value="CADRES">{t("paieCotCadres")}</option>
              </select>
            </Champ>
            <Champ label={t("paieCotDateEffet")}><input type="date" style={inputStyle} value={f.date_effet} onChange={maj("date_effet")} /></Champ>
          </div>
          <div style={{ marginTop: 12 }}><button style={boutonPrincipal} onClick={enregistrer}>{t("paieEnregistrer")}</button></div>
        </Section>
      )}
    </div>
  );
}
