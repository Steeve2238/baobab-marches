"use client";

import { useEffect, useState } from "react";
import { api } from "../../../lib/api";
import { useLangue } from "../../../lib/i18n/LanguageContext";
import AppShell from "../../../lib/components/AppShell";
import FiscaliteSousNav from "../../../lib/components/FiscaliteSousNav";
import { inputStyle, thStyle, tdStyle, boutonPrincipalStyle, boutonSecondaireStyle } from "../../../lib/fiscaliteUi";

const GROUPES = ["RETENUES", "TVA", "IS", "CEL"];

export default function FiscaliteComptesPage() {
  const { t } = useLangue();
  const [lignes, setLignes] = useState(null);
  const [saisies, setSaisies] = useState({});
  const [erreur, setErreur] = useState("");
  const [info, setInfo] = useState("");

  const charger = () =>
    api
      .fiscaliteComptes()
      .then((r) => {
        setLignes(r.comptes);
        setSaisies(Object.fromEntries(r.comptes.map((c) => [c.cle, c.prefixes.join(", ")])));
      })
      .catch((e) => setErreur(e.message));
  useEffect(() => {
    charger();
  }, []);

  async function enregistrer(e) {
    e.preventDefault();
    setErreur("");
    setInfo("");
    try {
      const r = await api.fiscaliteComptesEnregistrer(saisies);
      setLignes(r.comptes);
      setSaisies(Object.fromEntries(r.comptes.map((c) => [c.cle, c.prefixes.join(", ")])));
      setInfo(t("fiscCptEnregistres"));
    } catch (err) {
      setErreur(err.message);
    }
  }
  const retablir = (c) => setSaisies({ ...saisies, [c.cle]: c.defaut.join(", ") });

  return (
    <AppShell title={t("fiscCptTitre")} subNav={<FiscaliteSousNav />}>
      <p style={{ fontSize: 12.5, color: "var(--sub)", maxWidth: 820, lineHeight: 1.5, marginBottom: 14 }}>{t("fiscCptAide")}</p>
      {erreur && <p style={{ color: "var(--brique)", fontSize: 12.5, marginBottom: 12 }}>{erreur}</p>}
      {info && <p style={{ color: "#2E7D5B", fontSize: 12.5, marginBottom: 12 }}>{info}</p>}
      {lignes && (
        <form onSubmit={enregistrer}>
          {GROUPES.map((g) => (
            <div key={g} className="card" style={{ marginBottom: 14, overflowX: "auto" }}>
              <h3 style={{ fontSize: 14, margin: "0 0 4px" }}>{t(`fiscCptGroupe_${g}`)}</h3>
              <p style={{ fontSize: 11.5, color: "var(--sub)", margin: "0 0 8px" }}>{t(`fiscCptGroupeAide_${g}`)}</p>
              <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 640 }}>
                <thead>
                  <tr>
                    <th style={thStyle}>{t("fiscCptColUsage")}</th>
                    <th style={thStyle}>{t("fiscCptColComptes")}</th>
                    <th style={thStyle}>{t("fiscCptColDefaut")}</th>
                    <th style={thStyle}></th>
                  </tr>
                </thead>
                <tbody>
                  {lignes
                    .filter((c) => c.groupe === g)
                    .map((c) => (
                      <tr key={c.cle}>
                        <td style={{ ...tdStyle, fontSize: 12.5, minWidth: 240 }}>{t(`fiscCpt_${c.cle}`)}</td>
                        <td style={tdStyle}>
                          <input value={saisies[c.cle] ?? ""} onChange={(e) => setSaisies({ ...saisies, [c.cle]: e.target.value })} style={{ ...inputStyle, width: 220 }} aria-label={t(`fiscCpt_${c.cle}`)} />
                        </td>
                        <td style={{ ...tdStyle, fontSize: 12, color: "var(--sub)" }}>{c.defaut.join(", ")}</td>
                        <td style={{ ...tdStyle, textAlign: "right" }}>
                          {(saisies[c.cle] ?? "").replace(/\s/g, "") !== c.defaut.join(",") && (
                            <button type="button" style={boutonSecondaireStyle} onClick={() => retablir(c)}>{t("fiscCptRetablir")}</button>
                          )}
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          ))}
          <button type="submit" style={boutonPrincipalStyle}>{t("fiscEnregistrer")}</button>
        </form>
      )}
    </AppShell>
  );
}
