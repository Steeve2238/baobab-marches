const express = require("express");
const bcrypt = require("bcryptjs");
const db = require("../db");
const { v4: uuidv4 } = require("uuid");
const { requireAuth, requireRole } = require("../middleware/auth");
const { t } = require("../utils/i18n");
const { genererMotDePasseTemporaire } = require("../utils/motDePasseTemporaire");

const router = express.Router();
router.use(requireAuth);

/**
 * Charge les roles de chaque utilisateur donne (une seule requete groupee),
 * retourne une map { utilisateur_id: [{id, code, libelle}, ...] }.
 */
async function chargerRolesParUtilisateur(utilisateurIds) {
  if (utilisateurIds.length === 0) return {};
  const result = await db.query(
    `SELECT ur.utilisateur_id, r.id, r.code, r.libelle
     FROM utilisateur_role ur
     JOIN role r ON r.id = ur.role_id
     WHERE ur.utilisateur_id = ANY($1::uuid[])`,
    [utilisateurIds]
  );
  const map = {};
  for (const row of result.rows) {
    if (!map[row.utilisateur_id]) map[row.utilisateur_id] = [];
    map[row.utilisateur_id].push({ id: row.id, code: row.code, libelle: row.libelle });
  }
  return map;
}

// GET /api/utilisateurs - liste des utilisateurs du tenant, avec leurs roles.
// Ouvert a tout utilisateur authentifie (liste de collegues necessaire pour
// affecter une tache a une personne precise) ; seules les mutations
// (creation, modification, suppression, reset mot de passe) sont reservees
// ADMIN plus bas.
router.get("/", async (req, res) => {
  try {
    const usersResult = await db.query(
      `SELECT id, nom, prenom, email, actif, mot_de_passe_temporaire, date_creation
       FROM utilisateur WHERE tenant_id = $1 ORDER BY nom ASC, prenom ASC`,
      [req.user.tenantId]
    );
    const rolesParUtilisateur = await chargerRolesParUtilisateur(usersResult.rows.map((u) => u.id));
    const utilisateurs = usersResult.rows.map((u) => ({
      ...u,
      roles: rolesParUtilisateur[u.id] || [],
    }));
    res.json(utilisateurs);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: t(req, "UTILISATEURS_FETCH_ERROR") });
  }
});

// POST /api/utilisateurs - creation (reserve ADMIN). Un mot de passe
// temporaire est genere automatiquement (aucun service d'envoi d'email n'est
// configure sur Railway pour l'instant - adaptation par rapport a OGAA qui
// envoie ce mot de passe par email) : il est renvoye UNE SEULE FOIS dans la
// reponse, a communiquer manuellement a la personne concernee.
router.post("/", requireRole("ADMIN"), async (req, res) => {
  const { nom, prenom, email, role_ids } = req.body;
  if (!nom || !prenom || !email) {
    return res.status(400).json({ error: t(req, "UTILISATEUR_FIELDS_REQUIRED") });
  }
  if (!Array.isArray(role_ids) || role_ids.length === 0) {
    return res.status(400).json({ error: t(req, "UTILISATEUR_ROLE_REQUIRED") });
  }

  const client = await db.pool.connect();
  try {
    await client.query("BEGIN");

    const rolesCheck = await client.query(
      `SELECT id FROM role WHERE id = ANY($1::uuid[]) AND tenant_id = $2`,
      [role_ids, req.user.tenantId]
    );
    if (rolesCheck.rows.length !== role_ids.length) {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: t(req, "UTILISATEUR_ROLE_INVALID") });
    }

    const motDePasseTemporaire = genererMotDePasseTemporaire(prenom);
    const hash = await bcrypt.hash(motDePasseTemporaire, 10);

    const userResult = await client.query(
      `INSERT INTO utilisateur (id, tenant_id, nom, prenom, email, mot_de_passe_hash, mot_de_passe_temporaire)
       VALUES ($1, $2, $3, $4, $5, $6, true)
       RETURNING id, nom, prenom, email, actif, mot_de_passe_temporaire, date_creation`,
      [uuidv4(), req.user.tenantId, nom, prenom, email, hash]
    );
    const utilisateur = userResult.rows[0];

    for (const roleId of role_ids) {
      await client.query(
        `INSERT INTO utilisateur_role (utilisateur_id, role_id) VALUES ($1, $2)`,
        [utilisateur.id, roleId]
      );
    }

    await client.query("COMMIT");

    const rolesParUtilisateur = await chargerRolesParUtilisateur([utilisateur.id]);
    res.status(201).json({
      ...utilisateur,
      roles: rolesParUtilisateur[utilisateur.id] || [],
      mot_de_passe_temporaire_genere: motDePasseTemporaire,
    });
  } catch (err) {
    await client.query("ROLLBACK");
    if (err.code === "23505") {
      return res.status(409).json({ error: t(req, "UTILISATEUR_EMAIL_ALREADY_EXISTS") });
    }
    console.error(err);
    res.status(500).json({ error: t(req, "UTILISATEUR_CREATE_ERROR") });
  } finally {
    client.release();
  }
});

