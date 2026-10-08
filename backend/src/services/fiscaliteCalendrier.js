/**
 * Module Fiscalite - calendrier des obligations fiscales, alertes et estimateur de penalites.
 *
 * Echeances generees pour une annee civile (dates du CGI 2025) :
 *   - TVA mensuelle : depot et paiement au plus tard le 15 du mois suivant (declaration preparee dans le module) ;
 *   - retenues a la source du mois (prestataires, loyers, non-residents, IRVM) : versement avant le 15 du mois suivant
 *     (montant et statut repris de l'etat mensuel du module, lot 4 ; suivi manuel possible sinon) ;
 *   - impot sur les societes : 1er acompte avant le 15 fevrier, 2e acompte au plus tard le 30 avril, declaration des
 *     resultats au plus tard le 30 avril, solde au plus tard le 15 juin (art. 133, 214) ;
 *   - contribution economique locale : declaration de la CVA au plus tard le 30 avril, paiement au plus tard le
 *     31 juillet (art. 341, 342).
 *   - locaux professionnels : declaration au plus tard le 31 janvier (art. 333) ; taxe sur les voitures particulieres des
 *     personnes morales : declaration et paiement avant le 1er fevrier (art. 553-554). Suivis depuis les dossiers annuels du module.
 * L'IS est calendaire (exercice clos le 31 decembre) : pour une autre date de cloture, les dates sont a adapter.
 */
const db = require("../db");
const { v4: uuidv4 } = require("uuid");
const { FiscaliteError, dateLimite } = require("./fiscaliteTva");
const penalites = require("./fiscalitePenalites");
const retenuesSvc = require("./fiscaliteRetenues");

const pad = (n) => String(n).padStart(2, "0");
const num = (v) => Number(v || 0);

const STATUTS = ["A_FAIRE", "PREPAREE", "DEPOSEE", "PAYEE", "NON_CONCERNE"];

function genererEcheances(annee) {
  const e = [];
  // TVA et retenues : decembre N-1 (du 15 janvier N) a novembre N (du 15 decembre N)
  for (let k = 0; k < 12; k++) {
    const mois = k === 0 ? 12 : k;
    const an = k === 0 ? annee - 1 : annee;
    const cleMois = `${an}-${pad(mois)}`;
    const limite = dateLimite(an, mois);
    e.push({ cle: `TVA:${cleMois}`, type: "TVA", libelle_cle: "TVA", periode: cleMois, date_limite: limite, annee_periode: an, mois_periode: mois, automatique: true });
    e.push({ cle: `RETENUES:${cleMois}`, type: "RETENUES", libelle_cle: "RETENUES", periode: cleMois, date_limite: limite, annee_periode: an, mois_periode: mois, automatique: false });
  }
  e.push({ cle: `IS_ACOMPTE_1:${annee}`, type: "IS_ACOMPTE_1", periode: String(annee), date_limite: `${annee}-02-15`, automatique: false });
  e.push({ cle: `IS_ACOMPTE_2:${annee}`, type: "IS_ACOMPTE_2", periode: String(annee), date_limite: `${annee}-04-30`, automatique: false });
  e.push({ cle: `IS_DECLARATION:${annee}`, type: "IS_DECLARATION", periode: String(annee - 1), date_limite: `${annee}-04-30`, automatique: false });
  e.push({ cle: `IS_SOLDE:${annee}`, type: "IS_SOLDE", periode: String(annee - 1), date_limite: `${annee}-06-15`, automatique: false });
  e.push({ cle: `CEL_LOCAUX:${annee}`, type: "CEL_LOCAUX", periode: String(annee), date_limite: `${annee}-01-31`, automatique: false });
  e.push({ cle: `VEHICULES:${annee}`, type: "VEHICULES", periode: String(annee - 1), date_limite: `${annee}-01-31`, automatique: false });
  e.push({ cle: `CEL_DECLARATION:${annee}`, type: "CEL_DECLARATION", periode: String(annee), date_limite: `${annee}-04-30`, automatique: false });
  e.push({ cle: `CEL_PAIEMENT:${annee}`, type: "CEL_PAIEMENT", periode: String(annee), date_limite: `${annee}-07-31`, automatique: false });
  return e.sort((a, b) => a.date_limite.localeCompare(b.date_limite) || a.type.localeCompare(b.type));
}

