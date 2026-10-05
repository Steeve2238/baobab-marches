"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { api } from "../../../lib/api";
import { useLangue } from "../../../lib/i18n/LanguageContext";
import AppShell from "../../../lib/components/AppShell";
import ComptaSousNav from "../../../lib/components/ComptaSousNav";
import { useComptaStatut, labelStyle, inputStyle, boutonPrincipalStyle, boutonSecondaireStyle, boutonDangerStyle, thStyle, tdStyle, numStyle, formaterMontant, centimes, STATUT_COULEURS, statutLibelleCle } from "../../../lib/comptaUi";

const nombre = (v) => Number(String(v || "").replace(/\s/g, "").replace(",", ".")) || 0;
const jour = (d) => String(d || "").slice(0, 10);
const TAILLE = 50;
const ENC = {
  "comptaReglementsMontant": "comptaEncMontant",
  "comptaReglementsCompteTreso": "comptaEncCompteTreso",
  "comptaReglementsFacturesOuvertes": "comptaEncFacturesOuvertes",
  "comptaReglementsEnregistrer": "comptaEncEnregistrer",
  "comptaReglementsAucun": "comptaEncAucun",
  "comptaReglementsAnnuler": "comptaEncAnnuler",
  "comptaReglementsAnnulerConfirm": "comptaEncAnnulerConfirm",
  "comptaReglementsEnregistre": "comptaEncEnregistre",
  "comptaReglementsAucuneFacture": "comptaEncAucuneFacture",
  "comptaReglementsImputeSuperieur": "comptaEncImputeSuperieur",
  "comptaReglementsNumero": "comptaEncNumero",
  "comptaReglementsAvance": "comptaEncAvance"
};
const FORM_VIDE = () => ({ tiers_id: "", journal_id: "", date_reglement: new Date().toISOString().slice(0, 10), montant: "", mode_paiement: "Virement", reference: "", libelle: "" });

