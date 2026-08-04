const express = require("express");
const db = require("../db");
const { requireAuth } = require("../middleware/auth");
const { t } = require("../utils/i18n");
const { evaluerExpression } = require("../services/regleEngine");
const { evaluerRisqueLogistique } = require("../services/anticipationEngine");

const router = express.Router();
router.use(requireAuth);

const CODE_FORMULE_DEFAUT = "COUT_LOGISTIQUE_STANDARD_DEFAUT";
const EXPRESSION_DEFAUT =
  "montant_marchandise*(taux_assurance_pct/100) + frais_transport + frais_douane + frais_manutention";

async function obtenirFormuleParDefaut(tenantId) {
  const existante = await db.query(
    `SELECT * FROM regle_formule WHERE tenant_id = $1 AND code = $2`,
    [tenantId, CODE_FORMULE_DEFAUT]
  );
  if (existante.rows[0]) return existante.rows[0];

  const creee = await db.query(
    `INSERT INTO regle_formule (tenant_id, code, libelle, expression, description)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING *`,
    [
      tenantId,
      CODE_FORMULE_DEFAUT,
      "Cout logistique standard (assurance + transport + douane + manutention)",
      EXPRESSION_DEFAUT,
      "Formule par defaut appliquee aux scenarios incoterm sans formule specifique. Modifiable dans Parametres > Regles de calcul.",
    ]
  );
  return creee.rows[0];
}

/**
 * Determine le statut de penalite a partir des dates d'arrivee. Toujours
 * recalcule cote serveur (jamais fourni tel quel par le client) pour rester
 * coherent avec les dates reellement enregistrees.
 */
function calculerStatutPenalite({ date_arrivee_prevue, date_arrivee_reelle }) {
  if (!date_arrivee_prevue) return "AUCUNE";
  const prevue = new Date(date_arrivee_prevue);

  if (date_arrivee_reelle) {
    const reelle = new Date(date_arrivee_reelle);
    return reelle > prevue ? "ENCOURUE" : "AUCUNE";
  }

  const aujourdHui = new Date();
  return aujourdHui > prevue ? "RISQUE" : "AUCUNE";
}

// ----------------------------------------------------------------------------
// Scenarios Incoterm (EXW, FOB, CIF, DAP, DDP...)
// ----------------------------------------------------------------------------

// GET /api/logistique/incoterms
router.get("/incoterms", async (req, res) => {
  try {
    const result = await db.query(
      `SELECT * FROM incoterm_scenario WHERE tenant_id = $1 ORDER BY code ASC`,
      [req.user.tenantId]
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: t(req, "INCOTERMS_FETCH_ERROR") });
  }
});

