const { verifyToken } = require("../utils/jwt");
const { t } = require("../utils/i18n");

/**
 * Verifie le token JWT et attache req.user = { id, tenantId, email, roles }.
 * Rejette avec 401 si absent/invalide.
 */
function requireAuth(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;

  if (!token) {
    return res.status(401).json({ error: t(req, "AUTH_REQUIRED") });
  }

  try {
    const payload = verifyToken(token);
    req.user = payload;
    next();
  } catch (err) {
    return res.status(401).json({ error: t(req, "SESSION_INVALID") });
  }
}

/**
 * Verifie que l'utilisateur possede au moins un des roles fournis.
 * A utiliser apres requireAuth. Usage : requireRole("ADMIN", "DIRECTION")
 */
function requireRole(...allowedCodes) {
  return (req, res, next) => {
    const userRoles = req.user?.roles || [];
    const hasAccess = userRoles.some((r) => allowedCodes.includes(r));
    if (!hasAccess) {
      return res.status(403).json({ error: t(req, "ROLE_FORBIDDEN") });
    }
    next();
  };
}

module.exports = { requireAuth, requireRole };
