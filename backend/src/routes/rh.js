const express = require("express");
const multer = require("multer");
const XLSX = require("xlsx");
const db = require("../db");
const { requireAuth, requireRole } = require("../middleware/auth");
const { t } = require("../utils/i18n");

const router = express.Router();
router.use(requireAuth);

const uploadExcel = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }, // 5 Mo, largement suffisant pour une fiche hebdomadaire
});

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
// Enrichi le 01/09/2026 a partir des 10 modeles de fiches papier reellement
// utilisees chez ARED/OGAA que Steeve a transmis (voir
// reference/modeles_fiches_ogaa_demandes.md, projet Claude) : 5 nouveaux
// types de demande (DEMANDE_FONDS, CARBURANT, FOURNITURES, PHOTOCOPIE,
// EXPRESSION_BESOIN), champs enrichis pour CONGE/AVANCE/ORDRE_MISSION, et un
// circuit d'approbation A PLUSIEURS ETAPES (plusieurs des fiches papier ont
// jusqu'a 4 visas successifs), la ou l'etape 2/5 d'origine ne gerait qu'un
// seul niveau.
//
// Deux mecanismes de routage coexistent, PAR TYPE DE DEMANDE :
//   1. etape_approbation_rh : une CHAINE d'etapes fixe configuree par
//      l'ADMIN pour ce type (ex: Fournitures = chef de service -> DAFC ->
//      beneficiaire), fidele aux fiches papier - la chaine est la MEME quel
//      que soit qui demande.
//   2. A DEFAUT (aucune etape configuree pour ce type) : repli sur le
//      mecanisme historique a un seul niveau, route par le ROLE DU
//      DEMANDEUR via regle_approbation_rh (comportement RIGOUREUSEMENT
//      inchange pour CONGE/AVANCE/ORDRE_MISSION/HEURES_SUP tant que Steeve
//      ne configure pas de chaine dediee pour l'un de ces types).
//
// La chaine complete est FIGEE dans demande_rh.chaine_approbation (JSONB) au
// moment de la soumission (comme role_approbateur_id l'etait deja) ; un
// changement de configuration ulterieur n'affecte pas les demandes deja
// soumises. demande_rh.role_approbateur_id continue de designer le role
// requis pour l'ETAPE COURANTE uniquement (mis a jour a chaque etape
// franchie) : cela permet de reutiliser tel quel tout le reste du systeme
// d'acces (GET /demandes/a-valider, chargerDemandeAvecAcces) sans le
// modifier - seul PATCH /demandes/:id/valider gere l'avancement dans la
// chaine plutot qu'une decision finale immediate.
//
// La liste de types n'est pas contrainte en base (TEXT libre), seulement
// cote application, pour pouvoir en ajouter sans migration.
// ----------------------------------------------------------------------------

const TYPES_DEMANDE = [
  "CONGE",
  "AVANCE",
  "ORDRE_MISSION",
  "HEURES_SUP",
  "DEMANDE_FONDS",
  "CARBURANT",
  "FOURNITURES",
  "PHOTOCOPIE",
  "EXPRESSION_BESOIN",
];

const TYPES_ABSENCE = ["CONGE_ANNUEL", "PERMISSION_FAMILIALE", "SANS_SOLDE", "AUTRE"];
const TYPES_IMPRESSION = ["AGRAFE", "RELIE", "RECTO_VERSO", "SIMPLE"];

