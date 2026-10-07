const express = require("express");
const bcrypt = require("bcryptjs");
const crypto = require("crypto");
const multer = require("multer");
const db = require("../db");
const { v4: uuidv4 } = require("uuid");
const { signToken } = require("../utils/jwt");
const { requireSuperAdmin } = require("../middleware/auth");
const { t } = require("../utils/i18n");
const { genererMotDePasseTemporaire } = require("../utils/motDePasseTemporaire");
const { envoyerEmailReinitialisation } = require("../utils/mailer");
const licenceSvc = require("../services/licence");

const router = express.Router();

// Duree de validite + hachage du jeton de reinitialisation - voir
// routes/auth.js pour l'explication complete (meme principe, espace Super
// Admin separe, voir migration 019_reinitialisation_mot_de_passe.sql).
const DUREE_VALIDITE_JETON_MS = 60 * 60 * 1000; // 1 heure

function hacherJeton(jetonEnClair) {
  return crypto.createHash("sha256").update(jetonEnClair).digest("hex");
}

// ---------------------------------------------------------------------------
// Authentification Super Admin - completement separee de /api/auth (voir
// middleware/auth.js: requireSuperAdmin). Pas de router.use(requireAuth) ici,
// chaque route pose sa propre exigence.
// ---------------------------------------------------------------------------

// POST /api/super-admin/auth/login
router.post("/auth/login", async (req, res) => {
  const { email, mot_de_passe } = req.body;
  if (!email || !mot_de_passe) {
    return res.status(400).json({ error: t(req, "LOGIN_MISSING_FIELDS") });
  }

  try {
    const result = await db.query(
      `SELECT id, email, nom, mot_de_passe_hash, mot_de_passe_temporaire, actif
       FROM administrateur_plateforme WHERE email = $1`,
      [email]
    );
    const admin = result.rows[0];
    if (!admin || !admin.actif) {
      return res.status(401).json({ error: t(req, "LOGIN_INVALID") });
    }

    const passwordOk = await bcrypt.compare(mot_de_passe, admin.mot_de_passe_hash);
    if (!passwordOk) {
      return res.status(401).json({ error: t(req, "LOGIN_INVALID") });
    }

    const token = signToken({ superAdminId: admin.id, email: admin.email });

    return res.json({
      token,
      mustChangePassword: admin.mot_de_passe_temporaire,
      admin: { id: admin.id, nom: admin.nom, email: admin.email },
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: t(req, "LOGIN_SERVER_ERROR") });
  }
});

// POST /api/super-admin/auth/mot-de-passe-oublie - meme principe que
// /api/auth/mot-de-passe-oublie (voir routes/auth.js pour le detail des
// commentaires), adapte a administrateur_plateforme. Reponse toujours
// generique, meme raisonnement anti-enumeration de comptes.
router.post("/auth/mot-de-passe-oublie", async (req, res) => {
  const { email } = req.body;
  if (!email) {
    return res.status(400).json({ error: t(req, "FORGOT_PASSWORD_EMAIL_REQUIRED") });
  }

  try {
    const result = await db.query(
      `SELECT id, nom, email FROM administrateur_plateforme WHERE email = $1 AND actif`,
      [email]
    );
    const admin = result.rows[0];

    if (admin) {
      const jetonEnClair = crypto.randomBytes(32).toString("hex");
      const dateExpiration = new Date(Date.now() + DUREE_VALIDITE_JETON_MS);

      await db.query(
        `INSERT INTO jeton_reinitialisation_mot_de_passe (id, type_compte, compte_id, jeton_hash, date_expiration)
         VALUES ($1, 'SUPER_ADMIN', $2, $3, $4)`,
        [uuidv4(), admin.id, hacherJeton(jetonEnClair), dateExpiration]
      );

      const lienReinitialisation = `${process.env.FRONTEND_URL}/super-admin/reinitialiser-mot-de-passe?jeton=${jetonEnClair}`;

      try {
        await envoyerEmailReinitialisation({
          destinataire: admin.email,
          prenom: admin.nom,
          lienReinitialisation,
        });
      } catch (errEmail) {
        console.error("Echec d'envoi de l'email de reinitialisation (Super Admin) :", errEmail);
      }
    }

    return res.json({ success: true });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: t(req, "FORGOT_PASSWORD_ERROR") });
  }
});

// POST /api/super-admin/auth/reinitialiser-mot-de-passe
router.post("/auth/reinitialiser-mot-de-passe", async (req, res) => {
  const { jeton, nouveau_mot_de_passe } = req.body;
  if (!jeton || !nouveau_mot_de_passe || nouveau_mot_de_passe.length < 8) {
    return res.status(400).json({ error: t(req, "PASSWORD_TOO_SHORT") });
  }

  try {
    const jetonHash = hacherJeton(jeton);
    const result = await db.query(
      `SELECT id, compte_id FROM jeton_reinitialisation_mot_de_passe
       WHERE jeton_hash = $1 AND type_compte = 'SUPER_ADMIN' AND utilise = false AND date_expiration > now()`,
      [jetonHash]
    );
    const ligneJeton = result.rows[0];
    if (!ligneJeton) {
      return res.status(400).json({ error: t(req, "RESET_PASSWORD_INVALID_TOKEN") });
    }

    const hash = await bcrypt.hash(nouveau_mot_de_passe, 10);
    await db.query(`UPDATE administrateur_plateforme SET mot_de_passe_hash = $1, mot_de_passe_temporaire = false WHERE id = $2`, [
      hash,
      ligneJeton.compte_id,
    ]);

    await db.query(
      `UPDATE jeton_reinitialisation_mot_de_passe SET utilise = true
       WHERE type_compte = 'SUPER_ADMIN' AND compte_id = $1 AND utilise = false`,
      [ligneJeton.compte_id]
    );

    return res.json({ success: true });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: t(req, "FORGOT_PASSWORD_ERROR") });
  }
});

// POST /api/super-admin/auth/changer-mot-de-passe
router.post("/auth/changer-mot-de-passe", requireSuperAdmin, async (req, res) => {
  const { nouveau_mot_de_passe } = req.body;
  if (!nouveau_mot_de_passe || nouveau_mot_de_passe.length < 8) {
    return res.status(400).json({ error: t(req, "PASSWORD_TOO_SHORT") });
  }
  try {
    const hash = await bcrypt.hash(nouveau_mot_de_passe, 10);
    await db.query(
      `UPDATE administrateur_plateforme SET mot_de_passe_hash = $1, mot_de_passe_temporaire = false WHERE id = $2`,
      [hash, req.superAdmin.id]
    );
    return res.json({ success: true });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: t(req, "PASSWORD_CHANGE_ERROR") });
  }
});

