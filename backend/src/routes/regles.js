const express = require("express");
const db = require("../db");
const { requireAuth } = require("../middleware/auth");
const { t } = require("../utils/i18n");
const { evaluerExpression, validerExpression } = require("../services/regleEngine");

const router = express.Router();
router.use(requireAuth);

// ----------------------------------------------------------------------------
// regle_formule (tenant-scope) — les formules elles-memes (ex: cout d'une
// facilite bancaire, revision de prix, penalite de retard...)
// ----------------------------------------------------------------------------

// GET /api/regles/formules - liste des formules du tenant, filtrable par code
router.get("/formules", async (req, res) => {
  const { code } = req.query;
  try {
    const result = await db.query(
      code
        ? `SELECT * FROM regle_formule WHERE tenant_id = $1 AND code = $2 ORDER BY libelle ASC`
        : `SELECT * FROM regle_formule WHERE tenant_id = $1 ORDER BY libelle ASC`,
      code ? [req.user.tenantId, code] : [req.user.tenantId]
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: t(req, "REGLES_FETCH_ERROR") });
  }
});

// POST /api/regles/formules - creation d'une formule
router.post("/formules", async (req, res) => {
  const { code, libelle, expression, description } = req.body;
  if (!code || !libelle || !expression) {
    return res.status(400).json({ error: t(req, "REGLE_FIELDS_REQUIRED") });
  }

  const validite = validerExpression(expression);
  if (!validite.valide) {
    return res.status(400).json({ error: `${t(req, "REGLE_EXPRESSION_INVALID")} (${validite.erreur})` });
  }

  try {
    const result = await db.query(
      `INSERT INTO regle_formule (tenant_id, code, libelle, expression, description)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [req.user.tenantId, code, libelle, expression, description || null]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: t(req, "REGLE_CREATE_ERROR") });
  }
});

// PATCH /api/regles/formules/:id - edition d'une formule existante
router.patch("/formules/:id", async (req, res) => {
  const { id } = req.params;
  const { libelle, expression, description } = req.body;

  if (expression) {
    const validite = validerExpression(expression);
    if (!validite.valide) {
      return res.status(400).json({ error: `${t(req, "REGLE_EXPRESSION_INVALID")} (${validite.erreur})` });
    }
  }

  try {
    const result = await db.query(
      `UPDATE regle_formule
       SET libelle = COALESCE($1, libelle),
           expression = COALESCE($2, expression),
           description = COALESCE($3, description)
       WHERE id = $4 AND tenant_id = $5
       RETURNING *`,
      [libelle || null, expression || null, description || null, id, req.user.tenantId]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: t(req, "REGLE_NOT_FOUND") });
    }
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: t(req, "REGLE_UPDATE_ERROR") });
  }
});

// POST /api/regles/tester - evalue une expression a la volee (sans la sauver),
// utile pour valider une formule cote UI avant enregistrement.
router.post("/tester", (req, res) => {
  const { expression, variables } = req.body;
  if (!expression) {
    return res.status(400).json({ error: t(req, "REGLE_EXPRESSION_REQUIRED") });
  }
  try {
    const resultat = evaluerExpression(expression, variables || {});
    res.json({ resultat });
  } catch (err) {
    res.status(400).json({ error: `${t(req, "REGLE_EXPRESSION_INVALID")} (${err.message})` });
  }
});

// ----------------------------------------------------------------------------
// regle_parametre (dossier_ao-scope) — valeurs des variables d'une formule
// pour un dossier donne (ex: taux de penalite specifique a ce marche)
// ----------------------------------------------------------------------------

// GET /api/regles/dossiers/:dossierId/parametres
router.get("/dossiers/:dossierId/parametres", async (req, res) => {
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
      `SELECT rp.*, rf.code AS regle_code, rf.libelle AS regle_libelle, rf.expression
       FROM regle_parametre rp
       JOIN regle_formule rf ON rf.id = rp.regle_formule_id
       WHERE rp.dossier_ao_id = $1`,
      [dossierId]
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: t(req, "REGLES_FETCH_ERROR") });
  }
});

// POST /api/regles/dossiers/:dossierId/parametres - associe une formule +
// ses valeurs de parametres a un dossier
router.post("/dossiers/:dossierId/parametres", async (req, res) => {
  const { dossierId } = req.params;
  const { regle_formule_id, parametres_json } = req.body;

  if (!regle_formule_id) {
    return res.status(400).json({ error: t(req, "REGLE_FORMULE_ID_REQUIRED") });
  }

  try {
    const dossierCheck = await db.query(
      `SELECT id FROM dossier_ao WHERE id = $1 AND tenant_id = $2`,
      [dossierId, req.user.tenantId]
    );
    if (dossierCheck.rows.length === 0) {
      return res.status(404).json({ error: t(req, "DOSSIER_NOT_FOUND") });
    }

    const result = await db.query(
      `INSERT INTO regle_parametre (dossier_ao_id, regle_formule_id, parametres_json)
       VALUES ($1, $2, $3)
       RETURNING *`,
      [dossierId, regle_formule_id, parametres_json || {}]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: t(req, "REGLE_PARAMETRE_CREATE_ERROR") });
  }
});

// PATCH /api/regles/parametres/:id - met a jour les valeurs de parametres
router.patch("/parametres/:id", async (req, res) => {
  const { id } = req.params;
  const { parametres_json } = req.body;

  try {
    const result = await db.query(
      `UPDATE regle_parametre rp
       SET parametres_json = $1
       FROM dossier_ao d
       WHERE rp.id = $2 AND rp.dossier_ao_id = d.id AND d.tenant_id = $3
       RETURNING rp.*`,
      [parametres_json || {}, id, req.user.tenantId]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: t(req, "REGLE_PARAMETRE_NOT_FOUND") });
    }
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: t(req, "REGLE_PARAMETRE_UPDATE_ERROR") });
  }
});

module.exports = router;