const SELECT_DEMANDE = `
  SELECT d.id, d.tenant_id, d.employe_id, d.type_demande, d.details, d.statut,
         d.role_approbateur_id, d.approuve_par_utilisateur_id, d.motif_rejet,
         d.chaine_approbation, d.etape_courante,
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

// Calcule quel role doit approuver une demande a un seul niveau, a partir
// des roles ACTUELS du demandeur et des regles d'approbation configurees
// par le tenant. Retourne null si aucune regle ne correspond (repli ADMIN).
// Utilise uniquement en repli quand aucune chaine (etape_approbation_rh)
// n'est configuree pour le type de demande - voir construireChaineApprobation.
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

async function chargerRolesParIds(tenantId, roleIds) {
  const idsUniques = [...new Set(roleIds.filter(Boolean))];
  if (idsUniques.length === 0) return {};
  const result = await db.query(`SELECT id, code, libelle FROM role WHERE id = ANY($1::uuid[]) AND tenant_id = $2`, [
    idsUniques,
    tenantId,
  ]);
  return Object.fromEntries(result.rows.map((r) => [r.id, { code: r.code, libelle: r.libelle }]));
}

async function chargerEtapesConfigurees(tenantId, typeDemande) {
  const result = await db.query(
    `SELECT ordre, libelle, role_approbateur_id FROM etape_approbation_rh
     WHERE tenant_id = $1 AND type_demande = $2 ORDER BY ordre ASC`,
    [tenantId, typeDemande]
  );
  return result.rows;
}

// Construit la chaine d'approbation COMPLETE pour une nouvelle soumission :
// la chaine configuree pour ce type si elle existe, sinon un repli a une
// seule etape via l'ancien mecanisme (determinerRoleApprobateur). Chaque
// etape est enrichie avec le code/libelle du role au moment de la
// construction (pour affichage), puis figee telle quelle dans
// demande_rh.chaine_approbation.
async function construireChaineApprobation(req, typeDemande, employeUtilisateurId) {
  const etapesConfigurees = await chargerEtapesConfigurees(req.user.tenantId, typeDemande);
  let etapesBrutes;
  if (etapesConfigurees.length > 0) {
    etapesBrutes = etapesConfigurees;
  } else {
    const roleApprobateurId = await determinerRoleApprobateur(req.user.tenantId, employeUtilisateurId);
    etapesBrutes = [{ ordre: 1, libelle: t(req, "etapeApprobationLabel"), role_approbateur_id: roleApprobateurId }];
  }
  const rolesMap = await chargerRolesParIds(req.user.tenantId, etapesBrutes.map((e) => e.role_approbateur_id));
  return etapesBrutes.map((e) => ({
    ordre: e.ordre,
    libelle: e.libelle,
    role_approbateur_id: e.role_approbateur_id || null,
    role_code: e.role_approbateur_id ? rolesMap[e.role_approbateur_id]?.code || null : null,
    role_libelle: e.role_approbateur_id ? rolesMap[e.role_approbateur_id]?.libelle || null : null,
  }));
}

async function chargerDecisionsDemande(demandeRhId) {
  const result = await db.query(
    `SELECT de.id, de.ordre, de.libelle, de.role_approbateur_id, de.decision, de.motif_rejet, de.date_decision,
            u.nom AS decideur_nom, u.prenom AS decideur_prenom
     FROM decision_etape_demande_rh de
     LEFT JOIN utilisateur u ON u.id = de.decideur_utilisateur_id
     WHERE de.demande_rh_id = $1
     ORDER BY de.ordre ASC, de.date_decision ASC`,
    [demandeRhId]
  );
  return result.rows;
}

function estTableauNonVide(x) {
  return Array.isArray(x) && x.length > 0;
}

// Valide un tableau de lignes generique (budget, articles, documents...) :
// chaque ligne doit avoir tous les champsTexteRequis renseignes (non vides)
// et tous les champsNombreRequis positifs ou nuls.
function validerLignesGenerique(lignes, champsTexteRequis, champsNombreRequis = []) {
  if (!estTableauNonVide(lignes)) return false;
  return lignes.every((l) => {
    if (!l || typeof l !== "object") return false;
    for (const champ of champsTexteRequis) {
      if (!l[champ] || String(l[champ]).trim() === "") return false;
    }
    for (const champ of champsNombreRequis) {
      const n = Number(l[champ]);
      if (!Number.isFinite(n) || n < 0) return false;
    }
    return true;
  });
}

function validerDetailsDemande(type_demande, details) {
  if (!TYPES_DEMANDE.includes(type_demande)) return "RH_TYPE_DEMANDE_INVALID";
  if (!details || typeof details !== "object" || Array.isArray(details)) return "RH_DEMANDE_DETAILS_REQUIRED";

  if (type_demande === "CONGE") {
    if (!details.date_debut || !details.date_fin || !details.nb_jours) return "RH_DEMANDE_DETAILS_REQUIRED";
    if (!TYPES_ABSENCE.includes(details.type_absence)) return "RH_DEMANDE_DETAILS_REQUIRED";
  } else if (type_demande === "AVANCE") {
    if (!details.objet_mission || !details.duree_mission || !details.itineraire) return "RH_DEMANDE_DETAILS_REQUIRED";
    if (!validerLignesGenerique(details.lignes_budget, ["rubrique"], ["montant"])) return "RH_DEMANDE_DETAILS_REQUIRED";
  } else if (type_demande === "ORDRE_MISSION") {
    if (!details.destination || !details.date_depart || !details.date_retour_prevue) return "RH_DEMANDE_DETAILS_REQUIRED";
  } else if (type_demande === "HEURES_SUP") {
    if (!details.date || !details.nb_heures) return "RH_DEMANDE_DETAILS_REQUIRED";
  } else if (type_demande === "DEMANDE_FONDS") {
    if (!details.activite || !details.depense || !details.montant) return "RH_DEMANDE_DETAILS_REQUIRED";
  } else if (type_demande === "CARBURANT") {
    if (!details.vehicule_id || !details.activite || !details.km_a_parcourir || !details.quantite_necessaire) {
      return "RH_DEMANDE_DETAILS_REQUIRED";
    }
  } else if (type_demande === "FOURNITURES") {
    if (!details.activite) return "RH_DEMANDE_DETAILS_REQUIRED";
    if (!validerLignesGenerique(details.lignes_articles, ["description"], ["quantite"])) return "RH_DEMANDE_DETAILS_REQUIRED";
  } else if (type_demande === "PHOTOCOPIE") {
    if (!validerLignesGenerique(details.documents, ["titre"], ["pages"])) return "RH_DEMANDE_DETAILS_REQUIRED";
    if (details.documents.some((d) => d.type_impression && !TYPES_IMPRESSION.includes(d.type_impression))) {
      return "RH_DEMANDE_DETAILS_REQUIRED";
    }
  } else if (type_demande === "EXPRESSION_BESOIN") {
    if (!details.activite) return "RH_DEMANDE_DETAILS_REQUIRED";
    if (!validerLignesGenerique(details.lignes_articles, ["article"], ["quantite"])) return "RH_DEMANDE_DETAILS_REQUIRED";
  }
  return null;
}

// Verifications additionnelles necessitant un acces DB (au-dela de la
// validation synchrone ci-dessus) - pour l'instant uniquement CARBURANT
// (le vehicule doit reellement appartenir au tenant, cf. Module 8 Parc Auto).
async function validerDetailsDemandeAsync(req, type_demande, details) {
  if (type_demande === "CARBURANT") {
    const vehiculeCheck = await db.query(`SELECT id FROM vehicule WHERE id = $1 AND tenant_id = $2`, [
      details.vehicule_id,
      req.user.tenantId,
    ]);
    if (vehiculeCheck.rows.length === 0) return "RH_DEMANDE_VEHICULE_INVALID";
  }
  return null;
}

// ----------------------------------------------------------------------------
// Circuit d'approbation (ADMIN uniquement)
// ----------------------------------------------------------------------------

// GET /api/rh/regles-approbation - circuit historique a un seul niveau,
// route par le role du demandeur (repli quand aucune chaine d'etapes n'est
// configuree pour un type - voir plus haut).
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

// GET /api/rh/etapes-approbation?type_demande=FOURNITURES - chaine d'etapes
// configuree pour un type de demande (vide = repli sur regles-approbation).
router.get("/etapes-approbation", requireRole("ADMIN"), async (req, res) => {
  const { type_demande } = req.query;
  if (!TYPES_DEMANDE.includes(type_demande)) {
    return res.status(400).json({ error: t(req, "RH_TYPE_DEMANDE_INVALID") });
  }
  try {
    const result = await db.query(
      `SELECT ea.id, ea.ordre, ea.libelle, ea.role_approbateur_id,
              ra.code AS role_approbateur_code, ra.libelle AS role_approbateur_libelle
       FROM etape_approbation_rh ea
       LEFT JOIN role ra ON ra.id = ea.role_approbateur_id
       WHERE ea.tenant_id = $1 AND ea.type_demande = $2
       ORDER BY ea.ordre ASC`,
      [req.user.tenantId, type_demande]
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: t(req, "RH_ETAPES_FETCH_ERROR") });
  }
});

// PUT /api/rh/etapes-approbation - remplace la chaine d'un type de demande.
// body: { type_demande, etapes: [{ libelle, role_approbateur_id }, ...] }
// (l'ordre soumis par le client n'est pas utilise tel quel : la chaine est
// toujours renumerotee 1..N selon l'ordre du tableau, pour eviter tout
// desaccord entre l'UI et la base). etapes: [] efface la chaine (repli sur
// regles-approbation pour ce type).
router.put("/etapes-approbation", requireRole("ADMIN"), async (req, res) => {
  const { type_demande, etapes } = req.body;
  if (!TYPES_DEMANDE.includes(type_demande)) {
    return res.status(400).json({ error: t(req, "RH_TYPE_DEMANDE_INVALID") });
  }
  if (!Array.isArray(etapes)) {
    return res.status(400).json({ error: t(req, "RH_ETAPES_INVALID") });
  }
  if (etapes.some((e) => !e || typeof e !== "object" || !e.libelle || String(e.libelle).trim() === "")) {
    return res.status(400).json({ error: t(req, "RH_ETAPES_INVALID") });
  }

  const client = await db.pool.connect();
  try {
    await client.query("BEGIN");

    const roleIdsUtilises = [...new Set(etapes.map((e) => e.role_approbateur_id).filter(Boolean))];
    if (roleIdsUtilises.length > 0) {
      const rolesCheck = await client.query(`SELECT id FROM role WHERE id = ANY($1::uuid[]) AND tenant_id = $2`, [
        roleIdsUtilises,
        req.user.tenantId,
      ]);
      if (rolesCheck.rows.length !== roleIdsUtilises.length) {
        await client.query("ROLLBACK");
        return res.status(400).json({ error: t(req, "RH_ETAPES_INVALID") });
      }
    }

    await client.query(`DELETE FROM etape_approbation_rh WHERE tenant_id = $1 AND type_demande = $2`, [
      req.user.tenantId,
      type_demande,
    ]);
    for (let i = 0; i < etapes.length; i++) {
      await client.query(
        `INSERT INTO etape_approbation_rh (tenant_id, type_demande, ordre, libelle, role_approbateur_id)
         VALUES ($1, $2, $3, $4, $5)`,
        [req.user.tenantId, type_demande, i + 1, etapes[i].libelle, etapes[i].role_approbateur_id || null]
      );
    }

    await client.query("COMMIT");

    const result = await db.query(
      `SELECT ea.id, ea.ordre, ea.libelle, ea.role_approbateur_id,
              ra.code AS role_approbateur_code, ra.libelle AS role_approbateur_libelle
       FROM etape_approbation_rh ea
       LEFT JOIN role ra ON ra.id = ea.role_approbateur_id
       WHERE ea.tenant_id = $1 AND ea.type_demande = $2
       ORDER BY ea.ordre ASC`,
      [req.user.tenantId, type_demande]
    );
    res.json(result.rows);
  } catch (err) {
    await client.query("ROLLBACK");
    console.error(err);
    res.status(500).json({ error: t(req, "RH_ETAPES_UPDATE_ERROR") });
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
// role requis pour l'ETAPE COURANTE correspond a l'un de leurs roles ACTUELS).
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

// GET /api/rh/demandes/:id (avec l'historique des decisions par etape)
router.get("/demandes/:id", async (req, res) => {
  try {
    const demande = await chargerDemandeAvecAcces(req, res);
    if (!demande) return;
    const decisions = await chargerDecisionsDemande(demande.id);
    res.json({ ...demande, decisions });
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
    const erreurAsync = await validerDetailsDemandeAsync(req, type_demande, details);
    if (erreurAsync) {
      return res.status(400).json({ error: t(req, erreurAsync) });
    }

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
    const erreurAsync = await validerDetailsDemandeAsync(req, type_demande, details);
    if (erreurAsync) {
      return res.status(400).json({ error: t(req, erreurAsync) });
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
// Construit et fige la chaine d'approbation complete au moment de la
// soumission (un changement de configuration ulterieur n'affecte pas les
// demandes deja soumises) ; positionne l'etape courante sur la premiere.
router.patch("/demandes/:id/soumettre", async (req, res) => {
  try {
    const demande = await chargerDemandeAvecAcces(req, res, { exigerProprietaire: true });
    if (!demande) return;
    if (demande.statut !== "BROUILLON") {
      return res.status(400).json({ error: t(req, "RH_DEMANDE_SOUMETTRE_STATUT_INVALID") });
    }

    const employe = await db.query(`SELECT utilisateur_id FROM employe WHERE id = $1`, [demande.employe_id]);
    const chaine = await construireChaineApprobation(req, demande.type_demande, employe.rows[0].utilisateur_id);

    await db.query(
      `UPDATE demande_rh
       SET statut = 'SOUMISE', role_approbateur_id = $1, chaine_approbation = $2, etape_courante = 1,
           date_soumission = now()
       WHERE id = $3`,
      [chaine[0].role_approbateur_id, JSON.stringify(chaine), demande.id]
    );
    const maj = await db.query(`${SELECT_DEMANDE} AND d.id = $2`, [req.user.tenantId, demande.id]);
    res.json({ ...maj.rows[0], decisions: [] });
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

// PATCH /api/rh/demandes/:id/valider - approbateur designe pour l'ETAPE
// COURANTE, ou ADMIN. body: { decision: 'APPROUVEE' | 'REJETEE', motif_rejet? }
// Un REJET a n'importe quelle etape arrete immediatement la chaine. Une
// APPROBATION avance a l'etape suivante si la chaine n'est pas terminee ;
// seule l'approbation de la DERNIERE etape finalise la demande (statut
// APPROUVEE) et declenche les effets de bord (decompte du solde de conges
// pour une demande CONGE).
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

    const chaine = demande.chaine_approbation || [];
    const etapeIndex = (demande.etape_courante || 1) - 1;
    const etapeActuelle = chaine[etapeIndex] || { ordre: 1, libelle: null, role_approbateur_id: demande.role_approbateur_id };
    const derniereEtape = etapeIndex >= chaine.length - 1;

    await client.query(
      `INSERT INTO decision_etape_demande_rh
         (demande_rh_id, ordre, libelle, role_approbateur_id, decideur_utilisateur_id, decision, motif_rejet)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        demande.id,
        etapeActuelle.ordre,
        etapeActuelle.libelle,
        etapeActuelle.role_approbateur_id,
        req.user.sub,
        decision,
        decision === "REJETEE" ? motif_rejet : null,
      ]
    );

    if (decision === "REJETEE") {
      await client.query(
        `UPDATE demande_rh
         SET statut = 'REJETEE', approuve_par_utilisateur_id = $1, motif_rejet = $2, date_decision = now()
         WHERE id = $3`,
        [req.user.sub, motif_rejet, demande.id]
      );
    } else if (!derniereEtape) {
      // Approbation intermediaire : on avance a l'etape suivante, la
      // demande reste SOUMISE en attente du prochain approbateur.
      const etapeSuivante = chaine[etapeIndex + 1];
      await client.query(
        `UPDATE demande_rh SET etape_courante = $1, role_approbateur_id = $2 WHERE id = $3`,
        [etapeIndex + 2, etapeSuivante.role_approbateur_id, demande.id]
      );
    } else {
      // Derniere etape approuvee : finalisation + effets de bord.
      if (demande.type_demande === "CONGE") {
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
         SET statut = 'APPROUVEE', approuve_par_utilisateur_id = $1, motif_rejet = NULL, date_decision = now()
         WHERE id = $2`,
        [req.user.sub, demande.id]
      );
    }

    await client.query("COMMIT");

    const maj = await db.query(`${SELECT_DEMANDE} AND d.id = $2`, [req.user.tenantId, demande.id]);
    const decisions = await chargerDecisionsDemande(demande.id);
    res.json({ ...maj.rows[0], decisions });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error(err);
    res.status(500).json({ error: t(req, "RH_DEMANDE_VALIDER_ERROR") });
  } finally {
    client.release();
  }
});

// ----------------------------------------------------------------------------
// Module 9 - RH (etape 3/5 : planning des conges + statistiques RH)
//
// Le solde de conges, son historique (conge_historique) et le mecanisme de
// decompte existent deja depuis l'etape 2 (approbation d'une demande CONGE).
// Cette etape n'ajoute donc aucune migration : uniquement deux vues agregees
// en lecture sur les donnees deja en place.
//
// Meme decision de sensibilite que /rh/personnel : ces deux ecrans exposent
// des donnees nominatives sur l'ensemble du personnel (jours de conge,
// absences), reserves a ADMIN - pas ouverts a tout utilisateur authentifie
// comme les donnees de reference.
//
// Simplification assumee (a documenter si Steeve la remet en cause) : un
// conge est rattache au mois de sa date_debut uniquement (pas de repartition
// au prorata s'il chevauche deux mois) - suffisant pour un premier planning,
// comme le fait deja OGAA de facon equivalente dans son propre planning.
// ----------------------------------------------------------------------------

// GET /api/rh/planning-conges?annee=2026 (ADMIN)
router.get("/planning-conges", requireRole("ADMIN"), async (req, res) => {
  try {
    const annee = parseInt(req.query.annee, 10) || new Date().getUTCFullYear();

    const employesResult = await db.query(
      `SELECT e.id, u.nom, u.prenom
       FROM employe e
       JOIN utilisateur u ON u.id = e.utilisateur_id
       WHERE e.tenant_id = $1 AND e.statut = 'ACTIF'
       ORDER BY u.nom ASC, u.prenom ASC`,
      [req.user.tenantId]
    );

    const congesResult = await db.query(
      `SELECT employe_id, details
       FROM demande_rh
       WHERE tenant_id = $1 AND type_demande = 'CONGE' AND statut = 'APPROUVEE'
         AND EXTRACT(YEAR FROM (details->>'date_debut')::date) = $2`,
      [req.user.tenantId, annee]
    );

    const parEmploye = {};
    for (const emp of employesResult.rows) {
      parEmploye[emp.id] = {
        employe_id: emp.id,
        nom: emp.nom,
        prenom: emp.prenom,
        mois: Array.from({ length: 12 }, () => ({ jours: 0, periodes: [] })),
        total_jours: 0,
      };
    }
    for (const conge of congesResult.rows) {
      const ligne = parEmploye[conge.employe_id];
      if (!ligne) continue; // employe inactif ou supprime depuis
      const d = conge.details || {};
      const moisIndex = new Date(d.date_debut).getUTCMonth();
      const nbJours = Number(d.nb_jours || 0);
      ligne.mois[moisIndex].jours += nbJours;
      ligne.mois[moisIndex].periodes.push({
        nb_jours: nbJours,
        debut: d.date_debut,
        fin: d.date_fin,
        motif: d.motif || null,
      });
      ligne.total_jours += nbJours;
    }

    res.json({ annee, planning: Object.values(parEmploye) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: t(req, "RH_PLANNING_FETCH_ERROR") });
  }
});

// GET /api/rh/statistiques?periode=mensuel|annuel&mois=YYYY-MM (ADMIN)
router.get("/statistiques", requireRole("ADMIN"), async (req, res) => {
  try {
    const periode = req.query.periode === "annuel" ? "annuel" : "mensuel";
    const moisParam = /^\d{4}-\d{2}$/.test(req.query.mois || "") ? req.query.mois : new Date().toISOString().slice(0, 7);
    const [anneeStr, moisStr] = moisParam.split("-");
    const annee = parseInt(anneeStr, 10);
    const moisIndex = parseInt(moisStr, 10) - 1;

    let debut, fin;
    if (periode === "annuel") {
      debut = new Date(Date.UTC(annee, 0, 1));
      fin = new Date(Date.UTC(annee + 1, 0, 1));
    } else {
      debut = new Date(Date.UTC(annee, moisIndex, 1));
      fin = new Date(Date.UTC(annee, moisIndex + 1, 1));
    }

    const employesResult = await db.query(
      `SELECT e.id, e.solde_conges, u.nom, u.prenom
       FROM employe e
       JOIN utilisateur u ON u.id = e.utilisateur_id
       WHERE e.tenant_id = $1 AND e.statut = 'ACTIF'
       ORDER BY u.nom ASC, u.prenom ASC`,
      [req.user.tenantId]
    );

    const congesPeriodeResult = await db.query(
      `SELECT employe_id, details
       FROM demande_rh
       WHERE tenant_id = $1 AND type_demande = 'CONGE' AND statut = 'APPROUVEE'
         AND (details->>'date_debut')::date >= $2 AND (details->>'date_debut')::date < $3`,
      [req.user.tenantId, debut.toISOString(), fin.toISOString()]
    );

    const joursParEmploye = {};
    const absencesParEmploye = {};
    for (const c of congesPeriodeResult.rows) {
      joursParEmploye[c.employe_id] = (joursParEmploye[c.employe_id] || 0) + Number(c.details?.nb_jours || 0);
      absencesParEmploye[c.employe_id] = (absencesParEmploye[c.employe_id] || 0) + 1;
    }

    const statsEmployes = employesResult.rows.map((e) => ({
      id: e.id,
      nom: e.nom,
      prenom: e.prenom,
      jours_pris_periode: joursParEmploye[e.id] || 0,
      nb_absences: absencesParEmploye[e.id] || 0,
      solde_conges: e.solde_conges,
    }));

    const absencesEnCoursResult = await db.query(
      `SELECT d.employe_id AS id, u.nom, u.prenom, d.details->>'date_fin' AS date_fin
       FROM demande_rh d
       JOIN employe e ON e.id = d.employe_id
       JOIN utilisateur u ON u.id = e.utilisateur_id
       WHERE d.tenant_id = $1 AND d.type_demande = 'CONGE' AND d.statut = 'APPROUVEE'
         AND (d.details->>'date_debut')::date <= CURRENT_DATE
         AND (d.details->>'date_fin')::date >= CURRENT_DATE`,
      [req.user.tenantId]
    );

    const statsParTypeResult = await db.query(
      `SELECT type_demande, COUNT(*) AS total
       FROM demande_rh
       WHERE tenant_id = $1 AND date_creation >= $2 AND date_creation < $3
       GROUP BY type_demande`,
      [req.user.tenantId, debut.toISOString(), fin.toISOString()]
    );

    res.json({
      periode: { type: periode, debut: debut.toISOString(), fin: fin.toISOString() },
      stats_employes: statsEmployes,
      absences_en_cours: absencesEnCoursResult.rows,
      stats_par_type: statsParTypeResult.rows,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: t(req, "RH_STATISTIQUES_FETCH_ERROR") });
  }
});

// ----------------------------------------------------------------------------
// Module 9 - RH (etape 4/5 : Fiches de temps v2)
//
// Cf. reference/memo_rh_fiches_temps_ogaa.md, point 8, pour le detail du
// systeme OGAA d'origine. Adaptations actees : imputation par DOSSIER
// D'APPEL D'OFFRES (deja prevu dans le schema Baobab d'origine, amelioration
// vs le "programme" generique OGAA) ; circuit d'approbation IDENTIQUE a
// celui du moteur de demandes RH (etape 2 - meme table regle_approbation_rh,
// meme fonction determinerRoleApprobateur) plutot qu'un second circuit
// dedie ; categories "autre" fixees cote application (TYPES_TEMPS_AUTRE),
// modifiables sans migration.
//
// Une ligne de categorie CONGE_ABSENCE dans une fiche de temps est une note
// descriptive (reporting + verrou chronologique) UNIQUEMENT - elle ne
// modifie PAS employe.solde_conges (deja gere par le moteur de demandes RH
// a l'etape 2, pour eviter tout double-decompte).
// ----------------------------------------------------------------------------

const TYPES_TEMPS_AUTRE = [
  "ADMINISTRATION",
  "FORMATION",
  "CONGE_ABSENCE",
  "REUNION_INTERNE",
  "PROSPECTION_COMMERCIALE",
  "RECRUTEMENT",
  "MAINTENANCE_SIEGE",
  "DEPLACEMENT_HORS_DOSSIER",
  "VEILLE_MARCHES",
  "SUPPORT_INFORMATIQUE",
  "AUTRE",
];

const JOURS_OUVRES = ["LUNDI", "MARDI", "MERCREDI", "JEUDI", "VENDREDI"];
const JOURS_SEMAINE = [...JOURS_OUVRES, "SAMEDI", "DIMANCHE"];

function estLundi(dateStr) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr || "")) return false;
  const d = new Date(`${dateStr}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.getUTCDay() === 1;
}

// Accepte aussi bien une chaine "AAAA-MM-JJ" (query params) qu'un objet Date
// (colonne DATE renvoyee telle quelle par le driver pg, sans passer par
// JSON.stringify) - fiche.semaine_debut arrive sous cette seconde forme des
// qu'on le relit directement depuis un resultat de requete SQL.
function ajouterJours(date, n) {
  const d = typeof date === "string" ? new Date(`${date}T00:00:00Z`) : new Date(date);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function joursDeLaSemaine(semaineDebut) {
  // index 0 = lundi ... 6 = dimanche
  return Array.from({ length: 7 }, (_, i) => ajouterJours(semaineDebut, i));
}

const SELECT_FICHE_TEMPS = `
  SELECT f.id, f.tenant_id, f.employe_id, f.semaine_debut::text AS semaine_debut, f.statut_validation,
         f.role_approbateur_id, f.approuve_par_utilisateur_id, f.motif_rejet,
         f.date_soumission, f.date_decision, f.date_creation,
         u.nom AS employe_nom, u.prenom AS employe_prenom, u.email AS employe_email,
         ra.code AS role_approbateur_code, ra.libelle AS role_approbateur_libelle
  FROM fiche_temps f
  JOIN employe e ON e.id = f.employe_id
  JOIN utilisateur u ON u.id = e.utilisateur_id
  LEFT JOIN role ra ON ra.id = f.role_approbateur_id
  WHERE f.tenant_id = $1
`;

async function chargerLignes(ficheTempsId) {
  const result = await db.query(
    `SELECT id, jour::text AS jour, domaine_type, dossier_ao_id, categorie_autre, precision_autre, tache, temps
     FROM ligne_fiche_temps WHERE fiche_temps_id = $1 ORDER BY jour ASC`,
    [ficheTempsId]
  );
  return result.rows;
}

// Verrou chronologique : la semaine N-1 doit avoir ete soumise (SOUMISE ou
// VALIDEE), OU comporter au moins une ligne CONGE_ABSENCE (meme si cette
// fiche N-1 est restee en brouillon - preuve suffisante d'une semaine non
// travaillee). Aucune verification si aucune fiche n'existe encore pour
// l'employe avant la semaine N-1 (premiere semaine de saisie).
async function verifierVerrouChronologique(employeId, semaineDebut) {
  const semainePrecedente = ajouterJours(semaineDebut, -7);
  const ficheAnterieure = await db.query(
    `SELECT id, statut_validation FROM fiche_temps WHERE employe_id = $1 AND semaine_debut = $2`,
    [employeId, semainePrecedente]
  );
  if (ficheAnterieure.rows.length === 0) {
    // Aucune fiche pour la semaine precedente : on verifie qu'il n'existe
    // aucune fiche plus ancienne du tout - sinon on bloquerait a tort la toute
    // premiere semaine de saisie d'un employe deja ancien dans l'application.
    const premiereFiche = await db.query(
      `SELECT MIN(semaine_debut) AS premiere FROM fiche_temps WHERE employe_id = $1`,
      [employeId]
    );
    const premiere = premiereFiche.rows[0]?.premiere;
    if (!premiere) return true; // aucune fiche du tout : premiere semaine, pas de verrou
    return new Date(premiere) >= new Date(`${semaineDebut}T00:00:00Z`);
  }
  const fiche = ficheAnterieure.rows[0];
  if (fiche.statut_validation === "SOUMISE" || fiche.statut_validation === "VALIDEE") return true;
  const lignesPrecedentes = await chargerLignes(fiche.id);
  return lignesPrecedentes.some((l) => l.categorie_autre === "CONGE_ABSENCE");
}

function validerLignes(lignes, semaineDebut) {
  if (!Array.isArray(lignes)) return "RH_FICHE_TEMPS_LIGNES_INVALID";
  const joursValides = new Set(joursDeLaSemaine(semaineDebut));
  for (const ligne of lignes) {
    if (!ligne || typeof ligne !== "object") return "RH_FICHE_TEMPS_LIGNES_INVALID";
    if (!joursValides.has(ligne.jour)) return "RH_FICHE_TEMPS_LIGNES_INVALID";
    if (ligne.domaine_type !== "DOSSIER" && ligne.domaine_type !== "AUTRE") return "RH_FICHE_TEMPS_DOMAINE_INVALID";
    if (ligne.domaine_type === "DOSSIER" && !ligne.dossier_ao_id) return "RH_FICHE_TEMPS_DOMAINE_INVALID";
    if (ligne.domaine_type === "AUTRE" && !TYPES_TEMPS_AUTRE.includes(ligne.categorie_autre)) {
      return "RH_FICHE_TEMPS_DOMAINE_INVALID";
    }
    const temps = Number(ligne.temps);
    if (!Number.isFinite(temps) || temps <= 0 || temps > 24) return "RH_FICHE_TEMPS_LIGNES_INVALID";
  }
  return null;
}

async function chargerFicheTempsAvecAcces(req, res, { exigerProprietaire = false, exigerApprobateur = false } = {}) {
  const result = await db.query(`${SELECT_FICHE_TEMPS} AND f.id = $2`, [req.user.tenantId, req.params.id]);
  if (result.rows.length === 0) {
    res.status(404).json({ error: t(req, "RH_FICHE_TEMPS_NOT_FOUND") });
    return null;
  }
  const fiche = result.rows[0];
  const employe = await chargerEmployeCourant(req.user.tenantId, req.user.sub);
  const estProprietaire = !!employe && employe.id === fiche.employe_id;
  const estAdmin = req.user.roles.includes("ADMIN");

  if (exigerProprietaire && !estProprietaire && !estAdmin) {
    res.status(403).json({ error: t(req, "ROLE_FORBIDDEN") });
    return null;
  }
  if (exigerApprobateur && !estAdmin) {
    const roleIds = await chargerRoleIdsUtilisateur(req.user.tenantId, req.user.sub);
    const estApprobateur = fiche.role_approbateur_id && roleIds.includes(fiche.role_approbateur_id);
    if (!estApprobateur) {
      res.status(403).json({ error: t(req, "ROLE_FORBIDDEN") });
      return null;
    }
  }
  if (!exigerProprietaire && !exigerApprobateur && !estProprietaire && !estAdmin) {
    const roleIds = await chargerRoleIdsUtilisateur(req.user.tenantId, req.user.sub);
    const estApprobateurPotentiel = fiche.role_approbateur_id && roleIds.includes(fiche.role_approbateur_id);
    if (!estApprobateurPotentiel) {
      res.status(403).json({ error: t(req, "ROLE_FORBIDDEN") });
      return null;
    }
  }
  return fiche;
}

// GET /api/rh/fiches-temps/dossiers-disponibles - liste des dossiers pour le
// selecteur "Dossier" (ouvert a tout utilisateur authentifie, comme les
// autres donnees de reference - ce ne sont que des intitules de dossiers).
router.get("/fiches-temps/dossiers-disponibles", async (req, res) => {
  try {
    const result = await db.query(
      `SELECT id, reference_externe, intitule FROM dossier_ao
       WHERE tenant_id = $1 AND statut NOT IN ('NO_GO', 'CLOTURE')
       ORDER BY intitule ASC`,
      [req.user.tenantId]
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: t(req, "RH_DOSSIERS_DISPONIBLES_FETCH_ERROR") });
  }
});

// GET /api/rh/fiches-temps/semaine?semaine_debut=YYYY-MM-DD - recupere (et
// cree en BROUILLON si besoin) la fiche de la semaine courante pour
// l'employe connecte, avec ses lignes et l'etat du verrou chronologique.
router.get("/fiches-temps/semaine", async (req, res) => {
  const { semaine_debut } = req.query;
  if (!estLundi(semaine_debut)) {
    return res.status(400).json({ error: t(req, "RH_FICHE_TEMPS_SEMAINE_INVALID") });
  }
  try {
    const employe = await chargerEmployeCourant(req.user.tenantId, req.user.sub);
    if (!employe) {
      return res.status(404).json({ error: t(req, "RH_PAS_DE_FICHE_EMPLOYE") });
    }

    let fiche = await db.query(`${SELECT_FICHE_TEMPS} AND f.employe_id = $2 AND f.semaine_debut = $3`, [
      req.user.tenantId,
      employe.id,
      semaine_debut,
    ]);
    if (fiche.rows.length === 0) {
      await db.query(
        `INSERT INTO fiche_temps (tenant_id, employe_id, semaine_debut)
         VALUES ($1, $2, $3) ON CONFLICT (employe_id, semaine_debut) DO NOTHING`,
        [req.user.tenantId, employe.id, semaine_debut]
      );
      fiche = await db.query(`${SELECT_FICHE_TEMPS} AND f.employe_id = $2 AND f.semaine_debut = $3`, [
        req.user.tenantId,
        employe.id,
        semaine_debut,
      ]);
    }

    const lignes = await chargerLignes(fiche.rows[0].id);
    const semainePrecedenteOk = await verifierVerrouChronologique(employe.id, semaine_debut);
    res.json({ fiche: fiche.rows[0], lignes, semaine_precedente_ok: semainePrecedenteOk });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: t(req, "RH_FICHE_TEMPS_FETCH_ERROR") });
  }
});

