const express = require("express");
const bcrypt = require("bcryptjs");
const db = require("../db");
const { signToken } = require("../utils/jwt");
const { requireAuth } = require("../middleware/auth");
const { t, LANGUES_SUPPORTEES } = require("../utils/i18n");

const router = express.Router();

// POST /api/auth/login
router.post("/login", async (req, res) => {
  const { email, mot_de_passe } = req.body;
  if (!email || !mot_de_passe) {
    return res.status(400).json({ error: t(req, "LOGIN_MISSING_FIELDS") });
  }

  try {
    const userResult = await db.query(
      `SELECT u.id, u.tenant_id, u.nom, u.prenom, u.email, u.mot_de_passe_hash, u.mot_de_passe_temporaire,
              u.langue_preferee, u.actif, te.actif AS tenant_actif
       FROM utilisateur u
       JOIN tenant te ON te.id = u.tenant_id
       WHERE u.email = $1`,
      [email]
    );
    const user = userResult.rows[0];

    if (!user || !user.actif) {
      return res.status(401).json({ error: t(req, "LOGIN_INVALID") });
    }

    // L'entreprise elle-meme peut etre suspendue depuis le Super Admin
    // (tenant.actif) independamment du statut de chaque utilisateur - ce
    // champ existait deja dans le schema d'origine mais n'etait verifie nulle
    // part avant l'ajout du module Super Admin (04/09/2026).
    if (!user.tenant_actif) {
      return res.status(401).json({ error: t(req, "LOGIN_TENANT_SUSPENDU") });
    }

    const passwordOk = await bcrypt.compare(mot_de_passe, user.mot_de_passe_hash);
    if (!passwordOk) {
      return res.status(401).json({ error: t(req, "LOGIN_INVALID") });
    }

    const rolesResult = await db.query(
      `SELECT r.code FROM role r
       JOIN utilisateur_role ur ON ur.role_id = r.id
       WHERE ur.utilisateur_id = $1`,
      [user.id]
    );
    const roles = rolesResult.rows.map((r) => r.code);

    const token = signToken({
      sub: user.id,
      tenantId: user.tenant_id,
      email: user.email,
      roles,
    });

    return res.json({
      token,
      mustChangePassword: user.mot_de_passe_temporaire,
      user: {
        id: user.id,
        nom: user.nom,
        prenom: user.prenom,
        email: user.email,
        roles,
        langue_preferee: user.langue_preferee,
      },
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: t(req, "LOGIN_SERVER_ERROR") });
  }
});

// GET /api/auth/permissions - permissions agregees de l'utilisateur connecte
// (union de tous ses roles), calculees fraichement par requireAuth a chaque
// requete - jamais mises en cache dans le token, pour que l'admin puisse
// changer les permissions d'un role et voir l'effet immediatement, sans que
// la personne concernee ait besoin de se reconnecter (meme principe que
// req.user.roles). Consommee par AppShell pour construire le menu de gauche.
router.get("/permissions", requireAuth, async (req, res) => {
  res.json(req.user.permissions);
});

// POST /api/auth/changer-mot-de-passe
router.post("/changer-mot-de-passe", requireAuth, async (req, res) => {
  const { nouveau_mot_de_passe } = req.body;
  if (!nouveau_mot_de_passe || nouveau_mot_de_passe.length < 8) {
    return res.status(400).json({ error: t(req, "PASSWORD_TOO_SHORT") });
  }

  try {
    const hash = await bcrypt.hash(nouveau_mot_de_passe, 10);
    await db.query(
      `UPDATE utilisateur SET mot_de_passe_hash = $1, mot_de_passe_temporaire = false WHERE id = $2`,
      [hash, req.user.sub]
    );
    return res.json({ success: true });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: t(req, "PASSWORD_CHANGE_ERROR") });
  }
});

// PATCH /api/auth/langue - mise a jour de la langue preferee de l'utilisateur
router.patch("/langue", requireAuth, async (req, res) => {
  const { langue_preferee } = req.body;
  if (!LANGUES_SUPPORTEES.includes(langue_preferee)) {
    return res.status(400).json({ error: t(req, "LANGUE_INVALID") });
  }

  try {
    await db.query(
      `UPDATE utilisateur SET langue_preferee = $1 WHERE id = $2`,
      [langue_preferee, req.user.sub]
    );
    return res.json({ success: true, langue_preferee });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: t(req, "LANGUE_UPDATE_ERROR") });
  }
});

module.exports = router;
