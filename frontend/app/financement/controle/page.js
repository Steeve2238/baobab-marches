"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { api } from "../../../lib/api";
import { useLangue } from "../../../lib/i18n/LanguageContext";
import AppShell from "../../../lib/components/AppShell";
import FinancementSousNav from "../../../lib/components/financement/FinancementSousNav";
import { VersementFields, VERSEMENT_VIDE, versementPayload, ControleResultat } from "../../../lib/components/financement/ControleBlocs";
import { aujourdhui, joursEntre, jour, fmtXof, Aide, Pastille, labelStyle, inputStyle, boutonPrincipalStyle, thStyle, tdStyle, numStyle } from "../../../lib/financementUi";

// Controle d'un versement deja recu : le client dit ce qu'il a demande et ce
// qu'il a recu, la plateforme refait le calcul avec les conditions de la banque,
// dit si l'ecart se justifie et prepare les questions a poser a la banque.
function ajouterJours(dateStr, n) {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + Number(n));
  return d.toISOString().slice(0, 10);
}

export default function FinancementControlePage() {
  const { t, dict } = useLangue();
  const locale = dict.dateLocale || "fr-FR";
  const [conditions, setConditions] = useState(null);
  const [historique, setHistorique] = useState([]);
  const [base, setBase] = useState({ condition_id: "", montant: "", montant_ht: "", date_prise: aujourdhui(), date_echeance: "", duree_jours: "90", debiteur: "", libelle: "" });
  const [versement, setVersement] = useState(VERSEMENT_VIDE);
  const [resultat, setResultat] = useState(null);
  const [envoi, setEnvoi] = useState(false);
  const [erreur, setErreur] = useState("");

  const majBase = (k, v) => setBase((b) => ({ ...b, [k]: v }));
  const charger = () => api.finSimulations({ statut: "CONTROLEE" }).then(setHistorique).catch(() => {});
  useEffect(() => {
    api.finConditions().then(setConditions).catch(() => setConditions([]));
    charger();
  }, []);

  const cond = (conditions || []).find((c) => c.id === base.condition_id);

  async function lancer(e) {
    e.preventDefault();
    setErreur("");
    setResultat(null);
    setEnvoi(true);
    try {
      const p = {
        condition_id: base.condition_id,
        montant: Number(base.montant),
        montant_ht: base.montant_ht ? Number(base.montant_ht) : null,
        debiteur: base.debiteur || null,
        libelle: base.libelle || null,
        duree_jours: base.duree_jours ? Number(base.duree_jours) : null,
        ...versementPayload(versement),
      };
      if (base.date_prise && base.date_echeance) {
        p.date_prise = base.date_prise;
        p.date_echeance = base.date_echeance;
      }
      const r = await api.finControleDirect(p);
      setResultat(r);
      charger();
    } catch (err) {
      setErreur(err.message);
    } finally {
      setEnvoi(false);
    }
  }

  return (
    <AppShell title={t("finTitle")} subNav={<FinancementSousNav />}>
      <h2 style={{ fontSize: 16, color: "var(--petrol)", marginBottom: 4 }}>{t("finCtlTitre")}</h2>
      <p style={{ fontSize: 12.5, color: "var(--sub)", marginBottom: 14, maxWidth: 760, lineHeight: 1.55 }}>{t("finCtlIntro")}</p>

      {conditions !== null && conditions.length === 0 ? (
        <div className="card" style={{ borderLeft: "4px solid var(--ocre)" }}>
          <p style={{ fontSize: 13, marginBottom: 10 }}>{t("finCtlAucuneCondition")}</p>
          <Link href="/financement/banques" style={{ ...boutonPrincipalStyle, display: "inline-block", textDecoration: "none" }}>
            {t("finSimAllerBanques")}
          </Link>
        </div>
      ) : (
        <form onSubmit={lancer} className="card" style={{ marginBottom: 18 }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(230px, 1fr))", gap: 14, marginBottom: 16 }}>
            <div style={{ gridColumn: "1 / -1", maxWidth: 520 }}>
              <label style={labelStyle}>{t("finCtlCondition")}</label>
              <select value={base.condition_id} onChange={(e) => majBase("condition_id", e.target.value)} style={inputStyle} required>
                <option value="">{t("finCtlChoisirCondition")}</option>
                {(conditions || []).map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.partenaire_nom} — {t(`finType_${c.type_facilite}`)} ({t(`finStatut_${c.statut}`)})
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label style={labelStyle}>{t("finCtlMontantDemande")}</label>
              <input type="number" min="1" step="any" value={base.montant} onChange={(e) => majBase("montant", e.target.value)} style={inputStyle} required />
            </div>
            {cond && cond.base_creance === "HT" && (
              <div>
                <label style={labelStyle}>{t("finSimMontantHt")}</label>
                <input type="number" min="0" step="any" value={base.montant_ht} onChange={(e) => majBase("montant_ht", e.target.value)} style={inputStyle} />
              </div>
            )}
            <div>
              <label style={labelStyle}>{t("finSimDatePrise")}</label>
              <input
                type="date"
                value={base.date_prise}
                onChange={(e) => setBase((b) => ({ ...b, date_prise: e.target.value, date_echeance: b.duree_jours && e.target.value ? ajouterJours(e.target.value, b.duree_jours) : b.date_echeance }))}
                style={inputStyle}
              />
            </div>
            <div>
              <label style={labelStyle}>{t("finSimDateEcheance")}</label>
              <input
                type="date"
                value={base.date_echeance}
                onChange={(e) => {
                  const d = joursEntre(base.date_prise, e.target.value);
                  setBase((b) => ({ ...b, date_echeance: e.target.value, duree_jours: d && d > 0 ? String(d) : b.duree_jours }));
                }}
                style={inputStyle}
              />
            </div>
            <div>
              <label style={labelStyle}>{t("finSimDuree")}</label>
              <input
                type="number"
                min="1"
                value={base.duree_jours}
                onChange={(e) => setBase((b) => ({ ...b, duree_jours: e.target.value, date_echeance: e.target.value && b.date_prise ? ajouterJours(b.date_prise, e.target.value) : "" }))}
                style={inputStyle}
                required
              />
            </div>
            <div>
              <label style={labelStyle}>
                {t("finSimDebiteur")} ({t("finOptional")})
              </label>
              <input value={base.debiteur} onChange={(e) => majBase("debiteur", e.target.value)} style={inputStyle} />
            </div>
            <div>
              <label style={labelStyle}>
                {t("finSimLibelle")} ({t("finOptional")})
              </label>
              <input value={base.libelle} onChange={(e) => majBase("libelle", e.target.value)} style={inputStyle} />
            </div>
          </div>
          <VersementFields valeur={versement} onChange={setVersement} />
          <div style={{ marginTop: 14, display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
            <button type="submit" disabled={envoi} style={boutonPrincipalStyle}>
              {envoi ? t("finCtlEnCours") : t("finCtlLancer")}
            </button>
            {erreur && <span style={{ color: "var(--brique)", fontSize: 12.5 }}>{erreur}</span>}
          </div>
        </form>
      )}

      {resultat && (
        <section style={{ marginBottom: 24 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10, flexWrap: "wrap", gap: 8 }}>
            <h3 style={{ fontSize: 15, color: "var(--petrol)" }}>{t("finCtlResultat")}</h3>
            {resultat.simulation_id && (
              <Link href={`/financement/simulations/${resultat.simulation_id}`} style={{ color: "var(--petrol)", fontWeight: 600, fontSize: 12.5 }}>
                {t("finSimVoirFiche")}
              </Link>
            )}
          </div>
          <ControleResultat res={resultat} />
        </section>
      )}

      <section>
        <h3 style={{ fontSize: 14, color: "var(--petrol)", marginBottom: 8 }}>{t("finCtlHistorique")}</h3>
        {historique.length === 0 ? (
          <p className="card" style={{ fontSize: 13, color: "var(--sub)" }}>{t("finCtlHistoriqueVide")}</p>
        ) : (
          <div className="card" style={{ overflowX: "auto", padding: 0 }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr>
                  <th style={thStyle}>{t("finSimColDate")}</th>
                  <th style={thStyle}>{t("finSimColLibelle")}</th>
                  <th style={thStyle}>{t("finSimColType")}</th>
                  <th style={{ ...thStyle, textAlign: "right" }}>{t("finSimColMontant")}</th>
                  <th style={thStyle}>{t("finSimColBanque")}</th>
                  <th style={thStyle}></th>
                </tr>
              </thead>
              <tbody>
                {historique.map((s) => (
                  <tr key={s.id}>
                    <td style={tdStyle}>{jour(s.date_creation)}</td>
                    <td style={tdStyle}>{s.libelle || s.facture_numero || "—"}</td>
                    <td style={tdStyle}>{t(`finType_${s.type_facilite}`)}</td>
                    <td style={{ ...tdStyle, ...numStyle }}>{fmtXof(s.montant, locale)}</td>
                    <td style={tdStyle}>{s.partenaire_retenu_nom || "—"}</td>
                    <td style={tdStyle}>
                      <Link href={`/financement/simulations/${s.id}`} style={{ color: "var(--petrol)", fontWeight: 600, fontSize: 12 }}>
                        {t("finOpen")}
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </AppShell>
  );
}