// GET /api/rh/fiches-temps/mes?annee=2026 - liste des fiches de l'annee pour
// l'employe connecte (navigation entre semaines + total pour la carte
// "Mon resume (annee)", calculee cote client a partir de cette liste).
router.get("/fiches-temps/mes", async (req, res) => {
  try {
    const employe = await chargerEmployeCourant(req.user.tenantId, req.user.sub);
    if (!employe) {
      return res.status(404).json({ error: t(req, "RH_PAS_DE_FICHE_EMPLOYE") });
    }
    const annee = parseInt(req.query.annee, 10) || new Date().getUTCFullYear();
    const fichesResult = await db.query(
      `${SELECT_FICHE_TEMPS} AND f.employe_id = $2 AND EXTRACT(YEAR FROM f.semaine_debut) = $3
       ORDER BY f.semaine_debut ASC`,
      [req.user.tenantId, employe.id, annee]
    );
    const fiches = await Promise.all(
      fichesResult.rows.map(async (f) => {
        const lignes = await chargerLignes(f.id);
        const totalHeures = lignes.reduce((somme, l) => somme + Number(l.temps || 0), 0);
        return { ...f, total_heures: totalHeures };
      })
    );
    res.json(fiches);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: t(req, "RH_FICHE_TEMPS_FETCH_ERROR") });
  }
});

