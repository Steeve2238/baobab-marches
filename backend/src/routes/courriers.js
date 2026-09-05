const express = require("express");
const db = require("../db");
const { requireAuth, requireModule, blockLectureSeule } = require("../middleware/auth");
const { t } = require("../utils/i18n");
const { rendreTemplate, construireContexte } = require("../services/courrierEngine");

const router = express.Router();
router.use(requireAuth);
router.use(requireModule("courriers"));
router.use(blockLectureSeule);

// ----------------------------------------------------------------------------
// Modeles de courriers (tenant-scope)
// ----------------------------------------------------------------------------

// GET /api/courriers/modeles
router.get("/modeles", async (req, res) => {
  const { type_courrier } = req.query;
  try {
    const result = await db.query(
      type_courrier
        ? `SELECT * FROM modele_courrier WHERE tenant_id = $1 AND type_courrier = $2 ORDER BY titre ASC`
        : `SELECT * FROM modele_courrier WHERE tenant_id = $1 ORDER BY titre ASC`,
      type_courrier ? [req.user.tenantId, type_courrier] : [req.user.tenantId]
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: t(req, "MODELES_FETCH_ERROR") });
  }
});

// POST /api/courriers/modeles
router.post("/modeles", async (req, res) => {
  const { type_courrier, titre, corps_template, declencheur_evenement } = req.body;
  if (!type_courrier || !titre || !corps_template) {
    return res.status(400).json({ error: t(req, "MODELE_FIELDS_REQUIRED") });
  }
  try {
    const result = await db.query(
      `INSERT INTO modele_courrier (tenant_id, type_courrier, titre, corps_template, declencheur_evenement)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [req.user.tenantId, type_courrier, titre, corps_template, declencheur_evenement || null]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: t(req, "MODELE_CREATE_ERROR") });
  }
});

// PATCH /api/courriers/modeles/:id
router.patch("/modeles/:id", async (req, res) => {
  const { id } = req.params;
  const { titre, corps_template, declencheur_evenement } = req.body;
  try {
    const result = await db.query(
      `UPDATE modele_courrier
       SET titre = COALESCE($1, titre),
           corps_template = COALESCE($2, corps_template),
           declencheur_evenement = COALESCE($3, declencheur_evenement)
       WHERE id = $4 AND tenant_id = $5
       RETURNING *`,
      [titre || null, corps_template || null, declencheur_evenement || null, id, req.user.tenantId]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: t(req, "MODELE_NOT_FOUND") });
    }
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: t(req, "MODELE_UPDATE_ERROR") });
  }
});

// DELETE /api/courriers/modeles/:id
router.delete("/modeles/:id", async (req, res) => {
  const { id } = req.params;
  try {
    const result = await db.query(
      `DELETE FROM modele_courrier WHERE id = $1 AND tenant_id = $2 RETURNING id`,
      [id, req.user.tenantId]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: t(req, "MODELE_NOT_FOUND") });
    }
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: t(req, "MODELE_DELETE_ERROR") });
  }
});

// ----------------------------------------------------------------------------
// Generation de courriers (rendu des variables, sans envoi)
// ----------------------------------------------------------------------------

// POST /api/courriers/dossiers/:dossierId/generer
router.post("/dossiers/:dossierId/generer", async (req, res) => {
  const { dossierId } = req.params;
  const { modele_id, variables } = req.body;

  if (!modele_id) {
    return res.status(400).json({ error: t(req, "MODELE_ID_REQUIRED") });
  }

  try {
    const dossierResult = await db.query(
      `SELECT d.*, mo.nom AS maitre_ouvrage_nom
       FROM dossier_ao d
       LEFT JOIN maitre_ouvrage mo ON mo.id = d.maitre_ouvrage_id
       WHERE d.id = $1 AND d.tenant_id = $2`,
      [dossierId, req.user.tenantId]
    );
    if (dossierResult.rows.length === 0) {
      return res.status(404).json({ error: t(req, "DOSSIER_NOT_FOUND") });
    }

    const modeleResult = await db.query(
      `SELECT * FROM modele_courrier WHERE id = $1 AND tenant_id = $2`,
      [modele_id, req.user.tenantId]
    );
    if (modeleResult.rows.length === 0) {
      return res.status(404).json({ error: t(req, "MODELE_NOT_FOUND") });
    }
    const modele = modeleResult.rows[0];

    const contexte = construireContexte(dossierResult.rows[0], variables || {});
    const titreRendu = rendreTemplate(modele.titre, contexte);
    const corpsRendu = rendreTemplate(modele.corps_template, contexte);

    res.json({
      modele_id: modele.id,
      type_courrier: modele.type_courrier,
      titre: titreRendu.rendu,
      corps: corpsRendu.rendu,
      variables_manquantes: [...new Set([...titreRendu.variablesManquantes, ...corpsRendu.variablesManquantes])],
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: t(req, "GENERATION_ERROR") });
  }
});

// ----------------------------------------------------------------------------
// Suggestions automatiques (heuristiques simples a partir de l'etat du dossier)
// ----------------------------------------------------------------------------

// GET /api/courriers/dossiers/:dossierId/suggestions
router.get("/dossiers/:dossierId/suggestions", async (req, res) => {
  const { dossierId } = req.params;
  try {
    const dossierResult = await db.query(
      `SELECT id, date_limite_soumission, statut FROM dossier_ao WHERE id = $1 AND tenant_id = $2`,
      [dossierId, req.user.tenantId]
    );
    if (dossierResult.rows.length === 0) {
      return res.status(404).json({ error: t(req, "DOSSIER_NOT_FOUND") });
    }
    const dossier = dossierResult.rows[0];

    const tachesResult = await db.query(
      `SELECT statut, date_echeance FROM chronogramme_tache WHERE dossier_ao_id = $1`,
      [dossierId]
    );

    const typesSuggeres = new Set();
    const raisons = {};

    const tachesEnRetard = tachesResult.rows.filter((tache) => tache.statut === "EN_RETARD");
    if (tachesEnRetard.length > 0) {
      typesSuggeres.add("DEMANDE_PROROGATION");
      raisons.DEMANDE_PROROGATION = `${tachesEnRetard.length} tache(s) en retard sur le chronogramme.`;
      typesSuggeres.add("RESERVE_ORDRE_SERVICE");
      raisons.RESERVE_ORDRE_SERVICE = `${tachesEnRetard.length} tache(s) en retard : envisager une reserve sur ordre de service.`;
    }

    if (dossier.date_limite_soumission && ["ANALYSE", "GO"].includes(dossier.statut)) {
      const joursRestants = Math.ceil(
        (new Date(dossier.date_limite_soumission) - new Date()) / (1000 * 60 * 60 * 24)
      );
      if (joursRestants >= 0 && joursRestants <= 5) {
        typesSuggeres.add("DEMANDE_CLARIFICATION");
        raisons.DEMANDE_CLARIFICATION = `Date limite de soumission dans ${joursRestants} jour(s) - dernier moment pour demander des clarifications.`;
      }
    }

    if (typesSuggeres.size === 0) {
      return res.json([]);
    }

    const modelesResult = await db.query(
      `SELECT * FROM modele_courrier WHERE tenant_id = $1 AND type_courrier = ANY($2::text[])`,
      [req.user.tenantId, [...typesSuggeres]]
    );

    const suggestions = modelesResult.rows.map((modele) => ({
      ...modele,
      raison: raisons[modele.type_courrier],
    }));

    res.json(suggestions);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: t(req, "SUGGESTIONS_FETCH_ERROR") });
  }
});

module.exports = router;