// PATCH /api/super-admin/auth/langue - meme logique que /api/auth/langue,
// mais pour la preference de langue du compte Super Admin (stockee cote
// client uniquement pour l'instant, voir note ci-dessous).
//
// Note : administrateur_plateforme n'a pas de colonne langue_preferee - le
// Super Admin est une seule personne (Steeve) pour l'instant, la langue de
// l'espace Super Admin est geree cote frontend comme les autres pages
// (localStorage), sans avoir besoin d'etre persistee cote serveur. Pas de
// route ici : simplification volontaire, a revoir si plusieurs comptes
// Super Admin de langues differentes sont crees un jour.

router.use(requireSuperAdmin);

// Offres commerciales, contrats clients, PDF et envois par e-mail (fichier dedie).
router.use(require("./superAdminCommercial"));

// ---------------------------------------------------------------------------
// Parametres de facturation du Super Admin (entete + pied de page + logo,
// utilises sur les factures d'abonnement - voir GET /factures/:id plus bas).
// Table singleton plateforme_parametres (une seule ligne, voir migration
// 018_facturation_entete_pied_de_page.sql) : la plateforme n'a qu'un seul
// proprietaire (Steeve), contrairement a "tenant" (une ligne par client).
// ---------------------------------------------------------------------------

const MIMETYPES_LOGO_ACCEPTES = ["image/png", "image/jpeg"];
const uploadLogoPlateforme = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 2 * 1024 * 1024 }, // 2 Mo
});

// Convertit une erreur Multer (ex : fichier trop volumineux) en reponse JSON
// claire, au lieu de la laisser remonter jusqu'au gestionnaire d'erreur
// generique de index.js (message non specifique "Erreur serveur inattendue").
// Necessaire car un multer.MulterError leve pendant le parsing du flux
// multipart survient AVANT le try/catch de la route - meme correctif que
// routes/parametres.js (bug reel rencontre le 05/09/2026 par Steeve : upload
// d'un vrai logo > 2 Mo renvoyait un message generique et illisible).
function televerserLogo(middlewareMulter) {
  return (req, res, next) => {
    middlewareMulter(req, res, (err) => {
      if (err) {
        if (err.code === "LIMIT_FILE_SIZE") {
          return res.status(400).json({ error: t(req, "VENTE_LOGO_TOO_LARGE") });
        }
        console.error(err);
        return res.status(500).json({ error: t(req, "VENTE_LOGO_UPLOAD_ERROR") });
      }
      next();
    });
  };
}

// GET /api/super-admin/parametres/entete - SELECT * volontaire : renvoie
// aussi bien le logo que la signature/cachet (signature_cachet_base64 /
// signature_cachet_type_mime, migration 022) sans avoir a maintenir une
// liste de colonnes en double ici et dans le frontend.
router.get("/parametres/entete", async (req, res) => {
  try {
    const result = await db.query(`SELECT * FROM plateforme_parametres WHERE id = true`);
    res.json(result.rows[0] || {});
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: t(req, "ENTETE_FETCH_ERROR") });
  }
});

// PATCH /api/super-admin/parametres/entete
router.patch("/parametres/entete", async (req, res) => {
  const { raison_sociale, adresse, telephone, email, rccm, ninea, site_web, coordonnees_bancaires } = req.body;
  const b = req.body || {};
  try {
    const result = await db.query(
      `UPDATE plateforme_parametres
       SET raison_sociale = $1, adresse = $2, telephone = $3, email = $4,
           rccm = $5, ninea = $6, site_web = $7, coordonnees_bancaires = $8,
           forme_juridique = $9, capital_social = $10, representant_nom = $11, representant_fonction = $12,
           ville_signature = COALESCE($13, ville_signature), tribunal_competent = COALESCE($14, tribunal_competent),
           penalite_pi_mois = COALESCE($15, penalite_pi_mois), mention_propriete_intellectuelle = $16
       WHERE id = true
       RETURNING *`,
      [
        raison_sociale || null,
        adresse || null,
        telephone || null,
        email || null,
        rccm || null,
        ninea || null,
        site_web || null,
        coordonnees_bancaires || null,
        b.forme_juridique || null,
        b.capital_social || null,
        b.representant_nom || null,
        b.representant_fonction || null,
        b.ville_signature || null,
        b.tribunal_competent || null,
        Number.isInteger(Number(b.penalite_pi_mois)) && Number(b.penalite_pi_mois) > 0 && Number(b.penalite_pi_mois) <= 120 ? Number(b.penalite_pi_mois) : null,
        b.mention_propriete_intellectuelle || null,
      ]
    );
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: t(req, "ENTETE_UPDATE_ERROR") });
  }
});

// POST /api/super-admin/parametres/entete/logo
router.post("/parametres/entete/logo", televerserLogo(uploadLogoPlateforme.single("logo")), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: t(req, "VENTE_LOGO_FILE_REQUIRED") });
  }
  if (!MIMETYPES_LOGO_ACCEPTES.includes(req.file.mimetype)) {
    return res.status(400).json({ error: t(req, "VENTE_LOGO_TYPE_INVALID") });
  }
  try {
    const base64 = req.file.buffer.toString("base64");
    const result = await db.query(
      `UPDATE plateforme_parametres SET logo_base64 = $1, logo_type_mime = $2 WHERE id = true RETURNING *`,
      [base64, req.file.mimetype]
    );
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: t(req, "VENTE_LOGO_UPLOAD_ERROR") });
  }
});

// DELETE /api/super-admin/parametres/entete/logo
router.delete("/parametres/entete/logo", async (req, res) => {
  try {
    const result = await db.query(
      `UPDATE plateforme_parametres SET logo_base64 = NULL, logo_type_mime = NULL WHERE id = true RETURNING *`
    );
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: t(req, "VENTE_LOGO_UPLOAD_ERROR") });
  }
});

// POST /api/super-admin/parametres/entete/signature-cachet - image UNIQUE
// combinant la signature et le cachet (le tampon papier est scanne avec la
// signature dessus, c'est l'usage reel : deux images separees obligeraient a
// les repositionner l'une par rapport a l'autre a l'impression). Affichee en
// bas a droite de la facture, sous la mention "La Direction" (voir
// frontend/app/super-admin/factures/[id]/page.js) - demande de Steeve du
// 18/09/2026. Strictement le meme mecanisme que le logo ci-dessus (multer en
// memoire, 2 Mo, PNG/JPEG uniquement, requireSuperAdmin pose par le
// router.use plus haut), voir migration
// 022_facture_signature_cachet_detail_ligne.sql.
router.post(
  "/parametres/entete/signature-cachet",
  televerserLogo(uploadLogoPlateforme.single("signature_cachet")),
  async (req, res) => {
    if (!req.file) {
      return res.status(400).json({ error: t(req, "VENTE_LOGO_FILE_REQUIRED") });
    }
    if (!MIMETYPES_LOGO_ACCEPTES.includes(req.file.mimetype)) {
      return res.status(400).json({ error: t(req, "VENTE_LOGO_TYPE_INVALID") });
    }
    try {
      const base64 = req.file.buffer.toString("base64");
      const result = await db.query(
        `UPDATE plateforme_parametres SET signature_cachet_base64 = $1, signature_cachet_type_mime = $2
         WHERE id = true RETURNING *`,
        [base64, req.file.mimetype]
      );
      res.json(result.rows[0]);
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: t(req, "VENTE_LOGO_UPLOAD_ERROR") });
    }
  }
);

