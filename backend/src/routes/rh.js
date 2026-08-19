const express = require("express");
const db = require("../db");
const { requireAuth, requireRole } = require("../middleware/auth");
const { t } = require("../utils/i18n");

const router = express.Router();
router.use(requireAuth);

// ----------------------------------------------------------------------------
// Module 9 - RH (etape 1/5 : Dossiers du personnel)
//
// Contrairement aux modules de donnees de reference (Parc auto, fournisseurs,
// maitre_ouvrage, concurrence - ouverts a tout utilisateur authentifie car
// OGAA n'y garantit pas de codes de role fixes chez un tenant Baobab), la
// fiche employe porte des donnees personnelles (contact d'urgence, solde de
// conges). Decision explicite : la liste complete et la gestion des fiches
// d'AUTRUI restent reservees a ADMIN ; chacun peut toujours consulter/tenir
// a jour SA PROPRE fiche via /moi. A affiner plus tard (delegation a un role
// RH designe par tenant) une fois perimetre_json branche.
// ----------------------------------------------------------------------------

const SELECT_FICHE = `
  SELECT e.id, e.tenant_id, e.utilisateur_id, e.poste, e.type_contrat,
         e.date_embauche, e.date_fin_contrat, e.telephone,
         e.contact_urgence_nom, e.contact_urgence_telephone,
         e.solde_conges, e.statut,
         u.nom, u.prenom, u.email
  FROM employe e
  JOIN utilisateur u ON u.id = e.utilisateur_id
  WHERE e.tenant_id = $1
`;

async function chargerRolesParEmploye(tenantId, utilisateurIds) {
  if (utilisateurIds.length === 0) return {};
  const result = await db.query(
    `SELECT ur.utilisateur_id, r.code, r.libelle
     FROM utilisateur_role ur
     JOIN role r ON r.id = ur.role_id
     WHERE ur.utilisateur_id = ANY($1::uuid[]) AND r.tenant_id = $2`,
    [utilisateurIds, tenantId]
  );
  const map = {};
  for (const row of result.rows) {
    if (!map[row.utilisateur_id]) map[row.utilisateur_id] = [];
    map[row.utilisateur_id].push({ code: row.code, libelle: row.libelle });
  }
  return map;
}

// GET /api/rh/personnel - liste complete (ADMIN)
router.get("/personnel", requireRole("ADMIN"), async (req, res) => {
  try {
    const result = await db.query(`${SELECT_FICHE} ORDER BY u.nom ASC, u.prenom ASC`, [req.user.tenantId]);
    const rolesParUtilisateur = await chargerRolesParEmploye(
      req.user.tenantId,
      result.rows.map((r) => r.utilisateur_id)
    );
    const personnel = result.rows.map((row) => ({ ...row, roles: rolesParUtilisateur[row.utilisateur_id] || [] }));
    res.json(personnel);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: t(req, "RH_PERSONNEL_FETCH_ERROR") });
  }
});

// GET /api/rh/personnel/moi - sa propre fiche (tout utilisateur authentifie)
router.get("/personnel/moi", async (req, res) => {
  try {
    const result = await db.query(
      `${SELECT_FICHE} AND e.utilisateur_id = $2`,
      [req.user.tenantId, req.user.sub]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: t(req, "RH_FICHE_NOT_FOUND") });
    }
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: t(req, "RH_PERSONNEL_FETCH_ERROR") });
  }
});

// GET /api/rh/personnel/utilisateurs-disponibles - utilisateurs du tenant
// n'ayant pas encore de fiche employe (pour le formulaire de creation).
// ADMIN uniquement (meme perimetre que la creation elle-meme).
router.get("/personnel/utilisateurs-disponibles", requireRole("ADMIN"), async (req, res) => {
  try {
    const result = await db.query(
      `SELECT u.id, u.nom, u.prenom, u.email
       FROM utilisateur u
       WHERE u.tenant_id = $1 AND u.actif = true
         AND NOT EXISTS (SELECT 1 FROM employe e WHERE e.utilisateur_id = u.id)
       ORDER BY u.nom ASC, u.prenom ASC`,
      [req.user.tenantId]
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: t(req, "RH_PERSONNEL_FETCH_ERROR") });
  }
});

