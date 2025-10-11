const logger = require('./logger');

function serializeTags(tags = {}) {
  try {
    const clean = Object.entries(tags || {})
      .filter(([_, value]) => value !== undefined && value !== null)
      .map(([key, value]) => `${key}=${value}`)
      .join(',');
    return clean ? ` [${clean}]` : '';
  } catch (_) {
    return '';
  }
}

function increment(name, value = 1, tags = {}) {
  try {
    const tagString = serializeTags(tags);
    logger.info(`[metrics] increment ${name} ${value}${tagString}`);
  } catch (_) {}
}

function timing(name, value, tags = {}) {
  try {
    const tagString = serializeTags(tags);
    logger.info(`[metrics] timing ${name} ${value}ms${tagString}`);
  } catch (_) {}
}

module.exports = { increment, timing };