// DELETE /api/super-admin/parametres/entete/signature-cachet
router.delete("/parametres/entete/signature-cachet", async (req, res) => {
  try {
    const result = await db.query(
      `UPDATE plateforme_parametres SET signature_cachet_base64 = NULL, signature_cachet_type_mime = NULL
       WHERE id = true RETURNING *`
    );
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: t(req, "VENTE_LOGO_UPLOAD_ERROR") });
  }
});

// ---------------------------------------------------------------------------
// Statistiques
// ---------------------------------------------------------------------------

// GET /api/super-admin/statistiques
router.get("/statistiques", async (req, res) => {
  try {
    const result = await db.query(
      `SELECT
         COUNT(*) FILTER (WHERE actif) AS clients_actifs,
         COUNT(*) FILTER (WHERE NOT actif) AS clients_inactifs,
         COUNT(*) AS clients_total
       FROM tenant`
    );
    const row = result.rows[0];
    res.json({
      clients_actifs: Number(row.clients_actifs),
      clients_inactifs: Number(row.clients_inactifs),
      clients_total: Number(row.clients_total),
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: t(req, "SUPER_ADMIN_STATS_FETCH_ERROR") });
  }
});

// ---------------------------------------------------------------------------
// Clients (entreprises) - creation, suspension, formule, facturation
// ---------------------------------------------------------------------------

const SELECT_CLIENT = `
  SELECT te.id, te.raison_sociale, te.secteur_activite, te.pays, te.actif, te.date_creation,
         te.formule_abonnement_id,
         te.module_comptabilite_actif, te.module_comptabilite_prix_mensuel_xof, te.module_comptabilite_date_activation,
         te.module_fiscalite_actif, te.module_fiscalite_prix_mensuel_xof, te.module_fiscalite_date_activation,
         te.mode_hebergement,
         (SELECT MAX(l.date_fin) FROM licence_emise l WHERE l.tenant_id = te.id) AS licence_date_fin,
         fa.nom AS formule_nom, fa.prix_mensuel_xof AS formule_prix_mensuel_xof,
         fa.prix_licence_annuelle_xof AS formule_prix_licence_annuelle_xof,
         fa.plafond_utilisateurs AS formule_plafond_utilisateurs,
         (SELECT COUNT(*) FROM utilisateur u WHERE u.tenant_id = te.id) AS nombre_utilisateurs,
         (SELECT COUNT(*) FROM utilisateur u WHERE u.tenant_id = te.id AND u.actif) AS nombre_utilisateurs_actifs
  FROM tenant te
  LEFT JOIN formule_abonnement fa ON fa.id = te.formule_abonnement_id
`;

// GET /api/super-admin/clients
router.get("/clients", async (req, res) => {
  try {
    const result = await db.query(`${SELECT_CLIENT} ORDER BY te.date_creation DESC`);
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: t(req, "SUPER_ADMIN_CLIENTS_FETCH_ERROR") });
  }
});

// GET /api/super-admin/clients/:id - detail + liste des utilisateurs
router.get("/clients/:id", async (req, res) => {
  try {
    const clientResult = await db.query(`${SELECT_CLIENT} WHERE te.id = $1`, [req.params.id]);
    const client = clientResult.rows[0];
    if (!client) {
      return res.status(404).json({ error: t(req, "SUPER_ADMIN_CLIENT_NOT_FOUND") });
    }
    const usersResult = await db.query(
      `SELECT id, nom, prenom, email, actif, mot_de_passe_temporaire, date_creation
       FROM utilisateur WHERE tenant_id = $1 ORDER BY nom ASC, prenom ASC`,
      [req.params.id]
    );
    // Roles attribues a chaque utilisateur par l'administrateur du client
    // (une seule requete groupee, un utilisateur peut cumuler plusieurs roles).
    const rolesParUtilisateur = {};
    if (usersResult.rows.length > 0) {
      const rolesResult = await db.query(
        `SELECT ur.utilisateur_id, r.code, r.libelle
         FROM utilisateur_role ur
         JOIN role r ON r.id = ur.role_id
         WHERE ur.utilisateur_id = ANY($1::uuid[])
         ORDER BY r.libelle ASC`,
        [usersResult.rows.map((u) => u.id)]
      );
      for (const row of rolesResult.rows) {
        if (!rolesParUtilisateur[row.utilisateur_id]) rolesParUtilisateur[row.utilisateur_id] = [];
        rolesParUtilisateur[row.utilisateur_id].push({ code: row.code, libelle: row.libelle });
      }
    }
    const utilisateurs = usersResult.rows.map((u) => ({ ...u, roles: rolesParUtilisateur[u.id] || [] }));
    res.json({ ...client, utilisateurs });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: t(req, "SUPER_ADMIN_CLIENTS_FETCH_ERROR") });
  }
});

