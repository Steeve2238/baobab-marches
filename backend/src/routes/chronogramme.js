const express = require("express");
const db = require("../db");
const { requireAuth } = require("../middleware/auth");
const { t } = require("../utils/i18n");
const { genererChronogrammeStandard } = require("../services/chronogrammeEngine");

const router = express.Router();
router.use(requireAuth);

// POST /api/chronogramme/:dossierId/generer - genere automatiquement le
// retro-planning standard (phases AVANT_SOUMISSION + ATTRIBUTION_EXECUTION,
// voir services/chronogrammeEngine.js) a partir des dates du dossier et des
// clauses deja extraites. Ne genere pas deux fois par erreur : si des taches
// existent deja pour ce dossier, renvoie une erreur sauf si ?force=true est
// passe (utile si le dossier a ete corrige apres une premiere generation -
// les anciennes taches sont alors supprimees puis remplacees).
router.post("/:dossierId/generer", async (req, res) => {
  const { dossierId } = req.params;
  const force = req.query.force === "true";

  try {
    const dossierResult = await db.query(
      `SELECT * FROM dossier_ao WHERE id = $1 AND tenant_id = $2`,
      [dossierId, req.user.tenantId]
    );
    const dossier = dossierResult.rows[0];
    if (!dossier) {
      return res.status(404).json({ error: t(req, "DOSSIER_NOT_FOUND") });
    }

    const existantResult = await db.query(
      `SELECT id FROM chronogramme_tache WHERE dossier_ao_id = $1 LIMIT 1`,
      [dossierId]
    );
    if (existantResult.rows.length > 0 && !force) {
      return res.status(409).json({ error: t(req, "CHRONOGRAMME_ALREADY_EXISTS") });
    }

    const clausesResult = await db.query(
      `SELECT * FROM clause_extraite WHERE dossier_ao_id = $1`,
      [dossierId]
    );

    let taches;
    try {
      taches = genererChronogrammeStandard(dossier, clausesResult.rows);
    } catch (err) {
      if (err.message === "DATE_LIMITE_SOUMISSION_REQUISE") {
        return res.status(400).json({ error: t(req, "CHRONOGRAMME_DATE_LIMITE_REQUISE") });
      }
      throw err;
    }

    if (force && existantResult.rows.length > 0) {
      await db.query(`DELETE FROM chronogramme_tache WHERE dossier_ao_id = $1`, [dossierId]);
    }

    const inserees = [];
    for (const tache of taches) {
      const result = await db.query(
        `INSERT INTO chronogramme_tache
           (dossier_ao_id, phase, intitule, jalon_relatif, date_echeance, statut, ordre_affichage)
         VALUES ($1, $2, $3, $4, $5, 'A_FAIRE', $6)
         RETURNING *`,
        [dossierId, tache.phase, tache.intitule, tache.jalon_relatif, tache.date_echeance, tache.ordre_affichage]
      );
      inserees.push(result.rows[0]);
    }

    res.status(201).json(inserees);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: t(req, "CHRONOGRAMME_GENERATE_ERROR") });
  }
});

// POST /api/chronogramme/:dossierId/taches - ajouter une tache au chronogramme
router.post("/:dossierId/taches", async (req, res) => {
  const { dossierId } = req.params;
  const { phase, intitule, jalon_relatif, date_echeance, role_porteur_id, document_attendu, ordre_affichage } = req.body;

  if (!phase || !intitule) {
    return res.status(400).json({ error: t(req, "TACHE_FIELDS_REQUIRED") });
  }

  try {
    // Verifie que le dossier appartient bien au tenant courant
    const dossierCheck = await db.query(
      `SELECT id FROM dossier_ao WHERE id = $1 AND tenant_id = $2`,
      [dossierId, req.user.tenantId]
    );
    if (dossierCheck.rows.length === 0) {
      return res.status(404).json({ error: t(req, "DOSSIER_NOT_FOUND") });
    }

    const result = await db.query(
      `INSERT INTO chronogramme_tache
         (dossier_ao_id, phase, intitule, jalon_relatif, date_echeance, role_porteur_id, document_attendu, statut, ordre_affichage)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'A_FAIRE', COALESCE($8, 0))
       RETURNING *`,
      [dossierId, phase, intitule, jalon_relatif || null, date_echeance || null, role_porteur_id || null, document_attendu || null, ordre_affichage]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: t(req, "TACHE_CREATE_ERROR") });
  }
});

// PATCH /api/chronogramme/taches/:id - mise a jour de statut d'une tache
router.patch("/taches/:id", async (req, res) => {
  const { id } = req.params;
  const { statut } = req.body;
  const statutsValides = ["A_FAIRE", "EN_COURS", "FAIT", "EN_RETARD"];
  if (!statutsValides.includes(statut)) {
    return res.status(400).json({ error: t(req, "STATUT_INVALID") });
  }

  try {
    const result = await db.query(
      `UPDATE chronogramme_tache ct
       SET statut = $1
       FROM dossier_ao d
       WHERE ct.id = $2 AND ct.dossier_ao_id = d.id AND d.tenant_id = $3
       RETURNING ct.*`,
      [statut, id, req.user.tenantId]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: t(req, "TACHE_NOT_FOUND") });
    }
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: t(req, "TACHE_STATUT_UPDATE_ERROR") });
  }
});

module.exports = router;
