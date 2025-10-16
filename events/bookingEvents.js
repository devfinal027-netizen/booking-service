const { emitBookingTargets } = require('../sockets/utils');
const logger = require('../utils/logger');
const { Booking } = require('../models/bookingModels');

async function resolveParticipants(bookingId, hint = {}) {
  const participants = {
    bookingId: bookingId != null ? String(bookingId) : undefined,
    driverId: hint.driverId != null ? String(hint.driverId) : undefined,
    passengerId: hint.passengerId != null ? String(hint.passengerId) : undefined
  };
  if (participants.driverId && participants.passengerId) return participants;
  if (!participants.bookingId) return participants;
  try {
    const doc = await Booking.findById(participants.bookingId).select({ driverId: 1, passengerId: 1 }).lean();
    if (doc) {
      if (!participants.driverId && doc.driverId) participants.driverId = String(doc.driverId);
      if (!participants.passengerId && doc.passengerId) participants.passengerId = String(doc.passengerId);
    }
  } catch (err) {
    try { logger.warn('[events] resolveParticipants failed', { bookingId: participants.bookingId, error: err.message }); } catch (_) {}
  }
  return participants;
}

function scheduleBookingEmit(event, payload, hint, options) {
  Promise.resolve()
    .then(async () => {
      const participants = await resolveParticipants(hint && hint.bookingId, hint || {});
      emitBookingTargets(participants, event, payload, options);
    })
    .catch((err) => {
      try { logger.error('[events] emit failure', { event, bookingId: hint && hint.bookingId, error: err.message }); } catch (_) {}
    });
}

function buildLifecyclePayload(booking, { previousStatus, reason, driver, passenger, extras } = {}) {
  if (!booking) return null;
  const bookingId = String(booking._id || booking.id || '');
  if (!bookingId) return null;

  const payload = {
    id: bookingId,
    bookingId,
    status: booking.status,
    previousStatus,
    driverId: booking.driverId ? String(booking.driverId) : undefined,
    passengerId: booking.passengerId ? String(booking.passengerId) : undefined,
    acceptedAt: booking.acceptedAt || undefined,
    startedAt: booking.startedAt || undefined,
    completedAt: booking.completedAt || undefined,
    canceledAt: booking.status === 'canceled' ? (booking.updatedAt || new Date()) : undefined,
    canceledBy: booking.canceledBy || extras?.canceledBy,
    canceledReason: extras?.canceledReason || booking.canceledReason,
    fareEstimated: booking.fareEstimated != null ? Number(booking.fareEstimated) : undefined,
    currentFare: booking.currentFare != null ? Number(booking.currentFare) : undefined,
    fareFinal: booking.fareFinal != null ? Number(booking.fareFinal) : undefined,
    distanceKm: booking.distanceKm != null ? Number(booking.distanceKm) : undefined,
    reason,
  };

  if (driver) payload.driver = driver;
  if (passenger) payload.passenger = passenger;
  if (extras?.timeline) payload.timeline = extras.timeline;
  if (extras?.meta) payload.meta = extras.meta;

  return payload;
}

function emitLifecycleUpdate(booking, options = {}) {
  const payload = buildLifecyclePayload(booking, options);
  if (!payload) return;
  const hint = {
    bookingId: payload.bookingId,
    driverId: payload.driverId,
    passengerId: payload.passengerId
  };
  scheduleBookingEmit('booking:update', payload, hint, { includeOps: true });
}

function emitBookingUpdate(bookingId, patch) {
  try {
    if (bookingId && bookingId._id) {
      emitLifecycleUpdate(bookingId, { ...patch });
      return;
    }
    const payload = { id: String(bookingId), bookingId: String(bookingId), ...patch };
    const hint = {
      bookingId: payload.bookingId,
      driverId: patch && patch.driverId,
      passengerId: patch && patch.passengerId
    };
    scheduleBookingEmit('booking:update', payload, hint, { includeOps: true });
  } catch (err) {
    try { logger.error('[events] booking:update emit failed', { bookingId, error: err.message }); } catch (_) {}
  }
}

function emitBookingAssigned(bookingId, driverId) {
  try {
    const payload = { bookingId: String(bookingId), driverId: String(driverId) };
    try { logger.info('[events] booking:assigned', payload); } catch (_) {}
    scheduleBookingEmit('booking:assigned', payload, { bookingId: payload.bookingId, driverId: payload.driverId }, { includeOps: true });
  } catch (err) {
    try { logger.error('[events] booking:assigned emit failed', { bookingId, driverId, error: err.message }); } catch (_) {}
  }
}
function emitTripStarted(booking) {
  try {
    const payload = {
      id: String(booking._id),
      bookingId: String(booking._id),
      startedAt: booking.startedAt,
      startLocation: booking.startLocation
    };
    scheduleBookingEmit('trip:started', payload, {
      bookingId: payload.bookingId,
      driverId: booking.driverId,
      passengerId: booking.passengerId
    }, { includeOps: true });
  } catch (err) {
    try { logger.error('[events] trip:started emit failed', { bookingId: booking && booking._id, error: err.message }); } catch (_) {}
  }
}

function emitTripOngoing(bookingContext, location) {
  try {
    const bookingId = bookingContext && bookingContext._id ? String(bookingContext._id) : String(bookingContext);
    const payload = { id: bookingId, bookingId, location };
    scheduleBookingEmit('trip:ongoing', payload, {
      bookingId,
      driverId: bookingContext && bookingContext.driverId,
      passengerId: bookingContext && bookingContext.passengerId
    }, { includeOps: false });
  } catch (err) {
    try { logger.error('[events] trip:ongoing emit failed', { bookingContext, error: err.message }); } catch (_) {}
  }
}

function emitTripCompleted(booking) {
  try {
    const payload = {
      id: String(booking._id),
      bookingId: String(booking._id),
      amount: booking.fareFinal || booking.fareEstimated,
      distance: booking.distanceKm,
      waitingTime: booking.waitingTime,
      completedAt: booking.completedAt,
      driverEarnings: booking.driverEarnings,
      commission: booking.commissionAmount
    };
    scheduleBookingEmit('trip:completed', payload, {
      bookingId: payload.bookingId,
      driverId: booking.driverId,
      passengerId: booking.passengerId
    }, { includeOps: true });
  } catch (err) {
    try { logger.error('[events] trip:completed emit failed', { bookingId: booking && booking._id, error: err.message }); } catch (_) {}
  }
}

module.exports = {
  emitLifecycleUpdate,
  buildLifecyclePayload,
  emitBookingUpdate,
  emitBookingAssigned,
  emitTripStarted,
  emitTripOngoing,
  emitTripCompleted
};