// Reglements fournisseurs : liste + formulaire d'imputation sur les factures ouvertes.
function ReglementsContenu() {
  const { t } = useLangue();
  const locale = t("dateLocale");
  const params = useSearchParams();
  const { statut } = useComptaStatut();
  const [cote, setCote] = useState(params.get("cote") === "CLIENT" ? "CLIENT" : "FOURNISSEUR");
  const client = cote === "CLIENT";
  const L = (cle) => t(client && ENC[cle] ? ENC[cle] : cle);
  const [donnees, setDonnees] = useState({ total: 0, reglements: [] });
  const [page, setPage] = useState(0);
  const [q, setQ] = useState("");
  const [fournisseurs, setFournisseurs] = useState([]);
  const [tresos, setTresos] = useState([]);
  const [ouvert, setOuvert] = useState(false);
  const [form, setForm] = useState(FORM_VIDE());
  const [factures, setFactures] = useState([]);
  const [imputations, setImputations] = useState({});
  const [erreur, setErreur] = useState("");
  const [info, setInfo] = useState("");
  const [envoi, setEnvoi] = useState(false);

  function charger() {
    const p = { limit: TAILLE, offset: page * TAILLE };
    if (q) p.q = q;
    (client ? api.comptaEncaissementsReglements(p) : api.comptaAchatsReglements(p)).then(setDonnees).catch((e) => setErreur(e.message));
  }
  useEffect(charger, [page, cote]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    setFournisseurs([]);
    (client ? api.comptaEncaissementsClients() : api.comptaAchatsFournisseurs()).then(setFournisseurs).catch(() => {});
  }, [cote]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    api.comptaTresorerieComptes().then((c) => setTresos(c.filter((x) => x.actif))).catch(() => {});
  }, []);

  function changerCote(nouveau) {
    if (nouveau === cote) return;
    setCote(nouveau);
    setPage(0);
    setOuvert(false);
    setForm(FORM_VIDE());
    setFactures([]);
    setImputations({});
    setErreur("");
    setInfo("");
  }

  // Facture a regler depuis sa fiche : le formulaire s'ouvre prerempli.
  useEffect(() => {
    const tiers = params.get("tiers");
    const facture = params.get("facture");
    if (tiers) {
      setOuvert(true);
      choisirFournisseur(tiers, facture);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function choisirFournisseur(tiersId, factureCible) {
    setForm((f) => ({ ...f, tiers_id: tiersId }));
    setImputations({});
    setFactures([]);
    if (!tiersId) return;
    try {
      const brut = client
        ? await api.comptaEncaissementsFactures(tiersId)
        : (await api.comptaAchatsFactures({ tiers_id: tiersId, etat: "IMPAYEES", limit: 300 })).factures;
      const ouvertes = [...brut].sort((a, b) => String(a.date_echeance || a.date_facture).localeCompare(String(b.date_echeance || b.date_facture)));
      setFactures(ouvertes);
      if (factureCible) {
        const f = ouvertes.find((x) => x.id === factureCible);
        if (f) {
          setImputations({ [f.id]: String(f.solde) });
          setForm((x) => ({ ...x, montant: String(f.solde) }));
        }
      }
    } catch (e) {
      setErreur(e.message);
    }
  }

  const totalImpute = useMemo(() => Object.values(imputations).reduce((a, v) => a + centimes(nombre(v)), 0), [imputations]);
  const montantC = centimes(nombre(form.montant));
  const avanceC = montantC - totalImpute;
  const m = (v) => formaterMontant(v, locale);
  const mc = (c) => formaterMontant(c / 100, locale);

  function imputerAuto() {
    let reste = montantC;
    const r = {};
    for (const f of factures) {
      if (reste <= 0) break;
      const pris = Math.min(reste, centimes(Number(f.solde)));
      r[f.id] = String(pris / 100);
      reste -= pris;
    }
    setImputations(r);
  }

  async function enregistrer() {
    setErreur("");
    setInfo("");
    setEnvoi(true);
    try {
      const corps = {
        ...form,
        imputations: Object.entries(imputations).filter(([, v]) => nombre(v) > 0).map(([facture_id, montant]) => ({ facture_id, montant })),
      };
      await (client ? api.comptaEncaissementsCreerReglement(corps) : api.comptaAchatsCreerReglement(corps));
      setInfo(L("comptaReglementsEnregistre"));
      setOuvert(false);
      setForm(FORM_VIDE());
      setFactures([]);
      setImputations({});
      setPage(0);
      charger();
    } catch (e) {
      setErreur(e.message);
    } finally {
      setEnvoi(false);
    }
  }

  async function annuler(id) {
    if (!window.confirm(L("comptaReglementsAnnulerConfirm"))) return;
    setErreur("");
    try {
      await (client ? api.comptaEncaissementsAnnulerReglement(id) : api.comptaAchatsAnnulerReglement(id));
      charger();
    } catch (e) {
      setErreur(e.message);
    }
  }

  const peutEcrire = !!statut?.droits?.ecriture && statut?.initialisee;
  const valide = form.tiers_id && form.journal_id && montantC > 0 && avanceC >= 0;
  const pages = Math.max(1, Math.ceil(donnees.total / TAILLE));

  return (
    <AppShell title={t(client ? "comptaReglementsClientsTitre" : "comptaReglementsTitre")} subNav={<ComptaSousNav />}>
      <div style={{ display: "flex", gap: 6, marginBottom: 14 }} role="tablist">
        {[["FOURNISSEUR", "comptaCoteFournisseurs"], ["CLIENT", "comptaCoteClients"]].map(([c, cle]) => (
          <button key={c} role="tab" aria-selected={cote === c} onClick={() => changerCote(c)} style={{ ...boutonSecondaireStyle, ...(cote === c ? { background: "var(--petrol)", color: "#fff", borderColor: "var(--petrol)" } : {}) }}>{t(cle)}</button>
        ))}
      </div>
      {erreur && <p style={{ color: "var(--brique)", fontSize: 12.5, marginBottom: 12 }}>{erreur}</p>}
      {info && <p style={{ color: "var(--vert)", fontSize: 12.5, marginBottom: 12 }}>{info}</p>}
      <p style={{ fontSize: 12, color: "var(--sub)", marginBottom: 12, maxWidth: 780, lineHeight: 1.5 }}>{t(client ? "comptaReglementsClientsAide" : "comptaReglementsAide")}</p>

      {!ouvert && (
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 14, alignItems: "center" }}>
          <input placeholder={t("comptaPlanRecherche")} value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { setPage(0); charger(); } }} style={{ ...inputStyle, width: 240 }} />
          <span style={{ flex: 1 }} />
          {peutEcrire && <button style={boutonPrincipalStyle} onClick={() => setOuvert(true)}>+ {t(client ? "comptaReglementsClientsNouveau" : "comptaReglementsNouveau")}</button>}
        </div>
      )}

      {ouvert && (
        <div className="card" style={{ marginBottom: 16 }}>
          <strong style={{ fontSize: 13.5 }}>{t(client ? "comptaReglementsClientsNouveau" : "comptaReglementsNouveau")}</strong>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 12, marginTop: 12 }}>
            <div>
              <label style={labelStyle}>{t(client ? "comptaEncClient" : "comptaAchatsFournisseur")}</label>
              <select value={form.tiers_id} onChange={(e) => choisirFournisseur(e.target.value)} style={inputStyle}>
                <option value="">{t(client ? "comptaReglementsChoisirClient" : "comptaReglementsChoisirFournisseur")}</option>
                {fournisseurs.map((f) => (
                  <option key={f.id} value={f.id}>{f.code} — {f.nom} ({m(f.solde)})</option>
                ))}
              </select>
            </div>
            <div>
              <label style={labelStyle}>{L("comptaReglementsCompteTreso")}</label>
              <select value={form.journal_id} onChange={(e) => setForm((f) => ({ ...f, journal_id: e.target.value }))} style={inputStyle}>
                <option value="">{t("comptaChoisir")}</option>
                {tresos.map((j) => (
                  <option key={j.id} value={j.id}>{j.code} — {j.libelle}</option>
                ))}
              </select>
            </div>
            <div>
              <label style={labelStyle}>{t("comptaDate")}</label>
              <input type="date" value={form.date_reglement} onChange={(e) => setForm((f) => ({ ...f, date_reglement: e.target.value }))} style={inputStyle} />
            </div>
            <div>
              <label style={labelStyle}>{L("comptaReglementsMontant")}</label>
              <input inputMode="decimal" value={form.montant} onChange={(e) => setForm((f) => ({ ...f, montant: e.target.value }))} style={{ ...inputStyle, textAlign: "right" }} />
            </div>
            <div>
              <label style={labelStyle}>{t("comptaReglementsMode")}</label>
              <input value={form.mode_paiement} onChange={(e) => setForm((f) => ({ ...f, mode_paiement: e.target.value }))} style={inputStyle} />
            </div>
            <div>
              <label style={labelStyle}>{t("comptaReglementsReference")}</label>
              <input value={form.reference} onChange={(e) => setForm((f) => ({ ...f, reference: e.target.value }))} style={inputStyle} />
            </div>
          </div>

          {form.tiers_id && (
            <div style={{ marginTop: 14 }}>
              <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 6, flexWrap: "wrap" }}>
                <strong style={{ fontSize: 12.5 }}>{L("comptaReglementsFacturesOuvertes")}</strong>
                {factures.length > 0 && <button type="button" style={boutonSecondaireStyle} onClick={imputerAuto} disabled={montantC <= 0}>{t("comptaReglementsImputer")} ↓</button>}
              </div>
              {factures.length === 0 ? (
                <p style={{ fontSize: 12, color: "var(--sub)" }}>{L("comptaReglementsAucuneFacture")}</p>
              ) : (
                <div style={{ overflowX: "auto" }}>
                  <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 640 }}>
                    <thead>
                      <tr>
                        <th style={thStyle}>{t(client ? "comptaEncFacture" : "comptaAchatsReference")}</th>
                        <th style={thStyle}>{t("comptaAchatsEcheance")}</th>
                        <th style={{ ...thStyle, textAlign: "right" }}>{t("comptaAchatsSolde")}</th>
                        <th style={{ ...thStyle, width: 170, textAlign: "right" }}>{t("comptaReglementsImpute")}</th>
                        <th style={thStyle}></th>
                      </tr>
                    </thead>
                    <tbody>
                      {factures.map((f) => (
                        <tr key={f.id}>
                          <td style={tdStyle}>{client ? f.numero : <>{f.reference_fournisseur} <span style={{ color: "var(--sub)", fontSize: 11 }}>{f.numero}</span></>}</td>
                          <td style={{ ...tdStyle, color: f.en_retard ? "var(--brique)" : undefined }}>{jour(f.date_echeance || f.date_facture)}</td>
                          <td style={{ ...tdStyle, ...numStyle }}>{m(f.solde)}</td>
                          <td style={tdStyle}><input inputMode="decimal" value={imputations[f.id] || ""} onChange={(e) => setImputations((i) => ({ ...i, [f.id]: e.target.value }))} style={{ ...inputStyle, textAlign: "right" }} /></td>
                          <td style={tdStyle}>
                            <button type="button" style={{ ...boutonSecondaireStyle, padding: "3px 8px" }} onClick={() => setImputations((i) => ({ ...i, [f.id]: String(f.solde) }))}>{t("comptaReglementsToutImputer")}</button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              <div style={{ display: "flex", gap: 24, flexWrap: "wrap", marginTop: 10, fontSize: 12.5 }}>
                <span>{t("comptaReglementsImpute")} : <strong>{mc(totalImpute)}</strong></span>
                <span>{L("comptaReglementsAvance")} : <strong style={{ color: avanceC < 0 ? "var(--brique)" : undefined }}>{mc(Math.max(avanceC, 0))}</strong></span>
                {avanceC < 0 && <span style={{ color: "var(--brique)" }}>{L("comptaReglementsImputeSuperieur")}</span>}
              </div>
            </div>
          )}
          <div style={{ display: "flex", gap: 10, marginTop: 14 }}>
            <button disabled={!valide || envoi} style={{ ...boutonPrincipalStyle, opacity: !valide || envoi ? 0.5 : 1 }} onClick={enregistrer}>{L("comptaReglementsEnregistrer")}</button>
            <button style={boutonSecondaireStyle} onClick={() => { setOuvert(false); setForm(FORM_VIDE()); setFactures([]); setImputations({}); }}>{t("comptaAnnuler")}</button>
          </div>
        </div>
      )}

      <div className="card" style={{ padding: 0, overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 820 }}>
          <thead>
            <tr>
              <th style={thStyle}>{t("comptaDate")}</th>
              <th style={thStyle}>{L("comptaReglementsNumero")}</th>
              <th style={thStyle}>{t(client ? "comptaEncClient" : "comptaAchatsFournisseur")}</th>
              <th style={thStyle}>{t("comptaJournal")}</th>
              <th style={thStyle}>{t("comptaReglementsMode")}</th>
              <th style={{ ...thStyle, textAlign: "right" }}>{L("comptaReglementsMontant")}</th>
              <th style={thStyle}></th>
            </tr>
          </thead>
          <tbody>
            {donnees.reglements.map((r) => (
              <tr key={r.id} style={{ opacity: r.statut === "ANNULE" ? 0.5 : 1 }}>
                <td style={tdStyle}>{jour(r.date_reglement)}</td>
                <td style={{ ...tdStyle, fontFamily: "IBM Plex Mono, monospace", fontWeight: 700 }}>{r.numero}</td>
                <td style={tdStyle}>{r.tiers_nom}</td>
                <td style={tdStyle}>{r.journal_code}</td>
                <td style={tdStyle}>{r.mode_paiement} {r.reference}</td>
                <td style={{ ...tdStyle, ...numStyle }}>
                  {m(r.montant)}
                  {Number(r.montant) > Number(r.montant_impute) && <div style={{ fontSize: 10.5, color: "var(--ocre)" }}>{L("comptaReglementsAvance")} {m(Number(r.montant) - Number(r.montant_impute))}</div>}
                </td>
                <td style={{ ...tdStyle, whiteSpace: "nowrap" }}>
                  {r.statut === "ANNULE" ? (
                    <span style={{ fontSize: 10.5, fontWeight: 700, color: "var(--sub)" }}>{t("comptaAchatsAnnulee")}</span>
                  ) : (
                    <>
                      {r.ecriture_statut && <span style={{ fontSize: 10.5, fontWeight: 700, padding: "3px 8px", borderRadius: 20, marginRight: 6, ...STATUT_COULEURS[r.ecriture_statut] }}>{t(statutLibelleCle(r.ecriture_statut))}</span>}
                      {r.ecriture_id && <Link href={`/comptabilite/ecritures/${r.ecriture_id}`} style={{ fontSize: 12, color: "var(--petrol)", marginRight: 8 }}>{t("comptaAchatsVoirEcriture")}</Link>}
                      {peutEcrire && <button style={{ ...boutonDangerStyle, padding: "3px 8px" }} onClick={() => annuler(r.id)}>{L("comptaReglementsAnnuler")}</button>}
                    </>
                  )}
                </td>
              </tr>
            ))}
            {donnees.reglements.length === 0 && (
              <tr>
                <td colSpan={7} style={{ ...tdStyle, color: "var(--sub)" }}>{L("comptaReglementsAucun")}</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {pages > 1 && (
        <div style={{ display: "flex", gap: 10, alignItems: "center", marginTop: 12, fontSize: 12.5 }}>
          <button disabled={page === 0} onClick={() => setPage((p) => p - 1)} style={{ ...inputStyle, width: "auto" }}>‹</button>
          <span>{page + 1} / {pages}</span>
          <button disabled={page + 1 >= pages} onClick={() => setPage((p) => p + 1)} style={{ ...inputStyle, width: "auto" }}>›</button>
        </div>
      )}
    </AppShell>
  );
}

export default function ComptaReglementsPage() {
  return (
    <Suspense fallback={null}>
      <ReglementsContenu />
    </Suspense>
  );
}
