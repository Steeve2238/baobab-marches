"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { api } from "../../../../lib/api";
import { useLangue } from "../../../../lib/i18n/LanguageContext";
import AppShell from "../../../../lib/components/AppShell";
import FinancementSousNav from "../../../../lib/components/financement/FinancementSousNav";
import ComparatifBanques, { CommentaireBloc } from "../../../../lib/components/financement/ComparatifBanques";
import DossierSelect, { valeurDossier, payloadDossier, lienDossier } from "../../../../lib/components/financement/DossierSelect";
import { VersementFields, VERSEMENT_VIDE, versementPayload, ControleResultat } from "../../../../lib/components/financement/ControleBlocs";
import { fmtXof, jour, Pastille, labelStyle, inputStyle, boutonPrincipalStyle, boutonSecondaireStyle, boutonDangerStyle } from "../../../../lib/financementUi";

// Fiche d'une simulation enregistree : comparatif fige, banque choisie, lien au
// dossier, et controle du montant recu (avec les conditions figees au moment du
// choix, meme si la banque les modifie ensuite).
export default function FinancementSimulationFichePage() {
  const { t, dict } = useLangue();
  const locale = dict.dateLocale || "fr-FR";
  const { id } = useParams();
  const router = useRouter();
  const [sim, setSim] = useState(null);
  const [dossierId, setDossierId] = useState("");
  const [versement, setVersement] = useState(VERSEMENT_VIDE);
  const [conditionControle, setConditionControle] = useState("");
  const [resultats, setResultats] = useState({});
  const [erreur, setErreur] = useState("");
  const [message, setMessage] = useState("");
  const [envoi, setEnvoi] = useState(false);

  async function charger() {
    try {
      const s = await api.finSimulation(id);
      setSim(s);
      setDossierId(valeurDossier(s));
      setConditionControle(s.condition_retenue_id || "");
    } catch (e) {
      setErreur(e.message);
    }
  }
  useEffect(() => {
    charger();
  }, [id]);

  async function choisir(releve) {
    setErreur("");
    try {
      await api.finRetenir(id, { condition_id: releve.condition_id });
      setMessage(t("finSimChoixOk"));
      charger();
    } catch (e) {
      setErreur(e.message);
    }
  }
  async function annulerChoix() {
    setErreur("");
    try {
      await api.finAnnulerChoix(id);
      charger();
    } catch (e) {
      setErreur(e.message);
    }
  }
  async function lier() {
    setErreur("");
    try {
      await api.finLier(id, { ...payloadDossier(dossierId), facture_vente_id: sim.facture_vente_id || null });
      setMessage(t("finSaved"));
      charger();
    } catch (e) {
      setErreur(e.message);
    }
  }
  async function controler(e) {
    e.preventDefault();
    setErreur("");
    setEnvoi(true);
    try {
      const r = await api.finControler(id, { condition_id: conditionControle || undefined, ...versementPayload(versement) });
      setResultats((x) => ({ ...x, nouveau: r }));
      setVersement(VERSEMENT_VIDE);
      charger();
    } catch (err) {
      setErreur(err.message);
    } finally {
      setEnvoi(false);
    }
  }
  async function supprimerControle(cid) {
    if (!window.confirm(t("finConfirmDelete"))) return;
    try {
      await api.finSupprimerControle(cid);
      charger();
    } catch (e) {
      setErreur(e.message);
    }
  }
  async function supprimer() {
    if (!window.confirm(t("finConfirmDelete"))) return;
    try {
      await api.finSupprimerSimulation(id);
      router.push("/financement");
    } catch (e) {
      setErreur(e.message);
    }
  }

  if (!sim) {
    return (
      <AppShell title={t("finTitle")} subNav={<FinancementSousNav />} backHref="/financement">
        <p style={{ fontSize: 12.5, color: erreur ? "var(--brique)" : "var(--sub)" }}>{erreur || t("finLoading")}</p>
      </AppShell>
    );
  }

  const releves = (sim.resultats_json && sim.resultats_json.releves) || [];
  const classement = sim.resultats_json && sim.resultats_json.classement;
  const comparatif = releves.length > 1;

  return (
    <AppShell title={t("finTitle")} subNav={<FinancementSousNav />} backHref="/financement">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10, flexWrap: "wrap", marginBottom: 12 }}>
        <div>
          <h2 style={{ fontSize: 16, color: "var(--petrol)" }}>
            {sim.libelle || sim.facture_numero || t("finFicheTitre")}
          </h2>
          <p style={{ fontSize: 12.5, color: "var(--sub)", marginTop: 2 }}>
            {t(`finType_${sim.type_facilite}`)} — {fmtXof(sim.montant, locale)} {t("finXof")} — {sim.duree_jours} {t("finDays")}
            {sim.date_prise ? ` (${jour(sim.date_prise)} → ${jour(sim.date_echeance)})` : ""}
            {sim.debiteur ? ` — ${sim.debiteur}` : ""}
          </p>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <Pastille couleur={sim.statut === "SIMULEE" ? "var(--sub)" : "var(--vert)"}>{t(`finStatutSim_${sim.statut}`)}</Pastille>
          {sim.statut === "SIMULEE" && (
            <button type="button" onClick={supprimer} style={boutonDangerStyle}>
              {t("finFicheSupprimer")}
            </button>
          )}
        </div>
      </div>
      {(erreur || message) && <p style={{ color: erreur ? "var(--brique)" : "var(--vert)", fontSize: 12.5, marginBottom: 10 }}>{erreur || message}</p>}

      {sim.condition_retenue_id && (
        <div className="card" style={{ marginBottom: 14, borderLeft: "4px solid var(--vert)", display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
          <div>
            <div style={{ fontSize: 13.3 }}>
              {t("finSimChoix")}
              <b>{sim.partenaire_retenu_nom}</b>
            </div>
            <div style={{ fontSize: 12.5, color: "var(--sub)", marginTop: 2 }}>
              {t("finFicheCoutRetenu")} : <b className="mono">{fmtXof(sim.cout_retenu_xof, locale)} {t("finXof")}</b>
            </div>
          </div>
          {sim.statut === "RETENUE" && (
            <button type="button" onClick={annulerChoix} style={boutonSecondaireStyle}>
              {t("finSimAnnulerChoix")}
            </button>
          )}
        </div>
      )}

      <div className="card" style={{ marginBottom: 16 }}>
        <h3 style={{ fontSize: 14, color: "var(--petrol)", marginBottom: 4 }}>{t("finFicheLien")}</h3>
        <p style={{ fontSize: 12, color: "var(--sub)", marginBottom: 8 }}>{t("finFicheAffecterAide")}</p>
        <div style={{ display: "flex", gap: 10, alignItems: "flex-end", flexWrap: "wrap" }}>
          <div style={{ minWidth: 260 }}>
            <label style={labelStyle}>{t("finFicheAffecter")}</label>
            <DossierSelect valeur={dossierId} onChange={setDossierId} />
          </div>
          <button type="button" onClick={lier} style={boutonSecondaireStyle}>
            {t("finFicheLier")}
          </button>
          {lienDossier(sim) && (
            <Link href={lienDossier(sim)} style={{ color: "var(--petrol)", fontWeight: 600, fontSize: 12.5 }}>
              {t("finFicheOuvrirDossier")}
            </Link>
          )}
        </div>
      </div>

      {comparatif && (
        <section style={{ marginBottom: 20 }}>
          <h3 style={{ fontSize: 15, color: "var(--petrol)", marginBottom: 8 }}>{t("finFicheComparatif")}</h3>
          <CommentaireBloc commentaire={sim.commentaire_json} />
        </section>
      )}
      <section style={{ marginBottom: 22 }}>
        {!comparatif && <h3 style={{ fontSize: 15, color: "var(--petrol)", marginBottom: 8 }}>{t("finFicheBesoin")}</h3>}
        <ComparatifBanques releves={releves} classement={classement} choisiId={sim.condition_retenue_id} onChoisir={sim.statut === "SIMULEE" || sim.statut === "RETENUE" ? choisir : null} />
      </section>

      <section style={{ marginBottom: 20 }}>
        <h3 style={{ fontSize: 15, color: "var(--petrol)", marginBottom: 8 }}>{t("finFicheControles")}</h3>
        {resultats.nouveau && (
          <div style={{ marginBottom: 14 }}>
            <ControleResultat res={resultats.nouveau} />
          </div>
        )}
        {sim.controles.filter((c) => !resultats.nouveau || c.id !== resultats.nouveau.id).map((c) => (
          <div key={c.id} style={{ marginBottom: 14 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6, flexWrap: "wrap", gap: 6 }}>
              <span style={{ fontSize: 12, color: "var(--sub)" }}>
                {jour(c.date_creation)} — {c.partenaire_nom}
              </span>
              <button type="button" onClick={() => supprimerControle(c.id)} style={boutonDangerStyle}>
                {t("finCtlSupprimerControle")}
              </button>
            </div>
            <ControleResultat res={c.resultat_json} />
          </div>
        ))}
        {(sim.condition_retenue_id || releves.length > 0) && (
          <form onSubmit={controler} className="card">
            <h4 style={{ fontSize: 13.5, color: "var(--petrol)", marginBottom: 10 }}>{t("finCtlNouveau")}</h4>
            {!sim.condition_retenue_id && (
              <div style={{ marginBottom: 12, maxWidth: 420 }}>
                <label style={labelStyle}>{t("finCtlCondition")}</label>
                <select value={conditionControle} onChange={(e) => setConditionControle(e.target.value)} style={inputStyle} required>
                  <option value="">{t("finCtlChoisirCondition")}</option>
                  {releves.map((r) => (
                    <option key={r.condition_id} value={r.condition_id}>
                      {r.partenaire_nom}
                    </option>
                  ))}
                </select>
              </div>
            )}
            <VersementFields valeur={versement} onChange={setVersement} />
            <button type="submit" disabled={envoi} style={{ ...boutonPrincipalStyle, marginTop: 14 }}>
              {envoi ? t("finCtlEnCours") : t("finCtlLancer")}
            </button>
          </form>
        )}
      </section>
    </AppShell>
  );
}
