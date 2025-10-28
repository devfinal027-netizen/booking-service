const bookingSocket = require('./bookingSocket');
const driverSocket = require('./driverSocket');
const passengerSocket = require('./passengerSocket');
const liveSocket = require('./liveSocket');
const { socketAuth } = require('./socketAuth');
const { setIo } = require('./utils');
const logger = require('../utils/logger');
const metrics = require('../utils/metrics');

const LEGACY_EVENT_NAMES = new Set([
  'booking_request',
  'booking_accept',
  'booking_cancel',
  'booking:status',
  'booking_status',
  'booking_driver_location',
  'trip_started',
  'trip_ongoing',
  'trip_completed',
  'pricing_update'
]);

const LEGACY_EVENT_SUGGESTIONS = new Map([
  ['booking_request', 'booking:request'],
  ['booking_accept', 'booking:accept'],
  ['booking_cancel', 'booking:cancel'],
  ['booking:status', 'booking:update'],
  ['booking_status', 'booking:update'],
  ['booking_driver_location', 'booking:driver_location_update'],
  ['trip_started', 'trip:started'],
  ['trip_ongoing', 'trip:ongoing'],
  ['trip_completed', 'trip:completed'],
  ['pricing_update', 'pricing:update']
]);

function attachSocketHandlers(io) {
  setIo(io);
  io.use(socketAuth);
  io.on('connection', (socket) => {
    try { logger.info('[socket] connected', { sid: socket.id, user: socket.user && { id: socket.user.id, type: socket.user.type } }); } catch (_) {}

    socket.onAny((event) => {
      if (!event || !LEGACY_EVENT_NAMES.has(event)) return;
      try {
        logger.warn('[socket] legacy event received', { event, sid: socket.id, user: socket.user && { id: socket.user.id, type: socket.user.type } });
      } catch (_) {}
      try {
        metrics.increment('socket.legacy_event_received', 1, { event });
      } catch (_) {}
      const replacement = LEGACY_EVENT_SUGGESTIONS.get(event);
      if (replacement) {
        try {
          socket.emit('booking:legacy_warning', {
            legacyEvent: event,
            recommendedEvent: replacement,
            message: `Event "${event}" is deprecated. Please emit "${replacement}" instead.`
          });
        } catch (_) {}
      }
    });

    bookingSocket(io, socket);
    driverSocket(io, socket);
    passengerSocket(io, socket);
    liveSocket(io, socket);
    socket.on('disconnect', (reason) => {
      try { logger.info('[socket] disconnected', { sid: socket.id, reason }); } catch (_) {}
    });
  });
}

module.exports = { attachSocketHandlers };

