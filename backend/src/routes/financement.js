const express = require("express");
const db = require("../db");
const { v4: uuidv4 } = require("uuid");
const { requireAuth, requireModule, blockLectureSeule } = require("../middleware/auth");
const { t } = require("../utils/i18n");
const { evaluerExpression } = require("../services/regleEngine");

const router = express.Router();
router.use(requireAuth);
router.use(requireModule("financement"));
router.use(blockLectureSeule);

// Correspondance besoin de financement -> type de facilite recherche.
// Configurable en dur pour l'instant (liste fermee des besoins types) ;
// le COUT de chaque facilite, lui, est toujours calcule via le moteur de
// regles (jamais code en dur) - voir simulerFinancement() plus bas.
const MAPPING_BESOIN_FACILITE = {
  CAUTION_SOUMISSION: "CAUTION_BANCAIRE",
  CAUTION_BONNE_EXECUTION: "CAUTION_BANCAIRE",
  AVANCE_DEMARRAGE: "AVANCE_MARCHE",
  LC: "LC_INTERNATIONAL",
};

const CODE_FORMULE_DEFAUT = "COUT_FACILITE_STANDARD_DEFAUT";
const EXPRESSION_DEFAUT =
  "montant*(taux_annuel/100)*(duree_jours/365) + montant*(commission_pct/100) + montant*(taf_pct/100)";

/**
 * Recupere la formule de calcul de cout par defaut pour le tenant, et la
 * cree si elle n'existe pas encore (evite tout calcul code en dur : meme
 * la valeur "par defaut" vit en base et reste editable par l'utilisateur).
 */
async function obtenirFormuleParDefaut(tenantId) {
  const existante = await db.query(
    `SELECT * FROM regle_formule WHERE tenant_id = $1 AND code = $2`,
    [tenantId, CODE_FORMULE_DEFAUT]
  );
  if (existante.rows[0]) return existante.rows[0];

  const creee = await db.query(
    `INSERT INTO regle_formule (id, tenant_id, code, libelle, expression, description)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING *`,
    [
      uuidv4(),
      tenantId,
      CODE_FORMULE_DEFAUT,
      "Cout standard d'une facilite (interet + commission + TAF)",
      EXPRESSION_DEFAUT,
      "Formule par defaut appliquee aux lignes tarifaires sans formule specifique. Modifiable dans Parametres > Regles de calcul.",
    ]
  );
  return creee.rows[0];
}

// ----------------------------------------------------------------------------
// Partenaires financiers (banques, assurances)
// ----------------------------------------------------------------------------

// GET /api/financement/partenaires
router.get("/partenaires", async (req, res) => {
  try {
    const result = await db.query(
      `SELECT * FROM partenaire_financier WHERE tenant_id = $1 ORDER BY nom ASC`,
      [req.user.tenantId]
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: t(req, "PARTENAIRES_FETCH_ERROR") });
  }
});

// POST /api/financement/partenaires
router.post("/partenaires", async (req, res) => {
  const { nom, type_partenaire, contact_json } = req.body;
  if (!nom || !type_partenaire) {
    return res.status(400).json({ error: t(req, "PARTENAIRE_FIELDS_REQUIRED") });
  }
  try {
    const result = await db.query(
      `INSERT INTO partenaire_financier (id, tenant_id, nom, type_partenaire, contact_json)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [uuidv4(), req.user.tenantId, nom, type_partenaire, contact_json || {}]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: t(req, "PARTENAIRE_CREATE_ERROR") });
  }
});

// ----------------------------------------------------------------------------
// Grilles tarifaires (versionnees par partenaire)
// ----------------------------------------------------------------------------

// GET /api/financement/partenaires/:id/grilles
router.get("/partenaires/:id/grilles", async (req, res) => {
  const { id } = req.params;
  try {
    const result = await db.query(
      `SELECT g.* FROM grille_tarifaire g
       JOIN partenaire_financier p ON p.id = g.partenaire_id
       WHERE g.partenaire_id = $1 AND p.tenant_id = $2
       ORDER BY g.date_creation DESC`,
      [id, req.user.tenantId]
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: t(req, "GRILLES_FETCH_ERROR") });
  }
});

// POST /api/financement/partenaires/:id/grilles
router.post("/partenaires/:id/grilles", async (req, res) => {
  const { id } = req.params;
  const { version_label, date_effet } = req.body;
  if (!version_label) {
    return res.status(400).json({ error: t(req, "GRILLE_VERSION_REQUIRED") });
  }
  try {
    const partenaireCheck = await db.query(
      `SELECT id FROM partenaire_financier WHERE id = $1 AND tenant_id = $2`,
      [id, req.user.tenantId]
    );
    if (partenaireCheck.rows.length === 0) {
      return res.status(404).json({ error: t(req, "PARTENAIRE_NOT_FOUND") });
    }

    const result = await db.query(
      `INSERT INTO grille_tarifaire (id, tenant_id, partenaire_id, version_label, date_effet)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [uuidv4(), req.user.tenantId, id, version_label, date_effet || null]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: t(req, "GRILLE_CREATE_ERROR") });
  }
});

