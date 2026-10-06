/**
 * Variables de courrier tirees du financement d'un dossier (06/10/2026) :
 * quand on genere un courrier (demande de financement, credit relais,
 * garantie...) sur un dossier d'appel d'offres ou une consultation restreinte,
 * le montant, la banque, les dates, le cout, la marge et le besoin de
 * tresorerie sont repris automatiquement de la simulation, du compte
 * d'exploitation et du plan de tresorerie. Rien a ressaisir.
 *
 * Cles disponibles dans un modele : {{financement.xxx}}, {{compte.xxx}},
 * {{plan.xxx}}, {{annexes}} et, pour compatibilite avec les modeles existants,
 * {{montant_demande}}, {{duree_jours}}, {{type_facilite}}, {{banque}}.
 */
const planSvc = require("./planTresorerie");
const compteSvc = require("./compteExploitation");

const TYPES_FR = {
  AFFACTURAGE: "Affacturage",
  ESCOMPTE: "Escompte d'effets",
  CREDIT_TRESORERIE: "Crédit de trésorerie / ligne de crédit",
  CREDIT_RELAIS: "Crédit relais",
  AVANCE_MARCHE: "Avance sur marché",
  LC_INTERNATIONAL: "Lettre de crédit (import)",
  AVAL_TRAITE: "Aval de traite",
  CAUTION_SOUMISSION: "Caution de soumission",
  CAUTION_BONNE_EXECUTION: "Caution de bonne exécution",
  CAUTION_AVANCE_DEMARRAGE: "Caution d'avance de démarrage",
  CAUTION_RETENUE_GARANTIE: "Caution de retenue de garantie",
  ASSURANCE_CREDIT: "Assurance-crédit",
};

const nf = (n) => {
  if (n === null || n === undefined || Number.isNaN(Number(n))) return undefined;
  return String(Math.round(Number(n))).replace(/\B(?=(\d{3})+(?!\d))/g, " ");
};
const pc = (n) => (n === null || n === undefined ? undefined : `${String(Math.round(Number(n) * 10) / 10).replace(".", ",")} %`);
const dt = (iso) => (iso ? `${String(iso).slice(8, 10)}/${String(iso).slice(5, 7)}/${String(iso).slice(0, 4)}` : undefined);
const sans = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && v !== null && v !== ""));

/** type : "ao" | "consultation". Retourne {} si rien n'est disponible. */
async function contexte(tenantId, type, id, lang = "fr") {
  try {
    const sims = await planSvc.simulationsDuDossier(tenantId, type, id);
    if (!sims.length) return {};
    // Simulation retenue en priorite, sinon la plus recente.
    const retenue = sims.find((s) => s.statut === "RETENUE" || s.statut === "CONTROLEE");
    const sim = retenue || sims[0];
    const compte = await compteSvc.construire(tenantId, type, id, { simulation_id: sim.id, lang });
    if (!compte) return {};
    const f = compte.financements[0];
    const s = compte.synthese;
    const info = await planSvc.charger(tenantId, type, id, lang, { simulation_id: sim.id, condition_id: f ? f.condition_id : null, avec_financement: true });
    const plan = info && info.plan && !(info.plan.incomplet && info.plan.incomplet.length) ? info.plan.synthese : null;
    const ctx = {
      financement: f
        ? sans({
            banque: f.banque,
            type_facilite: TYPES_FR[f.type_facilite] || f.type_facilite,
            libelle: f.libelle,
            montant: nf(f.montant),
            duree_jours: f.duree_jours,
            date_mise_en_place: dt(f.date_prise),
            date_echeance: dt(f.date_echeance),
            cout: nf(f.cout_ttc),
            cout_pct_montant: pc(f.part_du_montant_pct),
            cout_pct_chiffre_affaires: pc(s.cout_financement_pct_ca),
            taux_annuel: pc(f.taux_effectif_annuel_pct),
            statut: retenue ? "retenue" : "simulée",
          })
        : undefined,
      compte: sans({
        chiffre_affaires: nf(s.ca_ht),
        cout_revient: nf(s.cout_revient),
        marge_commerciale: nf(s.marge_commerciale),
        marge_commerciale_pct: pc(s.marge_commerciale_pct_ca),
        frais_bancaires: nf(s.frais_bancaires),
        autres_charges: nf(s.autres_charges),
        marge_globale: nf(s.marge_globale),
        marge_globale_pct: pc(s.marge_globale_pct_ca),
        couverture: s.couverture !== null && s.couverture !== undefined ? String(s.couverture).replace(".", ",") : undefined,
      }),
      plan: plan
        ? sans({
            date_t: dt(info.params.date_t),
            besoin_max: nf(plan.besoin_max),
            date_besoin_max: dt(plan.date_besoin_max),
            portage_jours: plan.portage_jours,
            dernier_encaissement: dt(plan.dernier_encaissement),
            horizon_jours: plan.horizon_jours,
            point_bas_avec_ligne: nf(plan.point_bas_avec),
            apport: nf(info.params.apport_xof),
          })
        : undefined,
      annexes: "Compte d'exploitation prévisionnel du dossier ; plan de trésorerie prévisionnel",
    };
    if (f) {
      // Compatibilite avec les modeles qui utilisent deja ces variables libres.
      ctx.montant_demande = nf(f.montant);
      ctx.duree_jours = f.duree_jours;
      ctx.type_facilite = TYPES_FR[f.type_facilite] || f.type_facilite;
      ctx.banque = f.banque;
    }
    return ctx;
  } catch (err) {
    console.error("courrierFinancement.contexte", err);
    return {};
  }
}

module.exports = { contexte };
