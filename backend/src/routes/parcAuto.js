const express = require("express");
const db = require("../db");
const { requireAuth } = require("../middleware/auth");
const { t } = require("../utils/i18n");

const router = express.Router();
router.use(requireAuth);

// ----------------------------------------------------------------------------
// Helpers - calcul des alertes d'echeance (etape 2/3)
// ----------------------------------------------------------------------------

function joursRestants(dateCible, maintenant) {
  const diffMs = new Date(dateCible).getTime() - maintenant.getTime();
  return Math.ceil(diffMs / (1000 * 60 * 60 * 24));
}

function construireAlerte(vehicule, type, severite, details) {
  return {
    vehicule_id: vehicule.id,
    immatriculation: vehicule.immatriculation,
    marque_modele: vehicule.marque_modele,
    type,
    severite, // DEPASSEE | PROCHE
    ...details,
  };
}

function ajouterAlerteDate(alertes, vehicule, champ, type, maintenant) {
  const valeur = vehicule[champ];
  if (!valeur) return;
  const jours = joursRestants(valeur, maintenant);
  if (jours < 0) {
    alertes.push(construireAlerte(vehicule, type, "DEPASSEE", { date: valeur, jours_restants: jours }));
  } else if (jours <= 30) {
    alertes.push(construireAlerte(vehicule, type, "PROCHE", { date: valeur, jours_restants: jours }));
  }
}