// GET /api/rh/personnel/:id - une fiche (ADMIN, ou la personne elle-meme)
router.get("/personnel/:id", async (req, res) => {
  try {
    const result = await db.query(`${SELECT_FICHE} AND e.id = $2`, [req.user.tenantId, req.params.id]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: t(req, "RH_FICHE_NOT_FOUND") });
    }
    const fiche = result.rows[0];
    const estAdmin = req.user.roles.includes("ADMIN");
    if (!estAdmin && fiche.utilisateur_id !== req.user.sub) {
      return res.status(403).json({ error: t(req, "ROLE_FORBIDDEN") });
    }
    const rolesParUtilisateur = await chargerRolesParEmploye(req.user.tenantId, [fiche.utilisateur_id]);
    res.json({ ...fiche, roles: rolesParUtilisateur[fiche.utilisateur_id] || [] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: t(req, "RH_PERSONNEL_FETCH_ERROR") });
  }
});

// POST /api/rh/personnel - creation d'une fiche employe pour un utilisateur
// existant du tenant (ADMIN).
router.post("/personnel", requireRole("ADMIN"), async (req, res) => {
  const {
    utilisateur_id,
    poste,
    type_contrat,
    date_embauche,
    telephone,
    contact_urgence_nom,
    contact_urgence_telephone,
    solde_conges,
  } = req.body;

  if (!utilisateur_id) {
    return res.status(400).json({ error: t(req, "RH_UTILISATEUR_REQUIRED") });
  }

  try {
    const utilisateurCheck = await db.query(
      `SELECT id FROM utilisateur WHERE id = $1 AND tenant_id = $2`,
      [utilisateur_id, req.user.tenantId]
    );
    if (utilisateurCheck.rows.length === 0) {
      return res.status(400).json({ error: t(req, "RH_UTILISATEUR_INVALID") });
    }

    const insertResult = await db.query(
      `INSERT INTO employe (tenant_id, utilisateur_id, poste, type_contrat, date_embauche,
                             telephone, contact_urgence_nom, contact_urgence_telephone, solde_conges)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING id`,
      [
        req.user.tenantId,
        utilisateur_id,
        poste || null,
        type_contrat || null,
        date_embauche || null,
        telephone || null,
        contact_urgence_nom || null,
        contact_urgence_telephone || null,
        solde_conges != null && solde_conges !== "" ? Number(solde_conges) : 0,
      ]
    );

    const fiche = await db.query(`${SELECT_FICHE} AND e.id = $2`, [req.user.tenantId, insertResult.rows[0].id]);
    const rolesParUtilisateur = await chargerRolesParEmploye(req.user.tenantId, [fiche.rows[0].utilisateur_id]);
    res.status(201).json({ ...fiche.rows[0], roles: rolesParUtilisateur[fiche.rows[0].utilisateur_id] || [] });
  } catch (err) {
    if (err.code === "23505") {
      return res.status(409).json({ error: t(req, "RH_FICHE_ALREADY_EXISTS") });
    }
    console.error(err);
    res.status(500).json({ error: t(req, "RH_FICHE_CREATE_ERROR") });
  }
});

