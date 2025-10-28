const jwt = require('jsonwebtoken');

function getFirstEnv(...names) {
  for (const name of names) {
    const v = process.env[name];
    if (v != null && v !== '') return v;
  }
  return undefined;
}

function cleanToken(input) {
  if (!input || typeof input !== 'string') return '';
  return input.trim().replace(/^(Bearer|JWT|Token)\s+/i, '');
}

function verifyExternalToken(token, options = {}) {
  const raw = cleanToken(token);
  if (!raw) {
    const err = new Error('Token is required');
    err.code = 'TOKEN_REQUIRED';
    throw err;
  }
  const secret = getFirstEnv('JWT_SECRET');
  if (!secret) {
    const err = new Error('JWT secret not configured');
    err.code = 'JWT_SECRET_MISSING';
    throw err;
  }
  const issuer = getFirstEnv('JWT_ISSUER', 'TOKEN_ISSUER', 'AUTH_ISSUER');
  const audience = getFirstEnv('JWT_AUDIENCE', 'TOKEN_AUDIENCE', 'AUTH_AUDIENCE');
  const verifyOpts = { ...options };
  if (issuer) verifyOpts.issuer = issuer;
  if (audience) verifyOpts.audience = audience;
  const verified = jwt.verify(raw, secret, verifyOpts);
  const requiredKeys = ['iss','aud','ver','id','type','roles','driverId','paymentPreference','carName'];
  for (const k of requiredKeys) {
    if (!Object.prototype.hasOwnProperty.call(verified, k)) {
      const err = new Error(`Token missing required claim: ${k}`);
      err.code = 'TOKEN_INVALID_CLAIMS';
      throw err;
    }
  }
  return verified;
}

// decodeExternalToken and resolveEntityFromToken removed; not needed in Booking service

function scheduleTokenExpiryDisconnect(socket, decoded) {
  if (!decoded || !decoded.exp) return;
  const expiryMs = decoded.exp * 1000;
  const delay = expiryMs - Date.now();
  if (!Number.isFinite(delay) || delay <= 0) {
    try { socket.emit('auth_error', { code: 'TOKEN_EXPIRED', message: 'Authentication token expired.' }); } catch (_) {}
    try { socket.disconnect(true); } catch (_) {}
    return;
  }
  const timer = setTimeout(() => {
    try { socket.emit('auth_error', { code: 'TOKEN_EXPIRED', message: 'Authentication token expired.' }); } catch (_) {}
    try { socket.disconnect(true); } catch (_) {}
  }, delay);
  if (timer.unref) timer.unref();
  socket.once('disconnect', () => clearTimeout(timer));
}

async function socketAuth(socket, next) {
  const authHeader = socket.handshake.auth?.token
    || socket.handshake.query?.token
    || socket.handshake.headers?.authorization;
  try {
    const claims = verifyExternalToken(authHeader);
    socket.user = {
      id: claims.id != null ? String(claims.id) : undefined,
      type: String(claims.type || '').toLowerCase(),
      name: claims.name,
      phone: claims.phone,
      email: claims.email,
      vehicleType: claims.vehicleType,
      carName: claims.carName,
      carModel: claims.carModel,
      carPlate: claims.carPlate,
      carColor: claims.carColor,
    };
    socket.authToken = authHeader && String(authHeader).startsWith('Bearer ') ? String(authHeader) : `Bearer ${String(authHeader || '')}`;
    scheduleTokenExpiryDisconnect(socket, claims);
    return next();
  } catch (err) {
    return next(err);
  }
}

module.exports = { socketAuth, verifyExternalToken };

