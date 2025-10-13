const jwt = require('jsonwebtoken');

/**
 * Extract user information from JWT token
 * @param {string} token - JWT token
 * @returns {Object} User information from token
 */
function extractUserFromToken(token) {
  try {
    if (!token) return null;
    
    // Remove 'Bearer ' prefix if present
    const cleanToken = token.startsWith('Bearer ') ? token.slice(7) : token;
    
    const decoded = jwt.verify(cleanToken, process.env.JWT_SECRET || 'secret');
    
    return {
      id: String(decoded.id || decoded.userId || decoded._id || decoded.sub || (decoded.user && (decoded.user.id || decoded.user._id)) || ''),
      type: decoded.type,
      roles: decoded.roles || [],
      permissions: decoded.permissions || [],
      // Extract user details if available in token
      name: decoded.name || null,
      phone: decoded.phone || null,
      email: decoded.email || null,
      vehicle_info: decoded.vehicle_info || null, // For drivers
    };
  } catch (error) {
    console.error('Error extracting user from token:', error.message);
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
      id: targetUserId || 'unknown',
      name: `${targetUserType || 'User'} ${String(targetUserId || '').slice(-4) || 'Unknown'}`,
      phone: 'Not available',
      email: 'Not available',
      vehicle_info: null,
      type: targetUserType || 'unknown'
    };
  }

  // First try to get info from token
  let decodedAll = null;
  try {
    const authz = req.headers && req.headers.authorization ? req.headers.authorization : null;
    if (authz) {
      const clean = authz.startsWith('Bearer ') ? authz.slice(7) : authz;
      decodedAll = jwt.verify(clean, process.env.JWT_SECRET || 'secret');
    }
  } catch (_) {}

  const tokenInfo = extractUserFromToken(req.headers.authorization);
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

    // If token embeds collections of users, try to resolve by id and type
    if (decodedAll) {
      const candidateContainers = [];
      if (targetUserType === 'passenger') candidateContainers.push(decodedAll.passengers, decodedAll.users, decodedAll.userList, decodedAll.data);
      if (targetUserType === 'driver') candidateContainers.push(decodedAll.drivers, decodedAll.users, decodedAll.userList, decodedAll.data);
      if (targetUserType === 'admin') candidateContainers.push(decodedAll.admins, decodedAll.staff, decodedAll.users, decodedAll.userList, decodedAll.data);

      const findInContainer = (container) => {
        if (!container) return null;
        // If it's an array
        if (Array.isArray(container)) {
          const found = container.find((u) => {
            const id = u && (u.id || u._id || (u.user && (u.user.id || u.user._id)));
            return id != null && String(id) === String(targetUserId);
          });
          return found || null;
        }
        // If it's a map-like object keyed by id
        if (typeof container === 'object') {
          const direct = container[targetUserId];
          if (direct) return direct;
          const any = Object.values(container).find((u) => String(u && (u.id || u._id)) === String(targetUserId));
          return any || null;
        }
        return null;
      };

      for (const cont of candidateContainers) {
        const found = findInContainer(cont);
        if (found) {
          return {
            id: String(found.id || found._id || targetUserId),
            name: found.name || `${targetUserType} ${String(targetUserId).slice(-4)}`,
            phone: found.phone || 'Not available',
            email: found.email || 'Not available',
            vehicle_info: found.vehicle_info || {
              carModel: found.carModel,
              carPlate: found.carPlate,
              carColor: found.carColor,
              vehicleType: found.vehicleType,
            },
            type: targetUserType
          };
        }
      }
    }
  }

  // Fallback to external service
  try {
    const { getPassengerById, getDriverById, getAdminById } = require('./userService');
    const authHeader = req.headers && req.headers.authorization ? 
      { headers: { Authorization: req.headers.authorization } } : {};

    let userInfo = null;
    switch (targetUserType) {
      case 'passenger':
        userInfo = await getPassengerById(targetUserId, authHeader);
        break;
      case 'driver':
        userInfo = await getDriverById(targetUserId, authHeader);
        break;
      case 'admin':
        userInfo = await getAdminById(targetUserId, authHeader);
        break;
    }

    // For drivers, properly map vehicle information
    let vehicle_info = null;
    if (targetUserType === 'driver' && userInfo) {
      vehicle_info = {
        carModel: userInfo.carModel || null,
        carPlate: userInfo.carPlate || null,
        carColor: userInfo.carColor || null,
        vehicleType: userInfo.vehicleType || null,
      };
    } else if (userInfo?.vehicle_info) {
      vehicle_info = userInfo.vehicle_info;
    }

    return {
      id: String(targetUserId),
      name: userInfo?.name || `${targetUserType} ${String(targetUserId).slice(-4)}`,
      phone: userInfo?.phone || 'Not available',
      email: userInfo?.email || 'Not available',
      vehicle_info: vehicle_info,
      type: targetUserType
    };
  } catch (error) {
    console.error('Error fetching user info:', error.message);
    // Return fallback info instead of null
    return {
      id: String(targetUserId),
      name: `${targetUserType} ${String(targetUserId).slice(-4)}`,
      phone: 'Not available',
      email: 'Not available',
      vehicle_info: null,
      type: targetUserType
    };
  }
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