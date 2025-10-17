'use strict';

const { socketAuth: defaultSocketAuth, verifyExternalToken } = require('../utils/jwt');

function socketAuth(socket, next) {
  try {
    const authHeader = socket.handshake?.auth?.token || socket.handshake?.query?.token || socket.handshake?.headers?.authorization;
    if (!authHeader) return next(new Error('auth_error: missing token'));
    const claims = verifyExternalToken(authHeader);
    socket.user = {
      id: claims.id != null ? String(claims.id) : undefined,
      type: String(claims.type || '').toLowerCase(),
      name: claims.name,
      phone: claims.phone || claims.phoneNumber || claims.mobile,
      email: claims.email,
      vehicleType: claims.vehicleType,
      carName: claims.carName,
      carModel: claims.carModel,
      carPlate: claims.carPlate,
      carColor: claims.carColor,
      roles: claims.roles
    };
    socket.authToken = String(authHeader).startsWith('Bearer ') ? String(authHeader) : `Bearer ${String(authHeader)}`;
    return next();
  } catch (err) {
    return next(err);
  }
}

module.exports = { socketAuth };
