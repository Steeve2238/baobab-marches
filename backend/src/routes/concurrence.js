const express = require("express");
const db = require("../db");
const { v4: uuidv4 } = require("uuid");
const { requireAuth, requireModule } = require("../middleware/auth");
const { t } = require("../utils/i18n");

const router = express.Router();
router.use(requireAuth);
router.use(requireModule("marches"));

// ----------------------------------------------------------------------------
// Module 7 - Intelligence concurrentielle & juridique
// Donnees de reference (comme fournisseur / maitre_ouvrage) : ouvertes a tout
// utilisateur authentifie du tenant, pas de restriction de role.
// ----------------------------------------------------------------------------

// ----------------------------------------------------------------------------
// Historique des offres concurrentes
// ----------------------------------------------------------------------------

// GET /api/concurrence/historique?maitre_ouvrage_id=...
router.get("/historique", async (req, res) => {
  const { maitre_ouvrage_id } = req.query;
  try {
    const params = [req.user.tenantId];
    let filtre = "";
    if (maitre_ouvrage_id) {
      params.push(maitre_ouvrage_id);
      filtre = ` AND h.maitre_ouvrage_id = $${params.length}`;
    }
    const result = await db.query(
      `SELECT h.*, mo.nom AS maitre_ouvrage_nom
       FROM offre_concurrente_historique h
       LEFT JOIN maitre_ouvrage mo ON mo.id = h.maitre_ouvrage_id
       WHERE h.tenant_id = $1${filtre}
       ORDER BY h.date_observation DESC NULLS LAST`,
      params
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: t(req, "HISTORIQUE_CONCURRENT_FETCH_ERROR") });
  }
});

// POST /api/concurrence/historique
router.post("/historique", async (req, res) => {
  const {
    dossier_ao_reference,
    maitre_ouvrage_id,
    concurrent_nom,
    montant_offre,
    resultat,
    motif_echec,
    date_observation,
  } = req.body;

  if (!concurrent_nom) {
    return res.status(400).json({ error: t(req, "HISTORIQUE_CONCURRENT_NOM_REQUIRED") });
  }

  try {
    const inserted = await db.query(
      `INSERT INTO offre_concurrente_historique
         (id, tenant_id, dossier_ao_reference, maitre_ouvrage_id, concurrent_nom,
          montant_offre, resultat, motif_echec, date_observation)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING id`,
      [
        uuidv4(),
        req.user.tenantId,
        dossier_ao_reference || null,
        maitre_ouvrage_id || null,
        concurrent_nom,
        montant_offre || null,
        resultat || null,
        motif_echec || null,
        date_observation || null,
      ]
    );

    // On renvoie la ligne enrichie (nom du maitre d'ouvrage) plutot que la
    // ligne brute, pour que le front n'ait pas besoin de recharger toute la
    // liste pour afficher cette information (meme principe que fournisseurs.js).
    const result = await db.query(
      `SELECT h.*, mo.nom AS maitre_ouvrage_nom
       FROM offre_concurrente_historique h
       LEFT JOIN maitre_ouvrage mo ON mo.id = h.maitre_ouvrage_id
       WHERE h.id = $1`,
      [inserted.rows[0].id]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: t(req, "HISTORIQUE_CONCURRENT_CREATE_ERROR") });
  }
});

// PATCH /api/concurrence/historique/:id
router.patch("/historique/:id", async (req, res) => {
  const { id } = req.params;
  const {
    dossier_ao_reference,
    maitre_ouvrage_id,
    concurrent_nom,
    montant_offre,
    resultat,
    motif_echec,
    date_observation,
  } = req.body;

  try {
    const updated = await db.query(
      `UPDATE offre_concurrente_historique
       SET dossier_ao_reference = COALESCE($1, dossier_ao_reference),
           maitre_ouvrage_id = COALESCE($2, maitre_ouvrage_id),
           concurrent_nom = COALESCE($3, concurrent_nom),
           montant_offre = COALESCE($4, montant_offre),
           resultat = COALESCE($5, resultat),
           motif_echec = COALESCE($6, motif_echec),
           date_observation = COALESCE($7, date_observation)
       WHERE id = $8 AND tenant_id = $9
       RETURNING id`,
      [
        dossier_ao_reference,
        maitre_ouvrage_id,
        concurrent_nom,
        montant_offre,
        resultat,
        motif_echec,
        date_observation,
        id,
        req.user.tenantId,
      ]
    );
    if (updated.rows.length === 0) {
      return res.status(404).json({ error: t(req, "HISTORIQUE_CONCURRENT_NOT_FOUND") });
    }
    const result = await db.query(
      `SELECT h.*, mo.nom AS maitre_ouvrage_nom
       FROM offre_concurrente_historique h
       LEFT JOIN maitre_ouvrage mo ON mo.id = h.maitre_ouvrage_id
       WHERE h.id = $1`,
      [updated.rows[0].id]
    );
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: t(req, "HISTORIQUE_CONCURRENT_UPDATE_ERROR") });
  }
});