// PATCH /api/rh/personnel/:id - mise a jour (ADMIN, ou la personne elle-meme
// pour ses seuls champs de contact - pas poste/type_contrat/solde_conges/statut).
router.patch("/personnel/:id", async (req, res) => {
  try {
    const ficheActuelle = await db.query(`SELECT utilisateur_id FROM employe WHERE id = $1 AND tenant_id = $2`, [
      req.params.id,
      req.user.tenantId,
    ]);
    if (ficheActuelle.rows.length === 0) {
      return res.status(404).json({ error: t(req, "RH_FICHE_NOT_FOUND") });
    }
    const estAdmin = req.user.roles.includes("ADMIN");
    const estSoiMeme = ficheActuelle.rows[0].utilisateur_id === req.user.sub;
    if (!estAdmin && !estSoiMeme) {
      return res.status(403).json({ error: t(req, "ROLE_FORBIDDEN") });
    }

    const { poste, type_contrat, date_embauche, date_fin_contrat, telephone,
            contact_urgence_nom, contact_urgence_telephone, solde_conges, statut } = req.body;

    // Une personne non-ADMIN ne peut modifier que ses coordonnees de contact,
    // pas son poste, son contrat, son solde de conges ni son statut.
    const champsAutorises = estAdmin
      ? { poste, type_contrat, date_embauche, date_fin_contrat, telephone,
          contact_urgence_nom, contact_urgence_telephone, solde_conges, statut }
      : { telephone, contact_urgence_nom, contact_urgence_telephone };

    const result = await db.query(
      `UPDATE employe
       SET poste = COALESCE($1, poste),
           type_contrat = COALESCE($2, type_contrat),
           date_embauche = COALESCE($3, date_embauche),
           date_fin_contrat = COALESCE($4, date_fin_contrat),
           telephone = COALESCE($5, telephone),
           contact_urgence_nom = COALESCE($6, contact_urgence_nom),
           contact_urgence_telephone = COALESCE($7, contact_urgence_telephone),
           solde_conges = COALESCE($8, solde_conges),
           statut = COALESCE($9, statut)
       WHERE id = $10 AND tenant_id = $11
       RETURNING id`,
      [
        champsAutorises.poste || null,
        champsAutorises.type_contrat || null,
        champsAutorises.date_embauche || null,
        champsAutorises.date_fin_contrat || null,
        champsAutorises.telephone || null,
        champsAutorises.contact_urgence_nom || null,
        champsAutorises.contact_urgence_telephone || null,
        champsAutorises.solde_conges != null && champsAutorises.solde_conges !== "" ? Number(champsAutorises.solde_conges) : null,
        champsAutorises.statut || null,
        req.params.id,
        req.user.tenantId,
      ]
    );

    const fiche = await db.query(`${SELECT_FICHE} AND e.id = $2`, [req.user.tenantId, result.rows[0].id]);
    const rolesParUtilisateur = await chargerRolesParEmploye(req.user.tenantId, [fiche.rows[0].utilisateur_id]);
    res.json({ ...fiche.rows[0], roles: rolesParUtilisateur[fiche.rows[0].utilisateur_id] || [] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: t(req, "RH_FICHE_UPDATE_ERROR") });
  }
});

// ----------------------------------------------------------------------------
// Module 9 - RH (etape 2/5 : moteur de demandes RH + circuit d'approbation)
//
// Cf. reference/memo_rh_fiches_temps_ogaa.md (projet Claude) pour le detail
// du systeme OGAA d'origine. Adaptation actee : circuit d'approbation
// PARAMETRABLE par tenant (table regle_approbation_rh) plutot que la
// hierarchie a codes de role fixes d'OGAA (EMPLOYE/RT/RSE/GPA -> RH -> DAFC
// -> DGA -> DG), puisque les roles Baobab sont libres par tenant. Repli si
// aucune regle ne correspond a un role du demandeur : validation par ADMIN
// (coherent avec le bypass ADMIN deja en place partout ailleurs).
//
// Perimetre : 4 types de demande pour commencer (CONGE, AVANCE,
// ORDRE_MISSION, HEURES_SUP) - la liste n'est pas contrainte en base
// (TEXT libre), seulement cote application, pour pouvoir en ajouter sans
// migration le jour ou Steeve le demandera.
// ----------------------------------------------------------------------------

const TYPES_DEMANDE = ["CONGE", "AVANCE", "ORDRE_MISSION", "HEURES_SUP"];

const SELECT_DEMANDE = `
  SELECT d.id, d.tenant_id, d.employe_id, d.type_demande, d.details, d.statut,
         d.role_approbateur_id, d.approuve_par_utilisateur_id, d.motif_rejet,
         d.date_soumission, d.date_decision, d.date_creation,
         u.nom AS employe_nom, u.prenom AS employe_prenom, u.email AS employe_email,
         ra.code AS role_approbateur_code, ra.libelle AS role_approbateur_libelle
  FROM demande_rh d
  JOIN employe e ON e.id = d.employe_id
  JOIN utilisateur u ON u.id = e.utilisateur_id
  LEFT JOIN role ra ON ra.id = d.role_approbateur_id
  WHERE d.tenant_id = $1
`;

async function chargerEmployeCourant(tenantId, utilisateurId) {
  const result = await db.query(
    `SELECT id, solde_conges FROM employe WHERE tenant_id = $1 AND utilisateur_id = $2`,
    [tenantId, utilisateurId]
  );
  return result.rows[0] || null;
}

async function chargerRoleIdsUtilisateur(tenantId, utilisateurId) {
  const result = await db.query(
    `SELECT r.id FROM role r
     JOIN utilisateur_role ur ON ur.role_id = r.id
     WHERE ur.utilisateur_id = $1 AND r.tenant_id = $2`,
    [utilisateurId, tenantId]
  );
  return result.rows.map((r) => r.id);
}

