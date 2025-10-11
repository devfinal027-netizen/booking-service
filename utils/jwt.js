const jwt = require('jsonwebtoken');
const axios = require('axios');
require('dotenv').config();

// Minimal JWKS cache for socket verification (mirrors middleware/auth.js behavior)
const jwksCache = { keys: {}, fetchedAt: 0 };
async function getSigningKey(kid) {
  const jwksUrl = process.env.AUTH_JWKS_URL;
  if (!jwksUrl) return null;
  const now = Date.now();
  if (
    jwksCache.fetchedAt &&
    now - jwksCache.fetchedAt < 5 * 60 * 1000 &&
    jwksCache.keys[kid]
  ) {
    return jwksCache.keys[kid];
  }
  try {
    const res = await axios.get(jwksUrl);
    const data = res.data || {};
    const keys = Array.isArray(data.keys) ? data.keys : [];
    jwksCache.keys = {};
    keys.forEach((k) => {
      if (k.kid && k.x5c && k.x5c[0]) {
        jwksCache.keys[k.kid] = `-----BEGIN CERTIFICATE-----\n${k.x5c[0]}\n-----END CERTIFICATE-----\n`;
      }
    });
    jwksCache.fetchedAt = now;
  } catch (_) {
    return null;
  }
  return jwksCache.keys[kid] || null;
}

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

function formatAuthError(code, message) {
  const payload = { code, message };
  const err = new Error(JSON.stringify(payload));
  err.data = payload;
  return err;
}

async function verifySocketToken(token) {
  if (!token) {
    throw formatAuthError('AUTH_MISSING_TOKEN', 'Authentication token missing.');
  }
  let decoded;
  try {
    const decodedHeader = jwt.decode(token, { complete: true }) || {};
    const header = decodedHeader.header || {};
    const algorithm = header.alg || '';
    const isSymmetric = /^HS/i.test(algorithm);
    const isAsymmetric = /^RS/i.test(algorithm);

    const verifyAsync = (secretOrKeyProvider, options) => new Promise((resolve, reject) => {
      jwt.verify(token, secretOrKeyProvider, options, (err, payload) => {
        if (err) return reject(err);
        return resolve(payload);
      });
    });

    if (isAsymmetric && process.env.AUTH_JWKS_URL) {
      decoded = await verifyAsync(
        async (header, cb) => {
          try {
            const cert = await getSigningKey(header.kid);
            if (!cert) return cb(new Error('Signing key not found'));
            return cb(null, cert);
          } catch (e) {
            return cb(e);
          }
        },
        {
          algorithms: algorithm ? [algorithm] : ['RS256'],
          audience: process.env.AUTH_AUDIENCE || process.env.JWT_AUDIENCE || undefined,
          issuer: process.env.AUTH_ISSUER || process.env.JWT_ISSUER || undefined
        }
      );
    } else {
      const sharedSecret = process.env.JWT_SECRET || 'secret';
      if (!sharedSecret) {
        throw new Error('Shared secret not configured');
      }
      decoded = await verifyAsync(
        sharedSecret,
        {
          algorithms: algorithm ? [algorithm] : ['HS256'],
          audience: process.env.AUTH_AUDIENCE || process.env.JWT_AUDIENCE || undefined,
          issuer: process.env.AUTH_ISSUER || process.env.JWT_ISSUER || undefined
        }
      );
    }
  } catch (error) {
    const message = error && error.message ? error.message : 'Invalid token';
    throw formatAuthError('AUTH_INVALID_TOKEN', message);
  }
  if (decoded && decoded.exp && decoded.exp * 1000 <= Date.now()) {
    throw formatAuthError('AUTH_TOKEN_EXPIRED', 'Authentication token expired.');
  }
  return decoded || {};
}

async function socketAuth(socket, next) {
  const authHeader = socket.handshake.auth?.token
    || socket.handshake.query?.token
    || socket.handshake.headers?.authorization;
  const token = authHeader
    ? String(authHeader).trim().replace(/^(Bearer|JWT|Token)\s+/i, '')
    : '';
  try {
    const decoded = await verifySocketToken(token);
    const top = decoded || {};
    const userObj = (decoded && decoded.user) || {};
    const driverObj = (decoded && decoded.driver) || {};
    const src = { ...userObj, ...driverObj, ...top };
    const name = src.name || src.fullName || src.displayName;
    const phone = src.phone || src.phoneNumber || src.mobile;
    const email = src.email;
    const vehicleType = src.vehicleType;
    const carName = src.carName || src.carModel || src.vehicleName || src.carname || driverObj.carName || driverObj.carModel;
    const carModel = src.carModel || src.carName || src.vehicleName || src.carname || driverObj.carModel || driverObj.carName;
    const carPlate = src.carPlate || src.car_plate || src.carPlateNumber || src.plate || src.plateNumber || driverObj.carPlate;
    const carColor = src.carColor || src.color || driverObj.carColor;
    const normalizeRoleString = (value) => {
      if (!value) return '';
      let s = String(value).toLowerCase();
      s = s.replace(/^role[_:\-\s]?/, '');
      s = s.replace(/^scope[_:\-\s]?/, '');
      s = s.replace(/^urn:[^:]+:/, '');
      s = s.replace(/^[^:]+:([^:]+)$/, '$1');
      s = s.replace(/[\s\-]+/g, '_');
      if (s === 'drivers') s = 'driver';
      if (s === 'passengers') s = 'passenger';
      if (s === 'admins') s = 'admin';
      return s;
    };
    const resolvedTypeRaw = (src.type || src.userType || src.role || decoded.type || '');
    const resolvedType = normalizeRoleString(resolvedTypeRaw);
    const resolvedId = src.id
      || src.userId
      || src.driverId
      || src.uid
      || src.sub
      || decoded.id;

    socket.user = {
      id: resolvedId != null ? String(resolvedId) : undefined,
      type: resolvedType,
      name,
      phone,
      email,
      vehicleType,
      carName,
      carModel,
      carPlate,
      carColor
    };
    socket.authToken = `Bearer ${token}`;
    scheduleTokenExpiryDisconnect(socket, decoded);
    return next();
  } catch (err) {
    return next(err);
  }
}

module.exports = { socketAuth };

