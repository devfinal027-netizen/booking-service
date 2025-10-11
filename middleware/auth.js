const { verifyExternalToken } = require('../external service/jwtHelper');

const authenticate = (req, res, next) => {
  const authHeader = req.headers.authorization || '';
  if (!authHeader) {
    return res.status(401).json({ message: 'Unauthorized' });
  }
  try {
    const claims = verifyExternalToken(authHeader);
    req.user = claims;
    if (process.env.AUTH_DEBUG === '1') {
      console.log('✅ Token valid:', {
        id: claims.id,
        type: claims.type,
        iss: claims.iss,
        aud: claims.aud,
        ver: claims.ver,
        exp: claims?.exp ? new Date(claims.exp * 1000) : undefined,
      });
    }
    return next();
  } catch (error) {
    if (process.env.AUTH_DEBUG === '1') {
      console.log('❌ Token invalid:', {
        error: error.message,
        path: req.path,
      });
    }
    return res.status(401).json({ message: 'Unauthorized' });
  }
};

const authorize = (...allowedRoles) => {
  const normalizeRoleString = (value) => {
    if (!value) return '';
    let s = String(value).toLowerCase();
    // strip common prefixes
    s = s.replace(/^role[_:\-\s]?/, '');
    s = s.replace(/^scope[_:\-\s]?/, '');
    s = s.replace(/^urn:[^:]+:/, '');
    // compact separators
    s = s.replace(/[\s\-]+/g, '_');
    // singularize simple plurals
    if (s === 'drivers') s = 'driver';
    if (s === 'admins') s = 'admin';
    if (s === 'passengers') s = 'passenger';
    if (s === 'staffs') s = 'staff';
    if (s === 'superadmins') s = 'superadmin';
    // map common synonyms
    if (s === 'customer' || s === 'customers') s = 'passenger';
    if (s === 'rider' || s === 'riders') s = 'passenger';
    if (s === 'super_admin') s = 'superadmin';
    return s;
  };

  const allowed = (allowedRoles || []).map(r => normalizeRoleString(r));
  return (req, res, next) => {
    if (!req.user) return res.status(403).json({ message: 'Forbidden: No user information found.' });

    const userType = normalizeRoleString(req.user.type);
    const userRoles = Array.isArray(req.user.roles) ? req.user.roles.map(r => normalizeRoleString(r)) : [];

    const isAuthorized = userRoles.some(r => allowed.includes(r)) || allowed.includes(userType);

    if (isAuthorized) return next();
    return res.status(403).json({ message: 'Forbidden' });
  };
};

module.exports = { authenticate, authorize };