// POST /api/super-admin/clients - cree l'entreprise cliente ET son premier
// compte administrateur en une seule operation (transaction) : un client sans
// aucun moyen de se connecter serait inutilisable. Seed aussi un role ADMIN
// pour ce tenant (les roles sont libres par tenant, voir routes/roles.js -
// il en faut au moins un pour que le premier compte existe avec des droits).
// Si une formule est assignee des la creation ET qu'elle porte des frais
// d'installation (> 0), genere aussi dans la meme transaction la toute
// premiere facture du client (type_facture = INSTALLATION, periode = mois de
// creation) - demande explicite de Steeve le 04/09/2026 : l'installation est
// facturee separement de l'abonnement mensuel recurrent, une seule fois.
router.post("/clients", async (req, res) => {
  const { raison_sociale, secteur_activite, pays, formule_abonnement_id, admin_nom, admin_prenom, admin_email } =
    req.body;
  if (!raison_sociale || !admin_nom || !admin_prenom || !admin_email) {
    return res.status(400).json({ error: t(req, "SUPER_ADMIN_CLIENT_FIELDS_REQUIRED") });
  }
  // Mode d'hebergement : HEBERGE (chez Steeve, defaut) ou LOCAL (version installee chez le client).
  const modeHebergement = req.body.mode_hebergement === "LOCAL" ? "LOCAL" : "HEBERGE";

  const client = await db.pool.connect();
  try {
    await client.query("BEGIN");

    const tenantResult = await client.query(
      `INSERT INTO tenant (id, raison_sociale, secteur_activite, pays, formule_abonnement_id, mode_hebergement)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id`,
      [uuidv4(), raison_sociale, secteur_activite || null, pays || "Senegal", formule_abonnement_id || null, modeHebergement]
    );
    const tenantId = tenantResult.rows[0].id;

    const roleResult = await client.query(
      `INSERT INTO role (id, tenant_id, code, libelle) VALUES ($1, $2, 'ADMIN', 'Administrateur') RETURNING id`,
      [uuidv4(), tenantId]
    );
    const roleAdminId = roleResult.rows[0].id;

    const motDePasseTemporaire = genererMotDePasseTemporaire(admin_prenom);
    const hash = await bcrypt.hash(motDePasseTemporaire, 10);

    const userResult = await client.query(
      `INSERT INTO utilisateur (id, tenant_id, nom, prenom, email, mot_de_passe_hash, mot_de_passe_temporaire)
       VALUES ($1, $2, $3, $4, $5, $6, true)
       RETURNING id, nom, prenom, email`,
      [uuidv4(), tenantId, admin_nom, admin_prenom, admin_email, hash]
    );
    const adminUser = userResult.rows[0];

    await client.query(`INSERT INTO utilisateur_role (utilisateur_id, role_id) VALUES ($1, $2)`, [
      adminUser.id,
      roleAdminId,
    ]);

    let factureInstallationId = null;
    if (formule_abonnement_id) {
      const formuleResult = await client.query(
        `SELECT nom, plafond_utilisateurs, frais_installation_xof FROM formule_abonnement WHERE id = $1`,
        [formule_abonnement_id]
      );
      const formule = formuleResult.rows[0];
      if (formule && Number(formule.frais_installation_xof) > 0) {
        const periode = new Date().toISOString().slice(0, 7);
        const factureResult = await client.query(
          `INSERT INTO facture_abonnement (id, tenant_id, formule_abonnement_id, formule_nom, periode, montant_xof, type_facture, plafond_utilisateurs_facture)
           VALUES ($1, $2, $3, $4, $5, $6, 'INSTALLATION', $7)
           RETURNING id`,
          [
            uuidv4(),
            tenantId,
            formule_abonnement_id,
            formule.nom,
            periode,
            formule.frais_installation_xof,
            formule.plafond_utilisateurs ?? null,
          ]
        );
        factureInstallationId = factureResult.rows[0].id;
      }
    }

    await client.query("COMMIT");

    const clientResult = await db.query(`${SELECT_CLIENT} WHERE te.id = $1`, [tenantId]);
    let factureInstallation = null;
    if (factureInstallationId) {
      const factureResult = await db.query(`${SELECT_FACTURE} WHERE f.id = $1`, [factureInstallationId]);
      factureInstallation = factureResult.rows[0];
    }
    res.status(201).json({
      ...clientResult.rows[0],
      premier_administrateur: { ...adminUser, mot_de_passe_temporaire: motDePasseTemporaire },
      premiere_facture_installation: factureInstallation,
    });
  } catch (err) {
    await client.query("ROLLBACK");
    if (err.code === "23505") {
      return res.status(409).json({ error: t(req, "SUPER_ADMIN_CLIENT_EMAIL_EXISTS") });
    }
    console.error(err);
    res.status(500).json({ error: t(req, "SUPER_ADMIN_CLIENT_CREATE_ERROR") });
  } finally {
    client.release();
  }
});

// PATCH /api/super-admin/clients/:id - modifie les infos (pas le statut
// actif, qui a ses propres routes suspendre/reactiver ci-dessous pour rendre
// cette action explicite et volontaire, jamais un effet de bord d'un
// formulaire d'edition generique).
router.patch("/clients/:id", async (req, res) => {
  const { raison_sociale, secteur_activite, pays, formule_abonnement_id } = req.body;
  try {
    const existing = await db.query(`SELECT id FROM tenant WHERE id = $1`, [req.params.id]);
    if (existing.rows.length === 0) {
      return res.status(404).json({ error: t(req, "SUPER_ADMIN_CLIENT_NOT_FOUND") });
    }
    await db.query(
      `UPDATE tenant SET
         raison_sociale = COALESCE($1, raison_sociale),
         secteur_activite = $2,
         pays = COALESCE($3, pays),
         formule_abonnement_id = $4
       WHERE id = $5`,
      [raison_sociale, secteur_activite || null, pays, formule_abonnement_id || null, req.params.id]
    );
    const clientResult = await db.query(`${SELECT_CLIENT} WHERE te.id = $1`, [req.params.id]);
    res.json(clientResult.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: t(req, "SUPER_ADMIN_CLIENT_UPDATE_ERROR") });
  }
});

// PATCH /api/super-admin/clients/:id/module-comptabilite - active ou verrouille
// le module Comptabilite (vendu en option, migration 032) et fixe son
// supplement mensuel. Corps : { actif: boolean, prix_mensuel_xof?: nombre }.
// Verrouiller ne supprime AUCUNE donnee : seul l'acces est coupe (voir
// middleware exigerModuleComptabiliteActif) ; le supplement n'est facture que
// sur les factures d'abonnement generees tant que le module est actif.
router.patch("/clients/:id/module-comptabilite", async (req, res) => {
  const { actif, prix_mensuel_xof } = req.body || {};
  if (typeof actif !== "boolean") {
    return res.status(400).json({ error: t(req, "SUPER_ADMIN_MODULE_COMPTA_INVALID") });
  }
  let prix = null;
  if (prix_mensuel_xof !== undefined && prix_mensuel_xof !== null && prix_mensuel_xof !== "") {
    prix = Number(prix_mensuel_xof);
    if (!Number.isInteger(prix) || prix < 0) {
      return res.status(400).json({ error: t(req, "SUPER_ADMIN_MODULE_COMPTA_INVALID") });
    }
  }
  try {
    const existing = await db.query(
      `SELECT module_comptabilite_actif FROM tenant WHERE id = $1`,
      [req.params.id]
    );
    if (existing.rows.length === 0) {
      return res.status(404).json({ error: t(req, "SUPER_ADMIN_CLIENT_NOT_FOUND") });
    }
    const etaitActif = !!existing.rows[0].module_comptabilite_actif;
    await db.query(
      `UPDATE tenant SET
         module_comptabilite_actif = $1,
         module_comptabilite_prix_mensuel_xof = COALESCE($2, module_comptabilite_prix_mensuel_xof),
         module_comptabilite_date_activation = CASE WHEN $1 AND NOT $3 THEN now() ELSE module_comptabilite_date_activation END
       WHERE id = $4`,
      [actif, prix, etaitActif, req.params.id]
    );
    const clientResult = await db.query(`${SELECT_CLIENT} WHERE te.id = $1`, [req.params.id]);
    res.json(clientResult.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: t(req, "SUPER_ADMIN_CLIENT_UPDATE_ERROR") });
  }
});

