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
      `SELECT r.code FROM role r
       JOIN utilisateur_role ur ON ur.role_id = r.id
       WHERE ur.utilisateur_id = $1`,
      [user.id]
    );

    req.user = {
      sub: user.id,
      tenantId: user.tenant_id,
      email: user.email,
      roles: rolesResult.rows.map((r) => r.code),
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

module.exports = { requireAuth, requireRole, requireSuperAdmin };
