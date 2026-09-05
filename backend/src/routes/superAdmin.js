const express = require("express");
const bcrypt = require("bcryptjs");
const multer = require("multer");
const db = require("../db");
const { v4: uuidv4 } = require("uuid");
const { signToken } = require("../utils/jwt");
const { requireSuperAdmin } = require("../middleware/auth");
const { t } = require("../utils/i18n");
const { genererMotDePasseTemporaire } = require("../utils/motDePasseTemporaire");

const router = express.Router();

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

// GET /api/super-admin/parametres/entete
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
  try {
    const result = await db.query(
      `UPDATE plateforme_parametres
       SET raison_sociale = $1, adresse = $2, telephone = $3, email = $4,
           rccm = $5, ninea = $6, site_web = $7, coordonnees_bancaires = $8
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
         fa.nom AS formule_nom, fa.prix_mensuel_xof AS formule_prix_mensuel_xof,
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
    res.json({ ...client, utilisateurs: usersResult.rows });
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

  const client = await db.pool.connect();
  try {
    await client.query("BEGIN");

    const tenantResult = await client.query(
      `INSERT INTO tenant (id, raison_sociale, secteur_activite, pays, formule_abonnement_id)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id`,
      [uuidv4(), raison_sociale, secteur_activite || null, pays || "Senegal", formule_abonnement_id || null]
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
        `SELECT nom, frais_installation_xof FROM formule_abonnement WHERE id = $1`,
        [formule_abonnement_id]
      );
      const formule = formuleResult.rows[0];
      if (formule && Number(formule.frais_installation_xof) > 0) {
        const periode = new Date().toISOString().slice(0, 7);
        const factureResult = await client.query(
          `INSERT INTO facture_abonnement (id, tenant_id, formule_abonnement_id, formule_nom, periode, montant_xof, type_facture)
           VALUES ($1, $2, $3, $4, $5, $6, 'INSTALLATION')
           RETURNING id`,
          [uuidv4(), tenantId, formule_abonnement_id, formule.nom, periode, formule.frais_installation_xof]
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
  const { nom, plafond_utilisateurs, prix_mensuel_xof, ordre_affichage, frais_installation_xof } = req.body;
  if (!nom || prix_mensuel_xof === undefined || prix_mensuel_xof === null) {
    return res.status(400).json({ error: t(req, "SUPER_ADMIN_FORMULE_FIELDS_REQUIRED") });
  }
  try {
    const result = await db.query(
      `INSERT INTO formule_abonnement (id, nom, plafond_utilisateurs, prix_mensuel_xof, ordre_affichage, frais_installation_xof)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [uuidv4(), nom, plafond_utilisateurs || null, prix_mensuel_xof, ordre_affichage || 0, frais_installation_xof || 0]
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
  const { nom, plafond_utilisateurs, prix_mensuel_xof, ordre_affichage, actif, frais_installation_xof } = req.body;
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
         frais_installation_xof = COALESCE($6, frais_installation_xof)
       WHERE id = $7
       RETURNING *`,
      [nom, plafond_utilisateurs ?? null, prix_mensuel_xof, ordre_affichage, actif, frais_installation_xof, req.params.id]
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
// migration 014). Idempotent par construction : la contrainte unique
// (tenant_id, periode) empeche un doublon pour le meme mois.
router.post("/clients/:id/factures/generer", async (req, res) => {
  const periode = (req.body && req.body.periode) || new Date().toISOString().slice(0, 7); // "AAAA-MM"

  try {
    const clientResult = await db.query(
      `SELECT te.id, te.formule_abonnement_id, fa.nom AS formule_nom, fa.prix_mensuel_xof
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
      `INSERT INTO facture_abonnement (id, tenant_id, formule_abonnement_id, formule_nom, periode, montant_xof, type_facture)
       VALUES ($1, $2, $3, $4, $5, $6, 'ABONNEMENT')
       RETURNING id`,
      [uuidv4(), client.id, client.formule_abonnement_id, client.formule_nom, periode, client.prix_mensuel_xof]
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
      `SELECT te.id, te.formule_abonnement_id, fa.nom AS formule_nom, fa.frais_installation_xof
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
      `INSERT INTO facture_abonnement (id, tenant_id, formule_abonnement_id, formule_nom, periode, montant_xof, type_facture)
       VALUES ($1, $2, $3, $4, $5, $6, 'INSTALLATION')
       RETURNING id`,
      [uuidv4(), client.id, client.formule_abonnement_id, client.formule_nom, periode, client.frais_installation_xof]
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
