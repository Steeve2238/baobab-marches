"use client";

import { useEffect, useState } from "react";
import { api } from "../../api";
import { useLangue } from "../../i18n/LanguageContext";
import { Section, inputStyle, boutonPrincipal, cellule, enteteCellule, Pastille, useStatut, Statut } from "../paieUi";

export default function ParamComptes({ peutModifier }) {
  const { t } = useLangue();
  const [lignes, setLignes] = useState(null);
  const s = useStatut();
  useEffect(() => { api.paieComptes().then(setLignes).catch(s.ko); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);
  if (!lignes) return <p style={{ fontSize: 12.5, color: "var(--sub)" }}>{t("loading")}</p>;

  async function enregistrer() {
    try {
      const corps = Object.fromEntries(lignes.map((l) => [l.cle, l.compte]));
      setLignes(await api.paieEnregistrerComptes(corps));
      s.ok(t("paieEnregistre"));
    } catch (e) { s.ko(e); }
  }
  const groupes = ["CHARGES", "TIERS"];

  return (
    <Section titre={t("paieComptesTitre")} aide={t("paieComptesAide")}>
      <p style={{ fontSize: 12, color: "#B26A00", background: "rgba(230,150,0,0.12)", padding: "8px 10px", borderRadius: 8, margin: "0 0 12px", lineHeight: 1.5 }}>{t("paieComptesAdapter")}</p>
      <Statut s={s} />
      {groupes.map((g) => (
        <div key={g} style={{ marginBottom: 14 }}>
          <h3 style={{ fontSize: 13, margin: "0 0 6px" }}>{t(`paieComptesGroupe_${g}`)}</h3>
          <table style={{ borderCollapse: "collapse", width: "100%", maxWidth: 620 }}>
            <thead><tr><th style={enteteCellule}>{t("paieComptesUsage")}</th><th style={enteteCellule}>{t("paieComptesCompte")}</th><th style={enteteCellule}></th></tr></thead>
            <tbody>
              {lignes.filter((l) => l.groupe === g).map((l) => (
                <tr key={l.cle}>
                  <td style={cellule}>{t(`paieCompte_${l.cle}`)}</td>
                  <td style={cellule}><input className="mono" style={{ ...inputStyle, width: 120 }} value={l.compte} onChange={(e) => setLignes(lignes.map((x) => (x.cle === l.cle ? { ...x, compte: e.target.value } : x)))} disabled={!peutModifier} /></td>
                  <td style={cellule}>{l.personnalise ? <Pastille ton="alerte">{t("paieComptesPerso")}</Pastille> : <span style={{ fontSize: 11, color: "var(--sub)" }}>{t("paieComptesDefaut")} {l.defaut}</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
      {peutModifier && <button style={boutonPrincipal} onClick={enregistrer}>{t("paieEnregistrer")}</button>}
    </Section>
  );
}
