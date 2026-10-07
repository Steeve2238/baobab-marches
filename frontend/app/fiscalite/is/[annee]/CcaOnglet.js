"use client";

import { useRef, useState } from "react";
import { api } from "../../../../lib/api";
import { inputStyle, labelStyle, thStyle, tdStyle, boutonPrincipalStyle, boutonSecondaireStyle, pastilleStyle, formaterXof } from "../../../../lib/fiscaliteUi";

const nombre = (v) => (v === "" || v === null || v === undefined ? null : Number(v));

/** Formulaire <-> API pour la partie « comptes courants d'associes » des saisies. */
export function ccaVersFormulaire(c) {
  const x = c || {};
  return {
    taux_bceao: x.taux_bceao ?? "",
    majoration_points: x.majoration_points ?? 3,
    capital_social: x.capital_social ?? "",
    capital_libere: x.capital_libere === true ? "oui" : x.capital_libere === false ? "non" : "auto",
    base_methode: x.base_methode === "CLOTURE" ? "CLOTURE" : "MOYENNE",
    rao_manuel: x.rao_manuel ?? "",
    provisions_manuel: x.provisions_manuel ?? "",
    comptes_cca: (x.comptes_cca || []).join(", "),
    comptes_interets: (x.comptes_interets || []).join(", "),
    associes: (x.associes || []).map((a) => ({ ...a, somme: a.somme ?? "", interets: a.interets ?? "", taux: a.taux ?? "" })),
  };
}

export function ccaPourEnvoi(c) {
  const liste = (s) => String(s || "").split(/[,;\s]+/).filter(Boolean);
  return {
    taux_bceao: nombre(c.taux_bceao),
    majoration_points: nombre(c.majoration_points) ?? 3,
    capital_social: nombre(c.capital_social),
    capital_libere: c.capital_libere === "oui" ? true : c.capital_libere === "non" ? false : null,
    base_methode: c.base_methode,
    rao_manuel: nombre(c.rao_manuel),
    provisions_manuel: nombre(c.provisions_manuel),
    comptes_cca: liste(c.comptes_cca),
    comptes_interets: liste(c.comptes_interets),
    associes: c.associes.map((a) => ({ ...a, somme: nombre(a.somme), interets: nombre(a.interets), taux: nombre(a.taux) })),
  };
}