// DELETE /api/concurrence/historique/:id
router.delete("/historique/:id", async (req, res) => {
  const { id } = req.params;
  try {
    const result = await db.query(
      `DELETE FROM offre_concurrente_historique WHERE id = $1 AND tenant_id = $2 RETURNING id`,
      [id, req.user.tenantId]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: t(req, "HISTORIQUE_CONCURRENT_NOT_FOUND") });
    }
    res.status(204).send();
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: t(req, "HISTORIQUE_CONCURRENT_DELETE_ERROR") });
  }
});

// ----------------------------------------------------------------------------
// Bibliotheque de clauses a risque
// ----------------------------------------------------------------------------

// GET /api/concurrence/clauses-risque?maitre_ouvrage_id=...
router.get("/clauses-risque", async (req, res) => {
  const { maitre_ouvrage_id } = req.query;
  try {
    const params = [req.user.tenantId];
    let filtre = "";
    if (maitre_ouvrage_id) {
      params.push(maitre_ouvrage_id);
      filtre = ` AND c.maitre_ouvrage_id = $${params.length}`;
    }
    const result = await db.query(
      `SELECT c.*, mo.nom AS maitre_ouvrage_nom
       FROM clause_risque_bibliotheque c
       LEFT JOIN maitre_ouvrage mo ON mo.id = c.maitre_ouvrage_id
       WHERE c.tenant_id = $1${filtre}
       ORDER BY c.occurrences DESC, mo.nom ASC NULLS LAST`,
      params
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: t(req, "CLAUSE_RISQUE_FETCH_ERROR") });
  }
});

// POST /api/concurrence/clauses-risque
router.post("/clauses-risque", async (req, res) => {
  const { maitre_ouvrage_id, pattern_description, niveau_risque, type_clause, occurrences } = req.body;

  if (!pattern_description) {
    return res.status(400).json({ error: t(req, "CLAUSE_RISQUE_DESCRIPTION_REQUIRED") });
  }

  try {
    const inserted = await db.query(
      `INSERT INTO clause_risque_bibliotheque
         (id, tenant_id, maitre_ouvrage_id, pattern_description, niveau_risque, type_clause, occurrences)
       VALUES ($1, $2, $3, $4, COALESCE($5, 'MOYEN'), $6, COALESCE($7, 1))
       RETURNING id`,
      [
        uuidv4(),
        req.user.tenantId,
        maitre_ouvrage_id || null,
        pattern_description,
        niveau_risque || null,
        type_clause || null,
        occurrences || null,
      ]
    );

    // Meme principe que /historique : on renvoie la ligne enrichie (nom du
    // maitre d'ouvrage) pour eviter au front de recharger toute la liste.
    const result = await db.query(
      `SELECT c.*, mo.nom AS maitre_ouvrage_nom
       FROM clause_risque_bibliotheque c
       LEFT JOIN maitre_ouvrage mo ON mo.id = c.maitre_ouvrage_id
       WHERE c.id = $1`,
      [inserted.rows[0].id]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: t(req, "CLAUSE_RISQUE_CREATE_ERROR") });
  }
});

