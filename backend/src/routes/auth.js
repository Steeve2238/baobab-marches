const express = require("express");
const bcrypt = require("bcryptjs");
const crypto = require("crypto");
const { v4: uuidv4 } = require("uuid");
const db = require("../db");
const { signToken } = require("../utils/jwt");
const { requireAuth } = require("../middleware/auth");
const { t, LANGUES_SUPPORTEES } = require("../utils/i18n");
const { envoyerEmailReinitialisation } = require("../utils/mailer");

const router = express.Router();

// ---------------------------------------------------------------------------
// "Mot de passe oublie" - demande explicite de Steeve le 06/09/2026, pour les
// utilisateurs clients (voir routes/superAdmin.js pour l'equivalent Super
// Admin). Voir migration 019_reinitialisation_mot_de_passe.sql : le jeton
// n'est jamais stocke en clair, seule son empreinte SHA-256 l'est.
//
// Duree de validite du jeton et fonctions communes aux deux espaces
// (client + Super Admin) : dupliquees ici et dans superAdmin.js plutot que
// factorisees dans un utilitaire partage - chaque espace reste volontairement
// independant (voir note en tete de superAdmin.js sur l'authentification
// completement separee), et la logique est assez courte pour que la
// duplication reste lisible.
// ---------------------------------------------------------------------------
const DUREE_VALIDITE_JETON_MS = 60 * 60 * 1000; // 1 heure

function hacherJeton(jetonEnClair) {
  return crypto.createHash("sha256").update(jetonEnClair).digest("hex");
}

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

// POST /api/auth/mot-de-passe-oublie - genere un jeton et envoie l'email de
// reinitialisation. Repond TOUJOURS avec un succes generique, que l'email
// corresponde ou non a un compte existant : reveler l'inexistence d'un
// compte (via un message d'erreur different) permettrait a quiconque de
// verifier quelles adresses sont enregistrees sur la plateforme.
router.post("/mot-de-passe-oublie", async (req, res) => {
  const { email } = req.body;
  if (!email) {
    return res.status(400).json({ error: t(req, "FORGOT_PASSWORD_EMAIL_REQUIRED") });
  }

  try {
    const result = await db.query(
      `SELECT id, nom, prenom, email FROM utilisateur WHERE email = $1 AND actif`,
      [email]
    );
    const user = result.rows[0];

    if (user) {
      const jetonEnClair = crypto.randomBytes(32).toString("hex");
      const dateExpiration = new Date(Date.now() + DUREE_VALIDITE_JETON_MS);

      await db.query(
        `INSERT INTO jeton_reinitialisation_mot_de_passe (id, type_compte, compte_id, jeton_hash, date_expiration)
         VALUES ($1, 'UTILISATEUR', $2, $3, $4)`,
        [uuidv4(), user.id, hacherJeton(jetonEnClair), dateExpiration]
      );

      const lienReinitialisation = `${process.env.FRONTEND_URL}/reinitialiser-mot-de-passe?jeton=${jetonEnClair}`;

      try {
        await envoyerEmailReinitialisation({
          destinataire: user.email,
          prenom: user.prenom,
          lienReinitialisation,
        });
      } catch (errEmail) {
        // On journalise l'echec d'envoi cote serveur (ex : SMTP non
        // configure) mais on ne le repercute jamais au client - voir note
        // ci-dessus sur le message generique.
        console.error("Echec d'envoi de l'email de reinitialisation :", errEmail);
      }
    }

    return res.json({ success: true });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: t(req, "FORGOT_PASSWORD_ERROR") });
  }
});

// POST /api/auth/reinitialiser-mot-de-passe - valide le jeton recu par email
// et enregistre le nouveau mot de passe.
router.post("/reinitialiser-mot-de-passe", async (req, res) => {
  const { jeton, nouveau_mot_de_passe } = req.body;
  if (!jeton || !nouveau_mot_de_passe || nouveau_mot_de_passe.length < 8) {
    return res.status(400).json({ error: t(req, "PASSWORD_TOO_SHORT") });
  }

  try {
    const jetonHash = hacherJeton(jeton);
    const result = await db.query(
      `SELECT id, compte_id FROM jeton_reinitialisation_mot_de_passe
       WHERE jeton_hash = $1 AND type_compte = 'UTILISATEUR' AND utilise = false AND date_expiration > now()`,
      [jetonHash]
    );
    const ligneJeton = result.rows[0];
    if (!ligneJeton) {
      return res.status(400).json({ error: t(req, "RESET_PASSWORD_INVALID_TOKEN") });
    }

    const hash = await bcrypt.hash(nouveau_mot_de_passe, 10);
    await db.query(`UPDATE utilisateur SET mot_de_passe_hash = $1, mot_de_passe_temporaire = false WHERE id = $2`, [
      hash,
      ligneJeton.compte_id,
    ]);

    // Marque ce jeton utilise ET invalide tout autre jeton en cours pour ce
    // meme compte (ex : plusieurs demandes de reinitialisation successives).
    await db.query(
      `UPDATE jeton_reinitialisation_mot_de_passe SET utilise = true
       WHERE type_compte = 'UTILISATEUR' AND compte_id = $1 AND utilise = false`,
      [ligneJeton.compte_id]
    );

    return res.json({ success: true });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: t(req, "FORGOT_PASSWORD_ERROR") });
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
