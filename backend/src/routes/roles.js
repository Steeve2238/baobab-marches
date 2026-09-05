const express = require("express");
const db = require("../db");
const { v4: uuidv4 } = require("uuid");
const { requireAuth, requireRole } = require("../middleware/auth");
const { t } = require("../utils/i18n");

const router = express.Router();
router.use(requireAuth);

// GET /api/roles - liste des roles du tenant (avec nombre de titulaires).
// Ouvert a tout utilisateur authentifie : necessaire pour peupler les menus
// d'affectation de taches (chronogramme) partout dans l'application, pas
// seulement dans l'ecran d'administration des roles.
router.get("/", async (req, res) => {
  try {
    const result = await db.query(
      `SELECT r.*, COUNT(ur.utilisateur_id) AS nombre_utilisateurs
       FROM role r
       LEFT JOIN utilisateur_role ur ON ur.role_id = r.id
       WHERE r.tenant_id = $1
       GROUP BY r.id
       ORDER BY r.libelle ASC`,
      [req.user.tenantId]
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: t(req, "ROLES_FETCH_ERROR") });
  }
});

// POST /api/roles - creation d'un role (reserve ADMIN). Les roles sont
// librement definis par tenant (section 3 du CDC) : pas de liste figee cote
// code, chaque entreprise cliente de la plateforme organise les siens.
router.post("/", requireRole("ADMIN"), async (req, res) => {
  const { code, libelle, perimetre_json, lecture_seule, validateur_universel } = req.body;
  if (!code || !libelle) {
    return res.status(400).json({ error: t(req, "ROLE_FIELDS_REQUIRED") });
  }

  try {
    const result = await db.query(
      `INSERT INTO role (id, tenant_id, code, libelle, perimetre_json, lecture_seule, validateur_universel)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [
        uuidv4(),
        req.user.tenantId,
        code.trim().toUpperCase().replace(/\s+/g, "_"),
        libelle.trim(),
        perimetre_json || {},
        lecture_seule || false,
        validateur_universel || false,
      ]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    if (err.code === "23505") {
      return res.status(409).json({ error: t(req, "ROLE_CODE_ALREADY_EXISTS") });
    }
    console.error(err);
    res.status(500).json({ error: t(req, "ROLE_CREATE_ERROR") });
  }
});

// PATCH /api/roles/:id - modification (libelle / perimetre / lecture seule).
// Le code n'est pas modifiable ici : il n'est jamais interprete par le code
// applicatif (seul l'id compte pour les references), le changer apporterait
// de la confusion sans benefice reel.
router.patch("/:id", requireRole("ADMIN"), async (req, res) => {
  const { id } = req.params;
  const { libelle, perimetre_json, lecture_seule, validateur_universel } = req.body;

  try {
    const result = await db.query(
      `UPDATE role
       SET libelle = COALESCE($1, libelle),
           perimetre_json = COALESCE($2, perimetre_json),
           lecture_seule = COALESCE($3, lecture_seule),
           validateur_universel = COALESCE($4, validateur_universel)
       WHERE id = $5 AND tenant_id = $6
       RETURNING *`,
      [
        libelle || null,
        perimetre_json || null,
        lecture_seule != null ? lecture_seule : null,
        validateur_universel != null ? validateur_universel : null,
        id,
        req.user.tenantId,
      ]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: t(req, "ROLE_NOT_FOUND") });
    }
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: t(req, "ROLE_UPDATE_ERROR") });
  }
});

// DELETE /api/roles/:id - suppression, bloquee si le role est encore
// detenu par au moins un utilisateur (sinon la suppression le retirerait
// silencieusement de tout le monde - utilisateur_role est en CASCADE) ou
// encore reference par une tache de chronogramme (la contrainte de cle
// etrangere sur chronogramme_tache.role_porteur_id refuse alors elle-meme
// la suppression, on se contente d'intercepter l'erreur pour un message
// clair plutot qu'un 500 brut).
router.delete("/:id", requireRole("ADMIN"), async (req, res) => {
  const { id } = req.params;
  try {
    const roleCheck = await db.query(`SELECT id FROM role WHERE id = $1 AND tenant_id = $2`, [
      id,
      req.user.tenantId,
    ]);
    if (roleCheck.rows.length === 0) {
      return res.status(404).json({ error: t(req, "ROLE_NOT_FOUND") });
    }

    const titulaires = await db.query(
      `SELECT 1 FROM utilisateur_role WHERE role_id = $1 LIMIT 1`,
      [id]
    );
    if (titulaires.rows.length > 0) {
      return res.status(409).json({ error: t(req, "ROLE_IN_USE_BY_USERS") });
    }

    await db.query(`DELETE FROM role WHERE id = $1 AND tenant_id = $2`, [id, req.user.tenantId]);
    res.status(204).send();
  } catch (err) {
    if (err.code === "23503") {
      return res.status(409).json({ error: t(req, "ROLE_IN_USE_BY_TASKS") });
    }
    console.error(err);
    res.status(500).json({ error: t(req, "ROLE_DELETE_ERROR") });
  }
});

module.exports = router;
