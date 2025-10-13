require("dotenv").config();
const { verifyExternalToken } = require("../utils/externalJwt");

const authenticate = (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res
      .status(401)
      .json({ message: "Authentication failed: No token provided." });
  }

  try {
    const claims = verifyExternalToken(authHeader);
    req.user = {
      id: String(claims.id),
      type: String(claims.type || '').toLowerCase(),
      roles: Array.isArray(claims.roles) ? claims.roles : (claims.roles ? [claims.roles] : []),
      driverId: claims.driverId != null ? String(claims.driverId) : null,
      paymentPreference: claims.paymentPreference ?? null,
      carName: claims.carName ?? null,
      iss: claims.iss,
      aud: claims.aud,
      ver: claims.ver,
    };
    return next();
  } catch (e) {
    return res.status(401).json({ message: "Authentication failed: Unauthorized" });
  }
};

/**
 * Updated authorize middleware that works with your token structure
 * Uses the 'type' field for authorization since 'roles' is only for superadmin
 */
const authorize = (...allowedTypes) => {
  // Normalize allowed types to lower-case for case-insensitive matching
  const normalizedAllowed = (allowedTypes || []).map((t) => String(t).toLowerCase());

  // Helper to normalize a single role/type token into canonical form
  const normalizeRole = (value) => {
    if (!value) return undefined;
    let raw = String(value).toLowerCase();
    // Strip common prefixes and separators: ROLE_ADMIN, SUPER_ADMIN, etc.
    raw = raw.replace(/^role[_-]/, "").replace(/[^a-z]/g, "");
    if (raw.startsWith("superadmin") || raw === "superadministrator") return "superadmin";
    if (raw === "administrator" || raw.startsWith("admin")) return "admin";
    if (raw.startsWith("driver")) return "driver";
    if (raw.startsWith("passenger") || raw === "rider") return "passenger";
    if (raw === "staff" || raw === "operator") return "admin"; // treat staff/operator as admin for authorization
    return raw; // fallback
  };

  return (req, res, next) => {
    if (!req.user) {
      return res
        .status(403)
        .json({ message: "Forbidden: No user information found." });
    }

    // Collect all possible type/role signals
    const roleCandidates = [];
    const pushIf = (v) => { const n = normalizeRole(v); if (n) roleCandidates.push(n); };
    pushIf(req.user.type);
    pushIf(req.user.role);
    if (Array.isArray(req.user.roles)) {
      req.user.roles.forEach((r) => pushIf(typeof r === "object" ? (r.name || r.role) : r));
    }
    if (req.user.isAdmin || req.user.is_admin) roleCandidates.push("admin");

    // Determine effective type with privilege precedence
    let effectiveType = "";
    if (roleCandidates.includes("superadmin")) effectiveType = "superadmin";
    else if (roleCandidates.includes("admin")) effectiveType = "admin";
    else if (roleCandidates.includes("driver")) effectiveType = "driver";
    else if (roleCandidates.includes("passenger")) effectiveType = "passenger";

    // Persist normalized type on request for downstream handlers
    if (effectiveType) req.user.type = effectiveType;

    // If endpoint allows admin, also allow superadmin
    if (normalizedAllowed.includes("admin") && (effectiveType === "admin" || effectiveType === "superadmin")) {
      return next();
    }

    // Strict superadmin endpoints
    if (normalizedAllowed.includes("superadmin") && effectiveType === "superadmin") {
      return next();
    }

    // For all other user types, check direct inclusion
    if (effectiveType && normalizedAllowed.includes(effectiveType)) {
      return next();
    }

    return res.status(403).json({
      message: "Forbidden: You do not have permission to access this resource.",
    });
  };
};

module.exports = {
  authenticate,
  authorize,
};
