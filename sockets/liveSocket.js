const { Live } = require('../models/bookingModels');
const { sendMessageToSocketId } = require('./utils');
const logger = require('../utils/logger');
const { emitSocketError } = require('../utils/socketErrors');

module.exports = (io, socket) => {
  // booking:status_request passthrough
  socket.on('booking:status_request', async (payload) => {
    try { logger.info('[socket<-user] booking:status_request', { sid: socket.id, payload }); } catch (_) {}
    try {
      const data = typeof payload === 'string' ? JSON.parse(payload) : (payload || {});
      const bookingId = String(data.bookingId || '');
      if (!bookingId) {
        emitSocketError(socket, 'booking_error', 'VALIDATION_ERROR', 'bookingId is required', { source: 'booking:status_request' });
        return;
      }
      const { Booking } = require('../models/bookingModels');
      const { Driver, Passenger } = require('../models/userModels');
      const { buildLifecyclePayload } = require('../events/bookingEvents');

      const booking = await Booking.findById(bookingId).lean();
      if (!booking) {
        emitSocketError(socket, 'booking_error', 'NOT_FOUND', 'Booking not found', { source: 'booking:status_request', extras: { bookingId } });
        return;
      }

      let driverPayload;
      if (booking.driverId) {
        let driverDoc = null;
        try {
          driverDoc = await Driver.findById(String(booking.driverId)).lean();
        } catch (_) {}
        driverPayload = {
          id: String(booking.driverId),
          name: driverDoc ? driverDoc.name : undefined,
          phone: driverDoc ? driverDoc.phone : undefined,
          email: driverDoc ? driverDoc.email : undefined,
          vehicleType: driverDoc ? driverDoc.vehicleType : booking.vehicleType,
          carName: driverDoc ? (driverDoc.carModel || driverDoc.carName) : undefined,
          carPlate: driverDoc ? driverDoc.carPlate : undefined,
          rating: driverDoc && driverDoc.rating != null ? driverDoc.rating : undefined
        };
      }

      let passengerPayload;
      if (booking.passengerId) {
        passengerPayload = {
          id: String(booking.passengerId),
          name: booking.passengerName,
          phone: booking.passengerPhone
        };
        if (!passengerPayload.name || !passengerPayload.phone) {
          try {
            const passengerDoc = await Passenger.findById(String(booking.passengerId)).select({ _id: 1, name: 1, phone: 1 }).lean();
            if (passengerDoc) {
              passengerPayload.name = passengerPayload.name || passengerDoc.name;
              passengerPayload.phone = passengerPayload.phone || passengerDoc.phone;
            }
          } catch (_) {}
        }
      }

      const lifecyclePayload = buildLifecyclePayload(booking, {
        driver: driverPayload,
        passenger: passengerPayload,
        extras: {
          meta: {
            booking: {
              pickup: booking.pickup,
              dropoff: booking.dropoff,
              vehicleType: booking.vehicleType,
              fareEstimated: booking.fareEstimated,
              currentFare: booking.currentFare,
              fareFinal: booking.fareFinal,
              distanceKm: booking.distanceKm
            }
          }
        }
      });

      if (!lifecyclePayload) {
        emitSocketError(socket, 'booking_error', 'INTERNAL_ERROR', 'Failed to generate booking snapshot', { source: 'booking:status_request', extras: { bookingId } });
        return;
      }

      try { logger.info('[socket->user] booking:update snapshot', { bookingId: lifecyclePayload.bookingId, status: lifecyclePayload.status }); } catch (_) {}
      socket.emit('booking:update', lifecyclePayload);
    } catch (err) {
      emitSocketError(socket, 'booking_error', 'INTERNAL_ERROR', 'Failed to fetch booking status', { source: 'booking:status_request', details: err && err.message });
    }
  });

  // booking:ETA_update
  socket.on('booking:ETA_update', async (payload) => {
    try { logger.info('[socket<-driver] booking:ETA_update', { sid: socket.id, userId: socket.user && socket.user.id, payload }); } catch (_) {}
    try {
      if (!socket.user || String(socket.user.type).toLowerCase() !== 'driver') {
        emitSocketError(socket, 'booking_error', 'UNAUTHORIZED', 'Unauthorized: driver token required', { source: 'booking:ETA_update' });
        return;
      }
      const data = typeof payload === 'string' ? JSON.parse(payload) : (payload || {});
      const bookingId = String(data.bookingId || '');
      const etaMinutes = data.etaMinutes != null ? parseInt(data.etaMinutes, 10) : undefined;
      const message = data.message || undefined;
      if (!bookingId || !Number.isFinite(etaMinutes)) {
        emitSocketError(socket, 'booking_error', 'VALIDATION_ERROR', 'bookingId and etaMinutes are required', { source: 'booking:ETA_update' });
        return;
      }
      const { Booking } = require('../models/bookingModels');
      const booking = await Booking.findById(bookingId).lean();
      if (!booking) {
        emitSocketError(socket, 'booking_error', 'NOT_FOUND', 'Booking not found', { source: 'booking:ETA_update', extras: { bookingId } });
        return;
      }
      if (String(booking.driverId || '') !== String(socket.user.id)) {
        emitSocketError(socket, 'booking_error', 'FORBIDDEN', 'Only assigned driver can send ETA', { source: 'booking:ETA_update', extras: { bookingId } });
        return;
      }
      const out = { bookingId: String(booking._id), etaMinutes, message, driverId: String(socket.user.id), timestamp: new Date().toISOString() };
      sendMessageToSocketId(`booking:${String(booking._id)}`, { event: 'booking:ETA_update', data: out });
      try { logger.info('[socket->room] booking:ETA_update', { bookingId: String(booking._id), etaMinutes }); } catch (_) {}
    } catch (err) {
      emitSocketError(socket, 'booking_error', 'INTERNAL_ERROR', 'Failed to process ETA update', { source: 'booking:ETA_update', details: err && err.message });
    }
  });
};