// PATCH /api/financement/grilles/:id/statut
router.patch("/grilles/:id/statut", async (req, res) => {
  const { id } = req.params;
  const { statut } = req.body;
  const statutsValides = ["EN_NEGOCIATION", "ACTIVE", "ARCHIVEE"];
  if (!statutsValides.includes(statut)) {
    return res.status(400).json({ error: t(req, "STATUT_INVALID") });
  }
  try {
    const result = await db.query(
      `UPDATE grille_tarifaire SET statut = $1
       WHERE id = $2 AND tenant_id = $3
       RETURNING *`,
      [statut, id, req.user.tenantId]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: t(req, "GRILLE_NOT_FOUND") });
    }
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: t(req, "GRILLE_STATUT_UPDATE_ERROR") });
  }
});

// ----------------------------------------------------------------------------
// Lignes de credit / tarifs (une ligne = une facilite : caution, LC, avance...)
// ----------------------------------------------------------------------------

// GET /api/financement/grilles/:id/lignes
router.get("/grilles/:id/lignes", async (req, res) => {
  const { id } = req.params;
  try {
    const result = await db.query(
      `SELECT l.* FROM ligne_credit_tarif l
       JOIN grille_tarifaire g ON g.id = l.grille_tarifaire_id
       WHERE l.grille_tarifaire_id = $1 AND g.tenant_id = $2
       ORDER BY l.type_facilite ASC`,
      [id, req.user.tenantId]
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: t(req, "LIGNES_FETCH_ERROR") });
  }
});

// POST /api/financement/grilles/:id/lignes
router.post("/grilles/:id/lignes", async (req, res) => {
  const { id } = req.params;
  const {
    type_facilite,
    taux_annuel,
    commission_pct,
    taf_pct,
    forfait_min_periode,
    periode_facturation,
    plafond_montant,
    regle_formule_id,
  } = req.body;

  if (!type_facilite) {
    return res.status(400).json({ error: t(req, "LIGNE_TYPE_REQUIRED") });
  }

  try {
    const grilleCheck = await db.query(
      `SELECT id FROM grille_tarifaire WHERE id = $1 AND tenant_id = $2`,
      [id, req.user.tenantId]
    );
    if (grilleCheck.rows.length === 0) {
      return res.status(404).json({ error: t(req, "GRILLE_NOT_FOUND") });
    }

    const result = await db.query(
      `INSERT INTO ligne_credit_tarif
         (id, grille_tarifaire_id, type_facilite, taux_annuel, commission_pct, taf_pct,
          forfait_min_periode, periode_facturation, plafond_montant, regle_formule_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, COALESCE($8, 'TRIMESTRE'), $9, $10)
       RETURNING *`,
      [
        uuidv4(),
        id,
        type_facilite,
        taux_annuel || null,
        commission_pct || null,
        taf_pct || null,
        forfait_min_periode || null,
        periode_facturation || null,
        plafond_montant || null,
        regle_formule_id || null,
      ]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: t(req, "LIGNE_CREATE_ERROR") });
  }
});

// ----------------------------------------------------------------------------
// Simulations de financement (pour un dossier donne)
// ----------------------------------------------------------------------------

/**
 * Calcule et classe toutes les options de financement disponibles (lignes
 * tarifaires actives correspondant au type de besoin) pour un montant et
 * une duree donnes. Le cout de chaque option est TOUJOURS calcule via le
 * moteur de regles (regle_formule), jamais par une formule codee en dur ici.
 */
