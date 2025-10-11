const { verifyExternalToken } = require('../external service/jwtHelper');

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

module.exports = { socketAuth };

