"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { api } from "../../../lib/api";
import { useLangue } from "../../../lib/i18n/LanguageContext";
import AppShell from "../../../lib/components/AppShell";
import ComptaSousNav from "../../../lib/components/ComptaSousNav";
import { useComptaStatut, labelStyle, inputStyle, boutonPrincipalStyle, boutonSecondaireStyle, thStyle, tdStyle, numStyle, formaterMontant } from "../../../lib/comptaUi";

const MVT_VIDE = (journal_id = "") => ({ journal_id, date_ecriture: new Date().toISOString().slice(0, 10), libelle: "", sens: "SORTIE", montant: "", contrepartie_numero: "", valider: false });

// Banques et caisses : soldes, ouverture d'un compte, mouvements divers.
export default function ComptaTresoreriePage() {
  const { t } = useLangue();
  const locale = t("dateLocale");
  const { statut } = useComptaStatut();
  const [comptes, setComptes] = useState([]);
  const [plan, setPlan] = useState([]);
  const [nouveau, setNouveau] = useState(null);
  const [mvt, setMvt] = useState(null);
  const [erreur, setErreur] = useState("");
  const [info, setInfo] = useState("");

  function charger() {
    api.comptaTresorerieComptes().then(setComptes).catch((e) => setErreur(e.message));
  }
  useEffect(() => {
    charger();
    api.comptaComptes({ limit: 5000, actif: "true" }).then(setPlan).catch(() => {});
  }, []);

  const m = (v) => formaterMontant(v, locale);
  const valid = !!statut?.droits?.validation;
  const peutEcrire = !!statut?.droits?.ecriture && statut?.initialisee;

  async function creerCompte() {
    setErreur("");
    try {
      await api.comptaTresorerieCreerCompte(nouveau);
      setInfo(t("comptaTresoCompteCree"));
      setNouveau(null);
      charger();
    } catch (e) {
      setErreur(e.message);
    }
  }

  async function enregistrerMouvement() {
    setErreur("");
    try {
      await api.comptaTresorerieMouvement(mvt);
      setInfo(t("comptaTresoMouvementCree"));
      setMvt(null);
      charger();
    } catch (e) {
      setErreur(e.message);
    }
  }

  return (
    <AppShell title={t("comptaTresoTitre")} subNav={<ComptaSousNav />}>
      {erreur && <p style={{ color: "var(--brique)", fontSize: 12.5, marginBottom: 12 }}>{erreur}</p>}
      {info && <p style={{ color: "var(--vert)", fontSize: 12.5, marginBottom: 12 }}>{info}</p>}
      <p style={{ fontSize: 12, color: "var(--sub)", marginBottom: 12, maxWidth: 780, lineHeight: 1.5 }}>{t("comptaTresoAide")}</p>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 14 }}>
        {peutEcrire && <button style={boutonPrincipalStyle} onClick={() => setMvt(MVT_VIDE(comptes[0]?.id))}>+ {t("comptaTresoMouvement")}</button>}
        {valid && <button style={boutonSecondaireStyle} onClick={() => setNouveau({ type: "BANQUE", libelle: "" })}>+ {t("comptaTresoNouveauCompte")}</button>}
      </div>

      {nouveau && (
        <div className="card" style={{ marginBottom: 14, display: "grid", gridTemplateColumns: "150px 1fr auto auto", gap: 10, alignItems: "end" }}>
          <div>
            <label style={labelStyle}>{t("comptaTresoTypeCompte")}</label>
            <select value={nouveau.type} onChange={(e) => setNouveau((n) => ({ ...n, type: e.target.value }))} style={inputStyle}>
              <option value="BANQUE">{t("comptaTresoBanque")}</option>
              <option value="CAISSE">{t("comptaTresoCaisse")}</option>
            </select>
          </div>
          <div>
            <label style={labelStyle}>{t("comptaTresoLibelleCompte")}</label>
            <input value={nouveau.libelle} onChange={(e) => setNouveau((n) => ({ ...n, libelle: e.target.value }))} style={inputStyle} />
          </div>
          <button disabled={!nouveau.libelle.trim()} style={boutonPrincipalStyle} onClick={creerCompte}>{t("comptaTresoCreerCompte")}</button>
          <button style={boutonSecondaireStyle} onClick={() => setNouveau(null)}>{t("comptaAnnuler")}</button>
        </div>
      )}

      {mvt && (
        <div className="card" style={{ marginBottom: 14 }}>
          <strong style={{ fontSize: 13.5 }}>{t("comptaTresoMouvement")}</strong>
          <p style={{ fontSize: 12, color: "var(--sub)", margin: "4px 0 10px", maxWidth: 760 }}>{t("comptaTresoMouvementAide")}</p>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))", gap: 12 }}>
            <div>
              <label style={labelStyle}>{t("comptaTresoCompte")}</label>
              <select value={mvt.journal_id} onChange={(e) => setMvt((x) => ({ ...x, journal_id: e.target.value }))} style={inputStyle}>
                {comptes.filter((c) => c.actif).map((c) => (
                  <option key={c.id} value={c.id}>{c.code} — {c.libelle}</option>
                ))}
              </select>
            </div>
            <div>
              <label style={labelStyle}>{t("comptaDate")}</label>
              <input type="date" value={mvt.date_ecriture} onChange={(e) => setMvt((x) => ({ ...x, date_ecriture: e.target.value }))} style={inputStyle} />
            </div>
            <div>
              <label style={labelStyle}>{t("comptaTresoSens")}</label>
              <select value={mvt.sens} onChange={(e) => setMvt((x) => ({ ...x, sens: e.target.value }))} style={inputStyle}>
                <option value="SORTIE">{t("comptaTresoSortie")}</option>
                <option value="ENTREE">{t("comptaTresoEntree")}</option>
              </select>
            </div>
            <div>
              <label style={labelStyle}>{t("comptaReglementsMontant")}</label>
              <input inputMode="decimal" value={mvt.montant} onChange={(e) => setMvt((x) => ({ ...x, montant: e.target.value }))} style={{ ...inputStyle, textAlign: "right" }} />
            </div>
            <div>
              <label style={labelStyle}>{t("comptaTresoContrepartie")}</label>
              <input list="comptes-contrepartie" value={mvt.contrepartie_numero} onChange={(e) => setMvt((x) => ({ ...x, contrepartie_numero: e.target.value }))} style={{ ...inputStyle, fontFamily: "IBM Plex Mono, monospace" }} />
              <div style={{ fontSize: 10.5, color: "var(--sub)", marginTop: 3 }}>{t("comptaTresoContrepartieAide")}</div>
            </div>
            <div style={{ gridColumn: "span 2", minWidth: 220 }}>
              <label style={labelStyle}>{t("comptaLibelle")}</label>
              <input value={mvt.libelle} onChange={(e) => setMvt((x) => ({ ...x, libelle: e.target.value }))} style={inputStyle} />
            </div>
          </div>
          <datalist id="comptes-contrepartie">
            {plan.filter((c) => c.nature === "GENERAL" || c.nature === "TRESORERIE").map((c) => (
              <option key={c.id} value={c.numero}>{c.libelle}</option>
            ))}
          </datalist>
          <div style={{ display: "flex", gap: 14, alignItems: "center", marginTop: 14, flexWrap: "wrap" }}>
            <button disabled={!mvt.journal_id || !mvt.libelle.trim() || !mvt.contrepartie_numero || !(Number(String(mvt.montant).replace(",", ".")) > 0)} style={boutonPrincipalStyle} onClick={enregistrerMouvement}>{t("comptaTresoEnregistrer")}</button>
            <button style={boutonSecondaireStyle} onClick={() => setMvt(null)}>{t("comptaAnnuler")}</button>
            {valid && (
              <label style={{ fontSize: 12.5, display: "flex", gap: 6, alignItems: "center" }}>
                <input type="checkbox" checked={mvt.valider} onChange={(e) => setMvt((x) => ({ ...x, valider: e.target.checked }))} />
                {t("comptaTresoValiderDirect")}
              </label>
            )}
          </div>
        </div>
      )}

      <div className="card" style={{ padding: 0, overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 720 }}>
          <thead>
            <tr>
              <th style={thStyle}>{t("comptaJournal")}</th>
              <th style={thStyle}>{t("comptaTresoCompte")}</th>
              <th style={{ ...thStyle, textAlign: "right" }}>{t("comptaTresoSoldeValide")}</th>
              <th style={{ ...thStyle, textAlign: "right" }}>{t("comptaTresoSoldeInstance")}</th>
              <th style={{ ...thStyle, textAlign: "right" }}>{t("comptaTresoSoldePrevu")}</th>
              <th style={thStyle}></th>
            </tr>
          </thead>
          <tbody>
            {comptes.map((c) => {
              const valideN = Number(c.solde_valide);
              return (
                <tr key={c.id} style={{ opacity: c.actif ? 1 : 0.5 }}>
                  <td style={tdStyle}>
                    <strong style={{ fontFamily: "IBM Plex Mono, monospace" }}>{c.code}</strong>
                    <div style={{ fontSize: 11, color: "var(--sub)" }}>{c.type_journal === "BANQUE" ? t("comptaTresoBanque") : t("comptaTresoCaisse")}</div>
                  </td>
                  <td style={tdStyle}>
                    {c.libelle}
                    <div style={{ fontSize: 11, color: "var(--sub)", fontFamily: "IBM Plex Mono, monospace" }}>{c.compte_tresorerie}</div>
                  </td>
                  <td style={{ ...tdStyle, ...numStyle, fontWeight: 700, color: valideN < 0 ? "var(--brique)" : undefined }}>{m(valideN)}</td>
                  <td style={{ ...tdStyle, ...numStyle, color: "var(--ocre)" }}>{m(c.solde_instance)}</td>
                  <td style={{ ...tdStyle, ...numStyle }}>{m(valideN + Number(c.solde_instance))}</td>
                  <td style={tdStyle}>
                    <Link href={`/comptabilite/ecritures?journal_id=${c.id}`} style={{ fontSize: 12, color: "var(--petrol)", fontWeight: 600 }}>{t("comptaTresoVoirJournal")}</Link>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </AppShell>
  );
}