// PATCH /api/super-admin/clients/:id/module-fiscalite - active ou verrouille le module Fiscalite (vendu en option,
// migration 049) et fixe son supplement mensuel. Meme mecanique que le module Comptabilite : verrouiller ne supprime
// aucune donnee, seul l'acces est coupe (middleware exigerModuleFiscaliteActif).
router.patch("/clients/:id/module-fiscalite", async (req, res) => {
  const { actif, prix_mensuel_xof } = req.body || {};
  if (typeof actif !== "boolean") {
    return res.status(400).json({ error: t(req, "SUPER_ADMIN_MODULE_FISCALITE_INVALID") });
  }
  let prix = null;
  if (prix_mensuel_xof !== undefined && prix_mensuel_xof !== null && prix_mensuel_xof !== "") {
    prix = Number(prix_mensuel_xof);
    if (!Number.isInteger(prix) || prix < 0) {
      return res.status(400).json({ error: t(req, "SUPER_ADMIN_MODULE_FISCALITE_INVALID") });
    }
  }
  try {
    const existing = await db.query(`SELECT module_fiscalite_actif FROM tenant WHERE id = $1`, [req.params.id]);
    if (existing.rows.length === 0) {
      return res.status(404).json({ error: t(req, "SUPER_ADMIN_CLIENT_NOT_FOUND") });
    }
    const etaitActif = !!existing.rows[0].module_fiscalite_actif;
    await db.query(
      `UPDATE tenant SET
         module_fiscalite_actif = $1,
         module_fiscalite_prix_mensuel_xof = COALESCE($2, module_fiscalite_prix_mensuel_xof),
         module_fiscalite_date_activation = CASE WHEN $1 AND NOT $3 THEN now() ELSE module_fiscalite_date_activation END
       WHERE id = $4`,
      [actif, prix, etaitActif, req.params.id]
    );
    const clientResult = await db.query(`${SELECT_CLIENT} WHERE te.id = $1`, [req.params.id]);
    res.json(clientResult.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: t(req, "SUPER_ADMIN_CLIENT_UPDATE_ERROR") });
  }
});

// PATCH /api/super-admin/clients/:id/mode-hebergement - bascule un client entre HEBERGE (sa base est chez nous,
// abonnement mensuel) et LOCAL (version installee chez lui, licence annuelle). Corps : { mode: "HEBERGE" | "LOCAL" }.
// Un client LOCAL ne peut plus se connecter a la plateforme hebergee (ses donnees vivent chez lui) ; aucune donnee
// n'est supprimee ni deplacee par ce changement.
router.patch("/clients/:id/mode-hebergement", async (req, res) => {
  const mode = req.body && req.body.mode;
  if (mode !== "HEBERGE" && mode !== "LOCAL") {
    return res.status(400).json({ error: t(req, "SUPER_ADMIN_MODE_HEBERGEMENT_INVALID") });
  }
  try {
    const result = await db.query(`UPDATE tenant SET mode_hebergement = $1 WHERE id = $2 RETURNING id`, [mode, req.params.id]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: t(req, "SUPER_ADMIN_CLIENT_NOT_FOUND") });
    }
    const clientResult = await db.query(`${SELECT_CLIENT} WHERE te.id = $1`, [req.params.id]);
    res.json(clientResult.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: t(req, "SUPER_ADMIN_CLIENT_UPDATE_ERROR") });
  }
});

// ---------------------------------------------------------------------------
// Licences (version installable) - voir services/licence.js
// ---------------------------------------------------------------------------

// GET /api/super-admin/licences/etat - la cle de signature est-elle configuree sur ce serveur ? (+ cle publique)
router.get("/licences/etat", async (req, res) => {
  const publique = licenceSvc.clePubliqueConfiguree();
  res.json({ cle_signature_configuree: !!publique, cle_publique: publique });
});

// POST /api/super-admin/licences/verifier - controle une cle (signature + etat a la date du jour). Corps : { cle }.
router.post("/licences/verifier", async (req, res) => {
  const publique = licenceSvc.clePubliqueConfiguree();
  if (!publique) return res.status(503).json({ error: t(req, "SUPER_ADMIN_LICENCE_SANS_CLE") });
  const v = licenceSvc.verifierLicence(req.body && req.body.cle, publique);
  if (!v.valide) return res.status(400).json({ valide: false, erreur: v.erreur });
  const { admin, ...resume } = v.payload;
  res.json({ valide: true, licence: resume, avec_activation: !!admin, ...licenceSvc.etatLicence(v.payload, new Date().toISOString().slice(0, 10)) });
});

// GET /api/super-admin/clients/:id/licences - licences deja emises pour ce client
router.get("/clients/:id/licences", async (req, res) => {
  try {
    const result = await db.query(
      `SELECT id, numero_serie, date_emission, date_debut, date_fin, max_utilisateurs, modules_json, cle, facture_id
       FROM licence_emise WHERE tenant_id = $1 ORDER BY date_emission DESC`,
      [req.params.id]
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: t(req, "SUPER_ADMIN_CLIENTS_FETCH_ERROR") });
  }
});

