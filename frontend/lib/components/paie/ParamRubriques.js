"use client";

import { useEffect, useState } from "react";
import { api } from "../../api";
import { useLangue } from "../../i18n/LanguageContext";
import { Champ, Section, grille, inputStyle, boutonPrincipal, boutonLeger, boutonDanger, cellule, enteteCellule, droite, fmt, Pastille, useStatut, Statut } from "../paieUi";

const VIDE = { id: null, code: "", libelle: "", sens: "GAIN", mode: "VARIABLE", section: "INDEMNITES", imposable: true, soumis_cotisations: true, exoneration_plafond: "", proratisable: false, montant_defaut: "", compte_cle: "PRIMES", actif: true, systeme: false };

export default function ParamRubriques({ peutModifier }) {
  const { t } = useLangue();
  const [rubs, setRubs] = useState(null);
  const [comptes, setComptes] = useState([]);
  const [f, setF] = useState(null);
  const s = useStatut();

  const charger = () => api.paieRubriques().then(setRubs).catch(s.ko);
  useEffect(() => { charger(); api.paieComptes().then(setComptes).catch(() => {}); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);
  if (!rubs) return <p style={{ fontSize: 12.5, color: "var(--sub)" }}>{t("loading")}</p>;

  const maj = (k, v) => setF({ ...f, [k]: v });
  const editer = (r) => setF({ ...r, exoneration_plafond: r.exoneration_plafond ?? "", montant_defaut: r.montant_defaut ?? "" });

  async function enregistrer() {
    const corps = { ...f, exoneration_plafond: f.exoneration_plafond === "" ? null : f.exoneration_plafond, montant_defaut: f.montant_defaut === "" ? null : f.montant_defaut };
    try {
      if (f.id) await api.paieModifierRubrique(f.id, corps); else await api.paieCreerRubrique(corps);
      s.ok(t("paieEnregistre")); setF(null); charger();
    } catch (e) { s.ko(e); }
  }
  async function supprimer(r) {
    if (!window.confirm(t("paieConfirmSuppr"))) return;
    try { await api.paieSupprimerRubrique(r.id); s.ok(t("paieSupprime")); charger(); } catch (e) { s.ko(e); }
  }
  const gain = f && f.sens === "GAIN";

  return (
    <div style={{ display: "grid", gap: 14 }}>
      <Section titre={t("paieRubTitre")} aide={t("paieRubAide")}>
        <Statut s={s} />
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 760 }}>
            <thead><tr>
              <th style={enteteCellule}>{t("paieLibelle")}</th><th style={enteteCellule}>{t("paieRubSens")}</th><th style={enteteCellule}>{t("paieRubMode")}</th>
              <th style={enteteCellule}>{t("paieRubTraitement")}</th><th style={{ ...enteteCellule, ...droite }}>{t("paieRubMontantDefaut")}</th><th style={enteteCellule}></th>{peutModifier && <th style={enteteCellule}></th>}
            </tr></thead>
            <tbody>
              {rubs.map((r) => (
                <tr key={r.id} style={{ opacity: r.actif ? 1 : 0.5 }}>
                  <td style={cellule}><div style={{ fontWeight: 600 }}>{r.libelle}</div><div className="mono" style={{ fontSize: 11, color: "var(--sub)" }}>{r.code}</div></td>
                  <td style={cellule}>{t(`paieRubSens_${r.sens}`)}</td>
                  <td style={cellule}>{t(`paieRubMode_${r.mode}`)}</td>
                  <td style={{ ...cellule, fontSize: 11.5 }}>
                    {r.sens === "GAIN" ? (
                      <>
                        {r.imposable ? t("paieRubImposable") : t("paieRubNonImposable")} · {r.soumis_cotisations ? t("paieRubCotisable") : t("paieRubNonCotisable")}
                        {r.exoneration_plafond != null && <> · {t("paieRubExoneree")} {fmt(r.exoneration_plafond)}</>}
                        {r.proratisable && <> · {t("paieRubProrata")}</>}
                      </>
                    ) : "—"}
                  </td>
                  <td style={{ ...cellule, ...droite }}>{fmt(r.montant_defaut)}</td>
                  <td style={cellule}>{!r.actif && <Pastille ton="neutre">{t("paieInactif")}</Pastille>}</td>
                  {peutModifier && <td style={{ ...cellule, whiteSpace: "nowrap" }}><button style={boutonLeger} onClick={() => editer(r)}>{t("paieModifier")}</button>{!r.systeme && <> <button style={boutonDanger} onClick={() => supprimer(r)}>{t("paieSupprimer")}</button></>}</td>}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {peutModifier && !f && <div style={{ marginTop: 12 }}><button style={boutonLeger} onClick={() => setF({ ...VIDE })}>{t("paieRubNouvelle")}</button></div>}
      </Section>
      {peutModifier && f && (
        <Section titre={f.id ? t("paieRubModifier") : t("paieRubNouvelle")}>
          <div style={grille}>
            <Champ label={t("paieCotCode")}><input style={inputStyle} value={f.code} onChange={(e) => maj("code", e.target.value)} disabled={!!f.id} placeholder="PRIME_CHANTIER" /></Champ>
            <Champ label={t("paieLibelle")}><input style={inputStyle} value={f.libelle} onChange={(e) => maj("libelle", e.target.value)} /></Champ>
            <Champ label={t("paieRubSens")}>
              <select style={inputStyle} value={f.sens} onChange={(e) => maj("sens", e.target.value)}>{["GAIN", "RETENUE", "REMBOURSEMENT"].map((x) => <option key={x} value={x}>{t(`paieRubSens_${x}`)}</option>)}</select>
            </Champ>
            <Champ label={t("paieRubMode")}>
              <select style={inputStyle} value={f.mode} onChange={(e) => maj("mode", e.target.value)}>{["FIXE", "VARIABLE", "QUANTITE"].map((x) => <option key={x} value={x}>{t(`paieRubMode_${x}`)}</option>)}</select>
            </Champ>
            <Champ label={t("paieRubMontantDefaut")}><input type="number" style={inputStyle} value={f.montant_defaut} onChange={(e) => maj("montant_defaut", e.target.value)} /></Champ>
            <Champ label={t("paieRubCompte")}>
              <select style={inputStyle} value={f.compte_cle || ""} onChange={(e) => maj("compte_cle", e.target.value)}>
                <option value="">—</option>
                {comptes.map((c) => <option key={c.cle} value={c.cle}>{t(`paieCompte_${c.cle}`)} ({c.compte})</option>)}
              </select>
            </Champ>
          </div>
          {gain && (
            <>
              <div style={{ display: "flex", gap: 18, flexWrap: "wrap", margin: "12px 0 8px", fontSize: 12.5 }}>
                <label style={{ display: "flex", gap: 6, alignItems: "center" }}><input type="checkbox" checked={f.section === "SALAIRE"} onChange={(e) => maj("section", e.target.checked ? "SALAIRE" : "INDEMNITES")} />{t("paieRubSectionSalaire")}</label>
                <label style={{ display: "flex", gap: 6, alignItems: "center" }}><input type="checkbox" checked={f.imposable} onChange={(e) => maj("imposable", e.target.checked)} />{t("paieRubImposable")}</label>
                <label style={{ display: "flex", gap: 6, alignItems: "center" }}><input type="checkbox" checked={f.soumis_cotisations} onChange={(e) => maj("soumis_cotisations", e.target.checked)} />{t("paieRubCotisable")}</label>
                <label style={{ display: "flex", gap: 6, alignItems: "center" }}><input type="checkbox" checked={f.proratisable} onChange={(e) => maj("proratisable", e.target.checked)} />{t("paieRubProrata")}</label>
              </div>
              <div style={{ maxWidth: 320 }}>
                <Champ label={t("paieRubExoPlafond")}><input type="number" style={inputStyle} value={f.exoneration_plafond} onChange={(e) => maj("exoneration_plafond", e.target.value)} placeholder={t("paieRubExoAucun")} /></Champ>
                <p style={{ fontSize: 11, color: "var(--sub)", margin: "4px 0 0", lineHeight: 1.4 }}>{t("paieRubExoAide")}</p>
              </div>
            </>
          )}
          <label style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 12.5, marginTop: 12 }}><input type="checkbox" checked={f.actif} onChange={(e) => maj("actif", e.target.checked)} />{t("paieRubActive")}</label>
          <div style={{ display: "flex", gap: 8, marginTop: 14 }}><button style={boutonPrincipal} onClick={enregistrer}>{t("paieEnregistrer")}</button><button style={boutonLeger} onClick={() => setF(null)}>{t("paieAnnuler")}</button></div>
        </Section>
      )}
    </div>
  );
}