export default function CcaOnglet({ t, locale, calcul, saisies, setSaisies, gele, annee, executer, setErreur, setInfo }) {
  const mm = (v) => formaterXof(v, locale);
  const cca = calcul.cca;
  const form = saisies.cca;
  const fichier = useRef(null);
  const [report, setReport] = useState({ annee_origine: annee - 1, montant_initial: "", note: "" });
  const maj = (champ, valeur) => setSaisies({ ...saisies, cca: { ...form, [champ]: valeur } });
  const majAssocie = (id, champ, valeur) => maj("associes", form.associes.map((a) => (a.id === id ? { ...a, [champ]: valeur } : a)));
  const nombreInput = (valeur, onChange, largeur = 140, placeholder = "") => (
    <input type="number" step="any" disabled={gele} placeholder={placeholder} value={valeur ?? ""} onChange={(e) => onChange(e.target.value)} style={{ ...inputStyle, width: largeur, textAlign: "right", padding: "4px 8px" }} />
  );
  const ligne = (libelle, valeur, { fort, ref, unite } = {}) => (
    <tr style={fort ? { background: "var(--line-soft)", fontWeight: 700 } : undefined}>
      <td style={tdStyle}>{libelle}</td>
      <td style={{ ...tdStyle, color: "var(--sub)", fontSize: 11.5 }}>{ref || ""}</td>
      <td style={{ ...tdStyle, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{valeur === null || valeur === undefined ? "" : `${typeof valeur === "number" && !unite ? mm(valeur) : valeur}${unite || ""}`}</td>
    </tr>
  );

  async function importerTableau(e) {
    const f = e.target.files && e.target.files[0];
    e.target.value = "";
    if (!f) return;
    setErreur("");
    try {
      const fd = new FormData();
      fd.append("fichier", f);
      const r = await api.fiscaliteImportAssociesApercu(fd);
      const nouveaux = r.associes.map((a, i) => ({ id: `i${Date.now()}${i}`, nom: a.nom, compte: a.compte || "", nature: a.nature, somme: a.somme ?? "", interets: a.interets ?? "", taux: a.taux ?? "", exclu: false }));
      maj("associes", nouveaux);
      setInfo(t("fiscCcaInfoImporte").replace("{nombre}", String(nouveaux.length)));
    } catch (err) {
      setErreur(err.message);
    }
  }

  const sourceLabel = { SAISIE: t("fiscCcaOrigineSaisie"), COMPTES: t("fiscCcaOrigineComptes") };
  const statutTaux = cca.taux.statut;
  const pm = cca.pm;

  return (
    <div>
      <p style={{ fontSize: 12, color: "var(--sub)", marginBottom: 12, maxWidth: 860, lineHeight: 1.5 }}>{t("fiscCcaAide")}</p>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 12, marginBottom: 14 }}>
        {[
          [t("fiscCcaInteretsCompta"), cca.totaux.interets, null],
          [t("fiscCcaReintegration"), cca.totaux.reintegration, cca.totaux.reintegration > 0 ? "var(--brique)" : null],
          [t("fiscCcaDeductibles"), cca.totaux.deductible, null],
        ].map(([titre, valeur, couleur]) => (
          <div key={titre} className="card" style={couleur ? { borderLeft: `3px solid ${couleur}` } : undefined}>
            <div style={{ fontSize: 11, color: "var(--sub)", fontWeight: 700 }}>{titre}</div>
            <div style={{ fontSize: 18, fontWeight: 700, marginTop: 4, fontVariantNumeric: "tabular-nums" }}>{mm(valeur)}</div>
            <div style={{ fontSize: 11.5, color: "var(--sub)" }}>XOF</div>
          </div>
        ))}
      </div>

      {cca.actif && (
        <div className="card" style={{ marginBottom: 14, borderLeft: "3px solid #2E7D5B", fontSize: 12.5, lineHeight: 1.55 }}>
          {t("fiscCcaRattache")
            .replace("{reint}", mm(cca.totaux.reintegration))
            .replace("{deduction}", mm(cca.totaux.deduction_report || 0))}
        </div>
      )}

      {cca.actif && cca.variante_excel.ecart_reintegration !== 0 && (
        <div className="card" style={{ marginBottom: 14, borderLeft: "3px solid var(--ocre)", fontSize: 12.5, lineHeight: 1.55 }}>
          <strong>{t("fiscCcaVarianteTitre")}</strong>
          <div>
            {t("fiscCcaVarianteTexte")
              .replace("{reint}", mm(cca.variante_excel.reintegration_pm))
              .replace("{retenue}", mm(cca.pm.reintegration))
              .replace("{ecart}", mm(cca.variante_excel.ecart_reintegration))
              .replace("{is}", mm(cca.variante_excel.ecart_is))}
          </div>
        </div>
      )}

      <h3 style={{ fontSize: 13.5, color: "var(--petrol)", marginBottom: 6 }}>{t("fiscCcaParametres")}</h3>
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 6 }}>
        <div>
          <label style={labelStyle}>{t("fiscCcaTauxBceao")}</label>
          {nombreInput(form.taux_bceao, (v) => maj("taux_bceao", v), 130, cca.taux.suggere ? String(cca.taux.suggere.taux) : "")}
        </div>
        <div>
          <label style={labelStyle}>{t("fiscCcaMajoration")}</label>
          {nombreInput(form.majoration_points, (v) => maj("majoration_points", v), 110)}
        </div>
        <div>
          <label style={labelStyle}>{t("fiscCcaCapital")}</label>
          {nombreInput(form.capital_social, (v) => maj("capital_social", v), 190, String(cca.entrees.capital_auto))}
        </div>
        <div>
          <label style={labelStyle}>{t("fiscCcaCapitalLibere")}</label>
          <select disabled={gele} value={form.capital_libere} onChange={(e) => maj("capital_libere", e.target.value)} style={{ ...inputStyle, width: 190 }}>
            <option value="auto">{t("fiscCcaAuto")}</option>
            <option value="oui">{t("fiscOui")}</option>
            <option value="non">{t("fiscNon")}</option>
          </select>
        </div>
        <div>
          <label style={labelStyle}>{t("fiscCcaBaseMethode")}</label>
          <select disabled={gele} value={form.base_methode} onChange={(e) => maj("base_methode", e.target.value)} style={{ ...inputStyle, width: 230 }}>
            <option value="MOYENNE">{t("fiscCcaMethodeMoyenne")}</option>
            <option value="CLOTURE">{t("fiscCcaMethodeCloture")}</option>
          </select>
        </div>
      </div>
      <div style={{ fontSize: 11.5, color: "var(--sub)", marginBottom: 12 }}>
        {cca.taux.plafond !== null
          ? t("fiscCcaPlafondTaux").replace("{plafond}", String(cca.taux.plafond))
          : cca.taux.suggere
            ? t("fiscCcaTauxSuggere").replace("{annee}", String(cca.taux.suggere.annee)).replace("{taux}", String(cca.taux.suggere.taux))
            : t("fiscCcaTauxAide")}
      </div>
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 16 }}>
        <div>
          <label style={labelStyle}>{t("fiscCcaComptesCca")}</label>
          <input disabled={gele} value={form.comptes_cca} onChange={(e) => maj("comptes_cca", e.target.value)} style={{ ...inputStyle, width: 200 }} />
        </div>
        <div>
          <label style={labelStyle}>{t("fiscCcaComptesInterets")}</label>
          <input disabled={gele} value={form.comptes_interets} onChange={(e) => maj("comptes_interets", e.target.value)} style={{ ...inputStyle, width: 200 }} />
        </div>
        <div>
          <label style={labelStyle}>{t("fiscCcaRaoManuel")}</label>
          {nombreInput(form.rao_manuel, (v) => maj("rao_manuel", v), 190, String(cca.entrees.rao))}
        </div>
        <div>
          <label style={labelStyle}>{t("fiscCcaProvisionsManuel")}</label>
          {nombreInput(form.provisions_manuel, (v) => maj("provisions_manuel", v), 170, String(cca.entrees.provisions))}
        </div>
      </div>

      <h3 style={{ fontSize: 13.5, color: "var(--petrol)", marginBottom: 6 }}>{t("fiscCcaAssocies")}</h3>
      <p style={{ fontSize: 12, color: "var(--sub)", marginBottom: 8, maxWidth: 860, lineHeight: 1.5 }}>{t("fiscCcaAssociesAide")}</p>
      <div style={{ overflowX: "auto", marginBottom: 8 }}>
        <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 960 }}>
          <thead>
            <tr>
              <th style={thStyle}>{t("fiscCcaAssocie")}</th>
              <th style={thStyle}>{t("fiscCcaNature")}</th>
              <th style={thStyle}>{t("fiscCcaCompte")}</th>
              <th style={{ ...thStyle, textAlign: "right" }}>{t("fiscCcaSomme")}</th>
              <th style={{ ...thStyle, textAlign: "right" }}>{t("fiscCcaInterets")}</th>
              <th style={{ ...thStyle, textAlign: "right" }}>{t("fiscCcaTaux")}</th>
              <th style={{ ...thStyle, textAlign: "right" }}>{t("fiscCcaReint")}</th>
              <th style={thStyle}></th>
            </tr>
          </thead>
          <tbody>
            {cca.associes.length === 0 && form.associes.length === 0 && (
              <tr><td style={{ ...tdStyle, color: "var(--sub)" }} colSpan={8}>{t("fiscCcaAucun")}</td></tr>
            )}
            {form.associes.map((a) => {
              const r = cca.associes.find((x) => x.cle === a.id);
              return (
                <tr key={a.id} style={a.exclu ? { opacity: 0.5 } : undefined}>
                  <td style={tdStyle}><input disabled={gele} value={a.nom} onChange={(e) => majAssocie(a.id, "nom", e.target.value)} style={{ ...inputStyle, width: 190, padding: "4px 8px" }} /></td>
                  <td style={tdStyle}>
                    <select disabled={gele} value={a.nature} onChange={(e) => majAssocie(a.id, "nature", e.target.value)} style={{ ...inputStyle, width: 150, padding: "4px 8px" }}>
                      <option value="PERSONNE_MORALE">{t("fiscCcaPM")}</option>
                      <option value="PERSONNE_PHYSIQUE">{t("fiscCcaPP")}</option>
                    </select>
                  </td>
                  <td style={tdStyle}><input disabled={gele} value={a.compte || ""} onChange={(e) => majAssocie(a.id, "compte", e.target.value)} style={{ ...inputStyle, width: 110, padding: "4px 8px" }} /></td>
                  <td style={{ ...tdStyle, textAlign: "right" }}>{nombreInput(a.somme, (v) => majAssocie(a.id, "somme", v), 150, r ? String(r.somme) : "")}</td>
                  <td style={{ ...tdStyle, textAlign: "right" }}>{nombreInput(a.interets, (v) => majAssocie(a.id, "interets", v), 130, r ? String(r.interets) : "")}</td>
                  <td style={{ ...tdStyle, textAlign: "right" }}>{nombreInput(a.taux, (v) => majAssocie(a.id, "taux", v), 70, r ? String(r.taux_effectif) : "")}</td>
                  <td style={{ ...tdStyle, textAlign: "right", fontVariantNumeric: "tabular-nums", fontWeight: 700 }}>{r ? mm(r.reintegration) : ""}</td>
                  <td style={{ ...tdStyle, textAlign: "right", whiteSpace: "nowrap" }}>
                    {!gele && (
                      <>
                        <button style={{ ...boutonSecondaireStyle, marginRight: 4 }} onClick={() => majAssocie(a.id, "exclu", !a.exclu)}>{a.exclu ? t("fiscCcaInclure") : t("fiscCcaExclure")}</button>
                        <button style={boutonSecondaireStyle} onClick={() => maj("associes", form.associes.filter((x) => x.id !== a.id))}>{t("fiscSupprimer")}</button>
                      </>
                    )}
                  </td>
                </tr>
              );
            })}
            {cca.associes.filter((r) => !form.associes.some((a) => a.id === r.cle)).map((r) => (
              <tr key={r.cle}>
                <td style={tdStyle}>
                  {r.nom} <span style={pastilleStyle({ color: "#35629a", background: "rgba(53,98,154,0.12)" })}>{sourceLabel[r.origine] || t("fiscCcaOrigineComptes")}</span>
                  <div style={{ fontSize: 11, color: "var(--sub)" }}>{r.methode === "MOYENNE_JOURNALIERE" ? t("fiscCcaMoyenneJour") : t("fiscCcaSoldeCloture")}{r.somme_cloture !== null ? ` · ${t("fiscCcaCloture")} ${mm(r.somme_cloture)}` : ""}</div>
                </td>
                <td style={tdStyle}>{r.nature === "PERSONNE_PHYSIQUE" ? t("fiscCcaPP") : t("fiscCcaPM")}</td>
                <td style={tdStyle}>{r.compte}</td>
                <td style={{ ...tdStyle, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{mm(r.somme)}</td>
                <td style={{ ...tdStyle, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{mm(r.interets)}</td>
                <td style={{ ...tdStyle, textAlign: "right" }}>{r.taux_effectif}</td>
                <td style={{ ...tdStyle, textAlign: "right", fontVariantNumeric: "tabular-nums", fontWeight: 700 }}>{mm(r.reintegration)}</td>
                <td style={{ ...tdStyle, textAlign: "right" }}>
                  {!gele && (
                    <button
                      style={boutonSecondaireStyle}
                      onClick={() => maj("associes", [...form.associes, { id: r.cle, nom: r.nom, compte: r.compte, nature: r.nature, somme: "", interets: "", taux: "", exclu: false }])}
                    >
                      {t("fiscCcaModifier")}
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!gele && (
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 18 }}>
          <button style={boutonSecondaireStyle} onClick={() => maj("associes", [...form.associes, { id: `n${Date.now()}`, nom: t("fiscCcaNouvelAssocie"), compte: "", nature: "PERSONNE_MORALE", somme: "", interets: "", taux: "", exclu: false }])}>{t("fiscCcaAjouterAssocie")}</button>
          <button style={boutonSecondaireStyle} onClick={() => fichier.current && fichier.current.click()}>{t("fiscCcaImporterTableau")}</button>
          <button style={boutonSecondaireStyle} onClick={() => api.fiscaliteImportModele("associes").catch((e) => setErreur(e.message))}>{t("fiscCcaModele")}</button>
          <input ref={fichier} type="file" accept=".xlsx,.xls,.csv" style={{ display: "none" }} onChange={importerTableau} />
        </div>
      )}

      {cca.actif && (
        <>
          <h3 style={{ fontSize: 13.5, color: "var(--petrol)", marginBottom: 6 }}>{t("fiscCcaDetail")}</h3>
          <table style={{ width: "100%", maxWidth: 860, borderCollapse: "collapse", marginBottom: 18 }}>
            <thead>
              <tr>
                <th style={thStyle}>{t("fiscDesignation")}</th>
                <th style={thStyle}>{t("fiscRetReference")}</th>
                <th style={{ ...thStyle, textAlign: "right", width: 170 }}>{t("fiscMontant")}</th>
              </tr>
            </thead>
            <tbody>
              {ligne(t("fiscCcaDTaux"), cca.taux.plafond === null ? t("fiscCcaARenseigner") : `${statutTaux === "OK" ? t("fiscCcaTauxOk") : t("fiscCcaTauxDepasse")} (≤ ${cca.taux.plafond} %)`, { ref: "art. 11-2 a)", unite: "" })}
              {ligne(t("fiscCcaDCapitalLibere"), cca.capital.libere ? t("fiscOui") : `${t("fiscNon")} (${mm(cca.capital.non_libere)})`, { ref: "art. 11-2 b)", unite: "" })}
              {ligne(t("fiscCcaDCapital"), cca.capital.montant, { ref: "" })}
              {ligne(t("fiscCcaDSommesPm"), pm.somme, { ref: "" })}
              {ligne(t("fiscCcaDPlafondStruct"), pm.plafond_structurel, { ref: "art. 11-2 d) 1er tiret" })}
              {ligne(t("fiscCcaDExces"), pm.exces, { ref: "" })}
              {ligne(t("fiscCcaDRatio"), `${(pm.ratio_deductible * 100).toFixed(2)} %`, { ref: "", unite: "" })}
              {ligne(t("fiscCcaDRao"), pm.composantes.rao, { ref: "" })}
              {ligne(`+ ${t("fiscCcaDInterets")}`, pm.composantes.interets, { ref: "" })}
              {ligne(`+ ${t("fiscCcaDAmort")}`, pm.composantes.amortissements, { ref: "" })}
              {ligne(`+ ${t("fiscCcaDProvisions")}`, pm.composantes.provisions, { ref: "" })}
              {ligne(`= ${t("fiscCcaDBase")}`, pm.base_ebitda, { fort: true, ref: "" })}
              {ligne(t("fiscCcaDPlafond15"), pm.plafond_15, { ref: "art. 11-2 d) 2e tiret" })}
              {ligne(t("fiscCcaDPartExces"), pm.part_sur_exces, { ref: t("fiscCcaDCond1") })}
              {ligne(t("fiscCcaDPartAuDela"), pm.part_au_dela_15, { ref: t("fiscCcaDCond2") })}
              {ligne(`= ${t("fiscCcaDReintPm")}`, pm.reintegration, { fort: true, ref: t("fiscCcaDMin") })}
              {cca.pp.somme > 0 && ligne(t("fiscCcaDPp"), cca.pp.exces, { ref: "art. 11-2 c)" })}
              {cca.report.deduction > 0 && ligne(t("fiscCcaDReportDeduit"), cca.report.deduction, { ref: "art. 11-2 j)" })}
            </tbody>
          </table>
        </>
      )}

      <h3 style={{ fontSize: 13.5, color: "var(--petrol)", marginBottom: 6 }}>{t("fiscCcaReportsTitre")}</h3>
      <p style={{ fontSize: 12, color: "var(--sub)", marginBottom: 8, maxWidth: 860, lineHeight: 1.5 }}>{t("fiscCcaReportsAide")}</p>
      <table style={{ width: "100%", maxWidth: 760, borderCollapse: "collapse", marginBottom: 8 }}>
        <thead>
          <tr>
            <th style={thStyle}>{t("fiscDeficitOrigine")}</th>
            <th style={{ ...thStyle, textAlign: "right" }}>{t("fiscDeficitInitial")}</th>
            <th style={{ ...thStyle, textAlign: "right" }}>{t("fiscDeficitImpute")}</th>
            <th style={{ ...thStyle, textAlign: "right" }}>{t("fiscDeficitReste")}</th>
            <th style={thStyle}>{t("fiscSource")}</th>
            <th style={thStyle}></th>
          </tr>
        </thead>
        <tbody>
          {cca.reports.length === 0 && <tr><td style={{ ...tdStyle, color: "var(--sub)" }} colSpan={6}>{t("fiscCcaReportsAucun")}</td></tr>}
          {cca.reports.map((r) => (
            <tr key={r.id}>
              <td style={{ ...tdStyle, fontWeight: 700 }}>{r.annee_origine}</td>
              <td style={{ ...tdStyle, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{mm(r.montant_initial)}</td>
              <td style={{ ...tdStyle, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{mm(r.impute)}</td>
              <td style={{ ...tdStyle, textAlign: "right", fontVariantNumeric: "tabular-nums", fontWeight: 700 }}>{mm(r.reste)}</td>
              <td style={tdStyle}>{r.source === "DECLARATION" ? t("fiscDeficitSourceDecl") : t("fiscSource_SAISIE")}</td>
              <td style={{ ...tdStyle, textAlign: "right" }}>
                {r.source === "MANUEL" && r.impute === 0 && !gele && <button style={boutonSecondaireStyle} onClick={() => executer(() => api.fiscaliteCcaSupprimerReport(r.id))}>{t("fiscSupprimer")}</button>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {!gele && (
        <div style={{ display: "flex", gap: 10, alignItems: "flex-end", flexWrap: "wrap" }}>
          <div>
            <label style={labelStyle}>{t("fiscDeficitOrigine")}</label>
            <input type="number" value={report.annee_origine} onChange={(e) => setReport({ ...report, annee_origine: e.target.value })} style={{ ...inputStyle, width: 100 }} />
          </div>
          <div>
            <label style={labelStyle}>{t("fiscDeficitInitial")}</label>
            <input type="number" min="0" value={report.montant_initial} onChange={(e) => setReport({ ...report, montant_initial: e.target.value })} style={{ ...inputStyle, width: 170, textAlign: "right" }} />
          </div>
          <div>
            <label style={labelStyle}>{t("fiscNote")}</label>
            <input value={report.note} onChange={(e) => setReport({ ...report, note: e.target.value })} style={{ ...inputStyle, width: 220 }} />
          </div>
          <button
            style={boutonPrincipalStyle}
            onClick={() =>
              executer(async () => {
                await api.fiscaliteCcaAjouterReport({ ...report, annee_origine: Number(report.annee_origine), montant_initial: Number(report.montant_initial) });
                setReport({ ...report, montant_initial: "", note: "" });
              })
            }
          >
            {t("fiscCcaReportAjouter")}
          </button>
        </div>
      )}
    </div>
  );
}