// Partagee entre GET /alertes et GET /statistiques (4 alertes les plus
// urgentes du tableau de bord).
async function calculerAlertes(tenantId) {
  const result = await db.query(
    `SELECT id, immatriculation, marque_modele, statut, kilometrage_actuel,
            date_expiration_assurance, date_expiration_visite_technique,
            prochain_entretien_date, prochain_entretien_km
     FROM vehicule
     WHERE tenant_id = $1`,
    [tenantId]
  );

  const maintenant = new Date();
  const alertes = [];

  for (const vehicule of result.rows) {
    ajouterAlerteDate(alertes, vehicule, "date_expiration_assurance", "ASSURANCE", maintenant);
    ajouterAlerteDate(alertes, vehicule, "date_expiration_visite_technique", "VISITE_TECHNIQUE", maintenant);
    ajouterAlerteDate(alertes, vehicule, "prochain_entretien_date", "ENTRETIEN_DATE", maintenant);

    if (vehicule.prochain_entretien_km != null && vehicule.kilometrage_actuel != null) {
      const marge = Number(vehicule.prochain_entretien_km) - Number(vehicule.kilometrage_actuel);
      if (marge <= 0) {
        alertes.push(construireAlerte(vehicule, "ENTRETIEN_KM", "DEPASSEE", { marge_km: marge }));
      } else if (marge <= 500) {
        alertes.push(construireAlerte(vehicule, "ENTRETIEN_KM", "PROCHE", { marge_km: marge }));
      }
    }
  }

  alertes.sort((a, b) => (a.severite === b.severite ? 0 : a.severite === "DEPASSEE" ? -1 : 1));
  return alertes;
}

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

    const entretiensResult = await db.query(
      `SELECT * FROM entretien_vehicule WHERE vehicule_id = $1 ORDER BY date_entretien DESC`,
      [id]
    );

    res.json({ ...vehicule, sorties: sortiesResult.rows, entretiens: entretiensResult.rows });
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
// Permet de corriger les infos du referentiel, de basculer manuellement
// le statut vers HORS_SERVICE (ou de le remettre DISPONIBLE), et de saisir
// les echeances assurance / visite technique - les transitions DISPONIBLE
// <-> EN_SORTIE et DISPONIBLE <-> EN_ENTRETIEN, elles, sont pilotees
// automatiquement par la creation/cloture d'une sortie ou d'un entretien
// (voir plus bas), pas par cette route.
router.patch("/vehicules/:id", async (req, res) => {
  const { id } = req.params;
  const {
    immatriculation,
    marque_modele,
    affectation_service,
    statut,
    kilometrage_actuel,
    date_expiration_assurance,
    date_expiration_visite_technique,
  } = req.body;
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
           kilometrage_actuel = COALESCE($5, kilometrage_actuel),
           date_expiration_assurance = COALESCE($6, date_expiration_assurance),
           date_expiration_visite_technique = COALESCE($7, date_expiration_visite_technique)
       WHERE id = $8 AND tenant_id = $9
       RETURNING *`,
      [
        immatriculation,
        marque_modele,
        affectation_service,
        statut,
        kilometrage_actuel,
        date_expiration_assurance,
        date_expiration_visite_technique,
        id,
        req.user.tenantId,
      ]
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

// ----------------------------------------------------------------------------
// Entretiens (etape 2/3)
// ----------------------------------------------------------------------------

// GET /api/parc-auto/entretiens?vehicule_id=...&statut=...
router.get("/entretiens", async (req, res) => {
  const { vehicule_id, statut } = req.query;
  try {
    const params = [req.user.tenantId];
    const filtres = [];
    if (vehicule_id) {
      params.push(vehicule_id);
      filtres.push(`e.vehicule_id = $${params.length}`);
    }
    if (statut) {
      params.push(statut);
      filtres.push(`e.statut = $${params.length}`);
    }
    const clauseFiltres = filtres.length ? ` AND ${filtres.join(" AND ")}` : "";

    const result = await db.query(
      `SELECT e.*, v.immatriculation AS vehicule_immatriculation, v.marque_modele AS vehicule_marque_modele
       FROM entretien_vehicule e
       JOIN vehicule v ON v.id = e.vehicule_id
       WHERE e.tenant_id = $1${clauseFiltres}
       ORDER BY e.date_entretien DESC`,
      params
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: t(req, "ENTRETIENS_FETCH_ERROR") });
  }
});

// GET /api/parc-auto/entretiens/:id
router.get("/entretiens/:id", async (req, res) => {
  const { id } = req.params;
  try {
    const result = await db.query(
      `SELECT e.*, v.immatriculation AS vehicule_immatriculation, v.marque_modele AS vehicule_marque_modele
       FROM entretien_vehicule e
       JOIN vehicule v ON v.id = e.vehicule_id
       WHERE e.id = $1 AND e.tenant_id = $2`,
      [id, req.user.tenantId]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: t(req, "ENTRETIEN_NOT_FOUND") });
    }
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: t(req, "ENTRETIEN_FETCH_ERROR") });
  }
});

// POST /api/parc-auto/entretiens - si statut = EN_COURS, refuse si le
// vehicule n'est pas DISPONIBLE, puis bascule le vehicule sur EN_ENTRETIEN.
// Enregistre aussi la prochaine echeance (date/km) sur le vehicule pour
// alimenter GET /alertes.
router.post("/entretiens", async (req, res) => {
  const {
    vehicule_id,
    type_entretien,
    date_entretien,
    kilometrage,
    prestataire,
    description,
    pieces_changees,
    cout,
    prochain_entretien_date,
    prochain_entretien_km,
    statut,
  } = req.body;

  if (!vehicule_id || !type_entretien) {
    return res.status(400).json({ error: t(req, "ENTRETIEN_FIELDS_REQUIRED") });
  }
  const statutsValides = ["PLANIFIE", "EN_COURS", "TERMINE"];
  const statutFinal = statut || "PLANIFIE";
  if (!statutsValides.includes(statutFinal)) {
    return res.status(400).json({ error: t(req, "ENTRETIEN_STATUT_INVALID") });
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
    if (statutFinal === "EN_COURS" && vehicule.statut !== "DISPONIBLE") {
      return res.status(400).json({ error: t(req, "VEHICULE_NON_DISPONIBLE") });
    }

    const inserted = await db.query(
      `INSERT INTO entretien_vehicule
         (tenant_id, vehicule_id, type_entretien, date_entretien, kilometrage, prestataire,
          description, pieces_changees, cout, prochain_entretien_date, prochain_entretien_km, statut)
       VALUES ($1, $2, $3, COALESCE($4, CURRENT_DATE), $5, $6, $7, $8, $9, $10, $11, $12)
       RETURNING id`,
      [
        req.user.tenantId,
        vehicule_id,
        type_entretien,
        date_entretien || null,
        kilometrage || null,
        prestataire || null,
        description || null,
        pieces_changees || null,
        cout || null,
        prochain_entretien_date || null,
        prochain_entretien_km || null,
        statutFinal,
      ]
    );

    if (statutFinal === "EN_COURS") {
      await db.query(`UPDATE vehicule SET statut = 'EN_ENTRETIEN' WHERE id = $1`, [vehicule_id]);
    }
    if (prochain_entretien_date || prochain_entretien_km) {
      await db.query(
        `UPDATE vehicule
         SET prochain_entretien_date = COALESCE($1, prochain_entretien_date),
             prochain_entretien_km = COALESCE($2, prochain_entretien_km)
         WHERE id = $3`,
        [prochain_entretien_date || null, prochain_entretien_km || null, vehicule_id]
      );
    }

    const result = await db.query(
      `SELECT e.*, v.immatriculation AS vehicule_immatriculation, v.marque_modele AS vehicule_marque_modele
       FROM entretien_vehicule e
       JOIN vehicule v ON v.id = e.vehicule_id
       WHERE e.id = $1`,
      [inserted.rows[0].id]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: t(req, "ENTRETIEN_CREATE_ERROR") });
  }
});

// PATCH /api/parc-auto/entretiens/:id - gere les transitions du vehicule :
// passage a EN_COURS -> vehicule EN_ENTRETIEN (refuse si pas DISPONIBLE) ;
// passage a TERMINE alors que le vehicule est EN_ENTRETIEN -> vehicule
// remis a DISPONIBLE.
router.patch("/entretiens/:id", async (req, res) => {
  const { id } = req.params;
  const {
    type_entretien,
    date_entretien,
    kilometrage,
    prestataire,
    description,
    pieces_changees,
    cout,
    prochain_entretien_date,
    prochain_entretien_km,
    statut,
  } = req.body;

  const statutsValides = ["PLANIFIE", "EN_COURS", "TERMINE"];
  if (statut && !statutsValides.includes(statut)) {
    return res.status(400).json({ error: t(req, "ENTRETIEN_STATUT_INVALID") });
  }

  try {
    const existantResult = await db.query(
      `SELECT * FROM entretien_vehicule WHERE id = $1 AND tenant_id = $2`,
      [id, req.user.tenantId]
    );
    const existant = existantResult.rows[0];
    if (!existant) {
      return res.status(404).json({ error: t(req, "ENTRETIEN_NOT_FOUND") });
    }

    if (statut === "EN_COURS" && existant.statut !== "EN_COURS") {
      const vehiculeResult = await db.query(`SELECT statut FROM vehicule WHERE id = $1`, [existant.vehicule_id]);
      const vehicule = vehiculeResult.rows[0];
      if (vehicule && vehicule.statut !== "DISPONIBLE") {
        return res.status(400).json({ error: t(req, "VEHICULE_NON_DISPONIBLE") });
      }
    }

    const misAJour = await db.query(
      `UPDATE entretien_vehicule
       SET type_entretien = COALESCE($1, type_entretien),
           date_entretien = COALESCE($2, date_entretien),
           kilometrage = COALESCE($3, kilometrage),
           prestataire = COALESCE($4, prestataire),
           description = COALESCE($5, description),
           pieces_changees = COALESCE($6, pieces_changees),
           cout = COALESCE($7, cout),
           prochain_entretien_date = COALESCE($8, prochain_entretien_date),
           prochain_entretien_km = COALESCE($9, prochain_entretien_km),
           statut = COALESCE($10, statut)
       WHERE id = $11
       RETURNING id`,
      [
        type_entretien || null,
        date_entretien || null,
        kilometrage || null,
        prestataire || null,
        description || null,
        pieces_changees || null,
        cout || null,
        prochain_entretien_date || null,
        prochain_entretien_km || null,
        statut || null,
        id,
      ]
    );

    if (statut === "EN_COURS" && existant.statut !== "EN_COURS") {
      await db.query(`UPDATE vehicule SET statut = 'EN_ENTRETIEN' WHERE id = $1`, [existant.vehicule_id]);
    }
    if (statut === "TERMINE" && existant.statut !== "TERMINE") {
      const vehiculeResult = await db.query(`SELECT statut FROM vehicule WHERE id = $1`, [existant.vehicule_id]);
      if (vehiculeResult.rows[0] && vehiculeResult.rows[0].statut === "EN_ENTRETIEN") {
        await db.query(`UPDATE vehicule SET statut = 'DISPONIBLE' WHERE id = $1`, [existant.vehicule_id]);
      }
    }
    if (prochain_entretien_date || prochain_entretien_km) {
      await db.query(
        `UPDATE vehicule
         SET prochain_entretien_date = COALESCE($1, prochain_entretien_date),
             prochain_entretien_km = COALESCE($2, prochain_entretien_km)
         WHERE id = $3`,
        [prochain_entretien_date || null, prochain_entretien_km || null, existant.vehicule_id]
      );
    }

    const result = await db.query(
      `SELECT e.*, v.immatriculation AS vehicule_immatriculation, v.marque_modele AS vehicule_marque_modele
       FROM entretien_vehicule e
       JOIN vehicule v ON v.id = e.vehicule_id
       WHERE e.id = $1`,
      [misAJour.rows[0].id]
    );
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: t(req, "ENTRETIEN_UPDATE_ERROR") });
  }
});

// ----------------------------------------------------------------------------
// Alertes d'echeance (etape 2/3)
// ----------------------------------------------------------------------------

// GET /api/parc-auto/alertes - assurance / visite technique (echues ou a
// moins de 30 jours) + entretien programme (echu ou a moins de 30 jours /
// 500 km).
router.get("/alertes", async (req, res) => {
  try {
    const alertes = await calculerAlertes(req.user.tenantId);
    res.json(alertes);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: t(req, "ALERTES_FETCH_ERROR") });
  }
});

// ----------------------------------------------------------------------------
// Statistiques (etape 3/3)
// ----------------------------------------------------------------------------

// GET /api/parc-auto/statistiques - tableau de bord Parc Auto : vehicules
// par statut, kilometrage du mois en cours, stats par vehicule (sorties,
// distance, cout d'entretien cumule), stats par localite de depart, et les
// 4 alertes les plus urgentes.
router.get("/statistiques", async (req, res) => {
  try {
    const tenantId = req.user.tenantId;

    const parStatutResult = await db.query(
      `SELECT statut, COUNT(*)::int AS total FROM vehicule WHERE tenant_id = $1 GROUP BY statut`,
      [tenantId]
    );
    const vehiculesParStatut = { DISPONIBLE: 0, EN_SORTIE: 0, EN_ENTRETIEN: 0, HORS_SERVICE: 0 };
    for (const row of parStatutResult.rows) {
      vehiculesParStatut[row.statut] = row.total;
    }

    const kmMoisResult = await db.query(
      `SELECT COALESCE(SUM(distance_parcourue), 0) AS total
       FROM sortie_vehicule
       WHERE tenant_id = $1 AND statut = 'CLOTUREE'
         AND date_retour >= date_trunc('month', CURRENT_DATE)
         AND date_retour < date_trunc('month', CURRENT_DATE) + interval '1 month'`,
      [tenantId]
    );

    const parVehiculeResult = await db.query(
      `SELECT v.id AS vehicule_id, v.immatriculation, v.marque_modele,
              COUNT(s.id)::int AS nombre_sorties,
              COALESCE(SUM(s.distance_parcourue), 0) AS distance_totale,
              COALESCE((SELECT SUM(cout) FROM entretien_vehicule e WHERE e.vehicule_id = v.id), 0) AS cout_entretien_total
       FROM vehicule v
       LEFT JOIN sortie_vehicule s ON s.vehicule_id = v.id AND s.statut = 'CLOTUREE'
       WHERE v.tenant_id = $1
       GROUP BY v.id, v.immatriculation, v.marque_modele
       ORDER BY distance_totale DESC`,
      [tenantId]
    );

    const parLocaliteResult = await db.query(
      `SELECT localite_depart, COUNT(*)::int AS nombre_sorties, COALESCE(SUM(distance_parcourue), 0) AS distance_totale
       FROM sortie_vehicule
       WHERE tenant_id = $1 AND localite_depart IS NOT NULL AND localite_depart <> ''
       GROUP BY localite_depart
       ORDER BY nombre_sorties DESC`,
      [tenantId]
    );

    const alertes = await calculerAlertes(tenantId);

    res.json({
      vehicules_par_statut: vehiculesParStatut,
      kilometrage_mois_courant: kmMoisResult.rows[0].total,
      par_vehicule: parVehiculeResult.rows,
      par_localite: parLocaliteResult.rows,
      alertes_urgentes: alertes.slice(0, 4),
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: t(req, "STATISTIQUES_FETCH_ERROR") });
  }
});

module.exports = router;