// Calcule quel role doit approuver une demande, a partir des roles ACTUELS
// du demandeur et des regles d'approbation configurees par le tenant.
// Retourne null si aucune regle ne correspond (repli ADMIN).
async function determinerRoleApprobateur(tenantId, employeUtilisateurId) {
  const roleIds = await chargerRoleIdsUtilisateur(tenantId, employeUtilisateurId);
  if (roleIds.length === 0) return null;
  const result = await db.query(
    `SELECT role_approbateur_id FROM regle_approbation_rh
     WHERE tenant_id = $1 AND role_demandeur_id = ANY($2::uuid[])
     LIMIT 1`,
    [tenantId, roleIds]
  );
  return result.rows[0]?.role_approbateur_id || null;
}

function validerDetailsDemande(type_demande, details) {
  if (!TYPES_DEMANDE.includes(type_demande)) return "RH_TYPE_DEMANDE_INVALID";
  if (!details || typeof details !== "object" || Array.isArray(details)) return "RH_DEMANDE_DETAILS_REQUIRED";
  if (type_demande === "CONGE") {
    if (!details.date_debut || !details.date_fin || !details.nb_jours) return "RH_DEMANDE_DETAILS_REQUIRED";
  } else if (type_demande === "AVANCE") {
    if (!details.montant) return "RH_DEMANDE_DETAILS_REQUIRED";
  } else if (type_demande === "ORDRE_MISSION") {
    if (!details.destination || !details.date_debut || !details.date_fin) return "RH_DEMANDE_DETAILS_REQUIRED";
  } else if (type_demande === "HEURES_SUP") {
    if (!details.date || !details.nb_heures) return "RH_DEMANDE_DETAILS_REQUIRED";
  }
  return null;
}

// ----------------------------------------------------------------------------
// Circuit d'approbation (ADMIN uniquement)
// ----------------------------------------------------------------------------

// GET /api/rh/regles-approbation
router.get("/regles-approbation", requireRole("ADMIN"), async (req, res) => {
  try {
    const result = await db.query(
      `SELECT rr.id, rr.role_demandeur_id, rd.code AS role_demandeur_code, rd.libelle AS role_demandeur_libelle,
              rr.role_approbateur_id, ra.code AS role_approbateur_code, ra.libelle AS role_approbateur_libelle
       FROM regle_approbation_rh rr
       JOIN role rd ON rd.id = rr.role_demandeur_id
       JOIN role ra ON ra.id = rr.role_approbateur_id
       WHERE rr.tenant_id = $1
       ORDER BY rd.libelle ASC`,
      [req.user.tenantId]
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: t(req, "RH_REGLES_FETCH_ERROR") });
  }
});

// PUT /api/rh/regles-approbation - remplace l'ensemble des regles du tenant
// en une fois (plus simple a manipuler cote UI qu'un CRUD ligne par ligne).
// body: { regles: [{ role_demandeur_id, role_approbateur_id }, ...] }
router.put("/regles-approbation", requireRole("ADMIN"), async (req, res) => {
  const { regles } = req.body;
  if (!Array.isArray(regles)) {
    return res.status(400).json({ error: t(req, "RH_REGLES_INVALID") });
  }

  const client = await db.pool.connect();
  try {
    await client.query("BEGIN");

    if (regles.length > 0) {
      const roleIdsUtilises = [...new Set(regles.flatMap((r) => [r.role_demandeur_id, r.role_approbateur_id]))];
      const rolesCheck = await client.query(
        `SELECT id FROM role WHERE id = ANY($1::uuid[]) AND tenant_id = $2`,
        [roleIdsUtilises, req.user.tenantId]
      );
      if (rolesCheck.rows.length !== roleIdsUtilises.length) {
        await client.query("ROLLBACK");
        return res.status(400).json({ error: t(req, "RH_REGLES_INVALID") });
      }
      const demandeurs = regles.map((r) => r.role_demandeur_id);
      if (new Set(demandeurs).size !== demandeurs.length) {
        await client.query("ROLLBACK");
        return res.status(400).json({ error: t(req, "RH_REGLES_INVALID") });
      }
    }

    await client.query(`DELETE FROM regle_approbation_rh WHERE tenant_id = $1`, [req.user.tenantId]);
    for (const regle of regles) {
      await client.query(
        `INSERT INTO regle_approbation_rh (tenant_id, role_demandeur_id, role_approbateur_id)
         VALUES ($1, $2, $3)`,
        [req.user.tenantId, regle.role_demandeur_id, regle.role_approbateur_id]
      );
    }

    await client.query("COMMIT");

    const result = await db.query(
      `SELECT rr.id, rr.role_demandeur_id, rd.code AS role_demandeur_code, rd.libelle AS role_demandeur_libelle,
              rr.role_approbateur_id, ra.code AS role_approbateur_code, ra.libelle AS role_approbateur_libelle
       FROM regle_approbation_rh rr
       JOIN role rd ON rd.id = rr.role_demandeur_id
       JOIN role ra ON ra.id = rr.role_approbateur_id
       WHERE rr.tenant_id = $1
       ORDER BY rd.libelle ASC`,
      [req.user.tenantId]
    );
    res.json(result.rows);
  } catch (err) {
    await client.query("ROLLBACK");
    console.error(err);
    res.status(500).json({ error: t(req, "RH_REGLES_UPDATE_ERROR") });
  } finally {
    client.release();
  }
});

