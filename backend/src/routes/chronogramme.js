const express = require("express");
const db = require("../db");
const { requireAuth, requireModule, blockLectureSeule } = require("../middleware/auth");
const { t } = require("../utils/i18n");
const { genererChronogrammeStandard } = require("../services/chronogrammeEngine");

const router = express.Router();
router.use(requireAuth);
router.use(requireModule("dossiers"));
router.use(blockLectureSeule);

/**
 * Verifie qu'un role_porteur_id / assigne_utilisateur_id fourni (l'un ou
 * l'autre, ou les deux) appartient bien au tenant courant, pour eviter
 * qu'une tache d'un dossier soit affectee a un role ou une personne d'un
 * AUTRE tenant. Retourne un code d'erreur i18n si invalide, null si ok.
 */
async function verifierAffectationValide(tenantId, rolePorteurId, assigneUtilisateurId) {
  if (rolePorteurId) {
    const roleCheck = await db.query(`SELECT id FROM role WHERE id = $1 AND tenant_id = $2`, [
      rolePorteurId,
      tenantId,
    ]);
    if (roleCheck.rows.length === 0) return "TACHE_ROLE_INVALID";
  }
  if (assigneUtilisateurId) {
    const userCheck = await db.query(
      `SELECT id FROM utilisateur WHERE id = $1 AND tenant_id = $2`,
      [assigneUtilisateurId, tenantId]
    );
    if (userCheck.rows.length === 0) return "TACHE_ASSIGNE_INVALID";
  }
  return null;
}

// GET /api/chronogramme/mes-taches - taches, sur TOUS les dossiers du
// tenant, qui concernent l'utilisateur connecte : soit affectees a lui
// nommement, soit non affectees a une personne en particulier et dont le
// role porteur figure parmi les roles qu'il detient (logique "OU", pas
// "ET" - inspiree d'OGAA, mais verifiee ici sur l'ENSEMBLE de ses roles et
// non un seul "role principal", ce qui evite le defaut connu sur OGAA ou
// une tache peut ne pas apparaitre pour un utilisateur multi-roles).
// Par defaut n'affiche pas les taches deja FAIT ; ?tous=true les inclut.
router.get("/mes-taches", async (req, res) => {
  const inclureTerminees = req.query.tous === "true";

  try {
    // Le statut EN_RETARD est toujours recalcule cote serveur (voir aussi
    // routes/dossiers.js), ici sur l'ensemble des dossiers du tenant.
    await db.query(
      `UPDATE chronogramme_tache ct
       SET statut = 'EN_RETARD'
       FROM dossier_ao d
       WHERE ct.dossier_ao_id = d.id AND d.tenant_id = $1
         AND ct.statut IN ('A_FAIRE', 'EN_COURS')
         AND ct.date_echeance IS NOT NULL
         AND ct.date_echeance < CURRENT_DATE`,
      [req.user.tenantId]
    );

    const mesRolesResult = await db.query(
      `SELECT r.id FROM role r
       JOIN utilisateur_role ur ON ur.role_id = r.id
       WHERE ur.utilisateur_id = $1 AND r.tenant_id = $2`,
      [req.user.sub, req.user.tenantId]
    );
    const mesRoleIds = mesRolesResult.rows.map((r) => r.id);

    const result = await db.query(
      `SELECT ct.*, d.reference_externe, d.intitule AS dossier_intitule,
              r.code AS role_code, r.libelle AS role_libelle
       FROM chronogramme_tache ct
       JOIN dossier_ao d ON d.id = ct.dossier_ao_id
       LEFT JOIN role r ON r.id = ct.role_porteur_id
       WHERE d.tenant_id = $1
         AND (
           ct.assigne_utilisateur_id = $2
           OR (ct.assigne_utilisateur_id IS NULL AND ct.role_porteur_id = ANY($3::uuid[]))
         )
         AND ($4 OR ct.statut != 'FAIT')
       ORDER BY ct.date_echeance ASC NULLS LAST`,
      [req.user.tenantId, req.user.sub, mesRoleIds, inclureTerminees]
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: t(req, "MES_TACHES_FETCH_ERROR") });
  }
});

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
  const {
    phase,
    intitule,
    jalon_relatif,
    date_echeance,
    role_porteur_id,
    assigne_utilisateur_id,
    document_attendu,
    ordre_affichage,
  } = req.body;

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

    const erreurAffectation = await verifierAffectationValide(
      req.user.tenantId,
      role_porteur_id,
      assigne_utilisateur_id
    );
    if (erreurAffectation) {
      return res.status(400).json({ error: t(req, erreurAffectation) });
    }

    const result = await db.query(
      `INSERT INTO chronogramme_tache
         (dossier_ao_id, phase, intitule, jalon_relatif, date_echeance, role_porteur_id,
          assigne_utilisateur_id, document_attendu, statut, ordre_affichage)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'A_FAIRE', COALESCE($9, 0))
       RETURNING *`,
      [
        dossierId,
        phase,
        intitule,
        jalon_relatif || null,
        date_echeance || null,
        role_porteur_id || null,
        assigne_utilisateur_id || null,
        document_attendu || null,
        ordre_affichage,
      ]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: t(req, "TACHE_CREATE_ERROR") });
  }
});