// POST /api/super-admin/clients/:id/licence - genere la cle de licence d'un client en mode LOCAL.
// Corps (tous facultatifs) : { date_debut: "AAAA-MM-JJ" (defaut aujourd'hui), duree_mois: 12, generer_facture: true,
//   inclure_activation: bool (defaut : vrai si c'est la premiere licence du client) }.
// - Premiere licence = "activation" : elle embarque le premier compte administrateur (nom, e-mail, EMPREINTE d'un mot
//   de passe temporaire neuf, jamais le mot de passe lui-meme) ; le mot de passe temporaire est renvoye UNE seule fois
//   dans la reponse, a transmettre au client a part. Une licence de renouvellement ne contient pas ce bloc.
// - Genere aussi la facture de licence (formule : prix annuel au prorata de la duree + supplement comptabilite si le
//   module est actif) sauf generer_facture = false.
router.post("/clients/:id/licence", async (req, res) => {
  const body = req.body || {};
  const dureeMois = body.duree_mois === undefined ? 12 : Number(body.duree_mois);
  if (!Number.isInteger(dureeMois) || dureeMois < 1 || dureeMois > 60) {
    return res.status(400).json({ error: t(req, "SUPER_ADMIN_LICENCE_PARAMS_INVALID") });
  }
  const debut = body.date_debut || new Date().toISOString().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(debut) || Number.isNaN(Date.parse(debut))) {
    return res.status(400).json({ error: t(req, "SUPER_ADMIN_LICENCE_PARAMS_INVALID") });
  }
  if (!licenceSvc.chargerClePrivee()) {
    return res.status(503).json({ error: t(req, "SUPER_ADMIN_LICENCE_SANS_CLE") });
  }

  const client = await db.pool.connect();
  try {
    await client.query("BEGIN");
    const tenantResult = await client.query(
      `SELECT te.id, te.raison_sociale, te.pays, te.secteur_activite, te.mode_hebergement,
              te.module_comptabilite_actif, te.module_comptabilite_prix_mensuel_xof,
              te.module_fiscalite_actif, te.module_fiscalite_prix_mensuel_xof,
              te.formule_abonnement_id, fa.nom AS formule_nom, fa.plafond_utilisateurs, fa.prix_licence_annuelle_xof
       FROM tenant te LEFT JOIN formule_abonnement fa ON fa.id = te.formule_abonnement_id
       WHERE te.id = $1 FOR UPDATE OF te`,
      [req.params.id]
    );
    const tenant = tenantResult.rows[0];
    if (!tenant) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: t(req, "SUPER_ADMIN_CLIENT_NOT_FOUND") });
    }
    if (tenant.mode_hebergement !== "LOCAL") {
      await client.query("ROLLBACK");
      return res.status(409).json({ error: t(req, "SUPER_ADMIN_LICENCE_CLIENT_HEBERGE") });
    }
    if (!tenant.formule_abonnement_id) {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: t(req, "SUPER_ADMIN_CLIENT_SANS_FORMULE") });
    }

    const nbPrecedentes = Number((await client.query(`SELECT COUNT(*) AS n FROM licence_emise WHERE tenant_id = $1`, [tenant.id])).rows[0].n);
    const inclureActivation = body.inclure_activation === undefined ? nbPrecedentes === 0 : !!body.inclure_activation;

    // Date de fin = debut + duree_mois - 1 jour
    const d = new Date(`${debut}T00:00:00Z`);
    d.setUTCMonth(d.getUTCMonth() + dureeMois);
    d.setUTCDate(d.getUTCDate() - 1);
    const fin = d.toISOString().slice(0, 10);

    const annee = debut.slice(0, 4);
    const nbAnnee = Number((await client.query(`SELECT COUNT(*) AS n FROM licence_emise WHERE numero_serie LIKE $1`, [`LIC-${annee}-%`])).rows[0].n);
    const numeroSerie = `LIC-${annee}-${String(nbAnnee + 1).padStart(4, "0")}`;

    const modules = { comptabilite: !!tenant.module_comptabilite_actif, fiscalite: !!tenant.module_fiscalite_actif };
    const payload = {
      v: 1,
      serie: numeroSerie,
      client: tenant.raison_sociale,
      pays: tenant.pays,
      secteur: tenant.secteur_activite || null,
      formule: tenant.formule_nom,
      max_utilisateurs: tenant.plafond_utilisateurs ?? null,
      modules,
      debut,
      fin,
      emis: new Date().toISOString(),
    };

    let premierAdmin = null;
    if (inclureActivation) {
      const admin = (
        await client.query(
          `SELECT u.nom, u.prenom, u.email FROM utilisateur u
           JOIN utilisateur_role ur ON ur.utilisateur_id = u.id JOIN role r ON r.id = ur.role_id AND r.code = 'ADMIN'
           WHERE u.tenant_id = $1 ORDER BY u.date_creation ASC LIMIT 1`,
          [tenant.id]
        )
      ).rows[0];
      if (!admin) {
        await client.query("ROLLBACK");
        return res.status(409).json({ error: t(req, "SUPER_ADMIN_LICENCE_SANS_ADMIN") });
      }
      const motDePasseTemporaire = genererMotDePasseTemporaire(admin.prenom);
      payload.admin = {
        nom: admin.nom,
        prenom: admin.prenom,
        email: admin.email,
        mot_de_passe_hash: await bcrypt.hash(motDePasseTemporaire, 10),
      };
      premierAdmin = { nom: admin.nom, prenom: admin.prenom, email: admin.email, mot_de_passe_temporaire: motDePasseTemporaire };
    }

    const cle = licenceSvc.signerLicence(payload);

    // Facture de licence (prix annuel de la formule au prorata + supplement comptabilite sur la duree)
    let factureId = null;
    if (body.generer_facture !== false) {
      const supplement = tenant.module_comptabilite_actif ? (Number(tenant.module_comptabilite_prix_mensuel_xof) || 0) * dureeMois : 0;
      const supplementFisc = tenant.module_fiscalite_actif ? (Number(tenant.module_fiscalite_prix_mensuel_xof) || 0) * dureeMois : 0;
      const montant = Math.round((Number(tenant.prix_licence_annuelle_xof) * dureeMois) / 12) + supplement + supplementFisc;
      const factureResult = await client.query(
        `INSERT INTO facture_abonnement (id, tenant_id, formule_abonnement_id, formule_nom, periode, montant_xof, type_facture,
                                         plafond_utilisateurs_facture, supplement_comptabilite_xof, supplement_fiscalite_xof, notes)
         VALUES ($1, $2, $3, $4, $5, $6, 'LICENCE', $7, $8, $9, $10) RETURNING id`,
        [uuidv4(), tenant.id, tenant.formule_abonnement_id, tenant.formule_nom, debut.slice(0, 7), montant,
         tenant.plafond_utilisateurs ?? null, supplement, supplementFisc, `Licence ${numeroSerie} du ${debut} au ${fin}`]
      );
      factureId = factureResult.rows[0].id;
    }

    const licenceResult = await client.query(
      `INSERT INTO licence_emise (id, tenant_id, numero_serie, date_debut, date_fin, max_utilisateurs, modules_json, cle, facture_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING id, numero_serie, date_emission, date_debut, date_fin, max_utilisateurs, modules_json, cle, facture_id`,
      [uuidv4(), tenant.id, numeroSerie, debut, fin, tenant.plafond_utilisateurs ?? null, JSON.stringify(modules), cle, factureId]
    );
    await client.query("COMMIT");

    res.status(201).json({ ...licenceResult.rows[0], avec_activation: inclureActivation, premier_administrateur: premierAdmin });
  } catch (err) {
    await client.query("ROLLBACK");
    if (err.code === "23505") {
      return res.status(409).json({ error: t(req, "SUPER_ADMIN_FACTURE_ALREADY_EXISTS") });
    }
    console.error(err);
    res.status(500).json({ error: t(req, "SUPER_ADMIN_LICENCE_GENERATE_ERROR") });
  } finally {
    client.release();
  }
});

// PATCH /api/super-admin/clients/:id/suspendre - bloque immediatement toute
// connexion pour ce client (voir routes/auth.js, verification tenant.actif),
// donnees entierement conservees, reversible via /reactiver.
router.patch("/clients/:id/suspendre", async (req, res) => {
  try {
    const result = await db.query(
      `UPDATE tenant SET actif = false WHERE id = $1 RETURNING id`,
      [req.params.id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: t(req, "SUPER_ADMIN_CLIENT_NOT_FOUND") });
    }
    const clientResult = await db.query(`${SELECT_CLIENT} WHERE te.id = $1`, [req.params.id]);
    res.json(clientResult.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: t(req, "SUPER_ADMIN_CLIENT_UPDATE_ERROR") });
  }
});

