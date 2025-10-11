const logger = require('./logger');

function buildSocketErrorPayload(code, message, options = {}) {
  const normalizedCode = code ? String(code).toUpperCase() : 'UNKNOWN_ERROR';
  const timestamp = new Date().toISOString();
  const {
    source,
    context,
    details,
    retryable,
    reason,
    extras,
    includeLegacy = true,
    log,
    logLevel = 'warn'
  } = options;

  const payload = {
    code: normalizedCode,
    message: message || 'Unexpected error',
    source,
    ...(extras && typeof extras === 'object' ? extras : {})
  };

  const errorMeta = {
    code: normalizedCode,
    message: payload.message,
    source,
    context: context && typeof context === 'object' ? context : undefined,
    details,
    retryable: typeof retryable === 'boolean' ? retryable : undefined,
    timestamp
  };

  payload.error = Object.fromEntries(
    Object.entries(errorMeta).filter(([, value]) => value !== undefined)
  );

  if (includeLegacy) {
    // Preserve historical fields for backwards compatibility
    if (reason != null && payload.reason == null) payload.reason = reason;
  } else {
    if ('message' in payload && !includeLegacy) delete payload.message;
    if ('source' in payload && !includeLegacy) delete payload.source;
  }

  if (log) {
    try {
      const level = logger && typeof logger[logLevel] === 'function' ? logLevel : 'warn';
      logger[level]('[socket-error]', { code: normalizedCode, message: payload.message, source, context, details });
    } catch (_) {}
  }

  return payload;
}

function emitSocketError(socket, event, code, message, options = {}) {
  if (!socket || typeof socket.emit !== 'function') return null;
  const payload = buildSocketErrorPayload(code, message, options);
  try {
    socket.emit(event || 'error', payload);
  } catch (err) {
    try { logger.error('[socket-error] emit failed', { event, code, message: err.message }); } catch (_) {}
  }
  return payload;
}

module.exports = {
  buildSocketErrorPayload,
  emitSocketError
};