// GET /api/rh/fiches-temps/a-valider - fiches SOUMISE en attente (meme
// logique d'acces que /demandes/a-valider).
router.get("/fiches-temps/a-valider", async (req, res) => {
  try {
    const estAdmin = req.user.roles.includes("ADMIN");
    if (estAdmin) {
      const result = await db.query(
        `${SELECT_FICHE_TEMPS} AND f.statut_validation = 'SOUMISE' ORDER BY f.date_soumission ASC`,
        [req.user.tenantId]
      );
      return res.json(result.rows);
    }
    const roleIds = await chargerRoleIdsUtilisateur(req.user.tenantId, req.user.sub);
    if (roleIds.length === 0) return res.json([]);
    const result = await db.query(
      `${SELECT_FICHE_TEMPS} AND f.statut_validation = 'SOUMISE' AND f.role_approbateur_id = ANY($2::uuid[])
       ORDER BY f.date_soumission ASC`,
      [req.user.tenantId, roleIds]
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: t(req, "RH_FICHE_TEMPS_FETCH_ERROR") });
  }
});

// GET /api/rh/fiches-temps/modele-import - modele Excel vierge telechargeable
// (place AVANT /fiches-temps/:id : sinon Express matcherait "modele-import"
// comme une valeur d'id, un piege de routage deja rencontre sur d'autres
// modules - toujours placer les routes a segment fixe avant les routes a
// parametre partageant le meme prefixe).
router.get("/fiches-temps/modele-import", (req, res) => {
  try {
    const enTetes = ["Jour (AAAA-MM-JJ)", "Domaine (DOSSIER ou AUTRE)", "Dossier (intitule exact)", "Categorie (si AUTRE)", "Precision", "Tache", "Temps (heures)"];
    const legende = [[], ["Categories AUTRE valides :"], ...TYPES_TEMPS_AUTRE.map((c) => [c])];
    const feuille = XLSX.utils.aoa_to_sheet([enTetes, [], ...legende]);
    const classeur = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(classeur, feuille, "Fiche de temps");
    const buffer = XLSX.write(classeur, { type: "buffer", bookType: "xlsx" });
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", 'attachment; filename="modele_fiche_temps.xlsx"');
    res.send(buffer);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: t(req, "RH_FICHE_TEMPS_EXPORT_ERROR") });
  }
});

