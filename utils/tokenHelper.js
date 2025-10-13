const { verifyExternalToken } = require('../utils/externalJwt');

/**
 * Extract user information from JWT token
 * @param {string} token - JWT token
 * @returns {Object} User information from token
 */
async function extractUserFromToken(token) {
  if (!token) return null;
  try {
    const claims = verifyExternalToken(token);
    return {
      id: String(claims.id),
      type: String(claims.type || '').toLowerCase(),
      roles: Array.isArray(claims.roles) ? claims.roles : (claims.roles ? [claims.roles] : []),
      permissions: [],
      name: null,
      phone: null,
      email: null,
      vehicle_info: null,
    };
  } catch (_) {
    return null;
  }
}

/**
 * Get user info from request (token or external service)
 * @param {Object} req - Express request object
 * @param {string} userId - User ID to fetch info for
 * @param {string} userType - Type of user (passenger, driver, admin)
 * @returns {Object} User information (never returns null fields)
 */
async function getUserInfo(req, userId = null, userType = null) {
  const targetUserIdRaw = userId ?? req.user?.id;
  const targetUserId = targetUserIdRaw != null ? String(targetUserIdRaw) : null;
  const targetUserType = userType || req.user?.type;
  
  if (!targetUserId || !targetUserType) {
    return {
      id: String(targetUserId || ''),
      name: '',
      phone: '',
      email: '',
      vehicle_info: null,
      type: String(targetUserType || ''),
    };
  }

  // First try to get info by introspecting token
  const tokenInfo = await extractUserFromToken(req.headers && req.headers.authorization);
  if (tokenInfo) {
    // If token represents the same user id AND same user type, return directly
    if (String(tokenInfo.id) === String(targetUserId) && (!tokenInfo.type || String(tokenInfo.type).toLowerCase() === String(targetUserType).toLowerCase())) {
      return {
        id: String(tokenInfo.id),
        name: tokenInfo.name || `${targetUserType} ${String(targetUserId).slice(-4)}`,
        phone: tokenInfo.phone || 'Not available',
        email: tokenInfo.email || 'Not available',
        vehicle_info: tokenInfo.vehicle_info || null,
        type: tokenInfo.type || targetUserType
      };
    }

    // Skip embedded collections parsing to avoid relying on local JWT contents
  }

  // Do not call external user service; return claims-only fields (non-null strings)
  return {
    id: String(targetUserId),
    name: '',
    phone: '',
    email: '',
    vehicle_info: null,
    type: targetUserType,
  };
}

/**
 * Populate user fields in an object
 * @param {Object} obj - Object to populate
 * @param {Object} userInfo - User information
 * @param {string} prefix - Prefix for field names (e.g., 'passenger_', 'driver_')
 * @returns {Object} Object with populated user fields
 */
function populateUserFields(obj, userInfo, prefix = '') {
  if (!userInfo) return obj;
  
  return {
    ...obj,
    [`${prefix}name`]: userInfo.name || null,
    [`${prefix}phone`]: userInfo.phone || null,
    [`${prefix}email`]: userInfo.email || null,
    ...(userInfo.vehicle_info && { [`${prefix}vehicle_info`]: userInfo.vehicle_info })
  };
}

module.exports = {
  extractUserFromToken,
  getUserInfo,
  populateUserFields
};