const express = require("express");
const db = require("../db");
const { requireAuth } = require("../middleware/auth");
const { t } = require("../utils/i18n");

const router = express.Router();
router.use(requireAuth);

// ----------------------------------------------------------------------------
// Module 8 - Parc auto (etape 1/3 : vehicules + sorties/missions)
// Donnee de reference/operationnelle comme fournisseur, maitre_ouvrage,
// concurrence : ouverte a tout utilisateur authentifie du tenant, pas de
// restriction de role (decision explicite de Steeve - coherent avec le
// reste de la plateforme plutot que la convention plus restrictive d'OGAA,
// dont les codes de role ADMIN/GPA/DAFC ne sont pas garantis exister chez
// un tenant Baobab, les roles y etant librement definis).
// ----------------------------------------------------------------------------

// ----------------------------------------------------------------------------
// Vehicules
// ----------------------------------------------------------------------------

// GET /api/parc-auto/vehicules
router.get("/vehicules", async (req, res) => {
  try {
    const result = await db.query(
      `SELECT * FROM vehicule WHERE tenant_id = $1 ORDER BY immatriculation ASC`,
      [req.user.tenantId]
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: t(req, "VEHICULES_FETCH_ERROR") });
  }
});

// GET /api/parc-auto/vehicules/:id - detail + historique des sorties
router.get("/vehicules/:id", async (req, res) => {
  const { id } = req.params;
  try {
    const vehiculeResult = await db.query(
      `SELECT * FROM vehicule WHERE id = $1 AND tenant_id = $2`,
      [id, req.user.tenantId]
    );
    const vehicule = vehiculeResult.rows[0];
    if (!vehicule) {
      return res.status(404).json({ error: t(req, "VEHICULE_NOT_FOUND") });
    }

    const sortiesResult = await db.query(
      `SELECT s.*, d.reference_externe AS dossier_reference, d.intitule AS dossier_intitule
       FROM sortie_vehicule s
       LEFT JOIN dossier_ao d ON d.id = s.dossier_ao_id
       WHERE s.vehicule_id = $1
       ORDER BY s.date_depart DESC`,
      [id]
    );

    res.json({ ...vehicule, sorties: sortiesResult.rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: t(req, "VEHICULE_FETCH_ERROR") });
  }
});