// ----------------------------------------------------------------------------
// Demandes RH
// ----------------------------------------------------------------------------

// GET /api/rh/demandes/mes - mes propres demandes (necessite une fiche employe)
router.get("/demandes/mes", async (req, res) => {
  try {
    const employe = await chargerEmployeCourant(req.user.tenantId, req.user.sub);
    if (!employe) {
      return res.status(404).json({ error: t(req, "RH_PAS_DE_FICHE_EMPLOYE") });
    }
    const result = await db.query(`${SELECT_DEMANDE} AND d.employe_id = $2 ORDER BY d.date_creation DESC`, [
      req.user.tenantId,
      employe.id,
    ]);
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: t(req, "RH_DEMANDES_FETCH_ERROR") });
  }
});

// GET /api/rh/demandes/a-valider - demandes SOUMISE en attente de ma
// validation (ADMIN voit tout ; les autres seulement les demandes dont le
// role_approbateur_id calcule a la soumission correspond a l'un de leurs
// roles ACTUELS).
router.get("/demandes/a-valider", async (req, res) => {
  try {
    const estAdmin = req.user.roles.includes("ADMIN");
    if (estAdmin) {
      const result = await db.query(`${SELECT_DEMANDE} AND d.statut = 'SOUMISE' ORDER BY d.date_soumission ASC`, [
        req.user.tenantId,
      ]);
      return res.json(result.rows);
    }
    const roleIds = await chargerRoleIdsUtilisateur(req.user.tenantId, req.user.sub);
    if (roleIds.length === 0) return res.json([]);
    const result = await db.query(
      `${SELECT_DEMANDE} AND d.statut = 'SOUMISE' AND d.role_approbateur_id = ANY($2::uuid[])
       ORDER BY d.date_soumission ASC`,
      [req.user.tenantId, roleIds]
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: t(req, "RH_DEMANDES_FETCH_ERROR") });
  }
});

async function chargerDemandeAvecAcces(req, res, { exigerProprietaire = false, exigerApprobateur = false } = {}) {
  const result = await db.query(`${SELECT_DEMANDE} AND d.id = $2`, [req.user.tenantId, req.params.id]);
  if (result.rows.length === 0) {
    res.status(404).json({ error: t(req, "RH_DEMANDE_NOT_FOUND") });
    return null;
  }
  const demande = result.rows[0];
  const employe = await chargerEmployeCourant(req.user.tenantId, req.user.sub);
  const estProprietaire = !!employe && employe.id === demande.employe_id;
  const estAdmin = req.user.roles.includes("ADMIN");

  if (exigerProprietaire && !estProprietaire && !estAdmin) {
    res.status(403).json({ error: t(req, "ROLE_FORBIDDEN") });
    return null;
  }
  if (exigerApprobateur && !estAdmin) {
    const roleIds = await chargerRoleIdsUtilisateur(req.user.tenantId, req.user.sub);
    const estApprobateur = demande.role_approbateur_id && roleIds.includes(demande.role_approbateur_id);
    if (!estApprobateur) {
      res.status(403).json({ error: t(req, "ROLE_FORBIDDEN") });
      return null;
    }
  }
  if (!exigerProprietaire && !exigerApprobateur && !estProprietaire && !estAdmin) {
    // Lecture simple (GET /:id) : proprietaire, approbateur potentiel ou ADMIN.
    const roleIds = await chargerRoleIdsUtilisateur(req.user.tenantId, req.user.sub);
    const estApprobateurPotentiel = demande.role_approbateur_id && roleIds.includes(demande.role_approbateur_id);
    if (!estApprobateurPotentiel) {
      res.status(403).json({ error: t(req, "ROLE_FORBIDDEN") });
      return null;
    }
  }
  return demande;
}

