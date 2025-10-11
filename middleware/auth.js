const jwt = require('jsonwebtoken');
const logger = require('../utils/logger');

const authenticate = (req, res, next) => {
  const raw = req.headers.authorization || '';
  const token = String(raw).replace(/^\s*Bearer\s+/i, '');
  if (!token) {
    logger.warn('[auth] missing token', { path: req.originalUrl || req.url, rawHeader: raw ? `${raw.slice(0,20)}...` : '' });
    return res.status(401).json({ message: 'Unauthorized' });
  }
  try {
    const issuer = process.env.TOKEN_ISSUER || process.env.JWT_ISSUER || 'auth-service';
    const audience = process.env.TOKEN_AUDIENCE || process.env.JWT_AUDIENCE || 'booking-service';
    const claims = jwt.verify(token, process.env.JWT_SECRET, {
      algorithms: ['HS256'],
      issuer,
      audience,
    });
    req.user = claims;
    if (process.env.AUTH_DEBUG === '1') {
      logger.info('[auth] verified', {
        id: claims.id,
        type: claims.type,
        iss: claims.iss,
        aud: claims.aud,
        exp: claims.exp,
        path: req.originalUrl || req.url,
      });
    }
    return next();
  } catch (e) {
    logger.warn('[auth] verify failed', {
      error: e && e.message,
      name: e && e.name,
      code: e && e.code,
      path: req.originalUrl || req.url,
      issuer: process.env.TOKEN_ISSUER || process.env.JWT_ISSUER || 'auth-service',
      audience: process.env.TOKEN_AUDIENCE || process.env.JWT_AUDIENCE || 'booking-service',
      hasSecret: !!process.env.JWT_SECRET,
      headerPreview: raw ? `${raw.slice(0, 14)}...` : '',
    });
    return res.status(401).json({ message: 'Invalid token' });
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

