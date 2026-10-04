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
  thStyle,
  tdStyle,
  numStyle,
  formaterMontant,
} from "../../../lib/comptaUi";

const PAR_PAGE = 50;
const PORTEES_PRODUIT = ["AUCUNE", "DESIGNATION", "CLIENT", "TOUS"];
const PORTEES_TRESO = ["AUCUNE", "TOUS"];

// Ecritures en instance : le premier ecran du comptable. Les ecritures des
// ventes (factures, acomptes, soldes, encaissements, annulations) sont
// generees automatiquement avec le compte de vente par defaut ; ici on
// corrige le compte (le reste est verrouille), puis on valide.
export default function EcrituresInstancePage() {
  const { t } = useLangue();
  const locale = t("dateLocale");
  const { statut, recharger: rechargerStatut } = useComptaStatut();
  const valid = !!statut?.droits?.validation;

  const [donnees, setDonnees] = useState({ total: 0, ecritures: [] });
  const [resume, setResume] = useState(null);
  const [comptes, setComptes] = useState([]);
  const [filtres, setFiltres] = useState({ q: "", role: "" });
  const [page, setPage] = useState(0);
  const [selection, setSelection] = useState([]);
  const [edition, setEdition] = useState(null); // { ligne, compte_numero, portee, retenir }
  const [depuis, setDepuis] = useState("");
  const [erreur, setErreur] = useState("");
  const [info, setInfo] = useState("");
  const [occupe, setOccupe] = useState(false);

  function charger() {
    const params = { limit: PAR_PAGE, offset: page * PAR_PAGE };
    if (filtres.q) params.q = filtres.q;
    if (filtres.role) params.role = filtres.role;
    api
      .comptaInstance(params)
      .then((d) => {
        setDonnees(d);
        setSelection((s) => s.filter((id) => d.ecritures.some((e) => e.id === id)));
      })
      .catch((e) => setErreur(e.message));
    api.comptaInstanceResume().then(setResume).catch(() => {});
  }
  useEffect(charger, [filtres, page]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    api.comptaComptes({ limit: 5000, actif: "true" }).then(setComptes).catch(() => {});
  }, []);

  const comptesProduit = useMemo(() => comptes.filter((c) => c.classe === 7), [comptes]);
  const comptesTreso = useMemo(() => comptes.filter((c) => c.nature === "TRESORERIE" || c.classe === 5), [comptes]);
  const apres = () => {
    charger();
    rechargerStatut();
  };

  async function valider(ids) {
    setErreur("");
    setInfo("");
    setOccupe(true);
    try {
      const r = await api.comptaValiderInstance(ids);
      setInfo(`${r.valides.length} ${t("comptaEcrituresValidees")}`);
      if (r.erreurs.length) setErreur(r.erreurs.map((x) => x.error).join(" | "));
      setSelection([]);
      apres();
    } catch (e) {
      setErreur(e.message);
    } finally {
      setOccupe(false);
    }
  }

  async function toutValider() {
    if (!window.confirm(`${t("comptaConfirmToutValider")} (${donnees.total})`)) return;
    valider(undefined);
  }

  async function rattrapage() {
    setErreur("");
    setInfo("");
    setOccupe(true);
    try {
      const r = await api.comptaRattrapage(depuis || undefined);
      setInfo(`${r.factures} ${t("comptaRattrapageFactures")} · ${r.encaissements} ${t("comptaRattrapageEncaissements")}`);
      if (r.ignorees.length) setErreur(`${t("comptaRattrapageIgnorees")} : ${r.ignorees.map((x) => `${x.numero} (${x.raison})`).join(", ")}`);
      apres();
    } catch (e) {
      setErreur(e.message);
    } finally {
      setOccupe(false);
    }
  }

  async function appliquerChangement() {
    setErreur("");
    setInfo("");
    try {
      const r = await api.comptaChangerCompte(edition.ligne.id, {
        compte_numero: edition.compte_numero,
        portee: edition.portee,
        retenir: edition.retenir,
      });
      setInfo(`${r.modifiees} ${t("comptaLignesModifiees")}${r.regle ? ` · ${t("comptaRegleMemorisee")}` : ""}`);
      setEdition(null);
      apres();
    } catch (e) {
      setErreur(e.message);
    }
  }

  const toutCoche = donnees.ecritures.length > 0 && donnees.ecritures.every((e) => selection.includes(e.id));
  const pages = Math.max(1, Math.ceil(donnees.total / PAR_PAGE));
  const m = (v) => formaterMontant(v, locale, true);

  return (
    <AppShell title={t("comptaNavInstance")} subNav={<ComptaSousNav />}>
      {erreur && <p style={{ color: "var(--brique)", fontSize: 12.5, marginBottom: 12 }}>{erreur}</p>}
      {info && <p style={{ color: "var(--vert)", fontSize: 12.5, marginBottom: 12 }}>{info}</p>}
      {statut && !statut.initialisee && <p style={{ fontSize: 12.5, color: "var(--ocre)" }}>{t("comptaNonInitialisee")}</p>}

      <p style={{ fontSize: 12, color: "var(--sub)", marginBottom: 12, maxWidth: 820, lineHeight: 1.55 }}>{t("comptaInstanceAide")}</p>

      {resume && (resume.a_generer > 0 || resume.encaissements_a_generer > 0 || resume.hors_exercice > 0) && (
        <div className="card" style={{ marginBottom: 14, background: "var(--ocre-bg)", borderColor: "transparent" }}>
          <div style={{ fontSize: 12.5, lineHeight: 1.55 }}>
            {resume.a_generer + resume.encaissements_a_generer > 0 && (
              <div>
                <strong>{resume.a_generer}</strong> {t("comptaFacturesSansEcriture")}
                {resume.encaissements_a_generer > 0 && (
                  <>
                    {" "}
                    · <strong>{resume.encaissements_a_generer}</strong> {t("comptaEncaissementsSansEcriture")}
                  </>
                )}
              </div>
            )}
            {resume.hors_exercice > 0 && (
              <div style={{ color: "var(--sub)" }}>
                {resume.hors_exercice} {t("comptaFacturesHorsExercice")}
              </div>
            )}
          </div>
          {valid && resume.a_generer + resume.encaissements_a_generer > 0 && (
            <div style={{ display: "flex", gap: 8, alignItems: "flex-end", flexWrap: "wrap", marginTop: 10 }}>
              <div>
                <label style={labelStyle}>{t("comptaRattrapageDepuis")}</label>
                <input type="date" value={depuis} onChange={(e) => setDepuis(e.target.value)} style={{ ...inputStyle, width: 150 }} />
              </div>
              <button disabled={occupe} style={boutonPrincipalStyle} onClick={rattrapage}>
                {t("comptaRattrapageBouton")}
              </button>
            </div>
          )}
        </div>
      )}

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginBottom: 12 }}>
        <input placeholder={t("comptaInstanceRecherche")} value={filtres.q} onChange={(e) => { setPage(0); setFiltres((f) => ({ ...f, q: e.target.value })); }} style={{ ...inputStyle, width: 240 }} />
        <select value={filtres.role} onChange={(e) => { setPage(0); setFiltres((f) => ({ ...f, role: e.target.value })); }} style={{ ...inputStyle, width: 190 }}>
          <option value="">{t("comptaInstanceTousTypes")}</option>
          <option value="FACTURE">{t("comptaRoleFACTURE")}</option>
          <option value="ENCAISSEMENT">{t("comptaRoleENCAISSEMENT")}</option>
          <option value="ANNULATION">{t("comptaRoleANNULATION")}</option>
        </select>
        {valid && (
          <>
            <button disabled={occupe || selection.length === 0} style={boutonSecondaireStyle} onClick={() => valider(selection)}>
              {t("comptaValiderSelection")} ({selection.length})
            </button>
            <button disabled={occupe || donnees.total === 0} style={boutonPrincipalStyle} onClick={toutValider}>
              {t("comptaToutValider")}
            </button>
          </>
        )}
        <label style={{ fontSize: 12, display: "flex", gap: 6, alignItems: "center" }}>
          {valid && <input type="checkbox" checked={toutCoche} onChange={(e) => setSelection(e.target.checked ? donnees.ecritures.map((x) => x.id) : [])} />}
          <span style={{ color: "var(--sub)" }}>
            {donnees.total} {t("comptaEcrituresMot")}
          </span>
        </label>
      </div>

      {donnees.ecritures.length === 0 && <p style={{ fontSize: 12.5, color: "var(--sub)" }}>{t("comptaInstanceVide")}</p>}

      {donnees.ecritures.map((e) => (
        <div key={e.id} className="card" style={{ marginBottom: 12, padding: 0, overflowX: "auto" }}>
          <div style={{ display: "flex", gap: 12, alignItems: "center", padding: "10px 12px", borderBottom: "1px solid var(--line)", flexWrap: "wrap" }}>
            {valid && <input type="checkbox" checked={selection.includes(e.id)} onChange={(ev) => setSelection((s) => (ev.target.checked ? [...s, e.id] : s.filter((x) => x !== e.id)))} />}
            <strong style={{ fontSize: 13 }}>{e.libelle}</strong>
            <span style={{ fontSize: 11.5, color: "var(--sub)" }}>
              {e.date_ecriture} · {e.journal_code}
            </span>
            <span style={{ fontSize: 10.5, fontWeight: 700, padding: "3px 8px", borderRadius: 20, color: "var(--ocre)", background: "var(--ocre-bg)" }}>{t("comptaRole" + String(e.origine_role).replace("ANNULATION_ENCAISSEMENT", "ANNULATION"))}</span>
            {e.facture_id && (
              <Link href={`/marches/consultation-restreinte/factures/${e.facture_id}`} style={{ fontSize: 12, color: "var(--petrol)", fontWeight: 600 }}>
                {t("comptaVoirFacture")} {e.facture_numero}
              </Link>
            )}
            <span style={{ flex: 1 }} />
            <Link href={`/comptabilite/ecritures/${e.id}`} style={{ fontSize: 12, color: "var(--sub)" }}>
              {t("comptaDetail")}
            </Link>
            {valid && (
              <button disabled={occupe} style={{ ...boutonSecondaireStyle, padding: "4px 10px" }} onClick={() => valider([e.id])}>
                {t("comptaValider")}
              </button>
            )}
          </div>
          <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 760 }}>
            <thead>
              <tr>
                <th style={thStyle}>{t("comptaCompte")}</th>
                <th style={thStyle}>{t("comptaLibelleLigne")}</th>
                <th style={thStyle}>{t("comptaTiers")}</th>
                <th style={{ ...thStyle, textAlign: "right" }}>{t("comptaDebit")}</th>
                <th style={{ ...thStyle, textAlign: "right" }}>{t("comptaCredit")}</th>
                <th style={thStyle}></th>
              </tr>
            </thead>
            <tbody>
              {e.lignes.map((l) => (
                <tr key={l.id} style={{ background: l.compte_modifiable ? "rgba(201,122,43,0.05)" : undefined }}>
                  <td style={tdStyle}>
                    <span style={{ fontFamily: "IBM Plex Mono, monospace", fontWeight: l.compte_modifiable ? 700 : 400 }}>{l.compte_numero}</span>
                    <div style={{ fontSize: 11, color: "var(--sub)" }}>{l.compte_libelle}</div>
                  </td>
                  <td style={tdStyle}>{l.libelle}</td>
                  <td style={tdStyle}>{l.tiers_code}</td>
                  <td style={{ ...tdStyle, ...numStyle }}>{m(l.debit)}</td>
                  <td style={{ ...tdStyle, ...numStyle }}>{m(l.credit)}</td>
                  <td style={{ ...tdStyle, textAlign: "right" }}>
                    {valid && l.compte_modifiable && (
                      <button style={{ ...boutonSecondaireStyle, padding: "3px 8px" }} onClick={() => setEdition({ ligne: l, compte_numero: l.compte_numero, portee: "AUCUNE", retenir: false })}>
                        {t("comptaChangerCompte")}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {edition && e.lignes.some((l) => l.id === edition.ligne.id) && (
            <div style={{ padding: 12, borderTop: "1px solid var(--line)", background: "var(--line-soft)", display: "grid", gap: 10 }}>
              <strong style={{ fontSize: 12.5 }}>
                {t("comptaChangerCompte")} — {edition.ligne.libelle}
              </strong>
              <datalist id="comptes-instance">
                {(edition.ligne.compte_modifiable === "PRODUIT" ? comptesProduit : comptesTreso).map((c) => (
                  <option key={c.id} value={c.numero}>
                    {c.libelle}
                  </option>
                ))}
              </datalist>
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end" }}>
                <div>
                  <label style={labelStyle}>{t("comptaNouveauCompteNumero")}</label>
                  <input list="comptes-instance" value={edition.compte_numero} onChange={(ev) => setEdition((x) => ({ ...x, compte_numero: ev.target.value.replace(/\D/g, "") }))} style={{ ...inputStyle, width: 150, fontFamily: "IBM Plex Mono, monospace" }} />
                  <div style={{ fontSize: 11, color: "var(--sub)", marginTop: 3 }}>{comptes.find((c) => c.numero === edition.compte_numero)?.libelle || ""}</div>
                </div>
                <div>
                  <label style={labelStyle}>{t("comptaPortee")}</label>
                  <select value={edition.portee} onChange={(ev) => setEdition((x) => ({ ...x, portee: ev.target.value, retenir: ev.target.value === "CLIENT" || ev.target.value === "DESIGNATION" ? x.retenir : false }))} style={{ ...inputStyle, width: 330 }}>
                    {(edition.ligne.compte_modifiable === "PRODUIT" ? PORTEES_PRODUIT : PORTEES_TRESO).map((p) => (
                      <option key={p} value={p}>
                        {t("comptaPortee_" + p)}
                      </option>
                    ))}
                  </select>
                </div>
                {edition.ligne.compte_modifiable === "PRODUIT" && (edition.portee === "CLIENT" || edition.portee === "DESIGNATION") && (
                  <label style={{ fontSize: 12, display: "flex", gap: 6, alignItems: "center", paddingBottom: 8 }}>
                    <input type="checkbox" checked={edition.retenir} onChange={(ev) => setEdition((x) => ({ ...x, retenir: ev.target.checked }))} />
                    {t("comptaRetenirRegle")}
                  </label>
                )}
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <button style={boutonPrincipalStyle} onClick={appliquerChangement}>
                  {t("comptaAppliquer")}
                </button>
                <button style={boutonSecondaireStyle} onClick={() => setEdition(null)}>
                  {t("comptaAnnuler")}
                </button>
              </div>
            </div>
          )}
        </div>
      ))}

      <div style={{ display: "flex", gap: 10, alignItems: "center", marginTop: 8, fontSize: 12.5 }}>
        <button style={boutonSecondaireStyle} disabled={page === 0} onClick={() => setPage((p) => p - 1)}>
          ←
        </button>
        <span>
          {page + 1} / {pages}
        </span>
        <button style={boutonSecondaireStyle} disabled={page + 1 >= pages} onClick={() => setPage((p) => p + 1)}>
          →
        </button>
      </div>
    </AppShell>
  );
}