// GET /api/rh/fiches-temps/:id
router.get("/fiches-temps/:id", async (req, res) => {
  try {
    const fiche = await chargerFicheTempsAvecAcces(req, res);
    if (!fiche) return;
    const lignes = await chargerLignes(fiche.id);
    res.json({ ...fiche, lignes });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: t(req, "RH_FICHE_TEMPS_FETCH_ERROR") });
  }
});

// PUT /api/rh/fiches-temps/:id/lignes - remplace l'ensemble des lignes de la
// fiche (proprietaire, brouillon uniquement). body: { lignes: [...] }
router.put("/fiches-temps/:id/lignes", async (req, res) => {
  try {
    const fiche = await chargerFicheTempsAvecAcces(req, res, { exigerProprietaire: true });
    if (!fiche) return;
    if (fiche.statut_validation !== "BROUILLON") {
      return res.status(400).json({ error: t(req, "RH_FICHE_TEMPS_MODIF_STATUT_INVALID") });
    }
    const erreurValidation = validerLignes(req.body.lignes, fiche.semaine_debut);
    if (erreurValidation) {
      return res.status(400).json({ error: t(req, erreurValidation) });
    }

    const client = await db.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(`DELETE FROM ligne_fiche_temps WHERE fiche_temps_id = $1`, [fiche.id]);
      for (const ligne of req.body.lignes) {
        await client.query(
          `INSERT INTO ligne_fiche_temps
             (fiche_temps_id, jour, domaine_type, dossier_ao_id, categorie_autre, precision_autre, tache, temps)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [
            fiche.id,
            ligne.jour,
            ligne.domaine_type,
            ligne.domaine_type === "DOSSIER" ? ligne.dossier_ao_id : null,
            ligne.domaine_type === "AUTRE" ? ligne.categorie_autre : null,
            ligne.precision_autre || null,
            ligne.tache || null,
            Number(ligne.temps),
          ]
        );
      }
      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }

    const lignes = await chargerLignes(fiche.id);
    res.json({ ...fiche, lignes });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: t(req, "RH_FICHE_TEMPS_LIGNES_UPDATE_ERROR") });
  }
});

// PATCH /api/rh/fiches-temps/:id/soumettre
router.patch("/fiches-temps/:id/soumettre", async (req, res) => {
  try {
    const fiche = await chargerFicheTempsAvecAcces(req, res, { exigerProprietaire: true });
    if (!fiche) return;
    if (fiche.statut_validation !== "BROUILLON") {
      return res.status(400).json({ error: t(req, "RH_FICHE_TEMPS_SOUMETTRE_STATUT_INVALID") });
    }

    const lignes = await chargerLignes(fiche.id);
    const joursDeLaSemaineDates = joursDeLaSemaine(fiche.semaine_debut);
    const totalParJour = {};
    for (const l of lignes) {
      totalParJour[l.jour] = (totalParJour[l.jour] || 0) + Number(l.temps || 0);
    }
    const jourOuvreVide = JOURS_OUVRES.some((_, i) => !(totalParJour[joursDeLaSemaineDates[i]] > 0));
    if (jourOuvreVide) {
      return res.status(400).json({ error: t(req, "RH_FICHE_TEMPS_JOUR_VIDE") });
    }

    const verrouOk = await verifierVerrouChronologique(fiche.employe_id, fiche.semaine_debut);
    if (!verrouOk) {
      return res.status(400).json({ error: t(req, "RH_FICHE_TEMPS_VERROU_CHRONOLOGIQUE") });
    }

    const employe = await db.query(`SELECT utilisateur_id FROM employe WHERE id = $1`, [fiche.employe_id]);
    const roleApprobateurId = await determinerRoleApprobateur(req.user.tenantId, employe.rows[0].utilisateur_id);

    await db.query(
      `UPDATE fiche_temps SET statut_validation = 'SOUMISE', role_approbateur_id = $1, date_soumission = now()
       WHERE id = $2`,
      [roleApprobateurId, fiche.id]
    );
    const maj = await db.query(`${SELECT_FICHE_TEMPS} AND f.id = $2`, [req.user.tenantId, fiche.id]);
    res.json({ ...maj.rows[0], lignes });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: t(req, "RH_FICHE_TEMPS_SOUMETTRE_ERROR") });
  }
});

// PATCH /api/rh/fiches-temps/:id/valider - approbateur designe ou ADMIN.
// body: { decision: 'APPROUVEE' | 'REJETEE', motif_rejet? }
router.patch("/fiches-temps/:id/valider", async (req, res) => {
  const { decision, motif_rejet } = req.body;
  if (decision !== "APPROUVEE" && decision !== "REJETEE") {
    return res.status(400).json({ error: t(req, "RH_FICHE_TEMPS_VALIDER_STATUT_INVALID") });
  }
  if (decision === "REJETEE" && !motif_rejet) {
    return res.status(400).json({ error: t(req, "RH_FICHE_TEMPS_MOTIF_REJET_REQUIS") });
  }
  try {
    const fiche = await chargerFicheTempsAvecAcces(req, res, { exigerApprobateur: true });
    if (!fiche) return;
    if (fiche.statut_validation !== "SOUMISE") {
      return res.status(400).json({ error: t(req, "RH_FICHE_TEMPS_VALIDER_STATUT_INVALID") });
    }

    const statutDecision = decision === "APPROUVEE" ? "VALIDEE" : "REJETEE";
    await db.query(
      `UPDATE fiche_temps
       SET statut_validation = $1, approuve_par_utilisateur_id = $2, motif_rejet = $3, date_decision = now()
       WHERE id = $4`,
      [statutDecision, req.user.sub, decision === "REJETEE" ? motif_rejet : null, fiche.id]
    );
    const maj = await db.query(`${SELECT_FICHE_TEMPS} AND f.id = $2`, [req.user.tenantId, fiche.id]);
    const lignes = await chargerLignes(fiche.id);
    res.json({ ...maj.rows[0], lignes });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: t(req, "RH_FICHE_TEMPS_VALIDER_ERROR") });
  }
});

// GET /api/rh/fiches-temps/:id/export - export Excel de la fiche (proprietaire,
// ADMIN, ou approbateur potentiel - meme acces qu'une lecture simple).
router.get("/fiches-temps/:id/export", async (req, res) => {
  try {
    const fiche = await chargerFicheTempsAvecAcces(req, res);
    if (!fiche) return;
    const lignes = await chargerLignes(fiche.id);

    const dossierIds = [...new Set(lignes.filter((l) => l.dossier_ao_id).map((l) => l.dossier_ao_id))];
    let intitulesDossiers = {};
    if (dossierIds.length > 0) {
      const dossiersResult = await db.query(`SELECT id, intitule FROM dossier_ao WHERE id = ANY($1::uuid[])`, [dossierIds]);
      intitulesDossiers = Object.fromEntries(dossiersResult.rows.map((d) => [d.id, d.intitule]));
    }

    const enTetes = ["Jour", "Domaine", "Dossier / Categorie", "Precision", "Tache", "Temps (heures)"];
    const donnees = lignes.map((l) => [
      l.jour,
      l.domaine_type,
      l.domaine_type === "DOSSIER" ? intitulesDossiers[l.dossier_ao_id] || "" : l.categorie_autre,
      l.precision_autre || "",
      l.tache || "",
      Number(l.temps),
    ]);
    const feuille = XLSX.utils.aoa_to_sheet([enTetes, ...donnees]);
    const classeur = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(classeur, feuille, "Fiche de temps");
    const buffer = XLSX.write(classeur, { type: "buffer", bookType: "xlsx" });
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename="fiche_temps_${fiche.semaine_debut}.xlsx"`);
    res.send(buffer);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: t(req, "RH_FICHE_TEMPS_EXPORT_ERROR") });
  }
});

