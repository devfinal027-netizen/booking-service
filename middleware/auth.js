const jwt = require('jsonwebtoken');

const authenticate = (req, res, next) => {
  const raw = req.headers.authorization || '';
  const token = String(raw).replace(/^\s*Bearer\s+/i, '');
  if (!token) return res.status(401).json({ message: 'Unauthorized' });
  try {
    const claims = jwt.verify(token, process.env.JWT_SECRET, {
      issuer: process.env.TOKEN_ISSUER || process.env.JWT_ISSUER,
      audience: process.env.TOKEN_AUDIENCE || process.env.JWT_AUDIENCE,
    });
    req.user = claims;
    return next();
  } catch (e) {
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

