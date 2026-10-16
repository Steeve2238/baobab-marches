"use client";

import { useEffect, useState } from "react";
import { api } from "../../../lib/api";
import { useLangue } from "../../../lib/i18n/LanguageContext";
import AppShell from "../../../lib/components/AppShell";
import { labelStyle, inputStyle, boutonPrincipalStyle, boutonDangerStyle, thStyle, tdStyle } from "../../../lib/comptaUi";

const sub = (txt, vars) => String(txt).replace(/\{(\w+)\}/g, (_, k) => (vars && vars[k] !== undefined ? vars[k] : `{${k}}`));

// Categories de depenses : chaque categorie est reliee a un compte de charge (et a un compte de TVA recuperable).
export default function CategoriesDepensesPage() {
  const { t } = useLangue();
  const [cats, setCats] = useState([]);
  const [nouvelle, setNouvelle] = useState({ libelle: "", compte_charge: "", compte_tva: "" });
  const [erreur, setErreur] = useState("");
  const [info, setInfo] = useState("");

  const charger = () => api.depenseCategories(false).then((r) => setCats(r.categories || [])).catch((e) => setErreur(e.message));
  useEffect(() => { charger(); }, []);

  const maj = (id, champ, valeur) => setCats((prev) => prev.map((c) => (c.id === id ? { ...c, [champ]: valeur, _modifie: true } : c)));

  async function enregistrer(c) {
    setErreur(""); setInfo("");
    try {
      await api.depenseModifierCategorie(c.id, { libelle: c.libelle, compte_charge: c.compte_charge || "", compte_tva: c.compte_tva || "", actif: c.actif });
      setInfo(t("catDepEnregistree"));
      charger();
    } catch (err) { setErreur(err.message); }
  }
  async function supprimer(c) {
    if (!window.confirm(t("catDepSupprimerConfirm"))) return;
    setErreur(""); setInfo("");
    try { await api.depenseSupprimerCategorie(c.id); charger(); } catch (err) { setErreur(err.message); }
  }
  async function ajouter(e) {
    e.preventDefault();
    setErreur(""); setInfo("");
    try {
      await api.depenseCreerCategorie(nouvelle);
      setNouvelle({ libelle: "", compte_charge: "", compte_tva: "" });
      setInfo(t("catDepEnregistree"));
      charger();
    } catch (err) { setErreur(err.message); }
  }

  return (
    <AppShell title={t("catDepTitre")}>
      <p style={{ fontSize: 12.5, color: "var(--sub)", margin: "0 0 14px", maxWidth: 760 }}>{t("catDepAide")}</p>
      {erreur && <p style={{ color: "var(--brique)", fontSize: 12.5 }}>{erreur}</p>}
      {info && <p style={{ color: "var(--vert)", fontSize: 12.5 }}>{info}</p>}

      <div className="card" style={{ padding: 0, overflowX: "auto", marginBottom: 18 }}>
        <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 820 }}>
          <thead><tr>
            <th style={thStyle}>{t("catDepLibelle")}</th><th style={thStyle}>{t("catDepCompteCharge")}</th><th style={thStyle}>{t("catDepCompteTva")}</th><th style={thStyle}>{t("catDepActive")}</th><th style={thStyle} />
          </tr></thead>
          <tbody>
            {cats.map((c) => (
              <tr key={c.id} style={{ opacity: c.actif ? 1 : 0.55 }}>
                <td style={tdStyle}><input value={c.libelle} onChange={(e) => maj(c.id, "libelle", e.target.value)} style={inputStyle} /><div style={{ fontSize: 11, color: "var(--sub)", marginTop: 2 }}>{sub(t("catDepNbDepenses"), { n: c.nb_depenses })}</div></td>
                <td style={tdStyle}><input value={c.compte_charge || ""} onChange={(e) => maj(c.id, "compte_charge", e.target.value)} style={{ ...inputStyle, width: 130 }} /></td>
                <td style={tdStyle}><input value={c.compte_tva || ""} placeholder={t("catDepAucuneTva")} onChange={(e) => maj(c.id, "compte_tva", e.target.value)} style={{ ...inputStyle, width: 130 }} /></td>
                <td style={tdStyle}><input type="checkbox" checked={!!c.actif} onChange={(e) => maj(c.id, "actif", e.target.checked)} /></td>
                <td style={{ ...tdStyle, whiteSpace: "nowrap" }}>
                  <button type="button" disabled={!c._modifie} onClick={() => enregistrer(c)} style={{ ...boutonPrincipalStyle, padding: "4px 12px", fontSize: 11.5, opacity: c._modifie ? 1 : 0.4 }}>{t("catDepEnregistrer")}</button>{" "}
                  <button type="button" onClick={() => supprimer(c)} style={{ ...boutonDangerStyle, padding: "4px 10px", fontSize: 11.5 }}>{t("catDepSupprimer")}</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <form onSubmit={ajouter} className="card">
        <h2 style={{ fontSize: 14, color: "var(--petrol)", margin: "0 0 12px" }}>{t("catDepNouvelle")}</h2>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "flex-end" }}>
          <div><label style={labelStyle}>{t("catDepLibelle")}</label><input required value={nouvelle.libelle} onChange={(e) => setNouvelle({ ...nouvelle, libelle: e.target.value })} style={{ ...inputStyle, width: 260 }} /></div>
          <div><label style={labelStyle}>{t("catDepCompteCharge")}</label><input value={nouvelle.compte_charge} onChange={(e) => setNouvelle({ ...nouvelle, compte_charge: e.target.value })} style={{ ...inputStyle, width: 140 }} /></div>
          <div><label style={labelStyle}>{t("catDepCompteTva")}</label><input value={nouvelle.compte_tva} onChange={(e) => setNouvelle({ ...nouvelle, compte_tva: e.target.value })} style={{ ...inputStyle, width: 140 }} /></div>
          <button type="submit" style={boutonPrincipalStyle}>{t("catDepEnregistrer")}</button>
        </div>
      </form>
    </AppShell>
  );
}
