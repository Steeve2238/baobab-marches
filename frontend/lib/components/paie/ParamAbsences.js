"use client";

import { useEffect, useState } from "react";
import { api } from "../../api";
import { useLangue } from "../../i18n/LanguageContext";
import { Section, inputStyle, boutonPrincipal, boutonLeger, boutonDanger, cellule, enteteCellule, useStatut, Statut } from "../paieUi";

export default function ParamAbsences({ peutModifier }) {
  const { t } = useLangue();
  const [lignes, setLignes] = useState(null);
  const [nouv, setNouv] = useState({ code: "", libelle: "", taux_maintien: "0" });
  const s = useStatut();
  const charger = () => api.paieTypesAbsence().then(setLignes).catch(s.ko);
  useEffect(() => { charger(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);
  if (!lignes) return <p style={{ fontSize: 12.5, color: "var(--sub)" }}>{t("loading")}</p>;

  const maj = (id, k, v) => setLignes(lignes.map((l) => (l.id === id ? { ...l, [k]: v } : l)));
  async function sauver(l) {
    try { await api.paieModifierTypeAbsence(l.id, { libelle: l.libelle, taux_maintien: l.taux_maintien, actif: l.actif }); s.ok(t("paieEnregistre")); charger(); } catch (e) { s.ko(e); }
  }
  async function supprimer(l) {
    if (!window.confirm(t("paieConfirmSuppr"))) return;
    try { await api.paieSupprimerTypeAbsence(l.id); s.ok(t("paieSupprime")); charger(); } catch (e) { s.ko(e); }
  }
  async function creer() {
    try { await api.paieCreerTypeAbsence(nouv); s.ok(t("paieEnregistre")); setNouv({ code: "", libelle: "", taux_maintien: "0" }); charger(); } catch (e) { s.ko(e); }
  }

  return (
    <Section titre={t("paieAbsTitre")} aide={t("paieAbsAide")}>
      <Statut s={s} />
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 560 }}>
          <thead><tr><th style={enteteCellule}>{t("paieLibelle")}</th><th style={enteteCellule}>{t("paieAbsMaintien")}</th><th style={enteteCellule}>{t("paieRubActive")}</th>{peutModifier && <th style={enteteCellule}></th>}</tr></thead>
          <tbody>
            {lignes.map((l) => (
              <tr key={l.id}>
                <td style={cellule}><input style={inputStyle} value={l.libelle} onChange={(e) => maj(l.id, "libelle", e.target.value)} disabled={!peutModifier} /><div className="mono" style={{ fontSize: 11, color: "var(--sub)" }}>{l.code}</div></td>
                <td style={cellule}><input type="number" style={{ ...inputStyle, width: 90 }} value={l.taux_maintien} onChange={(e) => maj(l.id, "taux_maintien", e.target.value)} disabled={!peutModifier} /> %</td>
                <td style={cellule}><input type="checkbox" checked={l.actif} onChange={(e) => maj(l.id, "actif", e.target.checked)} disabled={!peutModifier} /></td>
                {peutModifier && <td style={{ ...cellule, whiteSpace: "nowrap" }}><button style={boutonLeger} onClick={() => sauver(l)}>{t("paieEnregistrer")}</button>{!l.systeme && <> <button style={boutonDanger} onClick={() => supprimer(l)}>{t("paieSupprimer")}</button></>}</td>}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {peutModifier && (
        <div style={{ display: "flex", gap: 10, alignItems: "end", flexWrap: "wrap", marginTop: 16, borderTop: "1px solid var(--line-soft)", paddingTop: 14 }}>
          <div><label style={{ fontSize: 11.5, fontWeight: 600, display: "block", marginBottom: 5 }}>{t("paieCotCode")}</label><input style={{ ...inputStyle, width: 150 }} value={nouv.code} onChange={(e) => setNouv({ ...nouv, code: e.target.value })} placeholder="FORMATION" /></div>
          <div><label style={{ fontSize: 11.5, fontWeight: 600, display: "block", marginBottom: 5 }}>{t("paieLibelle")}</label><input style={{ ...inputStyle, width: 240 }} value={nouv.libelle} onChange={(e) => setNouv({ ...nouv, libelle: e.target.value })} /></div>
          <div><label style={{ fontSize: 11.5, fontWeight: 600, display: "block", marginBottom: 5 }}>{t("paieAbsMaintien")}</label><input type="number" style={{ ...inputStyle, width: 90 }} value={nouv.taux_maintien} onChange={(e) => setNouv({ ...nouv, taux_maintien: e.target.value })} /></div>
          <button style={boutonPrincipal} onClick={creer}>{t("paieAjouter")}</button>
        </div>
      )}
    </Section>
  );
}