// GET /api/rh/demandes/:id
router.get("/demandes/:id", async (req, res) => {
  try {
    const demande = await chargerDemandeAvecAcces(req, res);
    if (!demande) return;
    res.json(demande);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: t(req, "RH_DEMANDES_FETCH_ERROR") });
  }
});

// POST /api/rh/demandes - creation en BROUILLON
router.post("/demandes", async (req, res) => {
  const { type_demande, details } = req.body;

  const erreurValidation = validerDetailsDemande(type_demande, details);
  if (erreurValidation) {
    return res.status(400).json({ error: t(req, erreurValidation) });
  }

  try {
    const employe = await chargerEmployeCourant(req.user.tenantId, req.user.sub);
    if (!employe) {
      return res.status(404).json({ error: t(req, "RH_PAS_DE_FICHE_EMPLOYE") });
    }

    const insertResult = await db.query(
      `INSERT INTO demande_rh (tenant_id, employe_id, type_demande, details)
       VALUES ($1, $2, $3, $4) RETURNING id`,
      [req.user.tenantId, employe.id, type_demande, details]
    );

    const demande = await db.query(`${SELECT_DEMANDE} AND d.id = $2`, [req.user.tenantId, insertResult.rows[0].id]);
    res.status(201).json(demande.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: t(req, "RH_DEMANDE_CREATE_ERROR") });
  }
});

// PATCH /api/rh/demandes/:id - modification (proprietaire, brouillon uniquement)
router.patch("/demandes/:id", async (req, res) => {
  try {
    const demande = await chargerDemandeAvecAcces(req, res, { exigerProprietaire: true });
    if (!demande) return;
    if (demande.statut !== "BROUILLON") {
      return res.status(400).json({ error: t(req, "RH_DEMANDE_MODIF_STATUT_INVALID") });
    }

    const type_demande = req.body.type_demande || demande.type_demande;
    const details = req.body.details || demande.details;
    const erreurValidation = validerDetailsDemande(type_demande, details);
    if (erreurValidation) {
      return res.status(400).json({ error: t(req, erreurValidation) });
    }

    await db.query(`UPDATE demande_rh SET type_demande = $1, details = $2 WHERE id = $3`, [
      type_demande,
      details,
      demande.id,
    ]);
    const maj = await db.query(`${SELECT_DEMANDE} AND d.id = $2`, [req.user.tenantId, demande.id]);
    res.json(maj.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: t(req, "RH_DEMANDE_UPDATE_ERROR") });
  }
});

// PATCH /api/rh/demandes/:id/soumettre - proprietaire, brouillon uniquement.
// Calcule et fige le role approbateur au moment de la soumission (un
// changement de regle ulterieur n'affecte pas les demandes deja soumises).
router.patch("/demandes/:id/soumettre", async (req, res) => {
  try {
    const demande = await chargerDemandeAvecAcces(req, res, { exigerProprietaire: true });
    if (!demande) return;
    if (demande.statut !== "BROUILLON") {
      return res.status(400).json({ error: t(req, "RH_DEMANDE_SOUMETTRE_STATUT_INVALID") });
    }

    const employe = await db.query(`SELECT utilisateur_id FROM employe WHERE id = $1`, [demande.employe_id]);
    const roleApprobateurId = await determinerRoleApprobateur(req.user.tenantId, employe.rows[0].utilisateur_id);

    await db.query(
      `UPDATE demande_rh SET statut = 'SOUMISE', role_approbateur_id = $1, date_soumission = now() WHERE id = $2`,
      [roleApprobateurId, demande.id]
    );
    const maj = await db.query(`${SELECT_DEMANDE} AND d.id = $2`, [req.user.tenantId, demande.id]);
    res.json(maj.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: t(req, "RH_DEMANDE_SOUMETTRE_ERROR") });
  }
});