// POST /api/logistique/incoterms
router.post("/incoterms", async (req, res) => {
  const { code, repartition_couts_json, regle_calcul_id } = req.body;
  if (!code) {
    return res.status(400).json({ error: t(req, "INCOTERM_CODE_REQUIRED") });
  }
  try {
    const result = await db.query(
      `INSERT INTO incoterm_scenario (tenant_id, code, repartition_couts_json, regle_calcul_id)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [req.user.tenantId, code, repartition_couts_json || {}, regle_calcul_id || null]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: t(req, "INCOTERM_CREATE_ERROR") });
  }
});

// PATCH /api/logistique/incoterms/:id
router.patch("/incoterms/:id", async (req, res) => {
  const { id } = req.params;
  const { repartition_couts_json, regle_calcul_id } = req.body;
  try {
    const result = await db.query(
      `UPDATE incoterm_scenario
       SET repartition_couts_json = COALESCE($1, repartition_couts_json),
           regle_calcul_id = COALESCE($2, regle_calcul_id)
       WHERE id = $3 AND tenant_id = $4
       RETURNING *`,
      [repartition_couts_json || null, regle_calcul_id || null, id, req.user.tenantId]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: t(req, "INCOTERM_NOT_FOUND") });
    }
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: t(req, "INCOTERM_UPDATE_ERROR") });
  }
});

// POST /api/logistique/simulations - calcul de cout logistique (stateless),
// toujours via le moteur de regles (formule specifique au scenario ou formule
// par defaut auto-provisionnee), jamais code en dur ici.
router.post("/simulations", async (req, res) => {
  const { incoterm_scenario_id, variables } = req.body;
  if (!incoterm_scenario_id) {
    return res.status(400).json({ error: t(req, "INCOTERM_SCENARIO_ID_REQUIRED") });
  }
  try {
    const scenarioResult = await db.query(
      `SELECT * FROM incoterm_scenario WHERE id = $1 AND tenant_id = $2`,
      [incoterm_scenario_id, req.user.tenantId]
    );
    if (scenarioResult.rows.length === 0) {
      return res.status(404).json({ error: t(req, "INCOTERM_NOT_FOUND") });
    }
    const scenario = scenarioResult.rows[0];

    let formule;
    if (scenario.regle_calcul_id) {
      const formuleResult = await db.query(`SELECT * FROM regle_formule WHERE id = $1`, [
        scenario.regle_calcul_id,
      ]);
      formule = formuleResult.rows[0] || (await obtenirFormuleParDefaut(req.user.tenantId));
    } else {
      formule = await obtenirFormuleParDefaut(req.user.tenantId);
    }

    const coutTotal = evaluerExpression(formule.expression, variables || {});

    res.json({
      incoterm_code: scenario.code,
      formule_utilisee: formule.code,
      cout_total: Math.round(coutTotal * 100) / 100,
      repartition_couts: scenario.repartition_couts_json || {},
    });
  } catch (err) {
    res.status(400).json({ error: `${t(req, "REGLE_EXPRESSION_INVALID")} (${err.message})` });
  }
});

// ----------------------------------------------------------------------------
// Transitaires + tableau de bord performance
// ----------------------------------------------------------------------------

// GET /api/logistique/transitaires - liste avec stats de performance agregees
router.get("/transitaires", async (req, res) => {
  try {
    const result = await db.query(
      `SELECT
         tr.*,
         COUNT(h.id)::int AS nb_expeditions,
         ROUND(AVG(h.delai_jours)::numeric, 1) AS delai_moyen_jours,
         ROUND(
           (COUNT(h.id) FILTER (WHERE h.retard = true)::numeric / NULLIF(COUNT(h.id), 0)) * 100, 1
         ) AS taux_retard_pct
       FROM transitaire tr
       LEFT JOIN transitaire_historique h ON h.transitaire_id = tr.id
       WHERE tr.tenant_id = $1
       GROUP BY tr.id
       ORDER BY tr.nom ASC`,
      [req.user.tenantId]
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: t(req, "TRANSITAIRES_FETCH_ERROR") });
  }
});

// POST /api/logistique/transitaires
router.post("/transitaires", async (req, res) => {
  const { nom, contact_json } = req.body;
  if (!nom) {
    return res.status(400).json({ error: t(req, "TRANSITAIRE_NOM_REQUIRED") });
  }
  try {
    const result = await db.query(
      `INSERT INTO transitaire (tenant_id, nom, contact_json)
       VALUES ($1, $2, $3)
       RETURNING *`,
      [req.user.tenantId, nom, contact_json || {}]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: t(req, "TRANSITAIRE_CREATE_ERROR") });
  }
});

// GET /api/logistique/transitaires/:id/historique
router.get("/transitaires/:id/historique", async (req, res) => {
  const { id } = req.params;
  try {
    const result = await db.query(
      `SELECT h.* FROM transitaire_historique h
       JOIN transitaire tr ON tr.id = h.transitaire_id
       WHERE h.transitaire_id = $1 AND tr.tenant_id = $2
       ORDER BY h.date_expedition DESC NULLS LAST`,
      [id, req.user.tenantId]
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: t(req, "HISTORIQUE_FETCH_ERROR") });
  }
});

// POST /api/logistique/transitaires/:id/historique
router.post("/transitaires/:id/historique", async (req, res) => {
  const { id } = req.params;
  const { dossier_ao_id, delai_jours, retard, difficulte_type, date_expedition, date_livraison } = req.body;
  try {
    const transitaireCheck = await db.query(
      `SELECT id FROM transitaire WHERE id = $1 AND tenant_id = $2`,
      [id, req.user.tenantId]
    );
    if (transitaireCheck.rows.length === 0) {
      return res.status(404).json({ error: t(req, "TRANSITAIRE_NOT_FOUND") });
    }
    const result = await db.query(
      `INSERT INTO transitaire_historique
         (transitaire_id, dossier_ao_id, delai_jours, retard, difficulte_type, date_expedition, date_livraison)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [
        id,
        dossier_ao_id || null,
        delai_jours || null,
        !!retard,
        difficulte_type || null,
        date_expedition || null,
        date_livraison || null,
      ]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: t(req, "HISTORIQUE_CREATE_ERROR") });
  }
});

// ----------------------------------------------------------------------------
// Suivi logistique (par dossier)
// ----------------------------------------------------------------------------