// POST /api/rh/fiches-temps/:id/importer - import tolerant (proprietaire,
// brouillon uniquement). Une valeur non reconnue (domaine ou categorie) ne
// bloque jamais l'import : repli sur AUTRE/'AUTRE' + note explicative dans
// la precision (comportement OGAA explicitement repris, voir memo point 8).
router.post("/fiches-temps/:id/importer", uploadExcel.single("fichier"), async (req, res) => {
  try {
    const fiche = await chargerFicheTempsAvecAcces(req, res, { exigerProprietaire: true });
    if (!fiche) return;
    if (fiche.statut_validation !== "BROUILLON") {
      return res.status(400).json({ error: t(req, "RH_FICHE_TEMPS_MODIF_STATUT_INVALID") });
    }
    if (!req.file) {
      return res.status(400).json({ error: t(req, "RH_FICHE_TEMPS_IMPORT_FILE_REQUIRED") });
    }

    let classeur;
    try {
      classeur = XLSX.read(req.file.buffer, { type: "buffer" });
    } catch {
      return res.status(400).json({ error: t(req, "RH_FICHE_TEMPS_IMPORT_FILE_TYPE_INVALID") });
    }
    const feuille = classeur.Sheets[classeur.SheetNames[0]];
    const lignesBrutes = XLSX.utils.sheet_to_json(feuille, { header: 1, defval: "" });

    const dossiersResult = await db.query(`SELECT id, intitule FROM dossier_ao WHERE tenant_id = $1`, [req.user.tenantId]);
    const dossierParIntitule = Object.fromEntries(
      dossiersResult.rows.map((d) => [d.intitule.trim().toLowerCase(), d.id])
    );
    const joursValides = new Set(joursDeLaSemaine(fiche.semaine_debut));

    const lignesImportees = [];
    for (const ligne of lignesBrutes.slice(1)) {
      const [jourBrut, domaineBrut, dossierOuCategorie, precision, tache, tempsBrut] = ligne;
      const jour = String(jourBrut || "").trim();
      if (!jour || !joursValides.has(jour)) continue; // ligne d'en-tete/legende ou hors semaine : ignoree

      const temps = Number(tempsBrut);
      if (!Number.isFinite(temps) || temps <= 0) continue;

      const domaineNormalise = String(domaineBrut || "").trim().toUpperCase();
      let domaine_type, dossier_ao_id = null, categorie_autre = null, precision_autre = precision || null;

      const dossierId = dossierParIntitule[String(dossierOuCategorie || "").trim().toLowerCase()];
      if (domaineNormalise === "DOSSIER" && dossierId) {
        domaine_type = "DOSSIER";
        dossier_ao_id = dossierId;
      } else if (domaineNormalise === "AUTRE" && TYPES_TEMPS_AUTRE.includes(String(dossierOuCategorie || "").trim().toUpperCase())) {
        domaine_type = "AUTRE";
        categorie_autre = String(dossierOuCategorie).trim().toUpperCase();
      } else {
        // Repli tolerant : valeur non reconnue -> AUTRE/'AUTRE' + note (jamais de blocage a l'import).
        domaine_type = "AUTRE";
        categorie_autre = "AUTRE";
        precision_autre = `Import : valeur non reconnue ("${domaineNormalise}" / "${dossierOuCategorie}")${precision ? " - " + precision : ""}`;
      }

      lignesImportees.push({
        jour,
        domaine_type,
        dossier_ao_id,
        categorie_autre,
        precision_autre,
        tache: tache || null,
        temps,
      });
    }

    const client = await db.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(`DELETE FROM ligne_fiche_temps WHERE fiche_temps_id = $1`, [fiche.id]);
      for (const ligne of lignesImportees) {
        await client.query(
          `INSERT INTO ligne_fiche_temps
             (fiche_temps_id, jour, domaine_type, dossier_ao_id, categorie_autre, precision_autre, tache, temps)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [fiche.id, ligne.jour, ligne.domaine_type, ligne.dossier_ao_id, ligne.categorie_autre, ligne.precision_autre, ligne.tache, ligne.temps]
        );
      }
      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }

    const lignes = await chargerLignes(fiche.id);
    res.json({ ...fiche, lignes, nombre_lignes_importees: lignesImportees.length });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: t(req, "RH_FICHE_TEMPS_IMPORT_ERROR") });
  }
});

module.exports = router;