// PATCH /api/super-admin/clients/:id/reactiver
router.patch("/clients/:id/reactiver", async (req, res) => {
  try {
    const result = await db.query(
      `UPDATE tenant SET actif = true WHERE id = $1 RETURNING id`,
      [req.params.id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: t(req, "SUPER_ADMIN_CLIENT_NOT_FOUND") });
    }
    const clientResult = await db.query(`${SELECT_CLIENT} WHERE te.id = $1`, [req.params.id]);
    res.json(clientResult.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: t(req, "SUPER_ADMIN_CLIENT_UPDATE_ERROR") });
  }
});

// ---------------------------------------------------------------------------
// Formules d'abonnement (catalogue plateforme, pas de tenant_id)
// ---------------------------------------------------------------------------

// GET /api/super-admin/formules - toutes les formules, actives ou non (le
// Super Admin doit pouvoir voir/gerer aussi celles retirees du catalogue,
// encore utilisees par des clients existants). Le frontend filtre lui-meme
// sur `actif` pour ne proposer que les formules assignables a un NOUVEAU
// client.
router.get("/formules", async (req, res) => {
  try {
    const result = await db.query(`SELECT * FROM formule_abonnement ORDER BY ordre_affichage ASC, nom ASC`);
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: t(req, "SUPER_ADMIN_FORMULE_FETCH_ERROR") });
  }
});

