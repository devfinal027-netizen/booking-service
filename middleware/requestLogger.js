const logger = require('../utils/logger');

module.exports = function requestLogger(req, _res, next) {
  try {
    const user = req.user ? { id: req.user.id, type: req.user.type } : undefined;
    const hasAuth = !!req.headers.authorization;
    logger.info('[http] ->', { method: req.method, path: req.originalUrl || req.url, hasAuth, user });
  } catch (_) {}
  next();
};
