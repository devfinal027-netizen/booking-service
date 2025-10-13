'use strict';

const jwt = require('jsonwebtoken');

function getEnv(name, def) {
  const v = process.env[name];
  return v == null || v === '' ? def : v;
}

function normalizeBearer(token) {
  return String(token || '')
    .replace(/^\s+|\s+$/g, '')
    .replace(/^(Bearer|JWT|Token)\s+/i, '');
}

function verifyExternalToken(token, options = {}) {
  if (!token || typeof token !== 'string') {
    const err = new Error('Token is required');
    err.code = 'TOKEN_REQUIRED';
    throw err;
  }
  const raw = normalizeBearer(token);
  const secret = getEnv('JWT_SECRET');
  if (!secret) {
    const err = new Error('JWT_SECRET not configured');
    err.code = 'JWT_SECRET_MISSING';
    throw err;
  }

  const verified = jwt.verify(raw, secret, options);

  const requiredKeys = ['iss','aud','ver','id','type','roles','driverId','paymentPreference','carName'];
  for (const k of requiredKeys) {
    if (!Object.prototype.hasOwnProperty.call(verified, k)) {
      const err = new Error(`Token missing required claim: ${k}`);
      err.code = 'TOKEN_INVALID_CLAIMS';
      throw err;
    }
  }

  const expectedIss = getEnv('TOKEN_ISSUER', 'auth-service');
  const expectedAud = getEnv('TOKEN_AUDIENCE', 'booking-service');
  if (verified.iss !== expectedIss) {
    const err = new Error('Invalid token issuer');
    err.code = 'TOKEN_INVALID_ISSUER';
    throw err;
  }
  if (verified.aud !== expectedAud) {
    const err = new Error('Invalid token audience');
    err.code = 'TOKEN_INVALID_AUDIENCE';
    throw err;
  }
  if (Number(verified.ver) !== 1) {
    const err = new Error('Unsupported token version');
    err.code = 'TOKEN_UNSUPPORTED_VERSION';
    throw err;
  }

  return verified;
}

function decodeExternalToken(token) {
  if (!token || typeof token !== 'string') {
    const err = new Error('Token is required');
    err.code = 'TOKEN_REQUIRED';
    throw err;
  }
  const raw = normalizeBearer(token);
  return jwt.decode(raw, { complete: false });
}

async function resolveEntityFromToken(token) {
  const decoded = verifyExternalToken(token);
  const type = (decoded.type || '').toLowerCase();
  const id = decoded.id;
  return { type: type || 'unknown', entity: null, claims: decoded };
}

module.exports = {
  verifyExternalToken,
  decodeExternalToken,
  resolveEntityFromToken,
};


