const express = require("express");
const db = require("../db");
const { requireAuth } = require("../middleware/auth");
const { t } = require("../utils/i18n");
const calendrierFiscal = require("../services/fiscaliteCalendrier");

const router = express.Router();
router.use(requireAuth);

// Tableau de bord dirigeant - bloc « Prochaines échéances » (09/10/2026).
// Rassemble, sur une fenetre de N jours (30 par defaut), les echeances que l'utilisateur a le droit de voir :
//  - dossiers : date limite de soumission (dossiers en analyse / GO) ;
//  - commandes fournisseur confirmees non entierement recues : livraison prevue ;
//  - comptabilite : factures fournisseur a payer, factures clients a encaisser ;
//  - financement : echeances des facilites retenues ;
//  - fiscalite et social : calendrier fiscal (TVA, retenues, IS, CEL...) + IR/TRIMF et cotisations de la paie.
// Chaque source est filtree par les droits du role (modules) et par l'activation du module chez le client.
// Les echeances en retard (jusqu'a 90 jours) sont remontees en tete.

const RETARD_MAX_JOURS = 90;
const LIMITE_ITEMS = 40;

function aModule(p, ...cles) {
  return !!p && (p.admin || cles.some((c) => (p.modules || []).includes(c)));
}

function iso(d) {
  const x = d instanceof Date ? d : new Date(d);
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}-${String(x.getDate()).padStart(2, "0")}`;
}

function dateTexte(d) {
  return d instanceof Date ? iso(d) : String(d).slice(0, 10);
}

function joursEntre(dateIso, aujourdhui) {
  const a = new Date(`${dateIso}T00:00:00`);
  return Math.round((a - aujourdhui) / 86400000);
}

function niveau(jours) {
  if (jours < 0) return "RETARD";
  if (jours <= 7) return "IMMINENT";
  return "A_VENIR";
}

function lienFiscal(e) {
  if (e.type === "TVA") return `/fiscalite/tva/${e.annee_periode}/${e.mois_periode}`;
  if (e.type === "IS_DECLARATION" || e.type === "IS_SOLDE") return `/fiscalite/is/${Number(e.periode)}`;
  if (e.type.startsWith("CEL_")) return `/fiscalite/cel/${e.periode}`;
  if (e.type === "VEHICULES") return "/fiscalite/vehicules";
  if (e.type === "RETENUES") return `/fiscalite/retenues?annee=${e.annee_periode}&mois=${e.mois_periode}`;
  if ((e.type === "SALAIRES" || e.type === "COTISATIONS") && e.paie_periode_id) return `/paie/mois/${e.paie_periode_id}`;
  return "/fiscalite/calendrier";
}

// GET /api/tableau-bord/echeances?jours=30
router.get("/echeances", async (req, res) => {
  try {
    const tenantId = req.user.tenantId;
    const p = req.user.permissions || {};
    const horizon = Math.min(Math.max(parseInt(req.query.jours, 10) || 30, 1), 120);
    const auj = new Date();
    auj.setHours(0, 0, 0, 0);
    const debut = iso(new Date(auj.getTime() - RETARD_MAX_JOURS * 86400000));
    const fin = iso(new Date(auj.getTime() + horizon * 86400000));

    const peutDossiers = aModule(p, "dossiers", "marches") || p.tableauDeBord;
    const peutCommandes = aModule(p, "logistique", "fournisseurs", "marches", "dossiers");
    const peutCompta = p.comptabiliteActive && aModule(p, "comptabilite", "comptabilite-validation");
    const peutFinancement = aModule(p, "financement");
    const peutFiscal = p.fiscaliteActive && aModule(p, "fiscalite", "fiscalite-validation");
    const peutPaie = p.paieActive && aModule(p, "paie", "paie-validation");

    const items = [];
    const ajouter = (it) => {
      const date = dateTexte(it.date);
      const jours = joursEntre(date, auj);
      items.push({ ...it, date, jours, niveau: niveau(jours) });
    };
    const taches = [];

    if (peutDossiers) {
      taches.push(
        db
          .query(
            `SELECT id, intitule, reference_externe, date_limite_soumission AS date, statut
             FROM dossier_ao
             WHERE tenant_id = $1 AND statut IN ('ANALYSE', 'GO') AND date_limite_soumission BETWEEN $2 AND $3`,
            [tenantId, debut, fin]
          )
          .then((r) =>
            r.rows.forEach((d) =>
              ajouter({ source: "DOSSIER", titre: d.intitule, detail: d.reference_externe || null, date: d.date, lien: `/dossiers/${d.id}` })
            )
          )
      );
    }

    if (peutCommandes) {
      taches.push(
        db
          .query(
            `SELECT c.id, c.numero, c.date_livraison_prevue AS date, f.nom AS fournisseur
             FROM commande_fournisseur c
             LEFT JOIN fournisseur f ON f.id = c.fournisseur_id
             WHERE c.tenant_id = $1 AND c.statut = 'CONFIRMEE' AND c.date_livraison_prevue BETWEEN $2 AND $3
               AND EXISTS (
                 SELECT 1 FROM commande_fournisseur_ligne l
                 WHERE l.commande_id = c.id
                   AND l.quantite > COALESCE((SELECT SUM(rl.quantite) FROM reception_ligne rl JOIN reception_marchandise r ON r.id = rl.reception_id
                                              WHERE rl.commande_ligne_id = l.id AND r.statut = 'VALIDEE'), 0)
               )`,
            [tenantId, debut, fin]
          )
          .then((r) =>
            r.rows.forEach((c) =>
              ajouter({ source: "COMMANDE", titre: c.numero, detail: c.fournisseur || null, date: c.date, lien: `/commandes/${c.id}` })
            )
          )
      );
    }

    if (peutCompta) {
      taches.push(
        db
          .query(
            `SELECT fa.id, fa.numero, fa.date_echeance AS date, (fa.montant_ttc - fa.montant_regle) AS reste, tc.nom AS tiers
             FROM facture_fournisseur fa
             LEFT JOIN tiers_comptable tc ON tc.id = fa.tiers_id
             WHERE fa.tenant_id = $1 AND fa.statut = 'ENREGISTREE' AND fa.date_echeance BETWEEN $2 AND $3
               AND (fa.montant_ttc - fa.montant_regle) > 0`,
            [tenantId, debut, fin]
          )
          .then((r) =>
            r.rows.forEach((f) =>
              ajouter({ source: "PAIEMENT_FOURNISSEUR", titre: f.tiers || f.numero, detail: f.numero, montant: Number(f.reste), date: f.date, lien: `/comptabilite/achats/${f.id}` })
            )
          ),
        db
          .query(
            `SELECT fv.id, fv.numero, fv.date_echeance AS date, (fv.total_ttc - COALESCE(fv.montant_encaisse, 0)) AS reste, cc.nom AS client
             FROM facture_vente fv
             LEFT JOIN client_commercial cc ON cc.id = fv.client_commercial_id
             WHERE fv.tenant_id = $1 AND fv.statut = 'IMPAYEE' AND fv.date_echeance BETWEEN $2 AND $3`,
            [tenantId, debut, fin]
          )
          .then((r) =>
            r.rows.forEach((f) =>
              ajouter({ source: "ENCAISSEMENT_CLIENT", titre: f.client || f.numero, detail: f.numero, montant: Number(f.reste), date: f.date, lien: `/marches/consultation-restreinte/factures/${f.id}` })
            )
          )
      );
    }

    if (peutFinancement) {
      taches.push(
        db
          .query(
            `SELECT id, libelle, montant, date_echeance AS date
             FROM financement_simulation
             WHERE tenant_id = $1 AND statut IN ('RETENUE', 'CONTROLEE') AND date_echeance BETWEEN $2 AND $3`,
            [tenantId, debut, fin]
          )
          .then((r) =>
            r.rows.forEach((s) =>
              ajouter({ source: "FINANCEMENT", titre: s.libelle, montant: Number(s.montant), date: s.date, lien: `/financement/simulations/${s.id}` })
            )
          )
      );
    }

    if (peutFiscal || peutPaie) {
      taches.push(
        (async () => {
          const annee = auj.getFullYear();
          const annees = new Set([annee]);
          if (new Date(auj.getTime() + horizon * 86400000).getFullYear() !== annee) annees.add(annee + 1);
          if (auj.getMonth() < 3) annees.add(annee - 1); // retards possibles sur l'exercice precedent
          for (const a of annees) {
            const liste = await calendrierFiscal.lister(tenantId, a);
            for (const e of liste) {
              const social = e.type === "SALAIRES" || e.type === "COTISATIONS";
              if (social ? !(peutPaie || peutFiscal) : !peutFiscal) continue;
              if (!["A_FAIRE", "PREPAREE"].includes(e.statut)) continue;
              if (!["EN_RETARD", "IMMINENT", "A_VENIR"].includes(e.alerte)) continue;
              if (e.date_limite < debut || e.date_limite > fin) continue;
              ajouter({
                source: social ? "SOCIAL" : "FISCAL",
                type: e.type,
                mois_periode: e.mois_periode,
                annee_periode: e.annee_periode,
                periode: e.periode,
                titre: null,
                montant: e.montant != null ? Number(e.montant) : null,
                date: e.date_limite,
                lien: lienFiscal(e),
              });
            }
          }
        })()
      );
    }

    await Promise.all(taches);

    // Retards d'abord (les plus anciens en premier ne servent a rien : on garde l'ordre chronologique), puis a venir.
    items.sort((a, b) => a.jours - b.jours);
    const retards = items.filter((x) => x.jours < 0).length;
    res.json({ horizon, retards, total: items.length, items: items.slice(0, LIMITE_ITEMS) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: t(req, "SERVER_ERROR") });
  }
});

module.exports = router;
