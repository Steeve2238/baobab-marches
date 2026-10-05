"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { api } from "../../../../lib/api";
import { useLangue } from "../../../../lib/i18n/LanguageContext";
import AppShell from "../../../../lib/components/AppShell";
import ComptaSousNav from "../../../../lib/components/ComptaSousNav";
import VentilationEditor, { ventilationVersPayload, totalParts, partsDepuisLigne } from "../../../../lib/components/VentilationEditor";
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
  centimes,
  statutLibelleCle,
  STATUT_COULEURS,
} from "../../../../lib/comptaUi";

const LIGNE_VIDE = () => ({ cle: Math.random().toString(36).slice(2), compte_numero: "", tiers_id: "", libelle: "", debit: "", credit: "", date_echeance: "", parts: [] });
const nombre = (v) => Number(String(v || "").replace(/\s/g, "").replace(",", ".")) || 0;
const estCollectif = (n) => /^(40|41)/.test(n || "");

// Saisie / detail d'une ecriture. id = "nouvelle" : creation d'un brouillon.
// Un brouillon est modifiable (grille de lignes avec controle d'equilibre en
// direct) ; une ecriture validee ou en instance est en lecture seule : on la
// corrige par extourne (niveau "validation").
export default function EcritureDetailPage() {
  const { t } = useLangue();
  const locale = t("dateLocale");
  const router = useRouter();
  const { id } = useParams();
  const creation = id === "nouvelle";
  const { statut } = useComptaStatut();
  const valid = !!statut?.droits?.validation;
  const peutEcrire = !!statut?.droits?.ecriture;

  const [journaux, setJournaux] = useState([]);
  const [comptes, setComptes] = useState([]);
  const [tiers, setTiers] = useState([]);
  const [sections, setSections] = useState([]);
  const [editVent, setEditVent] = useState(null); // { ligneId, parts } : ventilation d'une ligne d'ecriture deja validee
  const [ecriture, setEcriture] = useState(null);
  const [entete, setEntete] = useState({ journal_id: "", date_ecriture: new Date().toISOString().slice(0, 10), libelle: "", numero_piece: "" });
  const [lignes, setLignes] = useState([LIGNE_VIDE(), LIGNE_VIDE()]);
  const [erreur, setErreur] = useState("");
  const [info, setInfo] = useState("");
  const [envoi, setEnvoi] = useState(false);

  useEffect(() => {
    api.comptaJournaux().then((j) => setJournaux(j.filter((x) => x.actif))).catch(() => {});
    api.comptaComptes({ limit: 5000, actif: "true" }).then(setComptes).catch(() => {});
    api.comptaTiers().then(setTiers).catch(() => {});
    api.comptaAnalytiqueSections({ actifs: "1" }).then(setSections).catch(() => {});
  }, []);

  function chargerEcriture() {
    api
      .comptaEcriture(id)
      .then((e) => {
        setEcriture(e);
        setEntete({ journal_id: e.journal_id, date_ecriture: e.date_ecriture, libelle: e.libelle, numero_piece: e.numero_piece || "" });
        setLignes(
          e.lignes.map((l) => ({
            cle: l.id,
            compte_numero: l.compte_numero,
            tiers_id: l.tiers_id || "",
            libelle: l.libelle || "",
            debit: Number(l.debit) ? String(l.debit) : "",
            credit: Number(l.credit) ? String(l.credit) : "",
            date_echeance: l.date_echeance || "",
            parts: partsDepuisLigne(l.analytique, Number(l.debit) || Number(l.credit)),
          }))
        );
      })
      .catch((e) => setErreur(e.message));
  }
  useEffect(() => {
    if (!creation) chargerEcriture();
  }, [id]); // eslint-disable-line react-hooks/exhaustive-deps

  const compteParNumero = useMemo(() => new Map(comptes.map((c) => [c.numero, c])), [comptes]);
  const editable = creation || ecriture?.statut === "BROUILLON";
  const lectureSeule = !editable || !peutEcrire;

  const totaux = useMemo(() => {
    let d = 0;
    let c = 0;
    for (const l of lignes) {
      d += centimes(nombre(l.debit));
      c += centimes(nombre(l.credit));
    }
    return { d, c, ecart: d - c };
  }, [lignes]);

  const majLigne = (cle, patch) => setLignes((ls) => ls.map((l) => (l.cle === cle ? { ...l, ...patch } : l)));

  function payload() {
    return {
      ...entete,
      lignes: lignes
        .filter((l) => l.compte_numero || nombre(l.debit) || nombre(l.credit))
        .map((l) => ({
          compte_numero: l.compte_numero,
          tiers_id: l.tiers_id || null,
          libelle: l.libelle || null,
          debit: nombre(l.debit),
          credit: nombre(l.credit),
          date_echeance: l.date_echeance || null,
          ...(compteParNumero.get(l.compte_numero)?.analytique && ventilationVersPayload(l.parts) ? { analytique: ventilationVersPayload(l.parts) } : {}),
        })),
    };
  }

  async function enregistrer(puisValider) {
    setErreur("");
    setInfo("");
    setEnvoi(true);
    try {
      let e;
      if (creation) e = await api.comptaCreerEcriture(payload());
      else e = await api.comptaModifierEcriture(id, payload());
      if (puisValider) {
        try {
          await api.comptaValiderEcriture(e.id);
        } catch (err) {
          // L'ecriture reste enregistree en brouillon : on l'ouvre pour correction.
          setErreur(`${t("comptaEnregistreeNonValidee")} ${err.message}`);
          if (creation) router.replace(`/comptabilite/ecritures/${e.id}`);
          else chargerEcriture();
          return;
        }
      }
      if (creation) router.replace(`/comptabilite/ecritures/${e.id}`);
      else {
        setInfo(puisValider ? t("comptaEcritureValidee") : t("comptaBrouillonEnregistre"));
        chargerEcriture();
      }
    } catch (err) {
      setErreur(err.message);
    } finally {
      setEnvoi(false);
    }
  }

  async function enregistrerVentilation(ligneId, parts) {
    setErreur("");
    setInfo("");
    try {
      await api.comptaAnalytiqueVentilerLigne(ligneId, ventilationVersPayload(parts) || []);
      setEditVent(null);
      setInfo(t("comptaAnaVentilationEnregistree"));
      chargerEcriture();
    } catch (err) {
      setErreur(err.message);
    }
  }

  async function valider() {
    setErreur("");
    try {
      await api.comptaValiderEcriture(id);
      setInfo(t("comptaEcritureValidee"));
      chargerEcriture();
    } catch (e) {
      setErreur(e.message);
    }
  }

  async function supprimer() {
    if (!window.confirm(t("comptaConfirmSuppression"))) return;
    try {
      await api.comptaSupprimerEcriture(id);
      router.replace("/comptabilite/ecritures");
    } catch (e) {
      setErreur(e.message);
    }
  }

  async function extourner() {
    const date = window.prompt(t("comptaExtournePrompt"), new Date().toISOString().slice(0, 10));
    if (!date) return;
    try {
      const e = await api.comptaExtourner(id, { date_ecriture: date });
      router.push(`/comptabilite/ecritures/${e.id}`);
    } catch (err) {
      setErreur(err.message);
    }
  }

  const equilibre = totaux.ecart === 0 && totaux.d > 0;

  return (
    <AppShell title={creation ? t("comptaNouvelleEcriture") : `${t("comptaEcritureMot")} ${ecriture?.journal_code || ""} ${ecriture?.numero_ecriture ?? ""}`} backHref="/comptabilite/ecritures" backLabelKey="comptaNavEcritures" subNav={<ComptaSousNav />}>
      {erreur && <p style={{ color: "var(--brique)", fontSize: 12.5, marginBottom: 12 }}>{erreur}</p>}
      {info && <p style={{ color: "var(--vert)", fontSize: 12.5, marginBottom: 12 }}>{info}</p>}

      {ecriture && (
        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", marginBottom: 14, fontSize: 12.5 }}>
          <span style={{ fontSize: 11, fontWeight: 700, padding: "3px 10px", borderRadius: 20, ...STATUT_COULEURS[ecriture.statut] }}>{t(statutLibelleCle(ecriture.statut))}</span>
          <span style={{ color: "var(--sub)" }}>
            {ecriture.exercice_libelle} · {t("comptaOrigine")} : {ecriture.origine}
          </span>
          {ecriture.extourne_de_id && (
            <Link href={`/comptabilite/ecritures/${ecriture.extourne_de_id}`} style={{ color: "var(--petrol)", fontWeight: 600 }}>
              {t("comptaVoirOriginale")}
            </Link>
          )}
          {ecriture.extournee_par_id && (
            <Link href={`/comptabilite/ecritures/${ecriture.extournee_par_id}`} style={{ color: "var(--ocre)", fontWeight: 600 }}>
              {t("comptaVoirExtourne")}
            </Link>
          )}
        </div>
      )}

      <div className="card" style={{ marginBottom: 14 }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))", gap: 10 }}>
          <div>
            <label style={labelStyle}>{t("comptaJournal")}</label>
            <select disabled={lectureSeule} value={entete.journal_id} onChange={(e) => setEntete((h) => ({ ...h, journal_id: e.target.value }))} style={inputStyle}>
              <option value="">—</option>
              {(lectureSeule && ecriture ? [{ id: ecriture.journal_id, code: ecriture.journal_code, libelle: ecriture.journal_libelle }] : journaux).map((j) => (
                <option key={j.id} value={j.id}>
                  {j.code} — {j.libelle}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label style={labelStyle}>{t("comptaDate")}</label>
            <input disabled={lectureSeule} type="date" value={entete.date_ecriture} onChange={(e) => setEntete((h) => ({ ...h, date_ecriture: e.target.value }))} style={inputStyle} />
          </div>
          <div>
            <label style={labelStyle}>{t("comptaPiece")}</label>
            <input disabled={lectureSeule} value={entete.numero_piece} onChange={(e) => setEntete((h) => ({ ...h, numero_piece: e.target.value }))} style={inputStyle} />
          </div>
          <div style={{ gridColumn: "span 2", minWidth: 220 }}>
            <label style={labelStyle}>{t("comptaLibelle")}</label>
            <input disabled={lectureSeule} value={entete.libelle} onChange={(e) => setEntete((h) => ({ ...h, libelle: e.target.value }))} style={inputStyle} />
          </div>
        </div>
      </div>

      <datalist id="comptes-liste">
        {comptes.map((c) => (
          <option key={c.id} value={c.numero}>
            {c.libelle}
          </option>
        ))}
      </datalist>

      <div className="card" style={{ padding: 0, overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 1100 }}>
          <thead>
            <tr>
              <th style={thStyle}>{t("comptaCompte")}</th>
              <th style={thStyle}>{t("comptaTiers")}</th>
              <th style={thStyle}>{t("comptaLibelleLigne")}</th>
              <th style={{ ...thStyle, textAlign: "right" }}>{t("comptaDebit")}</th>
              <th style={{ ...thStyle, textAlign: "right" }}>{t("comptaCredit")}</th>
              <th style={thStyle}>{t("comptaEcheance")}</th>
              {sections.length > 0 && <th style={thStyle}>{t("comptaAnaDossier")}</th>}
              {!lectureSeule && <th style={thStyle}></th>}
            </tr>
          </thead>
          <tbody>
            {lignes.map((l) => {
              const compte = compteParNumero.get(l.compte_numero);
              const lignePersistee = ecriture?.lignes?.find((x) => x.id === l.cle);
              const typeTiers = l.compte_numero.startsWith("41") ? "CLIENT" : "FOURNISSEUR";
              const tiersFiltres = tiers.filter((x) => x.type_tiers === typeTiers);
              return (
                <tr key={l.cle}>
                  <td style={{ ...tdStyle, minWidth: 230 }}>
                    <input
                      disabled={lectureSeule}
                      list="comptes-liste"
                      value={l.compte_numero}
                      onChange={(e) => majLigne(l.cle, { compte_numero: e.target.value.replace(/\D/g, "") })}
                      style={{ ...inputStyle, width: 120, fontFamily: "IBM Plex Mono, monospace", borderColor: l.compte_numero && !compte && !lectureSeule ? "var(--brique)" : undefined }}
                    />
                    <div style={{ fontSize: 11, color: "var(--sub)", marginTop: 2 }}>{compte ? compte.libelle : lignePersistee?.compte_libelle || ""}</div>
                  </td>
                  <td style={{ ...tdStyle, minWidth: 170 }}>
                    {estCollectif(l.compte_numero) ? (
                      lectureSeule ? (
                        <span>{lignePersistee ? `${lignePersistee.tiers_code || ""} ${lignePersistee.tiers_nom || ""}` : ""}</span>
                      ) : (
                        <select value={l.tiers_id} onChange={(e) => majLigne(l.cle, { tiers_id: e.target.value })} style={inputStyle}>
                          <option value="">—</option>
                          {tiersFiltres.map((x) => (
                            <option key={x.id} value={x.id}>
                              {x.code} — {x.nom}
                            </option>
                          ))}
                        </select>
                      )
                    ) : null}
                  </td>
                  <td style={tdStyle}>
                    <input disabled={lectureSeule} value={l.libelle} onChange={(e) => majLigne(l.cle, { libelle: e.target.value })} style={inputStyle} />
                  </td>
                  <td style={tdStyle}>
                    <input
                      disabled={lectureSeule}
                      inputMode="decimal"
                      value={l.debit}
                      onChange={(e) => majLigne(l.cle, { debit: e.target.value, credit: e.target.value ? "" : l.credit })}
                      style={{ ...inputStyle, width: 130, ...numStyle }}
                    />
                  </td>
                  <td style={tdStyle}>
                    <input
                      disabled={lectureSeule}
                      inputMode="decimal"
                      value={l.credit}
                      onChange={(e) => majLigne(l.cle, { credit: e.target.value, debit: e.target.value ? "" : l.debit })}
                      style={{ ...inputStyle, width: 130, ...numStyle }}
                    />
                  </td>
                  <td style={tdStyle}>
                    {(estCollectif(l.compte_numero) || l.date_echeance) && (
                      <input disabled={lectureSeule} type="date" value={l.date_echeance} onChange={(e) => majLigne(l.cle, { date_echeance: e.target.value })} style={{ ...inputStyle, width: 140 }} />
                    )}
                  </td>
                  {sections.length > 0 && (
                    <td style={{ ...tdStyle, minWidth: 210 }}>
                      {!compte?.analytique ? null : !lectureSeule ? (
                        <VentilationEditor sections={sections} parts={l.parts} onChange={(parts) => majLigne(l.cle, { parts })} />
                      ) : editVent?.ligneId === l.cle ? (
                        <div style={{ display: "grid", gap: 6 }}>
                          <VentilationEditor sections={sections} parts={editVent.parts} onChange={(parts) => setEditVent((v) => ({ ...v, parts }))} />
                          <div style={{ display: "flex", gap: 6 }}>
                            <button type="button" style={{ ...boutonPrincipalStyle, padding: "4px 10px" }} disabled={(editVent.parts || []).filter((p) => p.section_id).length > 1 && Math.abs(totalParts(editVent.parts) - 100) > 0.005} onClick={() => enregistrerVentilation(l.cle, editVent.parts)}>{t("comptaAnaEnregistrer")}</button>
                            <button type="button" style={{ ...boutonSecondaireStyle, padding: "3px 8px" }} onClick={() => setEditVent(null)}>{t("comptaAnnuler")}</button>
                          </div>
                        </div>
                      ) : (
                        <div style={{ fontSize: 12 }}>
                          {(lignePersistee?.analytique || []).length === 0 ? (
                            <span style={{ color: "var(--sub)" }}>{t("comptaAnaNonAffecte")}</span>
                          ) : (
                            lignePersistee.analytique.map((a) => (
                              <div key={a.section_id}>
                                <span style={{ fontFamily: "IBM Plex Mono, monospace", fontWeight: 600 }}>{a.code}</span>{" "}
                                {(lignePersistee.analytique.length > 1) && <span style={{ color: "var(--sub)" }}>{formaterMontant(a.montant, locale)}</span>}
                              </div>
                            ))
                          )}
                          {peutEcrire && ecriture?.statut !== "BROUILLON" && (
                            <button type="button" onClick={() => setEditVent({ ligneId: l.cle, parts: l.parts })} style={{ border: "none", background: "transparent", color: "var(--petrol)", fontWeight: 600, padding: 0, fontSize: 11, marginTop: 2 }}>
                              {t("comptaAnaModifierVentilation")}
                            </button>
                          )}
                        </div>
                      )}
                    </td>
                  )}
                  {!lectureSeule && (
                    <td style={tdStyle}>
                      <button type="button" style={{ ...boutonSecondaireStyle, padding: "3px 8px" }} onClick={() => setLignes((ls) => (ls.length > 2 ? ls.filter((x) => x.cle !== l.cle) : ls))}>
                        ×
                      </button>
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={3} style={{ ...tdStyle, fontWeight: 700 }}>
                {t("comptaTotaux")}
                {!lectureSeule && (
                  <button type="button" style={{ ...boutonSecondaireStyle, padding: "3px 8px", marginLeft: 12 }} onClick={() => setLignes((ls) => [...ls, LIGNE_VIDE()])}>
                    + {t("comptaAjouterLigne")}
                  </button>
                )}
              </td>
              <td style={{ ...tdStyle, ...numStyle, fontWeight: 700 }}>{formaterMontant(totaux.d / 100, locale)}</td>
              <td style={{ ...tdStyle, ...numStyle, fontWeight: 700 }}>{formaterMontant(totaux.c / 100, locale)}</td>
              <td colSpan={sections.length > 0 ? 3 : 2} style={{ ...tdStyle, fontWeight: 700, color: equilibre ? "var(--vert)" : "var(--brique)" }}>
                {equilibre ? t("comptaEquilibree") : `${t("comptaEcart")} : ${formaterMontant(Math.abs(totaux.ecart) / 100, locale)}`}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 14 }}>
        {!lectureSeule && (
          <>
            <button disabled={envoi} style={boutonPrincipalStyle} onClick={() => enregistrer(false)}>
              {t("comptaEnregistrerBrouillon")}
            </button>
            {valid && (
              <button disabled={envoi || !equilibre} style={boutonSecondaireStyle} onClick={() => enregistrer(true)}>
                {t("comptaEnregistrerValider")}
              </button>
            )}
          </>
        )}
        {ecriture && ecriture.statut !== "VALIDEE" && valid && !creation && (
          <button style={boutonPrincipalStyle} onClick={valider}>
            {t("comptaValider")}
          </button>
        )}
        {ecriture?.statut === "BROUILLON" && peutEcrire && (
          <button style={boutonDangerStyle} onClick={supprimer}>
            {t("comptaSupprimerBrouillon")}
          </button>
        )}
        {ecriture?.statut === "VALIDEE" && valid && !ecriture.extournee_par_id && !ecriture.extourne_de_id && (
          <button style={boutonDangerStyle} onClick={extourner}>
            {t("comptaExtourner")}
          </button>
        )}
      </div>
    </AppShell>
  );
}
