"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { api } from "../../../lib/api";
import { useLangue } from "../../../lib/i18n/LanguageContext";
import AppShell from "../../../lib/components/AppShell";
import ComptaSousNav from "../../../lib/components/ComptaSousNav";
import {
  useComptaStatut,
  labelStyle,
  inputStyle,
  boutonPrincipalStyle,
  boutonSecondaireStyle,
  boutonDangerStyle,
  thStyle,
  tdStyle,
  numStyle,
  formaterMontant,
} from "../../../lib/comptaUi";

const OPTIONS_DEFAUT = { creer_comptes: true, creer_journaux: true, creer_exercices: true, instance: false };

// Import Sage : reprise du grand livre de l'annee en cours et de la balance
// (a-nouveaux, mouvements ou soldes). Le fichier est controle en apercu (rien
// n'est ecrit), puis importe ; un lot d'import peut etre annule.
export default function ComptaImporterPage() {
  const { t } = useLangue();
  const locale = t("dateLocale");
  const { statut, recharger } = useComptaStatut();
  const valid = !!statut?.droits?.validation;
  const m = (v) => formaterMontant(v, locale);

  const [type, setType] = useState("grand-livre"); // grand-livre | balance
  const [fichier, setFichier] = useState(null);
  const [tiersClients, setTiersClients] = useState(null);
  const [tiersFournisseurs, setTiersFournisseurs] = useState(null);
  const [colonnes, setColonnes] = useState("AN");
  const [dateEcriture, setDateEcriture] = useState("");
  const [journalCode, setJournalCode] = useState("");
  const [options, setOptions] = useState(OPTIONS_DEFAUT);
  const [rapport, setRapport] = useState(null);
  const [resultat, setResultat] = useState(null);
  const [lots, setLots] = useState([]);
  const [erreur, setErreur] = useState("");
  const [info, setInfo] = useState("");
  const [occupe, setOccupe] = useState(false);
  const [cleFichier, setCleFichier] = useState(0);

  function chargerLots() {
    api.comptaImportLots().then(setLots).catch(() => {});
  }
  useEffect(() => {
    if (valid) chargerLots();
  }, [valid]);

  function reinitialiser() {
    setRapport(null);
    setResultat(null);
  }

  function formulaire() {
    const fd = new FormData();
    fd.append("fichier", fichier);
    fd.append("creer_comptes", options.creer_comptes ? "1" : "0");
    fd.append("creer_journaux", options.creer_journaux ? "1" : "0");
    fd.append("creer_exercices", options.creer_exercices ? "1" : "0");
    fd.append("statut", options.instance ? "EN_INSTANCE" : "VALIDEE");
    if (type === "balance") {
      fd.append("colonnes", colonnes);
      fd.append("date_ecriture", dateEcriture);
      if (journalCode) fd.append("journal_code", journalCode);
      if (tiersClients) fd.append("tiers_clients", tiersClients);
      if (tiersFournisseurs) fd.append("tiers_fournisseurs", tiersFournisseurs);
    }
    return fd;
  }

  const pret = !!fichier && (type === "grand-livre" || !!dateEcriture);

  async function verifier() {
    setErreur("");
    setInfo("");
    setResultat(null);
    setOccupe(true);
    try {
      setRapport(await api.comptaImportApercu(type, formulaire()));
    } catch (e) {
      setRapport(null);
      setErreur(e.message);
    } finally {
      setOccupe(false);
    }
  }

  async function importer() {
    if (!window.confirm(t("comptaImpConfirmer"))) return;
    setErreur("");
    setInfo("");
    setOccupe(true);
    try {
      const r = await api.comptaImporter(type, formulaire());
      if (r.ok) {
        setResultat(r);
        setRapport(null);
        setFichier(null);
        setTiersClients(null);
        setTiersFournisseurs(null);
        setCleFichier((c) => c + 1);
        setInfo(`${r.stats.ecritures} ${t("comptaImpEcrituresImportees")}`);
        chargerLots();
        recharger();
      } else {
        setRapport(r);
      }
    } catch (e) {
      setErreur(e.message);
    } finally {
      setOccupe(false);
    }
  }

  async function annuler(lot) {
    if (!window.confirm(`${t("comptaImpConfirmerAnnulation")} (${lot.nb_ecritures})`)) return;
    setErreur("");
    setInfo("");
    try {
      const r = await api.comptaImportAnnuler(lot.id);
      setInfo(`${r.ecritures_supprimees} ${t("comptaImpEcrituresSupprimees")}`);
      chargerLots();
      recharger();
    } catch (e) {
      setErreur(e.message);
    }
  }

  function diagnostic(d) {
    const modele = t(`comptaImpDiag_${d.code}`);
    return modele.replace(/\{(\w+)\}/g, (_, k) => {
      const v = d[k];
      return v === undefined || v === null ? "" : /^(debit|credit|ecart)$/.test(k) ? m(v) : String(v);
    });
  }

  const ongletStyle = (actif) => ({
    padding: "7px 16px",
    borderRadius: 20,
    fontSize: 12.5,
    fontWeight: actif ? 700 : 500,
    border: actif ? "none" : "1px solid var(--line)",
    background: actif ? "var(--petrol)" : "transparent",
    color: actif ? "#fff" : "var(--petrol)",
  });

  const nonValid = statut && !valid;

  return (
    <AppShell title={t("comptaNavImporter")} subNav={<ComptaSousNav />}>
      {erreur && <p style={{ color: "var(--brique)", fontSize: 12.5, marginBottom: 12 }}>{erreur}</p>}
      {info && (
        <p style={{ color: "var(--vert)", fontSize: 12.5, marginBottom: 12 }}>
          {info}{" "}
          {resultat && (
            <>
              <Link href="/comptabilite/grand-livre" style={{ color: "var(--petrol)", fontWeight: 600 }}>
                {t("comptaNavGrandLivre")}
              </Link>
              {" · "}
              <Link href="/comptabilite/balance" style={{ color: "var(--petrol)", fontWeight: 600 }}>
                {t("comptaNavBalance")}
              </Link>
            </>
          )}
        </p>
      )}
      {statut && !statut.initialisee && <p style={{ fontSize: 12.5, color: "var(--ocre)" }}>{t("comptaNonInitialisee")}</p>}
      {nonValid && <p style={{ fontSize: 12.5, color: "var(--ocre)" }}>{t("comptaImpReserve")}</p>}

      <p style={{ fontSize: 12, color: "var(--sub)", marginBottom: 14, maxWidth: 860, lineHeight: 1.55 }}>{t("comptaImpAide")}</p>

      {valid && statut?.initialisee && (
        <>
          <div style={{ display: "flex", gap: 8, marginBottom: 14, flexWrap: "wrap" }}>
            <button
              style={ongletStyle(type === "grand-livre")}
              onClick={() => {
                setType("grand-livre");
                reinitialiser();
              }}
            >
              {t("comptaImpOngletGL")}
            </button>
            <button
              style={ongletStyle(type === "balance")}
              onClick={() => {
                setType("balance");
                reinitialiser();
              }}
            >
              {t("comptaImpOngletBalance")}
            </button>
          </div>

          <div className="card" style={{ marginBottom: 18 }}>
            <p style={{ fontSize: 12, color: "var(--sub)", marginBottom: 12, lineHeight: 1.55 }}>
              {type === "grand-livre" ? t("comptaImpAideGL") : t("comptaImpAideBalance")}
            </p>
            <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "flex-end" }}>
              <div>
                <label style={labelStyle}>{t("comptaImpFichier")}</label>
                <input
                  key={cleFichier}
                  type="file"
                  accept=".xls,.xlsx"
                  onChange={(e) => {
                    setFichier(e.target.files?.[0] || null);
                    reinitialiser();
                  }}
                  style={{ ...inputStyle, width: 300 }}
                />
              </div>
              <button style={boutonSecondaireStyle} onClick={() => api.comptaImportModele(type).catch((e) => setErreur(e.message))}>
                {t("comptaImpModele")}
              </button>
            </div>

            {type === "balance" && (
              <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "flex-end", marginTop: 14 }}>
                <div>
                  <label style={labelStyle}>{t("comptaImpColonnes")}</label>
                  <select
                    value={colonnes}
                    onChange={(e) => {
                      setColonnes(e.target.value);
                      reinitialiser();
                    }}
                    style={{ ...inputStyle, width: 250 }}
                  >
                    <option value="AN">{t("comptaImpColAN")}</option>
                    <option value="SOLDES">{t("comptaImpColSoldes")}</option>
                    <option value="MOUVEMENTS">{t("comptaImpColMouvements")}</option>
                  </select>
                </div>
                <div>
                  <label style={labelStyle}>{t("comptaImpDateEcriture")}</label>
                  <input
                    type="date"
                    value={dateEcriture}
                    onChange={(e) => {
                      setDateEcriture(e.target.value);
                      reinitialiser();
                    }}
                    style={{ ...inputStyle, width: 160 }}
                  />
                </div>
                <div>
                  <label style={labelStyle}>{t("comptaImpJournal")}</label>
                  <input
                    value={journalCode}
                    maxLength={5}
                    placeholder={colonnes === "MOUVEMENTS" ? "OD" : "AN"}
                    onChange={(e) => {
                      setJournalCode(e.target.value.toUpperCase());
                      reinitialiser();
                    }}
                    style={{ ...inputStyle, width: 90, fontFamily: "IBM Plex Mono, monospace" }}
                  />
                </div>
                <div>
                  <label style={labelStyle}>{t("comptaImpTiersClients")}</label>
                  <input
                    key={`c${cleFichier}`}
                    type="file"
                    accept=".xls,.xlsx"
                    onChange={(e) => {
                      setTiersClients(e.target.files?.[0] || null);
                      reinitialiser();
                    }}
                    style={{ ...inputStyle, width: 250 }}
                  />
                </div>
                <div>
                  <label style={labelStyle}>{t("comptaImpTiersFournisseurs")}</label>
                  <input
                    key={`f${cleFichier}`}
                    type="file"
                    accept=".xls,.xlsx"
                    onChange={(e) => {
                      setTiersFournisseurs(e.target.files?.[0] || null);
                      reinitialiser();
                    }}
                    style={{ ...inputStyle, width: 250 }}
                  />
                </div>
              </div>
            )}

            <div style={{ display: "flex", gap: 18, flexWrap: "wrap", marginTop: 14 }}>
              {[
                ["creer_comptes", "comptaImpCreerComptes"],
                ["creer_journaux", "comptaImpCreerJournaux"],
                ["creer_exercices", "comptaImpCreerExercices"],
                ["instance", "comptaImpEnInstance"],
              ].map(([cle, libelle]) => (
                <label key={cle} style={{ fontSize: 12, display: "flex", gap: 6, alignItems: "center" }}>
                  <input
                    type="checkbox"
                    checked={!!options[cle]}
                    onChange={(e) => {
                      setOptions((o) => ({ ...o, [cle]: e.target.checked }));
                      reinitialiser();
                    }}
                  />
                  {t(libelle)}
                </label>
              ))}
            </div>

            <div style={{ marginTop: 16 }}>
              <button disabled={!pret || occupe} style={{ ...boutonPrincipalStyle, opacity: !pret || occupe ? 0.55 : 1 }} onClick={verifier}>
                {occupe ? t("comptaImpEnCours") : t("comptaImpVerifier")}
              </button>
            </div>
          </div>

          {rapport && (
            <div className="card" style={{ marginBottom: 18 }}>
              {rapport.ok ? (
                <p style={{ color: "var(--vert)", fontWeight: 700, fontSize: 13.5, marginBottom: 10 }}>{t("comptaImpPret")}</p>
              ) : (
                <p style={{ color: "var(--brique)", fontWeight: 700, fontSize: 13.5, marginBottom: 10 }}>
                  {t("comptaImpBloque")} ({rapport.nb_erreurs ?? rapport.erreurs.length})
                </p>
              )}

              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 10, marginBottom: 12 }}>
                <Stat titre={t("comptaImpEcritures")} valeur={rapport.stats.ecritures} />
                <Stat titre={t("comptaImpLignes")} valeur={rapport.stats.lignes} />
                <Stat titre={t("comptaDebit")} valeur={m(rapport.stats.total_debit)} />
                <Stat titre={t("comptaCredit")} valeur={m(rapport.stats.total_credit)} />
                <Stat
                  titre={t("comptaImpPeriode")}
                  valeur={rapport.stats.date_min ? `${rapport.stats.date_min}${rapport.stats.date_max !== rapport.stats.date_min ? ` → ${rapport.stats.date_max}` : ""}` : "—"}
                  petit
                />
              </div>

              {rapport.erreurs.length > 0 && (
                <ul style={{ margin: "0 0 12px", paddingLeft: 18, fontSize: 12.5, color: "var(--brique)", lineHeight: 1.6 }}>
                  {rapport.erreurs.map((d, i) => (
                    <li key={i}>{diagnostic(d)}</li>
                  ))}
                </ul>
              )}
              {rapport.avertissements.length > 0 && (
                <ul style={{ margin: "0 0 12px", paddingLeft: 18, fontSize: 12.5, color: "var(--ocre)", lineHeight: 1.6 }}>
                  {rapport.avertissements.map((d, i) => (
                    <li key={i}>{diagnostic(d)}</li>
                  ))}
                </ul>
              )}

              {rapport.par_journal.length > 0 && (
                <div style={{ overflowX: "auto", marginBottom: 12 }}>
                  <table style={{ borderCollapse: "collapse", minWidth: 420 }}>
                    <thead>
                      <tr>
                        <th style={thStyle}>{t("comptaJournal")}</th>
                        <th style={{ ...thStyle, textAlign: "right" }}>{t("comptaImpEcritures")}</th>
                        <th style={{ ...thStyle, textAlign: "right" }}>{t("comptaDebit")}</th>
                        <th style={{ ...thStyle, textAlign: "right" }}>{t("comptaCredit")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rapport.par_journal.map((j) => (
                        <tr key={j.code}>
                          <td style={{ ...tdStyle, fontWeight: 700 }}>{j.code}</td>
                          <td style={{ ...tdStyle, ...numStyle }}>{j.ecritures}</td>
                          <td style={{ ...tdStyle, ...numStyle }}>{m(j.debit)}</td>
                          <td style={{ ...tdStyle, ...numStyle }}>{m(j.credit)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              <Creations titre={t("comptaImpComptesCrees")} lignes={rapport.comptes_crees.map((c) => `${c.numero} — ${c.libelle}`)} />
              <Creations titre={t("comptaImpJournauxCrees")} lignes={rapport.journaux_crees.map((j) => `${j.code} — ${j.libelle}`)} />
              <Creations titre={t("comptaImpExercicesCrees")} lignes={rapport.exercices_crees.map((x) => x.libelle)} />
              <Creations
                titre={`${t("comptaImpTiersCrees")} (${rapport.stats.tiers_crees})`}
                lignes={rapport.tiers_crees.map((x) => `${x.code} — ${x.nom}`)}
              />

              {rapport.ok && (
                <div style={{ marginTop: 14 }}>
                  <button disabled={occupe} style={boutonPrincipalStyle} onClick={importer}>
                    {options.instance ? t("comptaImpImporterInstance") : t("comptaImpImporter")}
                  </button>
                </div>
              )}
            </div>
          )}

          <div className="card" style={{ overflowX: "auto" }}>
            <h3 style={{ fontSize: 13.5, color: "var(--petrol)", marginBottom: 10 }}>{t("comptaImpLotsTitre")}</h3>
            {lots.length === 0 ? (
              <p style={{ fontSize: 12.5, color: "var(--sub)" }}>{t("comptaImpAucunLot")}</p>
            ) : (
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr>
                    <th style={thStyle}>{t("comptaDate")}</th>
                    <th style={thStyle}>{t("comptaImpType")}</th>
                    <th style={thStyle}>{t("comptaImpNomFichier")}</th>
                    <th style={thStyle}>{t("comptaImpPeriode")}</th>
                    <th style={{ ...thStyle, textAlign: "right" }}>{t("comptaImpEcritures")}</th>
                    <th style={{ ...thStyle, textAlign: "right" }}>{t("comptaDebit")}</th>
                    <th style={thStyle}>{t("comptaStatut")}</th>
                    <th style={thStyle}></th>
                  </tr>
                </thead>
                <tbody>
                  {lots.map((l) => (
                    <tr key={l.id} style={{ opacity: l.statut === "ANNULE" ? 0.55 : 1 }}>
                      <td style={tdStyle}>{new Date(l.date_creation).toLocaleDateString(locale)}</td>
                      <td style={tdStyle}>{l.type_import === "GRAND_LIVRE" ? t("comptaImpOngletGL") : t("comptaImpOngletBalance")}</td>
                      <td style={tdStyle}>{l.nom_fichier}</td>
                      <td style={tdStyle}>
                        {l.date_min ? `${String(l.date_min).slice(0, 10)}${l.date_max && l.date_max !== l.date_min ? ` → ${String(l.date_max).slice(0, 10)}` : ""}` : "—"}
                      </td>
                      <td style={{ ...tdStyle, ...numStyle }}>{l.nb_ecritures}</td>
                      <td style={{ ...tdStyle, ...numStyle }}>{m(l.total_debit)}</td>
                      <td style={tdStyle}>
                        {l.statut === "ANNULE" ? t("comptaImpAnnule") : l.statut_ecritures === "EN_INSTANCE" ? t("comptaStatutEnInstance") : t("comptaStatutValidee")}
                      </td>
                      <td style={tdStyle}>
                        {l.statut === "ACTIF" && (
                          <button style={boutonDangerStyle} onClick={() => annuler(l)}>
                            {t("comptaImpAnnulerLot")}
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </>
      )}
    </AppShell>
  );
}

function Stat({ titre, valeur, petit }) {
  return (
    <div style={{ border: "1px solid var(--line-soft)", borderRadius: 10, padding: "9px 12px" }}>
      <div style={{ fontSize: 11, color: "var(--sub)", marginBottom: 3 }}>{titre}</div>
      <div style={{ fontSize: petit ? 12.5 : 16, fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>{valeur}</div>
    </div>
  );
}

function Creations({ titre, lignes }) {
  if (!lignes || lignes.length === 0) return null;
  return (
    <details style={{ marginBottom: 8, fontSize: 12.5 }}>
      <summary style={{ cursor: "pointer", fontWeight: 600 }}>
        {titre} ({lignes.length})
      </summary>
      <ul style={{ margin: "6px 0 0", paddingLeft: 18, lineHeight: 1.6, maxHeight: 220, overflowY: "auto" }}>
        {lignes.map((l, i) => (
          <li key={i}>{l}</li>
        ))}
      </ul>
    </details>
  );
}
