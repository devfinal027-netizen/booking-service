'use strict';

const jwt = require('jsonwebtoken');

function getEnv(name, fallback) {
  const value = process.env[name];
  return value != null && value !== '' ? value : fallback;
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
  const issuer = getEnv('TOKEN_ISSUER', getEnv('AUTH_ISSUER', 'auth-service'));
  const audience = getEnv('TOKEN_AUDIENCE', getEnv('AUTH_AUDIENCE', 'booking-service'));
  const secret = getEnv('JWT_SECRET');
  if (!secret) {
    const err = new Error('JWT secret not configured');
    err.code = 'JWT_SECRET_MISSING';
    throw err;
  }
  const verified = jwt.verify(raw, secret, {
    issuer,
    audience,
    ...options,
  });
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

function decodeExternalToken(token) {
  const raw = cleanToken(token);
  if (!raw) {
    const err = new Error('Token is required');
    err.code = 'TOKEN_REQUIRED';
    throw err;
  }
  return jwt.decode(raw, { complete: false });
}

async function resolveEntityFromToken(token) {
  const decoded = verifyExternalToken(token);
  const type = String(decoded.type || '').toLowerCase();
  const id = decoded.id;
  if (!id) {
    const err = new Error('Token missing id claim');
    err.code = 'TOKEN_INVALID';
    throw err;
  }
  const entities = require('./entities');
  switch (type) {
    case 'passenger':
      return { type: 'passenger', entity: await entities.findPassengerById(id), claims: decoded };
    case 'driver':
      return { type: 'driver', entity: await entities.findDriverById(id), claims: decoded };
    case 'staff':
      return { type: 'staff', entity: await entities.findStaffById(id), claims: decoded };
    case 'admin':
      return { type: 'admin', entity: await entities.findAdminById(id), claims: decoded };
    default:
      return { type: type || 'unknown', entity: null, claims: decoded };
  }
}

module.exports = { verifyExternalToken, decodeExternalToken, resolveEntityFromToken };
