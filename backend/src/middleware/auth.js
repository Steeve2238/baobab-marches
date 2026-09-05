const { verifyToken } = require("../utils/jwt");
const { t } = require("../utils/i18n");
const db = require("../db");

/**
 * Verifie le token JWT PUIS recalcule l'identite complete de l'utilisateur
 * depuis la base (tenant, statut actif, roles a jour) a chaque requete,
 * plutot que de faire confiance aux champs geles dans le token au moment du
 * login. Deux consequences importantes, directement inspirees du
 * fonctionnement d'OGAA :
 *   - un changement de role fait par un ADMIN prend effet immediatement, a
 *     la prochaine requete de la personne concernee (pas besoin de se
 *     reconnecter) ;
 *   - desactiver un utilisateur le deconnecte effectivement des la
 *     prochaine requete, meme si son token est encore valide.
 * Cout : une requete SQL supplementaire par appel authentifie - acceptable
 * ici (roles/permissions doivent primer sur la performance brute).
 *
 * Attache req.user = { sub, tenantId, email, roles }. Rejette avec 401 si
 * absent/invalide/compte desactive ou supprime.
 */
async function requireAuth(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;

  if (!token) {
    return res.status(401).json({ error: t(req, "AUTH_REQUIRED") });
  }

  let payload;
  try {
    payload = verifyToken(token);
  } catch (err) {
    return res.status(401).json({ error: t(req, "SESSION_INVALID") });
  }

  try {
    const userResult = await db.query(
      `SELECT u.id, u.tenant_id, u.email, u.actif
       FROM utilisateur u
       WHERE u.id = $1`,
      [payload.sub]
    );
    const user = userResult.rows[0];
    if (!user || !user.actif) {
      return res.status(401).json({ error: t(req, "SESSION_INVALID") });
    }

    const rolesResult = await db.query(
      `SELECT r.code, r.perimetre_json, r.lecture_seule, r.validateur_universel
       FROM role r
       JOIN utilisateur_role ur ON ur.role_id = r.id
       WHERE ur.utilisateur_id = $1`,
      [user.id]
    );

    const roles = rolesResult.rows.map((r) => r.code);

    // Permissions agregees (04/09/2026, construction du systeme de
    // permissions par role demande par Steeve) : un utilisateur peut porter
    // plusieurs roles (ex ADMIN+DIRECTION), donc on fait l'UNION des modules
    // visibles/du tableau de bord/du statut validateur universel sur tous
    // ses roles - et "lecture seule" ne s'applique que si TOUS ses roles le
    // sont (un seul role d'ecriture suffit a debloquer l'ecriture). ADMIN
    // court-circuite tout, meme principe que requireRole ci-dessous : accede
    // a tout, jamais en lecture seule, toujours validateur universel.
    let permissions;
    if (roles.includes("ADMIN")) {
      permissions = { admin: true, modules: null, tableauDeBord: true, lectureSeule: false, validateurUniversel: true };
    } else {
      const modules = new Set();
      let tableauDeBord = false;
      let validateurUniversel = false;
      let auMoinsUnRoleEcriture = false;
      for (const r of rolesResult.rows) {
        const perimetre = r.perimetre_json || {};
        (perimetre.modules || []).forEach((m) => modules.add(m));
        if (perimetre.tableauDeBord) tableauDeBord = true;
        if (r.validateur_universel) validateurUniversel = true;
        if (!r.lecture_seule) auMoinsUnRoleEcriture = true;
      }
      permissions = {
        admin: false,
        modules: Array.from(modules),
        tableauDeBord,
        lectureSeule: rolesResult.rows.length > 0 && !auMoinsUnRoleEcriture,
        validateurUniversel,
      };
    }

    req.user = {
      sub: user.id,
      tenantId: user.tenant_id,
      email: user.email,
      roles,
      permissions,
    };
    next();
  } catch (err) {
    console.error(err);
    return res.status(401).json({ error: t(req, "SESSION_INVALID") });
  }
}

/**
 * Verifie que l'utilisateur possede au moins un des roles fournis.
 * Un utilisateur portant le role ADMIN passe toujours, quelle que soit la
 * restriction demandee (meme convention qu'OGAA).
 * A utiliser apres requireAuth. Usage : requireRole("ADMIN", "DIRECTION")
 */
function requireRole(...allowedCodes) {
  return (req, res, next) => {
    const userRoles = req.user?.roles || [];
    if (userRoles.includes("ADMIN")) {
      return next();
    }
    const hasAccess = userRoles.some((r) => allowedCodes.includes(r));
    if (!hasAccess) {
      return res.status(403).json({ error: t(req, "ROLE_FORBIDDEN") });
    }
    next();
  };
}