// PATCH /api/utilisateurs/:id - modification (reserve ADMIN). role_ids,
// s'il est fourni, REMPLACE l'ensemble des roles actuels de la personne.
router.patch("/:id", requireRole("ADMIN"), async (req, res) => {
  const { id } = req.params;
  const { nom, prenom, email, actif, role_ids } = req.body;

  if (actif === false && id === req.user.sub) {
    return res.status(403).json({ error: t(req, "UTILISATEUR_CANNOT_DEACTIVATE_SELF") });
  }
  if (Array.isArray(role_ids) && role_ids.length === 0 && id === req.user.sub) {
    // Empeche un ADMIN de se retirer lui-meme tous ses roles (equivalent a
    // s'auto-exclure de la plateforme sans passer par la desactivation).
    return res.status(400).json({ error: t(req, "UTILISATEUR_ROLE_REQUIRED") });
  }

  const client = await db.pool.connect();
  try {
    await client.query("BEGIN");

    if (Array.isArray(role_ids)) {
      const rolesCheck = await client.query(
        `SELECT id FROM role WHERE id = ANY($1::uuid[]) AND tenant_id = $2`,
        [role_ids, req.user.tenantId]
      );
      if (rolesCheck.rows.length !== role_ids.length) {
        await client.query("ROLLBACK");
        return res.status(400).json({ error: t(req, "UTILISATEUR_ROLE_INVALID") });
      }
    }

    const result = await client.query(
      `UPDATE utilisateur
       SET nom = COALESCE($1, nom),
           prenom = COALESCE($2, prenom),
           email = COALESCE($3, email),
           actif = COALESCE($4, actif)
       WHERE id = $5 AND tenant_id = $6
       RETURNING id, nom, prenom, email, actif, mot_de_passe_temporaire, date_creation`,
      [nom || null, prenom || null, email || null, actif != null ? actif : null, id, req.user.tenantId]
    );
    if (result.rows.length === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: t(req, "UTILISATEUR_NOT_FOUND") });
    }

    if (Array.isArray(role_ids)) {
      await client.query(`DELETE FROM utilisateur_role WHERE utilisateur_id = $1`, [id]);
      for (const roleId of role_ids) {
        await client.query(
          `INSERT INTO utilisateur_role (utilisateur_id, role_id) VALUES ($1, $2)`,
          [id, roleId]
        );
      }
    }

    await client.query("COMMIT");

    const rolesParUtilisateur = await chargerRolesParUtilisateur([id]);
    res.json({ ...result.rows[0], roles: rolesParUtilisateur[id] || [] });
  } catch (err) {
    await client.query("ROLLBACK");
    if (err.code === "23505") {
      return res.status(409).json({ error: t(req, "UTILISATEUR_EMAIL_ALREADY_EXISTS") });
    }
    console.error(err);
    res.status(500).json({ error: t(req, "UTILISATEUR_UPDATE_ERROR") });
  } finally {
    client.release();
  }
});

// POST /api/utilisateurs/:id/reinitialiser-mot-de-passe - genere un nouveau
// mot de passe temporaire (reserve ADMIN), renvoye UNE SEULE FOIS.
router.post("/:id/reinitialiser-mot-de-passe", requireRole("ADMIN"), async (req, res) => {
  const { id } = req.params;
  try {
    const userResult = await db.query(
      `SELECT id, prenom FROM utilisateur WHERE id = $1 AND tenant_id = $2`,
      [id, req.user.tenantId]
    );
    const utilisateur = userResult.rows[0];
    if (!utilisateur) {
      return res.status(404).json({ error: t(req, "UTILISATEUR_NOT_FOUND") });
    }

    const motDePasseTemporaire = genererMotDePasseTemporaire(utilisateur.prenom);
    const hash = await bcrypt.hash(motDePasseTemporaire, 10);
    await db.query(
      `UPDATE utilisateur SET mot_de_passe_hash = $1, mot_de_passe_temporaire = true WHERE id = $2`,
      [hash, id]
    );

    res.json({ mot_de_passe_temporaire_genere: motDePasseTemporaire });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: t(req, "UTILISATEUR_RESET_PASSWORD_ERROR") });
  }
});

// DELETE /api/utilisateurs/:id - reserve ADMIN. Bloque la suppression de
// soi-meme, et bloque toute suppression si l'utilisateur a des donnees liees
// ailleurs dans la plateforme (taches affectees, clauses validees, signaux
// acquittes...) en s'appuyant simplement sur la contrainte de cle etrangere
// (erreur 23503) plutot que d'enumerer toutes les tables une par une :
// message clair invitant a desactiver plutot que supprimer, pour preserver
// l'historique (meme principe qu'OGAA).
router.delete("/:id", requireRole("ADMIN"), async (req, res) => {
  const { id } = req.params;
  if (id === req.user.sub) {
    return res.status(403).json({ error: t(req, "UTILISATEUR_CANNOT_DELETE_SELF") });
  }

  try {
    const result = await db.query(
      `DELETE FROM utilisateur WHERE id = $1 AND tenant_id = $2 RETURNING id`,
      [id, req.user.tenantId]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: t(req, "UTILISATEUR_NOT_FOUND") });
    }
    res.status(204).send();
  } catch (err) {
    if (err.code === "23503") {
      return res.status(409).json({ error: t(req, "UTILISATEUR_IN_USE") });
    }
    console.error(err);
    res.status(500).json({ error: t(req, "UTILISATEUR_DELETE_ERROR") });
  }
});

module.exports = router;