// PATCH /api/concurrence/clauses-risque/:id
router.patch("/clauses-risque/:id", async (req, res) => {
  const { id } = req.params;
  const { maitre_ouvrage_id, pattern_description, niveau_risque, type_clause, occurrences } = req.body;

  try {
    const updated = await db.query(
      `UPDATE clause_risque_bibliotheque
       SET maitre_ouvrage_id = COALESCE($1, maitre_ouvrage_id),
           pattern_description = COALESCE($2, pattern_description),
           niveau_risque = COALESCE($3, niveau_risque),
           type_clause = COALESCE($4, type_clause),
           occurrences = COALESCE($5, occurrences)
       WHERE id = $6 AND tenant_id = $7
       RETURNING id`,
      [maitre_ouvrage_id, pattern_description, niveau_risque, type_clause, occurrences, id, req.user.tenantId]
    );
    if (updated.rows.length === 0) {
      return res.status(404).json({ error: t(req, "CLAUSE_RISQUE_NOT_FOUND") });
    }
    const result = await db.query(
      `SELECT c.*, mo.nom AS maitre_ouvrage_nom
       FROM clause_risque_bibliotheque c
       LEFT JOIN maitre_ouvrage mo ON mo.id = c.maitre_ouvrage_id
       WHERE c.id = $1`,
      [updated.rows[0].id]
    );
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: t(req, "CLAUSE_RISQUE_UPDATE_ERROR") });
  }
});

// DELETE /api/concurrence/clauses-risque/:id
router.delete("/clauses-risque/:id", async (req, res) => {
  const { id } = req.params;
  try {
    const result = await db.query(
      `DELETE FROM clause_risque_bibliotheque WHERE id = $1 AND tenant_id = $2 RETURNING id`,
      [id, req.user.tenantId]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: t(req, "CLAUSE_RISQUE_NOT_FOUND") });
    }
    res.status(204).send();
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: t(req, "CLAUSE_RISQUE_DELETE_ERROR") });
  }
});

// POST /api/concurrence/clauses-risque/signaler
// Raccourci Module 1 -> Module 7 : depuis une clause deja extraite d'un
// dossier, on "signale" qu'elle constitue un motif recurrent. On regroupe
// automatiquement par (tenant, maitre_ouvrage_id, type_clause) : si un
// pattern existe deja pour ce maitre d'ouvrage et ce type de clause, on
// incremente son compteur d'occurrences ; sinon on cree une nouvelle entree.
router.post("/clauses-risque/signaler", async (req, res) => {
  const { dossier_ao_id, type_clause, libelle } = req.body;

  if (!dossier_ao_id || !type_clause || !libelle) {
    return res.status(400).json({ error: t(req, "CLAUSE_RISQUE_SIGNALER_FIELDS_REQUIRED") });
  }

  try {
    const dossierResult = await db.query(
      `SELECT id, maitre_ouvrage_id FROM dossier_ao WHERE id = $1 AND tenant_id = $2`,
      [dossier_ao_id, req.user.tenantId]
    );
    const dossier = dossierResult.rows[0];
    if (!dossier) {
      return res.status(404).json({ error: t(req, "DOSSIER_NOT_FOUND") });
    }
    if (!dossier.maitre_ouvrage_id) {
      return res.status(400).json({ error: t(req, "CLAUSE_RISQUE_SIGNALER_NO_MAITRE_OUVRAGE") });
    }

    const existant = await db.query(
      `SELECT * FROM clause_risque_bibliotheque
       WHERE tenant_id = $1 AND maitre_ouvrage_id = $2 AND type_clause = $3`,
      [req.user.tenantId, dossier.maitre_ouvrage_id, type_clause]
    );

    if (existant.rows.length > 0) {
      const misAJour = await db.query(
        `UPDATE clause_risque_bibliotheque
         SET occurrences = occurrences + 1, pattern_description = $1
         WHERE id = $2
         RETURNING *`,
        [libelle, existant.rows[0].id]
      );
      return res.json({ clause: misAJour.rows[0], cree: false });
    }

    const cree = await db.query(
      `INSERT INTO clause_risque_bibliotheque
         (id, tenant_id, maitre_ouvrage_id, pattern_description, niveau_risque, type_clause, occurrences)
       VALUES ($1, $2, $3, $4, 'MOYEN', $5, 1)
       RETURNING *`,
      [uuidv4(), req.user.tenantId, dossier.maitre_ouvrage_id, libelle, type_clause]
    );
    res.status(201).json({ clause: cree.rows[0], cree: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: t(req, "CLAUSE_RISQUE_SIGNALER_ERROR") });
  }
});

module.exports = router;