async function simulerFinancement({ tenantId, typeBesoin, montant, dureeJours }) {
  const typeFacilite = MAPPING_BESOIN_FACILITE[typeBesoin];
  if (!typeFacilite) {
    throw new Error("TYPE_BESOIN_INCONNU");
  }

  const lignesResult = await db.query(
    `SELECT l.*, g.partenaire_id, g.version_label, p.nom AS partenaire_nom
     FROM ligne_credit_tarif l
     JOIN grille_tarifaire g ON g.id = l.grille_tarifaire_id
     JOIN partenaire_financier p ON p.id = g.partenaire_id
     WHERE g.tenant_id = $1 AND g.statut = 'ACTIVE' AND l.type_facilite = $2`,
    [tenantId, typeFacilite]
  );

  const formuleDefaut = await obtenirFormuleParDefaut(tenantId);

  // Pre-charge les formules specifiques eventuellement referencees par les lignes
  const idsFormulesSpecifiques = [
    ...new Set(lignesResult.rows.map((l) => l.regle_formule_id).filter(Boolean)),
  ];
  let formulesSpecifiques = {};
  if (idsFormulesSpecifiques.length > 0) {
    const formulesResult = await db.query(
      `SELECT * FROM regle_formule WHERE id = ANY($1::uuid[])`,
      [idsFormulesSpecifiques]
    );
    formulesSpecifiques = Object.fromEntries(formulesResult.rows.map((f) => [f.id, f]));
  }

  const options = [];
  for (const ligne of lignesResult.rows) {
    if (ligne.plafond_montant && Number(montant) > Number(ligne.plafond_montant)) {
      continue; // hors capacite de cette ligne
    }

    const formule = ligne.regle_formule_id
      ? formulesSpecifiques[ligne.regle_formule_id] || formuleDefaut
      : formuleDefaut;

    try {
      const coutTotal = evaluerExpression(formule.expression, {
        montant: Number(montant),
        duree_jours: dureeJours || 0,
        taux_annuel: ligne.taux_annuel,
        commission_pct: ligne.commission_pct,
        taf_pct: ligne.taf_pct,
        forfait_min_periode: ligne.forfait_min_periode,
        plafond_montant: ligne.plafond_montant,
      });

      options.push({
        ligne_credit_tarif_id: ligne.id,
        partenaire_id: ligne.partenaire_id,
        partenaire_nom: ligne.partenaire_nom,
        grille_version_label: ligne.version_label,
        type_facilite: ligne.type_facilite,
        formule_utilisee: formule.code,
        cout_total: Math.round(coutTotal * 100) / 100,
      });
    } catch (err) {
      // Une formule mal ecrite pour une ligne ne doit pas bloquer les autres
      options.push({
        ligne_credit_tarif_id: ligne.id,
        partenaire_id: ligne.partenaire_id,
        partenaire_nom: ligne.partenaire_nom,
        erreur: `Formule invalide (${formule.code}) : ${err.message}`,
      });
    }
  }

  options.sort((a, b) => {
    if (a.cout_total == null) return 1;
    if (b.cout_total == null) return -1;
    return a.cout_total - b.cout_total;
  });

  return options;
}

// GET /api/financement/dossiers/:dossierId/simulations
router.get("/dossiers/:dossierId/simulations", async (req, res) => {
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
      `SELECT * FROM simulation_financement WHERE dossier_ao_id = $1 ORDER BY date_simulation DESC`,
      [dossierId]
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: t(req, "SIMULATIONS_FETCH_ERROR") });
  }
});

// POST /api/financement/dossiers/:dossierId/simulations
router.post("/dossiers/:dossierId/simulations", async (req, res) => {
  const { dossierId } = req.params;
  const { type_besoin, montant, duree_estimee_jours } = req.body;

  if (!type_besoin || !montant) {
    return res.status(400).json({ error: t(req, "SIMULATION_FIELDS_REQUIRED") });
  }
  if (!MAPPING_BESOIN_FACILITE[type_besoin]) {
    return res.status(400).json({ error: t(req, "TYPE_BESOIN_INVALID") });
  }

  try {
    const dossierCheck = await db.query(
      `SELECT id FROM dossier_ao WHERE id = $1 AND tenant_id = $2`,
      [dossierId, req.user.tenantId]
    );
    if (dossierCheck.rows.length === 0) {
      return res.status(404).json({ error: t(req, "DOSSIER_NOT_FOUND") });
    }

    const options = await simulerFinancement({
      tenantId: req.user.tenantId,
      typeBesoin: type_besoin,
      montant,
      dureeJours: duree_estimee_jours,
    });

    const meilleureOption = options.find((o) => o.cout_total != null);

    const result = await db.query(
      `INSERT INTO simulation_financement
         (id, dossier_ao_id, type_besoin, montant, duree_estimee_jours, resultat_json, option_recommandee_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [
        uuidv4(),
        dossierId,
        type_besoin,
        montant,
        duree_estimee_jours || null,
        JSON.stringify(options),
        meilleureOption ? meilleureOption.ligne_credit_tarif_id : null,
      ]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: t(req, "SIMULATION_CREATE_ERROR") });
  }
});

// PATCH /api/financement/simulations/:id/retenue - fige l'option choisie par l'utilisateur
router.patch("/simulations/:id/retenue", async (req, res) => {
  const { id } = req.params;
  const { option_retenue_id } = req.body;
  try {
    const result = await db.query(
      `UPDATE simulation_financement sf
       SET option_retenue_id = $1
       FROM dossier_ao d
       WHERE sf.id = $2 AND sf.dossier_ao_id = d.id AND d.tenant_id = $3
       RETURNING sf.*`,
      [option_retenue_id || null, id, req.user.tenantId]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: t(req, "SIMULATION_NOT_FOUND") });
    }
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: t(req, "SIMULATION_RETENUE_ERROR") });
  }
});

module.exports = router;