// PATCH /api/rh/demandes/:id/annuler - proprietaire ou ADMIN, tant que la
// demande n'a pas encore ete decidee.
router.patch("/demandes/:id/annuler", async (req, res) => {
  try {
    const demande = await chargerDemandeAvecAcces(req, res, { exigerProprietaire: true });
    if (!demande) return;
    if (demande.statut !== "BROUILLON" && demande.statut !== "SOUMISE") {
      return res.status(400).json({ error: t(req, "RH_DEMANDE_ANNULER_STATUT_INVALID") });
    }

    await db.query(`UPDATE demande_rh SET statut = 'ANNULEE' WHERE id = $1`, [demande.id]);
    const maj = await db.query(`${SELECT_DEMANDE} AND d.id = $2`, [req.user.tenantId, demande.id]);
    res.json(maj.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: t(req, "RH_DEMANDE_UPDATE_ERROR") });
  }
});

// PATCH /api/rh/demandes/:id/valider - approbateur designe ou ADMIN.
// body: { decision: 'APPROUVEE' | 'REJETEE', motif_rejet? }
// Pour une demande CONGE approuvee : decremente le solde de conges de
// l'employe et journalise le mouvement dans conge_historique (transaction).
router.patch("/demandes/:id/valider", async (req, res) => {
  const { decision, motif_rejet } = req.body;
  if (decision !== "APPROUVEE" && decision !== "REJETEE") {
    return res.status(400).json({ error: t(req, "RH_DEMANDE_VALIDER_STATUT_INVALID") });
  }
  if (decision === "REJETEE" && !motif_rejet) {
    return res.status(400).json({ error: t(req, "RH_DEMANDE_MOTIF_REJET_REQUIS") });
  }

  const client = await db.pool.connect();
  try {
    await client.query("BEGIN");

    const demandeResult = await client.query(
      `SELECT * FROM demande_rh WHERE id = $1 AND tenant_id = $2 FOR UPDATE`,
      [req.params.id, req.user.tenantId]
    );
    if (demandeResult.rows.length === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: t(req, "RH_DEMANDE_NOT_FOUND") });
    }
    const demande = demandeResult.rows[0];

    const estAdmin = req.user.roles.includes("ADMIN");
    if (!estAdmin) {
      const roleIds = await chargerRoleIdsUtilisateur(req.user.tenantId, req.user.sub);
      const estApprobateur = demande.role_approbateur_id && roleIds.includes(demande.role_approbateur_id);
      if (!estApprobateur) {
        await client.query("ROLLBACK");
        return res.status(403).json({ error: t(req, "ROLE_FORBIDDEN") });
      }
    }
    if (demande.statut !== "SOUMISE") {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: t(req, "RH_DEMANDE_VALIDER_STATUT_INVALID") });
    }

    if (decision === "APPROUVEE" && demande.type_demande === "CONGE") {
      const nbJours = Number(demande.details?.nb_jours || 0);
      const employeResult = await client.query(`SELECT solde_conges FROM employe WHERE id = $1 FOR UPDATE`, [
        demande.employe_id,
      ]);
      const soldeAvant = Number(employeResult.rows[0].solde_conges);
      if (soldeAvant < nbJours) {
        await client.query("ROLLBACK");
        return res.status(400).json({ error: t(req, "RH_SOLDE_CONGES_INSUFFISANT") });
      }
      const soldeApres = soldeAvant - nbJours;
      await client.query(`UPDATE employe SET solde_conges = $1 WHERE id = $2`, [soldeApres, demande.employe_id]);
      await client.query(
        `INSERT INTO conge_historique (tenant_id, employe_id, demande_rh_id, nb_jours, solde_avant, solde_apres)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [req.user.tenantId, demande.employe_id, demande.id, nbJours, soldeAvant, soldeApres]
      );
    }

    await client.query(
      `UPDATE demande_rh
       SET statut = $1, approuve_par_utilisateur_id = $2, motif_rejet = $3, date_decision = now()
       WHERE id = $4`,
      [decision, req.user.sub, decision === "REJETEE" ? motif_rejet : null, demande.id]
    );

    await client.query("COMMIT");

    const maj = await db.query(`${SELECT_DEMANDE} AND d.id = $2`, [req.user.tenantId, demande.id]);
    res.json(maj.rows[0]);
  } catch (err) {
    await client.query("ROLLBACK");
    console.error(err);
    res.status(500).json({ error: t(req, "RH_DEMANDE_VALIDER_ERROR") });
  } finally {
    client.release();
  }
});

module.exports = router;