// GET /api/logistique/dossiers/:dossierId/suivis
router.get("/dossiers/:dossierId/suivis", async (req, res) => {
  const { dossierId } = req.params;
  try {
    const dossierCheck = await db.query(
      `SELECT id FROM dossier_ao WHERE id = $1 AND tenant_id = $2`,
      [dossierId, req.user.tenantId]
    );
    if (dossierCheck.rows.length === 0) {
      return res.status(404).json({ error: t(req, "DOSSIER_NOT_FOUND") });
    }
    const result = await db.query(
      `SELECT sl.*, tr.nom AS transitaire_nom, inc.code AS incoterm_code
       FROM suivi_logistique sl
       LEFT JOIN transitaire tr ON tr.id = sl.transitaire_id
       LEFT JOIN incoterm_scenario inc ON inc.id = sl.incoterm_scenario_id
       WHERE sl.dossier_ao_id = $1
       ORDER BY sl.date_depart DESC NULLS LAST`,
      [dossierId]
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: t(req, "SUIVIS_FETCH_ERROR") });
  }
});

// POST /api/logistique/dossiers/:dossierId/suivis
router.post("/dossiers/:dossierId/suivis", async (req, res) => {
  const { dossierId } = req.params;
  const { transitaire_id, incoterm_scenario_id, date_depart, date_arrivee_prevue, date_arrivee_reelle, montant_ttc } =
    req.body;

  try {
    const dossierResult = await db.query(
      `SELECT id, intitule FROM dossier_ao WHERE id = $1 AND tenant_id = $2`,
      [dossierId, req.user.tenantId]
    );
    if (dossierResult.rows.length === 0) {
      return res.status(404).json({ error: t(req, "DOSSIER_NOT_FOUND") });
    }

    const statutPenalite = calculerStatutPenalite({ date_arrivee_prevue, date_arrivee_reelle });

    const result = await db.query(
      `INSERT INTO suivi_logistique
         (dossier_ao_id, transitaire_id, incoterm_scenario_id, date_depart,
          date_arrivee_prevue, date_arrivee_reelle, montant_ttc, statut_penalite)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING *`,
      [
        dossierId,
        transitaire_id || null,
        incoterm_scenario_id || null,
        date_depart || null,
        date_arrivee_prevue || null,
        date_arrivee_reelle || null,
        montant_ttc || null,
        statutPenalite,
      ]
    );

    await evaluerRisqueLogistique({
      tenantId: req.user.tenantId,
      dossierId,
      dossierIntitule: dossierResult.rows[0].intitule,
      statutPenalite,
      dateArriveePrevue: date_arrivee_prevue,
      dateArriveeReelle: date_arrivee_reelle,
    });

    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: t(req, "SUIVI_CREATE_ERROR") });
  }
});

// PATCH /api/logistique/suivis/:id - typiquement pour enregistrer la date
// d'arrivee reelle une fois la marchandise recue
router.patch("/suivis/:id", async (req, res) => {
  const { id } = req.params;
  const champs = req.body;

  try {
    const existant = await db.query(
      `SELECT sl.*, d.intitule AS dossier_intitule FROM suivi_logistique sl
       JOIN dossier_ao d ON d.id = sl.dossier_ao_id
       WHERE sl.id = $1 AND d.tenant_id = $2`,
      [id, req.user.tenantId]
    );
    if (existant.rows.length === 0) {
      return res.status(404).json({ error: t(req, "SUIVI_NOT_FOUND") });
    }

    const fusion = { ...existant.rows[0], ...champs };
    const statutPenalite = calculerStatutPenalite({
      date_arrivee_prevue: fusion.date_arrivee_prevue,
      date_arrivee_reelle: fusion.date_arrivee_reelle,
    });

    const result = await db.query(
      `UPDATE suivi_logistique
       SET transitaire_id = $1, incoterm_scenario_id = $2, date_depart = $3,
           date_arrivee_prevue = $4, date_arrivee_reelle = $5, montant_ttc = $6, statut_penalite = $7
       WHERE id = $8
       RETURNING *`,
      [
        fusion.transitaire_id || null,
        fusion.incoterm_scenario_id || null,
        fusion.date_depart || null,
        fusion.date_arrivee_prevue || null,
        fusion.date_arrivee_reelle || null,
        fusion.montant_ttc || null,
        statutPenalite,
        id,
      ]
    );

    await evaluerRisqueLogistique({
      tenantId: req.user.tenantId,
      dossierId: existant.rows[0].dossier_ao_id,
      dossierIntitule: existant.rows[0].dossier_intitule,
      statutPenalite,
      dateArriveePrevue: fusion.date_arrivee_prevue,
      dateArriveeReelle: fusion.date_arrivee_reelle,
    });

    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: t(req, "SUIVI_UPDATE_ERROR") });
  }
});

module.exports = router;
