'use strict';

const jwt = require('jsonwebtoken');
const { emitSocketError } = require('../utils/socketErrors');

const SOCKET_AUTH_ERROR = 'AUTHENTICATION_FAILED';

function scheduleExpiryDisconnect(socket, decoded) {
  if (!decoded || !decoded.exp) return;
  const expiryMs = decoded.exp * 1000;
  const delay = expiryMs - Date.now();
  if (!Number.isFinite(delay) || delay <= 0) {
    emitSocketError(socket, 'auth_error', 'TOKEN_EXPIRED', 'Authentication token expired.', { source: 'socket:auth', retryable: false });
    socket.disconnect(true);
    return;
  }
  const timer = setTimeout(() => {
    try { emitSocketError(socket, 'auth_error', 'TOKEN_EXPIRED', 'Authentication token expired.', { source: 'socket:auth', retryable: false }); } catch (_) {}
    try { socket.disconnect(true); } catch (_) {}
  }, delay);
  if (timer.unref) timer.unref();
  socket.once('disconnect', () => clearTimeout(timer));
}

async function authenticateSocket(socket) {
  try {
    let raw = socket.handshake.auth?.token || socket.handshake.query?.token || socket.handshake.headers?.authorization;
    if (!raw) throw new Error('Missing token');
    const token = String(raw).replace(/^(Bearer|JWT|Token)\s+/i, '').trim();
    if (!token) throw new Error('Missing token');
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'secret');
    if (decoded.exp && decoded.exp * 1000 <= Date.now()) {
      throw new Error('Token expired');
    }
    scheduleExpiryDisconnect(socket, decoded);
    return {
      id: decoded.id,
      type: decoded.type,
      name: decoded.name || decoded.fullName || decoded.displayName,
      phone: decoded.phone || decoded.phoneNumber || decoded.mobile,
      email: decoded.email,
      vehicleType: decoded.vehicleType
    };
  } catch (error) {
    try { emitSocketError(socket, 'auth_error', SOCKET_AUTH_ERROR, error.message || 'Authentication failed.', { source: 'socket:auth', retryable: false }); } catch (_) {}
    socket.disconnect(true);
    return null;
  }
}

module.exports = { authenticateSocket };