function joursEntre(a, b) {
  const da = Date.UTC(...a.split("-").map((x, i) => (i === 1 ? Number(x) - 1 : Number(x))));
  const db_ = Date.UTC(...b.split("-").map((x, i) => (i === 1 ? Number(x) - 1 : Number(x))));
  return Math.round((db_ - da) / 86400000);
}

function aujourdhui() {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Estimation indicative des sanctions pour un impot paye / depose avec retard (art. 665, 667, 671 du CGI) : voir
 * fiscalitePenalites.js (interet de retard, penalite de 25 / 50 / 100 %, amende de 200 000 F). Impots locaux (CEL) : interet de 10 %.
 */
function estimerPenalites({ montant, jours_retard, type = "TVA", declaration_deposee = false }) {
  const nature = type === "TVA" ? "TVA" : type === "RETENUES" || type === "SALAIRES" ? "RETENUE" : String(type).startsWith("CEL") ? "IMPOT_LOCAL" : "AUTRE";
  return penalites.estimer({ montant, jours_retard, nature, declaration_deposee });
}

/**
 * IR et TRIMF retenus sur salaires (module Paie) : une echeance par mois de paie existant, versement avant le 15 du mois suivant.
 * Le montant vient de la paie des que la periode est validee ; le suivi (depot, paiement) reste saisi dans le calendrier.
 */
async function echeancesSalaires(tenantId, annee) {
  const r = await db.query(
    `SELECT p.id, p.annee, p.mois, p.statut,
            COALESCE((SELECT SUM(b.ir + b.trimf) FROM paie_bulletin b WHERE b.periode_id = p.id), 0) AS montant
     FROM paie_periode p JOIN tenant t ON t.id = p.tenant_id
     WHERE p.tenant_id = $1 AND t.module_paie_actif = TRUE AND ((p.annee = $2 AND p.mois <= 11) OR (p.annee = $3 AND p.mois = 12))`,
    [tenantId, annee, annee - 1]
  ).catch(() => ({ rows: [] }));
  return r.rows.map((x) => {
    const cleMois = `${x.annee}-${pad(x.mois)}`;
    return {
      cle: `SALAIRES:${cleMois}`, type: "SALAIRES", libelle_cle: "SALAIRES", periode: cleMois, date_limite: dateLimite(x.annee, x.mois), annee_periode: x.annee, mois_periode: x.mois,
      automatique: false, paie_periode_id: x.id, paie_statut: x.statut, paie_montant: x.statut === "OUVERTE" ? null : num(x.montant),
    };
  });
}

async function lister(tenantId, annee) {
  const echeances = genererEcheances(annee);
  echeances.push(...(await echeancesSalaires(tenantId, annee)));
  echeances.sort((a, b) => a.date_limite.localeCompare(b.date_limite) || a.type.localeCompare(b.type));
  const cles = echeances.map((x) => x.cle);
  const suivis = await db.query(`SELECT * FROM fiscalite_suivi WHERE tenant_id = $1 AND cle = ANY($2)`, [tenantId, cles]);
  const parCle = new Map(suivis.rows.map((x) => [x.cle, x]));
  const tva = await db.query(
    `SELECT annee, mois, statut, solde_a_payer, credit_a_reporter, date_depot, date_paiement FROM fiscalite_declaration_tva
     WHERE tenant_id = $1 AND (annee = $2 OR (annee = $3 AND mois = 12))`,
    [tenantId, annee, annee - 1]
  );
  const parTva = new Map(tva.rows.map((x) => [`TVA:${x.annee}-${pad(x.mois)}`, x]));
  const dossiersIs = await db.query(
    `SELECT annee, statut, impot_du, solde_a_payer, date_depot, date_paiement, calcul_json FROM fiscalite_is_dossier WHERE tenant_id = $1 AND annee BETWEEN $2 AND $3`,
    [tenantId, annee - 2, annee]
  );
  const parIs = new Map(dossiersIs.rows.map((x) => [x.annee, x]));
  const paiementsIs = await db.query(
    `SELECT annee_exercice, nature, SUM(montant) AS total, MAX(date_paiement) AS dernier FROM fiscalite_is_paiement WHERE tenant_id = $1 AND annee_exercice BETWEEN $2 AND $3 GROUP BY annee_exercice, nature`,
    [tenantId, annee - 2, annee]
  );
  const parPaiement = new Map(paiementsIs.rows.map((x) => [`${x.annee_exercice}:${x.nature}`, x]));
  // Dossiers annuels du lot 5 : CEL (exercice = annee) et taxe sur les voitures (periode = annee - 1).
  const dossAnnuels = await db.query(
    `SELECT type, annee, statut, montant_du, date_depot, date_paiement, calcul_json FROM fiscalite_dossier_annuel WHERE tenant_id = $1 AND ((type = 'CEL' AND annee = $2) OR (type = 'VEHICULES' AND annee = $3))`,
    [tenantId, annee, annee - 1]
  );
  const celDossier = dossAnnuels.rows.find((x) => x.type === "CEL");
  const vehDossier = dossAnnuels.rows.find((x) => x.type === "VEHICULES");
  const retSuivi = await retenuesSvc.suiviCalendrier(tenantId, annee);
  const auj = aujourdhui();
  // Les echeances anterieures a l'activation du module (moins un mois de tolerance) ne sont pas suivies par la
  // plateforme : elles ne declenchent ni retard ni alerte (la TVA de ces mois a ete deposee hors plateforme).
  const t = await db.query(`SELECT COALESCE(module_fiscalite_date_activation, date_creation) AS debut FROM tenant WHERE id = $1`, [tenantId]);
  const debutSuivi = new Date(new Date(t.rows[0]?.debut || Date.now()).getTime() - 31 * 86400000).toISOString().slice(0, 10);

  return echeances.map((e) => {
    const s = parCle.get(e.cle);
    const d = parTva.get(e.cle);
    let statut = s ? s.statut : "A_FAIRE";
    let montant = s && s.montant !== null ? num(s.montant) : null;
    let dateDepot = s && s.date_depot ? String(s.date_depot).slice(0, 10) : null;
    let datePaiement = s && s.date_paiement ? String(s.date_paiement).slice(0, 10) : null;
    if (e.type === "TVA" && d) {
      statut = d.statut;
      montant = num(d.solde_a_payer);
      dateDepot = d.date_depot ? String(d.date_depot).slice(0, 10) : null;
      datePaiement = d.date_paiement ? String(d.date_paiement).slice(0, 10) : null;
    }
    // IS : l'exercice de l'echeance est annee - 1 ; les donnees viennent du dossier IS (module) quand il existe.
    if (e.type.startsWith("IS_")) {
      const ex = annee - 1;
      const dos = parIs.get(ex);
      if (e.type === "IS_DECLARATION" && dos && dos.statut !== "BROUILLON") {
        statut = dos.statut === "PREPAREE" ? "PREPAREE" : "DEPOSEE";
        dateDepot = dos.date_depot ? String(dos.date_depot).slice(0, 10) : null;
        montant = dos.impot_du === null ? montant : num(dos.impot_du);
      } else if (e.type === "IS_SOLDE" && dos && dos.statut !== "BROUILLON") {
        montant = dos.solde_a_payer === null ? montant : num(dos.solde_a_payer);
        const verse = parPaiement.get(`${ex}:SOLDE`);
        if (dos.statut === "PAYEE" || (verse && num(verse.total) >= num(dos.solde_a_payer) && num(dos.solde_a_payer) > 0) || (dos.statut !== "PREPAREE" && num(dos.solde_a_payer) === 0)) {
          statut = "PAYEE";
          datePaiement = dos.date_paiement ? String(dos.date_paiement).slice(0, 10) : verse ? String(verse.dernier).slice(0, 10) : null;
        } else statut = "A_FAIRE";
        if (dos.statut === "PREPAREE") statut = "PREPAREE";
      } else if (e.type === "IS_ACOMPTE_1" || e.type === "IS_ACOMPTE_2") {
        const plan = dos && dos.calcul_json && dos.calcul_json.acomptes && dos.calcul_json.acomptes.plan;
        const nature = e.type === "IS_ACOMPTE_1" ? "ACOMPTE_1" : "ACOMPTE_2";
        const verse = parPaiement.get(`${ex}:${nature}`);
        if (plan && plan[e.type === "IS_ACOMPTE_1" ? "acompte_1" : "acompte_2"] !== null && montant === null) montant = plan[e.type === "IS_ACOMPTE_1" ? "acompte_1" : "acompte_2"];
        if (verse) {
          statut = "PAYEE";
          montant = num(verse.total);
          datePaiement = String(verse.dernier).slice(0, 10);
        }
      }
    }
    // Lot 4 : retenues a la source suivies depuis l'etat mensuel du module (montant calcule, statut du dossier).
    let propositions = 0;
    if (e.type === "RETENUES") {
      const rs = retSuivi.get(e.periode);
      if (rs) {
        propositions = rs.nb_propositions;
        if (rs.statut !== "BROUILLON") {
          statut = rs.statut;
          montant = rs.montant_du !== null ? rs.montant_du : montant;
          dateDepot = rs.date_depot;
          datePaiement = rs.date_paiement;
        } else if (rs.nb_confirmees > 0 && montant === null) {
          montant = rs.calcule;
        }
      }
    }
    // Paie : IR et TRIMF retenus sur salaires, montant repris de la periode de paie validee ou cloturee.
    if (e.type === "SALAIRES" && e.paie_montant !== null && montant === null) montant = e.paie_montant;
    // Lot 5 : CEL et taxe sur les voitures suivies depuis leur dossier annuel.
    if (e.type.startsWith("CEL_") || e.type === "VEHICULES") {
      const dos = e.type === "VEHICULES" ? vehDossier : celDossier;
      if (dos && dos.statut !== "BROUILLON") {
        const cj = dos.calcul_json || {};
        if (e.type === "CEL_LOCAUX") montant = cj.locaux ? num(cj.locaux.total) : montant;
        else if (e.type === "CEL_DECLARATION" || e.type === "CEL_PAIEMENT") montant = cj.cva ? num(cj.cva.cva) : montant;
        else if (e.type === "VEHICULES") montant = num(dos.montant_du);
        const payeSeul = e.type === "CEL_PAIEMENT" || e.type === "VEHICULES";
        if (dos.statut === "PREPAREE") statut = "PREPAREE";
        else if (dos.statut === "DEPOSEE") {
          statut = "DEPOSEE";
          dateDepot = dos.date_depot ? String(dos.date_depot).slice(0, 10) : null;
        } else if (dos.statut === "PAYEE") {
          statut = "PAYEE";
          dateDepot = dos.date_depot ? String(dos.date_depot).slice(0, 10) : null;
          datePaiement = dos.date_paiement ? String(dos.date_paiement).slice(0, 10) : null;
        }
        if (!payeSeul && dos.statut === "PAYEE") statut = "PAYEE";
      }
    }
    // Deposee mais pas encore payee avec un montant a regler : l'echeance de paiement reste ouverte.
    const clos = statut === "PAYEE" || statut === "NON_CONCERNE" || (statut === "DEPOSEE" && (!(montant > 0) || e.type === "IS_DECLARATION" || e.type === "CEL_DECLARATION" || e.type === "CEL_LOCAUX"));
    const joursRestants = joursEntre(auj, e.date_limite);
    let alerte = "OK";
    if (!clos && e.date_limite < debutSuivi && statut === "A_FAIRE") {
      alerte = "HISTORIQUE";
    } else if (!clos) {
      if (joursRestants < 0) alerte = "EN_RETARD";
      else if (joursRestants <= 10) alerte = "IMMINENT";
      else alerte = "A_VENIR";
    }
    // La declaration de la CVA et son paiement portent sur le meme impot : les penalites sont estimees sur le paiement seulement.
    const penalites = alerte === "EN_RETARD" && montant && e.type !== "CEL_DECLARATION" ? estimerPenalites({ montant, jours_retard: -joursRestants, type: e.type === "TVA" || e.type === "RETENUES" || e.type === "SALAIRES" || e.type.startsWith("CEL") ? e.type : "AUTRE", declaration_deposee: statut === "DEPOSEE" }) : null;
    return {
      ...e,
      statut,
      montant,
      date_depot: dateDepot,
      date_paiement: datePaiement,
      reference: s ? s.reference : null,
      note: s ? s.note : null,
      jours_restants: joursRestants,
      alerte,
      penalites_estimees: penalites,
      propositions_en_attente: propositions,
    };
  });
}

async function majSuivi(tenantId, userId, cle, corps) {
  if (typeof cle !== "string" || !/^[A-Z_0-9]+:[0-9-]{4,7}$/.test(cle)) throw new FiscaliteError("FISCALITE_CODE_INVALIDE");
  const c = corps || {};
  if (!STATUTS.includes(c.statut)) throw new FiscaliteError("FISCALITE_CODE_INVALIDE");
  const estDate = (v) => v === null || v === undefined || v === "" || (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v));
  if (!estDate(c.date_depot) || !estDate(c.date_paiement)) throw new FiscaliteError("FISCALITE_DATE_INVALIDE");
  let montant = null;
  if (c.montant !== undefined && c.montant !== null && c.montant !== "") {
    montant = Number(c.montant);
    if (!Number.isFinite(montant) || montant < 0) throw new FiscaliteError("FISCALITE_MONTANT_INVALIDE");
  }
  await db.query(
    `INSERT INTO fiscalite_suivi (id, tenant_id, cle, statut, date_depot, date_paiement, reference, montant, note, mis_a_jour_par, date_modification)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10, now())
     ON CONFLICT (tenant_id, cle) DO UPDATE SET statut = EXCLUDED.statut, date_depot = EXCLUDED.date_depot, date_paiement = EXCLUDED.date_paiement,
       reference = EXCLUDED.reference, montant = EXCLUDED.montant, note = EXCLUDED.note, mis_a_jour_par = EXCLUDED.mis_a_jour_par, date_modification = now()`,
    [uuidv4(), tenantId, cle, c.statut, c.date_depot || null, c.date_paiement || null, (c.reference || "").trim() || null, montant, (c.note || "").trim() || null, userId]
  );
}

/** Synthese pour le tableau de bord : retards et echeances des 30 prochains jours. */
async function synthese(tenantId, annee) {
  const toutes = await lister(tenantId, annee);
  const ouvertes = toutes.filter((x) => ["EN_RETARD", "IMMINENT", "A_VENIR"].includes(x.alerte));
  return {
    annee,
    en_retard: toutes.filter((x) => x.alerte === "EN_RETARD"),
    imminentes: toutes.filter((x) => x.alerte === "IMMINENT"),
    prochaines: ouvertes.filter((x) => x.jours_restants >= 0 && x.jours_restants <= 45).slice(0, 8),
    total: toutes.length,
    faites: toutes.filter((x) => x.alerte === "OK").length,
  };
}

module.exports = { genererEcheances, estimerPenalites, lister, majSuivi, synthese, STATUTS };