// POST /api/parc-auto/vehicules
router.post("/vehicules", async (req, res) => {
  const { immatriculation, marque_modele, affectation_service, kilometrage_actuel } = req.body;
  if (!immatriculation) {
    return res.status(400).json({ error: t(req, "VEHICULE_IMMATRICULATION_REQUIRED") });
  }
  try {
    const result = await db.query(
      `INSERT INTO vehicule (tenant_id, immatriculation, marque_modele, affectation_service, kilometrage_actuel)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [req.user.tenantId, immatriculation, marque_modele || null, affectation_service || null, kilometrage_actuel || null]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: t(req, "VEHICULE_CREATE_ERROR") });
  }
});

// PATCH /api/parc-auto/vehicules/:id
// Permet de corriger les infos du referentiel et de basculer manuellement
// le statut vers HORS_SERVICE (ou de le remettre DISPONIBLE) - les
// transitions DISPONIBLE <-> EN_SORTIE, elles, sont pilotees automatiquement
// par la creation/cloture d'une sortie (voir plus bas), pas par cette route.
router.patch("/vehicules/:id", async (req, res) => {
  const { id } = req.params;
  const { immatriculation, marque_modele, affectation_service, statut, kilometrage_actuel } = req.body;
  const statutsValides = ["DISPONIBLE", "EN_SORTIE", "EN_ENTRETIEN", "HORS_SERVICE"];
  if (statut && !statutsValides.includes(statut)) {
    return res.status(400).json({ error: t(req, "VEHICULE_STATUT_INVALID") });
  }
  try {
    const result = await db.query(
      `UPDATE vehicule
       SET immatriculation = COALESCE($1, immatriculation),
           marque_modele = COALESCE($2, marque_modele),
           affectation_service = COALESCE($3, affectation_service),
           statut = COALESCE($4, statut),
           kilometrage_actuel = COALESCE($5, kilometrage_actuel)
       WHERE id = $6 AND tenant_id = $7
       RETURNING *`,
      [immatriculation, marque_modele, affectation_service, statut, kilometrage_actuel, id, req.user.tenantId]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: t(req, "VEHICULE_NOT_FOUND") });
    }
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: t(req, "VEHICULE_UPDATE_ERROR") });
  }
});

// ----------------------------------------------------------------------------
// Sorties / missions
// ----------------------------------------------------------------------------

// GET /api/parc-auto/sorties?statut=EN_COURS&vehicule_id=...
router.get("/sorties", async (req, res) => {
  const { statut, vehicule_id } = req.query;
  try {
    const params = [req.user.tenantId];
    const filtres = [];
    if (statut) {
      params.push(statut);
      filtres.push(`s.statut = $${params.length}`);
    }
    if (vehicule_id) {
      params.push(vehicule_id);
      filtres.push(`s.vehicule_id = $${params.length}`);
    }
    const clauseFiltres = filtres.length ? ` AND ${filtres.join(" AND ")}` : "";

    const result = await db.query(
      `SELECT s.*, v.immatriculation AS vehicule_immatriculation, v.marque_modele AS vehicule_marque_modele,
              d.reference_externe AS dossier_reference
       FROM sortie_vehicule s
       JOIN vehicule v ON v.id = s.vehicule_id
       LEFT JOIN dossier_ao d ON d.id = s.dossier_ao_id
       WHERE s.tenant_id = $1${clauseFiltres}
       ORDER BY s.date_depart DESC`,
      params
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: t(req, "SORTIES_FETCH_ERROR") });
  }
});

// GET /api/parc-auto/sorties/:id
router.get("/sorties/:id", async (req, res) => {
  const { id } = req.params;
  try {
    const result = await db.query(
      `SELECT s.*, v.immatriculation AS vehicule_immatriculation, v.marque_modele AS vehicule_marque_modele,
              d.reference_externe AS dossier_reference, d.intitule AS dossier_intitule
       FROM sortie_vehicule s
       JOIN vehicule v ON v.id = s.vehicule_id
       LEFT JOIN dossier_ao d ON d.id = s.dossier_ao_id
       WHERE s.id = $1 AND s.tenant_id = $2`,
      [id, req.user.tenantId]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: t(req, "SORTIE_NOT_FOUND") });
    }
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: t(req, "SORTIE_FETCH_ERROR") });
  }
});

// POST /api/parc-auto/sorties - refuse la creation si le vehicule n'est pas
// DISPONIBLE (meme controle serveur que chez OGAA), puis bascule le
// vehicule sur EN_SORTIE.
router.post("/sorties", async (req, res) => {
  const {
    vehicule_id,
    dossier_ao_id,
    chauffeur_nom,
    chef_mission_nom,
    passagers,
    localite_depart,
    destination,
    itineraire,
    date_depart,
    kilometrage_depart,
    niveau_carburant_depart,
  } = req.body;

  if (!vehicule_id || kilometrage_depart == null) {
    return res.status(400).json({ error: t(req, "SORTIE_FIELDS_REQUIRED") });
  }

  try {
    const vehiculeResult = await db.query(
      `SELECT id, statut FROM vehicule WHERE id = $1 AND tenant_id = $2`,
      [vehicule_id, req.user.tenantId]
    );
    const vehicule = vehiculeResult.rows[0];
    if (!vehicule) {
      return res.status(404).json({ error: t(req, "VEHICULE_NOT_FOUND") });
    }
    if (vehicule.statut !== "DISPONIBLE") {
      return res.status(400).json({ error: t(req, "VEHICULE_NON_DISPONIBLE") });
    }

    if (dossier_ao_id) {
      const dossierCheck = await db.query(
        `SELECT id FROM dossier_ao WHERE id = $1 AND tenant_id = $2`,
        [dossier_ao_id, req.user.tenantId]
      );
      if (dossierCheck.rows.length === 0) {
        return res.status(404).json({ error: t(req, "DOSSIER_NOT_FOUND") });
      }
    }

    const inserted = await db.query(
      `INSERT INTO sortie_vehicule
         (tenant_id, vehicule_id, dossier_ao_id, chauffeur_nom, chef_mission_nom, passagers,
          localite_depart, destination, itineraire, date_depart, kilometrage_depart,
          niveau_carburant_depart, statut)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, COALESCE($10, now()), $11, $12, 'EN_COURS')
       RETURNING id`,
      [
        req.user.tenantId,
        vehicule_id,
        dossier_ao_id || null,
        chauffeur_nom || null,
        chef_mission_nom || null,
        passagers || null,
        localite_depart || null,
        destination || null,
        itineraire || null,
        date_depart || null,
        kilometrage_depart,
        niveau_carburant_depart || null,
      ]
    );

    await db.query(`UPDATE vehicule SET statut = 'EN_SORTIE' WHERE id = $1`, [vehicule_id]);

    const result = await db.query(
      `SELECT s.*, v.immatriculation AS vehicule_immatriculation, v.marque_modele AS vehicule_marque_modele,
              d.reference_externe AS dossier_reference
       FROM sortie_vehicule s
       JOIN vehicule v ON v.id = s.vehicule_id
       LEFT JOIN dossier_ao d ON d.id = s.dossier_ao_id
       WHERE s.id = $1`,
      [inserted.rows[0].id]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: t(req, "SORTIE_CREATE_ERROR") });
  }
});

// PATCH /api/parc-auto/sorties/:id/cloturer - calcule la distance parcourue,
// remet le vehicule a DISPONIBLE et met a jour son kilometrage actuel.
router.patch("/sorties/:id/cloturer", async (req, res) => {
  const { id } = req.params;
  const { kilometrage_retour, date_retour, observations } = req.body;

  if (kilometrage_retour == null) {
    return res.status(400).json({ error: t(req, "SORTIE_KM_RETOUR_REQUIRED") });
  }

  try {
    const sortieResult = await db.query(
      `SELECT * FROM sortie_vehicule WHERE id = $1 AND tenant_id = $2`,
      [id, req.user.tenantId]
    );
    const sortie = sortieResult.rows[0];
    if (!sortie) {
      return res.status(404).json({ error: t(req, "SORTIE_NOT_FOUND") });
    }
    if (sortie.statut === "CLOTUREE") {
      return res.status(400).json({ error: t(req, "SORTIE_DEJA_CLOTUREE") });
    }
    if (Number(kilometrage_retour) < Number(sortie.kilometrage_depart)) {
      return res.status(400).json({ error: t(req, "SORTIE_KM_RETOUR_INVALID") });
    }

    const distance = Number(kilometrage_retour) - Number(sortie.kilometrage_depart);

    const misAJour = await db.query(
      `UPDATE sortie_vehicule
       SET kilometrage_retour = $1,
           distance_parcourue = $2,
           date_retour = COALESCE($3, now()),
           observations = COALESCE($4, observations),
           statut = 'CLOTUREE'
       WHERE id = $5
       RETURNING *`,
      [kilometrage_retour, distance, date_retour || null, observations || null, id]
    );

    await db.query(
      `UPDATE vehicule SET statut = 'DISPONIBLE', kilometrage_actuel = $1 WHERE id = $2`,
      [kilometrage_retour, sortie.vehicule_id]
    );

    const result = await db.query(
      `SELECT s.*, v.immatriculation AS vehicule_immatriculation, v.marque_modele AS vehicule_marque_modele,
              d.reference_externe AS dossier_reference
       FROM sortie_vehicule s
       JOIN vehicule v ON v.id = s.vehicule_id
       LEFT JOIN dossier_ao d ON d.id = s.dossier_ao_id
       WHERE s.id = $1`,
      [misAJour.rows[0].id]
    );
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: t(req, "SORTIE_CLOTURE_ERROR") });
  }
});

module.exports = router;