// POST /api/super-admin/formules
router.post("/formules", async (req, res) => {
  const { nom, plafond_utilisateurs, prix_mensuel_xof, ordre_affichage, frais_installation_xof, prix_licence_annuelle_xof } = req.body;
  if (!nom || prix_mensuel_xof === undefined || prix_mensuel_xof === null) {
    return res.status(400).json({ error: t(req, "SUPER_ADMIN_FORMULE_FIELDS_REQUIRED") });
  }
  try {
    const result = await db.query(
      `INSERT INTO formule_abonnement (id, nom, plafond_utilisateurs, prix_mensuel_xof, ordre_affichage, frais_installation_xof, prix_licence_annuelle_xof)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [uuidv4(), nom, plafond_utilisateurs || null, prix_mensuel_xof, ordre_affichage || 0, frais_installation_xof || 0, prix_licence_annuelle_xof || 0]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: t(req, "SUPER_ADMIN_FORMULE_CREATE_ERROR") });
  }
});

// PATCH /api/super-admin/formules/:id - modifie une formule EXISTANTE en
// place (nom/prix/plafond/frais d'installation/actif). Ne touche jamais les
// factures deja generees (formule_nom/montant_xof y sont figes, voir
// migration 014) : un changement de frais_installation_xof ici ne modifie
// jamais une facture d'installation deja generee pour un client existant.
router.patch("/formules/:id", async (req, res) => {
  const { nom, plafond_utilisateurs, prix_mensuel_xof, ordre_affichage, actif, frais_installation_xof, prix_licence_annuelle_xof } = req.body;
  try {
    const existing = await db.query(`SELECT id FROM formule_abonnement WHERE id = $1`, [req.params.id]);
    if (existing.rows.length === 0) {
      return res.status(404).json({ error: t(req, "SUPER_ADMIN_FORMULE_NOT_FOUND") });
    }
    const result = await db.query(
      `UPDATE formule_abonnement SET
         nom = COALESCE($1, nom),
         plafond_utilisateurs = $2,
         prix_mensuel_xof = COALESCE($3, prix_mensuel_xof),
         ordre_affichage = COALESCE($4, ordre_affichage),
         actif = COALESCE($5, actif),
         frais_installation_xof = COALESCE($6, frais_installation_xof),
         prix_licence_annuelle_xof = COALESCE($8, prix_licence_annuelle_xof)
       WHERE id = $7
       RETURNING *`,
      [nom, plafond_utilisateurs ?? null, prix_mensuel_xof, ordre_affichage, actif, frais_installation_xof, req.params.id, prix_licence_annuelle_xof]
    );
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: t(req, "SUPER_ADMIN_FORMULE_UPDATE_ERROR") });
  }
});

// ---------------------------------------------------------------------------
// Facturation mensuelle (suivi manuel - pas de paiement en ligne, decision
// actee avec Steeve le 04/09/2026)
// ---------------------------------------------------------------------------

const SELECT_FACTURE = `
  SELECT f.id, f.tenant_id, f.formule_abonnement_id, f.formule_nom, f.periode, f.montant_xof,
         f.plafond_utilisateurs_facture, f.supplement_comptabilite_xof, f.supplement_fiscalite_xof,
         f.type_facture, f.statut, f.date_generation, f.date_paiement, f.mode_paiement, f.notes,
         te.raison_sociale AS client_raison_sociale, te.adresse AS client_adresse
  FROM facture_abonnement f
  JOIN tenant te ON te.id = f.tenant_id
`;

// GET /api/super-admin/factures/:id - detail complet, pour l'affichage et
// l'impression d'une facture d'abonnement (voir
// frontend/app/super-admin/factures/[id]/page.js).
router.get("/factures/:id", async (req, res) => {
  try {
    const result = await db.query(`${SELECT_FACTURE} WHERE f.id = $1`, [req.params.id]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: t(req, "SUPER_ADMIN_FACTURE_NOT_FOUND") });
    }
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: t(req, "SUPER_ADMIN_FACTURE_FETCH_ERROR") });
  }
});

// GET /api/super-admin/factures - vue globale (toutes les entreprises), pour
// reperer d'un coup d'oeil les impayes. Filtre optionnel ?statut=IMPAYEE
router.get("/factures", async (req, res) => {
  const { statut } = req.query;
  try {
    const params = [];
    let where = "";
    if (statut) {
      params.push(statut);
      where = `WHERE f.statut = $${params.length}`;
    }
    const result = await db.query(
      `${SELECT_FACTURE} ${where} ORDER BY f.periode DESC, te.raison_sociale ASC`,
      params
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: t(req, "SUPER_ADMIN_FACTURE_FETCH_ERROR") });
  }
});

// GET /api/super-admin/clients/:id/factures - historique d'un client
router.get("/clients/:id/factures", async (req, res) => {
  try {
    const result = await db.query(
      `${SELECT_FACTURE} WHERE f.tenant_id = $1 ORDER BY f.periode DESC`,
      [req.params.id]
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: t(req, "SUPER_ADMIN_FACTURE_FETCH_ERROR") });
  }
});

// POST /api/super-admin/clients/:id/factures/generer - genere la facture du
// mois courant (ou du mois fourni) pour ce client, a partir de sa formule
// ACTUELLE (nom/prix figes dans la facture au moment de la generation, voir
// migration 014 - et depuis la migration 022, le plafond d'utilisateurs
// aussi, pour que le descriptif de la ligne reste celui reellement vendu ce
// mois-la meme si la formule evolue ensuite). Idempotent par construction :
// la contrainte unique (tenant_id, periode) empeche un doublon pour le meme
// mois.
router.post("/clients/:id/factures/generer", async (req, res) => {
  const periode = (req.body && req.body.periode) || new Date().toISOString().slice(0, 7); // "AAAA-MM"

  try {
    const clientResult = await db.query(
      `SELECT te.id, te.formule_abonnement_id, fa.nom AS formule_nom, fa.prix_mensuel_xof,
              fa.plafond_utilisateurs, te.module_comptabilite_actif, te.module_comptabilite_prix_mensuel_xof,
              te.module_fiscalite_actif, te.module_fiscalite_prix_mensuel_xof,
              te.mode_hebergement
       FROM tenant te LEFT JOIN formule_abonnement fa ON fa.id = te.formule_abonnement_id
       WHERE te.id = $1`,
      [req.params.id]
    );
    const client = clientResult.rows[0];
    if (!client) {
      return res.status(404).json({ error: t(req, "SUPER_ADMIN_CLIENT_NOT_FOUND") });
    }
    // Client installe en local : pas d'abonnement mensuel, sa facturation passe par la licence annuelle.
    if (client.mode_hebergement === "LOCAL") {
      return res.status(409).json({ error: t(req, "SUPER_ADMIN_CLIENT_LOCAL_PAS_ABONNEMENT") });
    }
    if (!client.formule_abonnement_id) {
      return res.status(400).json({ error: t(req, "SUPER_ADMIN_CLIENT_SANS_FORMULE") });
    }

    // Module Comptabilite actif : son supplement mensuel s'ajoute a la facture
    // (fige ici, montant_xof = total formule + supplement).
    const supplementCompta = client.module_comptabilite_actif ? Number(client.module_comptabilite_prix_mensuel_xof) || 0 : 0;
    const supplementFisc = client.module_fiscalite_actif ? Number(client.module_fiscalite_prix_mensuel_xof) || 0 : 0;
    const result = await db.query(
      `INSERT INTO facture_abonnement (id, tenant_id, formule_abonnement_id, formule_nom, periode, montant_xof, type_facture, plafond_utilisateurs_facture, supplement_comptabilite_xof, supplement_fiscalite_xof)
       VALUES ($1, $2, $3, $4, $5, $6, 'ABONNEMENT', $7, $8, $9)
       RETURNING id`,
      [
        uuidv4(),
        client.id,
        client.formule_abonnement_id,
        client.formule_nom,
        periode,
        Number(client.prix_mensuel_xof) + supplementCompta + supplementFisc,
        client.plafond_utilisateurs ?? null,
        supplementCompta,
        supplementFisc,
      ]
    );

    const factureResult = await db.query(`${SELECT_FACTURE} WHERE f.id = $1`, [result.rows[0].id]);
    res.status(201).json(factureResult.rows[0]);
  } catch (err) {
    if (err.code === "23505") {
      return res.status(409).json({ error: t(req, "SUPER_ADMIN_FACTURE_ALREADY_EXISTS") });
    }
    console.error(err);
    res.status(500).json({ error: t(req, "SUPER_ADMIN_FACTURE_GENERATE_ERROR") });
  }
});

// POST /api/super-admin/clients/:id/factures/generer-installation - genere
// (au besoin, hors creation du client) les frais d'installation de la
// formule ACTUELLE du client - typiquement utilise quand la formule a ete
// assignee APRES la creation du client (a la creation, voir POST /clients
// ci-dessus qui la genere automatiquement si une formule est deja choisie).
// Meme logique de gel que la facture d'abonnement : montant fige au moment
// de la generation, jamais retroactif. Idempotent par construction : la
// contrainte unique (tenant_id, periode, type_facture) empeche un doublon
// pour le meme mois.
router.post("/clients/:id/factures/generer-installation", async (req, res) => {
  const periode = (req.body && req.body.periode) || new Date().toISOString().slice(0, 7); // "AAAA-MM"

  try {
    const clientResult = await db.query(
      `SELECT te.id, te.formule_abonnement_id, fa.nom AS formule_nom, fa.frais_installation_xof,
              fa.plafond_utilisateurs
       FROM tenant te LEFT JOIN formule_abonnement fa ON fa.id = te.formule_abonnement_id
       WHERE te.id = $1`,
      [req.params.id]
    );
    const client = clientResult.rows[0];
    if (!client) {
      return res.status(404).json({ error: t(req, "SUPER_ADMIN_CLIENT_NOT_FOUND") });
    }
    if (!client.formule_abonnement_id) {
      return res.status(400).json({ error: t(req, "SUPER_ADMIN_CLIENT_SANS_FORMULE") });
    }

    const result = await db.query(
      `INSERT INTO facture_abonnement (id, tenant_id, formule_abonnement_id, formule_nom, periode, montant_xof, type_facture, plafond_utilisateurs_facture)
       VALUES ($1, $2, $3, $4, $5, $6, 'INSTALLATION', $7)
       RETURNING id`,
      [
        uuidv4(),
        client.id,
        client.formule_abonnement_id,
        client.formule_nom,
        periode,
        client.frais_installation_xof,
        client.plafond_utilisateurs ?? null,
      ]
    );

    const factureResult = await db.query(`${SELECT_FACTURE} WHERE f.id = $1`, [result.rows[0].id]);
    res.status(201).json(factureResult.rows[0]);
  } catch (err) {
    if (err.code === "23505") {
      return res.status(409).json({ error: t(req, "SUPER_ADMIN_FACTURE_ALREADY_EXISTS") });
    }
    console.error(err);
    res.status(500).json({ error: t(req, "SUPER_ADMIN_FACTURE_GENERATE_ERROR") });
  }
});

// PATCH /api/super-admin/factures/:id/marquer-payee
router.patch("/factures/:id/marquer-payee", async (req, res) => {
  const { mode_paiement, notes } = req.body;
  try {
    const result = await db.query(
      `UPDATE facture_abonnement
       SET statut = 'PAYEE', date_paiement = now(), mode_paiement = $1, notes = COALESCE($2, notes)
       WHERE id = $3 AND statut != 'ANNULEE'
       RETURNING id`,
      [mode_paiement || null, notes, req.params.id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: t(req, "SUPER_ADMIN_FACTURE_NOT_FOUND") });
    }
    const factureResult = await db.query(`${SELECT_FACTURE} WHERE f.id = $1`, [req.params.id]);
    res.json(factureResult.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: t(req, "SUPER_ADMIN_FACTURE_UPDATE_ERROR") });
  }
});

// PATCH /api/super-admin/factures/:id/annuler - corrige une facture generee
// par erreur (ex: mauvaise periode) sans la supprimer (garde une trace).
router.patch("/factures/:id/annuler", async (req, res) => {
  try {
    const result = await db.query(
      `UPDATE facture_abonnement SET statut = 'ANNULEE' WHERE id = $1 RETURNING id`,
      [req.params.id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: t(req, "SUPER_ADMIN_FACTURE_NOT_FOUND") });
    }
    const factureResult = await db.query(`${SELECT_FACTURE} WHERE f.id = $1`, [req.params.id]);
    res.json(factureResult.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: t(req, "SUPER_ADMIN_FACTURE_UPDATE_ERROR") });
  }
});

module.exports = router;