// PATCH /api/chronogramme/taches/:id - mise a jour du statut et/ou de
// l'affectation (role et/ou personne) d'une tache. Chaque champ est
// optionnel, mais au moins un doit etre fourni.
router.patch("/taches/:id", async (req, res) => {
  const { id } = req.params;
  let { statut, role_porteur_id, assigne_utilisateur_id } = req.body;
  // Une chaine vide equivaut a "aucune valeur" (ex: un <select> revenu sur
  // son option vide cote frontend), jamais a une tentative d'ecriture d'un
  // UUID invalide en base.
  if (role_porteur_id === "") role_porteur_id = null;
  if (assigne_utilisateur_id === "") assigne_utilisateur_id = null;
  const statutsValides = ["A_FAIRE", "EN_COURS", "FAIT", "EN_RETARD"];

  if (statut === undefined && role_porteur_id === undefined && assigne_utilisateur_id === undefined) {
    return res.status(400).json({ error: t(req, "TACHE_FIELDS_REQUIRED") });
  }
  if (statut !== undefined && !statutsValides.includes(statut)) {
    return res.status(400).json({ error: t(req, "STATUT_INVALID") });
  }

  try {
    const erreurAffectation = await verifierAffectationValide(
      req.user.tenantId,
      role_porteur_id,
      assigne_utilisateur_id
    );
    if (erreurAffectation) {
      return res.status(400).json({ error: t(req, erreurAffectation) });
    }

    // Construction dynamique du SET : seuls les champs REELLEMENT presents
    // dans le corps de la requete sont modifies (un champ absent est laisse
    // tel quel ; un champ present avec la valeur null EFFACE l'affectation
    // correspondante - utile pour desaffecter une tache).
    const colonnes = [];
    const valeurs = [];
    if (statut !== undefined) {
      colonnes.push(`statut = $${colonnes.length + 1}`);
      valeurs.push(statut);
    }
    if (role_porteur_id !== undefined) {
      colonnes.push(`role_porteur_id = $${colonnes.length + 1}`);
      valeurs.push(role_porteur_id);
    }
    if (assigne_utilisateur_id !== undefined) {
      colonnes.push(`assigne_utilisateur_id = $${colonnes.length + 1}`);
      valeurs.push(assigne_utilisateur_id);
    }

    const idxId = valeurs.length + 1;
    const idxTenant = valeurs.length + 2;
    const result = await db.query(
      `UPDATE chronogramme_tache ct
       SET ${colonnes.join(", ")}
       FROM dossier_ao d
       WHERE ct.id = $${idxId} AND ct.dossier_ao_id = d.id AND d.tenant_id = $${idxTenant}
       RETURNING ct.*`,
      [...valeurs, id, req.user.tenantId]
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