/**
 * Variante de requireRole pour les actions de VALIDATION au sens strict
 * (approuver/rejeter une action faite par un profil assistant - jamais pour
 * une simple creation) : accepte en plus tout utilisateur "validateur
 * universel" (role.validateur_universel, cf req.user.permissions calcule par
 * requireAuth ci-dessus), meme s'il ne porte aucun des codes de role listes.
 *
 * Construit le 05/09/2026 (Phase 2 du systeme de permissions par role) a la
 * demande explicite de Steeve : le Directeur General et le Directeur
 * Financier (les deux seuls roles marques validateur_universel par la
 * migration 017) doivent pouvoir se couvrir mutuellement - "si le directeur
 * general n'est pas la... si le directeur financier n'est pas la, c'est le
 * directeur general qui va signer" - portee choisie la plus large parmi les
 * options proposees ("toute action de validation, dans tout module"), donc
 * UN SEUL statut (validateur_universel) fait office d'autorite de validation
 * partout, plutot qu'un statut distinct par module.
 *
 * A utiliser a la place de requireRole(...) uniquement sur les routes qui
 * valident/rejettent une action deja soumise par quelqu'un d'autre - jamais
 * sur les routes de creation/edition simple.
 */
function requireRoleOuValidateurUniversel(...allowedCodes) {
  return (req, res, next) => {
    const userRoles = req.user?.roles || [];
    const permissions = req.user?.permissions;
    if (userRoles.includes("ADMIN") || permissions?.validateurUniversel) {
      return next();
    }
    const hasAccess = userRoles.some((r) => allowedCodes.includes(r));
    if (!hasAccess) {
      return res.status(403).json({ error: t(req, "ROLE_FORBIDDEN") });
    }
    next();
  };
}

/**
 * Systeme de permissions par role (construit le 04/09/2026 a la demande de
 * Steeve, cf conversation "architecture de l'organisation de l'entreprise") -
 * s'appuie sur req.user.permissions deja calcule par requireAuth ci-dessus
 * (union des roles portes par l'utilisateur). A utiliser apres requireAuth,
 * jamais seul.
 *
 * requireModule("dossiers") bloque l'acces a un module tant que le role de
 * l'utilisateur ne le liste pas explicitement dans son perimetre_json.modules
 * (colonne configurable depuis l'ecran Roles). Le module "dossiers" fait
 * exception : quiconque a le tableau de bord general (tableauDeBord) y a
 * aussi acces en lecture de fait, puisque le tableau de bord EST le
 * portefeuille des dossiers - sans ca, le Directeur Financier (qui a le
 * tableau de bord mais pas forcement "dossiers" dans son perimetre) verrait
 * son tableau de bord planter.
 */
function requireModule(moduleKey) {
  return (req, res, next) => {
    const permissions = req.user?.permissions;
    if (!permissions) {
      return res.status(403).json({ error: t(req, "MODULE_FORBIDDEN") });
    }
    if (permissions.admin) return next();
    if (permissions.modules.includes(moduleKey)) return next();
    if (moduleKey === "dossiers" && permissions.tableauDeBord) return next();
    return res.status(403).json({ error: t(req, "MODULE_FORBIDDEN") });
  };
}

/**
 * Bloque toute methode d'ecriture (tout sauf GET) pour un utilisateur dont
 * TOUS les roles sont marques "lecture seule" (cas du Directeur General,
 * qui doit pouvoir tout consulter mais ne jamais rien modifier). ADMIN n'est
 * jamais concerne. A poser en meme temps que requireModule, apres
 * requireAuth, sur les fichiers de routes ou la notion de lecture seule doit
 * s'appliquer telle quelle (le module Marche a son propre systeme de roles
 * plus fin ROLES_CREATION/VALIDATION/FACTURATION et n'utilise pas encore ce
 * middleware generique, voir ventes.js).
 */
function blockLectureSeule(req, res, next) {
  if (req.method === "GET") return next();
  const permissions = req.user?.permissions;
  if (!permissions || permissions.admin || !permissions.lectureSeule) return next();
  return res.status(403).json({ error: t(req, "LECTURE_SEULE_FORBIDDEN") });
}

/**
 * Verifie un token Super Admin - completement distinct du circuit
 * requireAuth/requireRole ci-dessus : le Super Admin n'appartient a AUCUN
 * tenant (table administrateur_plateforme, sans tenant_id), c'est le
 * proprietaire de la plateforme (Steeve), pas un role a l'interieur d'une
 * entreprise cliente. Le payload du token porte `superAdminId` (jamais
 * `sub`/`tenantId`) pour qu'un token tenant ne puisse jamais etre pris par
 * erreur pour un token Super Admin, et inversement (voir routes/superAdmin.js
 * pour l'emission de ce token).
 */
async function requireSuperAdmin(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;

  if (!token) {
    return res.status(401).json({ error: t(req, "AUTH_REQUIRED") });
  }

  let payload;
  try {
    payload = verifyToken(token);
  } catch (err) {
    return res.status(401).json({ error: t(req, "SESSION_INVALID") });
  }

  if (!payload.superAdminId) {
    return res.status(401).json({ error: t(req, "SESSION_INVALID") });
  }

  try {
    const result = await db.query(
      `SELECT id, email, nom, actif FROM administrateur_plateforme WHERE id = $1`,
      [payload.superAdminId]
    );
    const admin = result.rows[0];
    if (!admin || !admin.actif) {
      return res.status(401).json({ error: t(req, "SESSION_INVALID") });
    }
    req.superAdmin = { id: admin.id, email: admin.email, nom: admin.nom };
    next();
  } catch (err) {
    console.error(err);
    return res.status(401).json({ error: t(req, "SESSION_INVALID") });
  }
}

module.exports = {
  requireAuth,
  requireRole,
  requireRoleOuValidateurUniversel,
  requireModule,
  blockLectureSeule,
  requireSuperAdmin,
};
