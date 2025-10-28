const bookingService = require('../services/bookingService');
const bookingEvents = require('../events/bookingEvents');
const { sendMessageToSocketId } = require('./utils');
const lifecycle = require('../services/bookingLifecycleService');
const { calculateLivePricing } = require('../services/bookingPricingService');
const { emitSocketError } = require('../utils/socketErrors');
const {
  markDispatched,
  wasDispatched,
  getDispatchedDrivers,
  clearBookingDispatch,
  clearDriverDispatch
} = require('./dispatchRegistry');
const { wasEmitted, markEmitted } = require('./emitOnce');
const logger = require('../utils/logger');
const { Booking } = require('../models/bookingModels');
const metrics = require('../utils/metrics');

// Dedup moved to shared registry

module.exports = (io, socket) => {
  const notifyDispatchedRemoval = (bookingId, excludeDriverId, reason = 'taken') => {
    try {
      const dispatched = getDispatchedDrivers(String(bookingId));
      if (!dispatched || dispatched.size === 0) return;
      dispatched.forEach((driverId) => {
        if (excludeDriverId && String(driverId) === String(excludeDriverId)) return;
        sendMessageToSocketId(`driver:${String(driverId)}`, {
          event: 'booking:removed',
          data: { bookingId: String(bookingId), reason }
        });
        try {
          io.to(`driver:${String(driverId)}`).emit('booking:update', {
            bookingId: String(bookingId),
            status: 'unavailable',
            reason
          });
        } catch (_) {}
      });
    } catch (_) {}
  };

  // booking:join_room - allow user to join booking room to receive events
  socket.on('booking:join_room', async (payload) => {
    try { logger.info('[socket<-user] booking:join_room', { sid: socket.id, userId: socket.user && socket.user.id, payload }); } catch (_) {}
    try {
      const data = typeof payload === 'string' ? JSON.parse(payload) : (payload || {});
      const bookingId = String(data.bookingId || '');
      if (!bookingId) {
        emitSocketError(socket, 'booking_error', 'VALIDATION_ERROR', 'bookingId is required', { source: 'booking:join_room' });
        return;
      }
      const room = `booking:${bookingId}`;
      socket.join(room);
      try { logger.info('[socket->room] joined', { room, userId: socket.user && socket.user.id }); } catch (_) {}
      socket.emit('booking:joined', { bookingId });
    } catch (err) {
      emitSocketError(socket, 'booking_error', 'INTERNAL_ERROR', 'Failed to join booking room', { source: 'booking:join_room', details: err && err.message });
    }
  });
  // booking:request (create booking)
  socket.on('booking:request', async (payload) => {
    try { logger.info('[socket<-passenger] booking:request', { sid: socket.id, userId: socket.user && socket.user.id }); } catch (_) {}
    try {
      const data = typeof payload === 'string' ? JSON.parse(payload) : (payload || {});
      const requesterType = socket.user && socket.user.type ? String(socket.user.type).toLowerCase() : undefined;
      if (!socket.user || !requesterType) {
        emitSocketError(socket, 'booking_error', 'UNAUTHORIZED', 'Unauthorized: user token required', { source: 'booking:request' });
        return;
      }

      // Determine passengerId based on requester type
      let passengerId;
      if (requesterType === 'passenger') {
        passengerId = String(socket.user.id);
      } else if (requesterType === 'admin' || requesterType === 'superadmin') {
        if (!data.passengerId) {
          emitSocketError(socket, 'booking_error', 'VALIDATION_ERROR', 'passengerId is required when creating a booking as an admin', { source: 'booking:request' });
          return;
        }
        passengerId = String(data.passengerId);
      } else {
        emitSocketError(socket, 'booking_error', 'UNAUTHORIZED', 'Unauthorized: only passenger or admin can create booking', { source: 'booking:request' });
        return;
      }
      const booking = await bookingService.createBooking({
        passengerId,
        jwtUser: socket.user,
        vehicleType: data.vehicleType || 'mini',
        pickup: data.pickup,
        dropoff: data.dropoff,
        authHeader: socket.authToken ? { Authorization: socket.authToken } : undefined
      });
      // Guard log to verify dropoff presence from passenger request
      try {
        if (!booking.dropoff || booking.dropoff.latitude == null || booking.dropoff.longitude == null) {
          logger.warn('[booking:request] dropoff missing on created booking', { bookingId: String(booking._id), payloadDropoff: data && data.dropoff });
        }
      } catch (_) {}
      const bookingRoom = `booking:${String(booking._id)}`;
      socket.join(bookingRoom);
      const createdPayload = { id: String(booking._id), bookingId: String(booking._id) };
      try { logger.info('[socket->passenger] booking:created', { sid: socket.id, userId: socket.user && socket.user.id, bookingId: createdPayload.bookingId }); } catch (_) {}
      socket.emit('booking:created', createdPayload);

      // Select the nearest driver who can accept (has sufficient package balance)
      try {
        const { Driver } = require('../models/userModels');
        const geolib = require('geolib');
        const { Wallet } = require('../models/common');
        const financeService = require('../services/financeService');

        const radiusKm = parseFloat(process.env.BROADCAST_RADIUS_KM || process.env.RADIUS_KM || '5');
        // Do not rely on DB availability; socket-level availability filter is applied later
        const drivers = await Driver.find(booking.vehicleType ? { vehicleType: booking.vehicleType } : {}).lean();

        const { getLiveLocation } = require('./dispatchRegistry');
        const withDistance = drivers.map(d => {
          const live = getLiveLocation(String(d._id));
          const base = live && live.latitude != null && live.longitude != null
            ? { latitude: live.latitude, longitude: live.longitude }
            : (d.lastKnownLocation && d.lastKnownLocation.latitude != null && d.lastKnownLocation.longitude != null
              ? { latitude: d.lastKnownLocation.latitude, longitude: d.lastKnownLocation.longitude }
              : null);
          const distKm = base
            ? (geolib.getDistance(base, { latitude: booking.pickup.latitude, longitude: booking.pickup.longitude }) / 1000)
            : Number.POSITIVE_INFINITY;
          return { driver: d, distanceKm: distKm };
        })
        .filter(x => Number.isFinite(x.distanceKm) && x.distanceKm <= radiusKm)
        .sort((a, b) => a.distanceKm - b.distanceKm);

        // Broadcast to top-N nearest available drivers WITH finance filter
        const maxDrivers = parseInt(process.env.BROADCAST_MAX_DRIVERS || '50', 10);
        const targetFare = booking.fareFinal || booking.fareEstimated || 0;
        const financeEligibleDrivers = [];
        for (const item of withDistance) {
          try {
            const w = await Wallet.findOne({ userId: String(item.driver._id), role: 'driver' }).lean();
            const balance = w ? Number(w.balance || 0) : 0;
            if (financeService.canAcceptBooking(balance, targetFare)) {
              financeEligibleDrivers.push(item.driver);
            }
          } catch (_) {}
          if (financeEligibleDrivers.length >= 200) break; // soft cap to prevent huge arrays
        }
        const targetDrivers = financeEligibleDrivers.slice(0, Math.max(1, Math.min(maxDrivers, 200)));

        // Filter by runtime socket-level availability (driver toggled availability on this connection)
        try {
          const { isDriverAvailableBySocket } = require('./dispatchRegistry');
          if (targetDrivers && targetDrivers.length) {
            const filtered = [];
            for (const drv of targetDrivers) {
              if (isDriverAvailableBySocket(String(drv._id))) filtered.push(drv);
            }
            if (filtered.length) {
              targetDrivers.length = 0;
              filtered.forEach(d => targetDrivers.push(d));
            }
          }
        } catch (_) {}

        if (targetDrivers && targetDrivers.length) {
          // Keep passenger format as original: { id, name, phone }
          let passengerForDriver = { id: passengerId, name: socket.user.name, phone: socket.user.phone };
          try {
            const { Passenger } = require('../models/userModels');
            const pdoc = await Passenger.findById(passengerId).select({ _id: 1, name: 1, phone: 1 }).lean();
            if (pdoc) passengerForDriver = { id: String(pdoc._id), name: pdoc.name, phone: pdoc.phone };
          } catch (_) {}

          const bookingDetails = {
            id: String(booking._id),
            status: 'requested',
            passengerId,
            passenger: passengerForDriver,
            vehicleType: booking.vehicleType,
            pickup: booking.pickup,
            dropoff: booking.dropoff,
            fareEstimated: booking.fareEstimated,
            currentFare: booking.currentFare,
            fareFinal: booking.fareFinal,
            distanceKm: booking.distanceKm,
            createdAt: booking.createdAt,
            updatedAt: booking.updatedAt
          };
          const patch = {
            status: 'requested',
            passengerId,
            vehicleType: booking.vehicleType,
            pickup: booking.pickup,
            dropoff: booking.dropoff,
            passenger: passengerForDriver
          };
          const payloadForDriver = { id: String(booking._id), bookingId: String(booking._id), booking: bookingDetails, patch, user: { id: passengerId, type: 'passenger' } };
          // Also prepare a broadcast payload for the shared 'drivers' room as a fallback delivery channel
          const payloadForDriversRoom = { id: String(booking._id), bookingId: String(booking._id), booking: bookingDetails, patch };
          let sentCount = 0;
          for (const drv of targetDrivers) {
            const driverId = String(drv._id);
            // Do not attach extra fields; keep original format
            const channel = `driver:${driverId}`;
            if (!wasDispatched(String(booking._id), driverId)) {
              sendMessageToSocketId(channel, { event: 'booking:new', data: payloadForDriver });
              // Also emit incremental nearby update with the same schema as initial snapshot
              try { io.to(channel).emit('booking:nearby', { init: false, driverId, bookings: [bookingDetails], currentBookings: [], user: { id: driverId, type: 'driver' } }); } catch (_) {}
              markDispatched(String(booking._id), driverId);
              sentCount++;
            }
          }
            const usedFallback = sentCount === 0;
            if (usedFallback) {
              // Fallback broadcast to all connected drivers only when no targeted delivery was possible
              try { io.to('drivers').emit('booking:new', payloadForDriversRoom); } catch (_) {}
            }
            try { logger.info('[socket->drivers] booking:new dispatch', { bookingId: String(booking._id), sent: sentCount, considered: targetDrivers.length, fallback: usedFallback }); } catch (_) {}
          try {
            metrics.increment('dispatch.attempt', 1, {
              vehicleType: booking.vehicleType || 'unknown',
                targeted: targetDrivers.length,
                sent: sentCount,
                fallback: usedFallback ? 'true' : 'false'
            });
            if (sentCount > 0) {
              metrics.increment('dispatch.sent', sentCount, {
                vehicleType: booking.vehicleType || 'unknown'
              });
            } else {
              metrics.increment('dispatch.miss', 1, {
                vehicleType: booking.vehicleType || 'unknown'
              });
                if (usedFallback) {
                  metrics.increment('dispatch.fallback_broadcast', 1, {
                    vehicleType: booking.vehicleType || 'unknown'
                  });
                }
            }
          } catch (_) {}
        } else {
          try { logger.info('[socket->drivers] no eligible driver (package/distance)', { bookingId: String(booking._id) }); } catch (_) {}
          try { metrics.increment('dispatch.no_candidate', 1, { vehicleType: booking.vehicleType || 'unknown' }); } catch (_) {}
        }
  } catch (err) { try { logger.error('[booking:request] broadcast error', err); } catch (_) {} }
    } catch (err) {
      emitSocketError(socket, 'booking_error', 'INTERNAL_ERROR', 'Failed to create booking', { source: 'booking:request', details: err && err.message });
    }
  });

  // booking:accept
  socket.on('booking:accept', async (payload) => {
    let bookingId = null;
    try { logger.info('[socket<-driver] booking:accept', { sid: socket.id, userId: socket.user && socket.user.id, payload }); } catch (_) {}
    try {
      const data = typeof payload === 'string' ? JSON.parse(payload) : (payload || {});
      bookingId = String(data.bookingId || '');
      if (!socket.user || String(socket.user.type).toLowerCase() !== 'driver' || !socket.user.id) {
        emitSocketError(socket, 'booking_error', 'UNAUTHORIZED', 'Unauthorized: driver token required', { source: 'booking:accept', extras: { bookingId } });
        return;
      }
      if (!bookingId) {
        emitSocketError(socket, 'booking_error', 'VALIDATION_ERROR', 'bookingId is required', { source: 'booking:accept' });
        return;
      }

      // Only allow accept transition via lifecycle update in service
      const updated = await bookingService.updateBookingLifecycle({ requester: { ...socket.user, type: String(socket.user.type || '').toLowerCase() }, id: bookingId, status: 'accepted' });
      try { logger.info('[booking:accept] lifecycle updated', { bookingId: String(updated._id), status: updated.status, driverId: updated.driverId }); } catch (_) {}
      const room = `booking:${String(updated._id)}`;
      socket.join(room);
      try { logger.info('[booking:accept] lifecycle dispatched', { bookingId: String(updated._id), driverId: String(socket.user.id) }); } catch (_) {}
      // Canonical `booking:update` emission carries enriched payload from lifecycle service; no legacy duplicates are emitted here.

      try {
        // Notify only other dispatched drivers; do not broadcast to all drivers to avoid notifying the accepter
        notifyDispatchedRemoval(String(updated._id), String(socket.user.id), 'assigned');
        clearBookingDispatch(String(updated._id));
      } catch (_) {}

      // Pre-pickup ETA for passenger only (driver -> pickup) during accepted phase
      try {
        const { getIo } = require('./utils');
        const ioRef = getIo && getIo();
        if (ioRef && updated && updated.pickup && updated.passengerId) {
          const { getLiveLocation } = require('./dispatchRegistry');
          let origin = undefined;
          const live = getLiveLocation(String(socket.user.id));
          if (live && live.latitude != null && live.longitude != null) {
            origin = { latitude: Number(live.latitude), longitude: Number(live.longitude) };
          } else {
            try {
              const { Driver } = require('../models/userModels');
              const d = await Driver.findById(String(socket.user.id)).select({ lastKnownLocation: 1 }).lean();
              if (d && d.lastKnownLocation && d.lastKnownLocation.latitude != null && d.lastKnownLocation.longitude != null) {
                origin = { latitude: Number(d.lastKnownLocation.latitude), longitude: Number(d.lastKnownLocation.longitude) };
              }
            } catch (_) {}
          }
          if (origin) {
            const destination = { latitude: Number(updated.pickup.latitude), longitude: Number(updated.pickup.longitude) };
            const GOOGLE_MAPS_API_KEY = process.env.GOOGLE_MAPS_API_KEY || process.env.GMAPS_API_KEY;
            let etaSeconds;
            let etaText;
            if (GOOGLE_MAPS_API_KEY) {
              try {
                const { fetchEtaUsingGoogle } = require('../services/bookingPricingService');
                const r = await fetchEtaUsingGoogle({ origin, destination, apiKey: GOOGLE_MAPS_API_KEY });
                etaSeconds = r.etaSeconds;
                etaText = r.etaText || `${Math.round((etaSeconds || 0)/60)} min`;
              } catch (_) {}
            }
            if (!etaSeconds) {
              try {
                const { getEta } = require('../utils/routing');
                const fb = await getEta({ from: origin, to: destination, vehicle: updated.vehicleType || 'car' });
                if (fb && Number.isFinite(fb.etaMinutes)) {
                  etaSeconds = Math.max(1, Math.round(Number(fb.etaMinutes) * 60));
                  etaText = `${Math.round((etaSeconds || 0)/60)} min`;
                }
              } catch (_) {}
            }
            if (etaSeconds) {
              const payload = {
                bookingId: String(updated._id),
                eta: { seconds: etaSeconds, text: etaText },
                etaSeconds,
                etaText,
                driverLocation: origin,
                destination,
                phase: 'to_pickup'
              };
              const passengerRoom = `passenger:${String(updated.passengerId)}`;
              try { ioRef.to(passengerRoom).emit('eta:update', payload); } catch (_) {}
              try { ioRef.to(passengerRoom).emit('booking:ETA_update', payload); } catch (_) {}
              try { logger.info('[eta] pre-pickup emitted', { bookingId: String(updated._id), passengerRoom }); } catch (_) {}
            }
          }
        }
      } catch (_) {}
    } catch (err) {
      const safe = (m) => (m && m.message) ? m.message : 'Failed to accept booking';
      const extras = bookingId ? { bookingId } : undefined;
      emitSocketError(socket, 'booking_error', 'INTERNAL_ERROR', safe(err), { source: 'booking:accept', details: err && err.message, extras });
    }
  });

  // booking:cancel
  socket.on('booking:cancel', async (payload) => {
    try { logger.info('[socket<-user] booking:cancel', { sid: socket.id, userId: socket.user && socket.user.id, payload }); } catch (_) {}
    try {
      const data = typeof payload === 'string' ? JSON.parse(payload) : (payload || {});
      const bookingId = String(data.bookingId || '');
      const reason = data.reason;
      const requesterType = socket.user && socket.user.type ? String(socket.user.type).toLowerCase() : undefined;
      if (!socket.user || !socket.user.type) {
        emitSocketError(socket, 'booking_error', 'UNAUTHORIZED', 'Unauthorized: user token required', { source: 'booking:cancel', extras: { bookingId } });
        return;
      }
      if (!bookingId) {
        emitSocketError(socket, 'booking_error', 'VALIDATION_ERROR', 'bookingId is required', { source: 'booking:cancel' });
        return;
      }
      const bookingDoc = await Booking.findById(bookingId).lean();
      if (!bookingDoc) {
        emitSocketError(socket, 'booking_error', 'NOT_FOUND', 'Booking not found', { source: 'booking:cancel', extras: { bookingId } });
        return;
      }

      let finalReason = reason;
      let cancelExtras = {
        canceledBy: requesterType,
        canceledReason: reason
      };

      if (requesterType === 'driver') {
        const driverId = String(socket.user.id);
        const assignedDriverId = bookingDoc.driverId ? String(bookingDoc.driverId) : undefined;
        const isAssignedDriver = assignedDriverId && assignedDriverId === driverId;

        if (!isAssignedDriver) {
          if (bookingDoc.status !== 'requested') {
            emitSocketError(socket, 'booking_error', 'FORBIDDEN', 'Booking is no longer available to cancel', { source: 'booking:cancel', extras: { bookingId } });
            return;
          }

          try { clearDriverDispatch(String(bookingId), driverId); } catch (_) {}

          const declineReason = reason || 'driver_declined';
          try {
            sendMessageToSocketId(`driver:${driverId}`, {
              event: 'booking:removed',
              data: { bookingId: String(bookingId), reason: declineReason }
            });
          } catch (_) {}
          try {
            io.to(`driver:${driverId}`).emit('booking:update', {
              bookingId: String(bookingId),
              status: 'declined',
              reason: declineReason
            });
          } catch (_) {}

          const remainingDrivers = getDispatchedDrivers(String(bookingId));
          if (remainingDrivers && remainingDrivers.size > 0) {
            return;
          }

          if (assignedDriverId && assignedDriverId !== driverId) {
            return;
          }

          finalReason = reason || 'drivers_declined';
          cancelExtras = {
            canceledBy: 'driver_pool',
            canceledReason: finalReason
          };
        }
      }
      const updated = await bookingService.updateBookingLifecycle({
        requester: socket.user,
        id: bookingId,
        status: 'canceled',
        reason: finalReason,
        extras: cancelExtras
      });
      try {
        notifyDispatchedRemoval(String(updated._id), null, 'canceled');
        clearBookingDispatch(String(updated._id));
        try { io.to('drivers').emit('booking:removed', { bookingId: String(updated._id), reason: 'canceled' }); } catch (_) {}
      } catch (_) {}
      try { logger.info('[socket->room] booking:update canceled', { bookingId: String(updated._id), by: String(socket.user.type).toLowerCase() }); } catch (_) {}
    } catch (err) {
      emitSocketError(socket, 'booking_error', 'INTERNAL_ERROR', 'Failed to cancel booking', { source: 'booking:cancel', details: err && err.message });
    }
  });

  // trip:started (driver command)
  socket.on('trip:started', async (payload) => {
    try { logger.info('[socket<-driver] trip:started', { sid: socket.id, userId: socket.user && socket.user.id, payload }); } catch (_) {}
    try {
      const data = typeof payload === 'string' ? JSON.parse(payload) : (payload || {});
      const bookingId = String(data.bookingId || '');
      const startLocation = data.startLocation || data.location;
      if (!socket.user || String(socket.user.type).toLowerCase() !== 'driver') {
        emitSocketError(socket, 'booking_error', 'UNAUTHORIZED', 'Unauthorized: driver token required', { source: 'trip:started', extras: { bookingId } });
        return;
      }
      if (!bookingId) {
        emitSocketError(socket, 'booking_error', 'VALIDATION_ERROR', 'bookingId is required', { source: 'trip:started' });
        return;
      }
      const booking = await Booking.findOne({ _id: bookingId, driverId: String(socket.user.id) });
      if (!booking) {
        emitSocketError(socket, 'booking_error', 'NOT_FOUND', 'Booking not found or not assigned to you', { source: 'trip:started', extras: { bookingId } });
        return;
      }
      const updated = await lifecycle.startTrip(bookingId, startLocation);
      // Guard: ensure dropoff exists for ETA later; if missing and current booking has passenger dropoff, keep as is (booking creation should set dropoff)
      try {
        if (!updated.dropoff || updated.dropoff.latitude == null || updated.dropoff.longitude == null) {
          // no-op: we don't override here; log for observability
          logger.warn('[trip:started] dropoff missing for booking', { bookingId: String(updated._id) });
        }
      } catch (_) {}
      bookingEvents.emitTripStarted(updated);
      // Also emit an initial trip:ongoing update at the start location for clients expecting continuous stream from start
      try { if (startLocation) bookingEvents.emitTripOngoing(updated, startLocation); } catch (_) {}
      // no ETA yet until status becomes ongoing (handled by trip:ongoing)
      // End pre-pickup ETA for passenger (arrived at pickup)
      try {
        const { getIo } = require('./utils');
        const ioRef = getIo && getIo();
        const passengerRoom = updated && updated.passengerId ? `passenger:${String(updated.passengerId)}` : null;
        if (ioRef && passengerRoom) {
          const payload = { bookingId: String(updated._id), eta: { seconds: 0, text: 'arrived' }, etaSeconds: 0, etaText: 'arrived', ended: true, phase: 'to_pickup' };
          try { ioRef.to(passengerRoom).emit('eta:update', payload); } catch (_) {}
          try { ioRef.to(passengerRoom).emit('booking:ETA_update', payload); } catch (_) {}
          try { logger.info('[eta] pre-pickup ended', { bookingId: String(updated._id), passengerRoom }); } catch (_) {}
        }
      } catch (_) {}
      try { logger.info('[socket->room] trip:started', { bookingId: String(updated._id) }); } catch (_) {}
    } catch (err) {
      logger.error('[trip:started] error', err);
      emitSocketError(socket, 'booking_error', 'INTERNAL_ERROR', 'Failed to start trip', { source: 'trip:started', details: err && err.message });
    }
  });

  // trip:ongoing (driver command)
  socket.on('trip:ongoing', async (payload) => {
    try { logger.info('[socket<-driver] trip:ongoing', { sid: socket.id, userId: socket.user && socket.user.id, payload }); } catch (_) {}
    try {
      const data = typeof payload === 'string' ? JSON.parse(payload) : (payload || {});
      const bookingId = String(data.bookingId || '');
      const location = data.location || { latitude: data.latitude, longitude: data.longitude };
      if (!socket.user || String(socket.user.type).toLowerCase() !== 'driver') {
        emitSocketError(socket, 'booking_error', 'UNAUTHORIZED', 'Unauthorized: driver token required', { source: 'trip:ongoing', extras: { bookingId } });
        return;
      }
      if (!bookingId || !location || location.latitude == null || location.longitude == null) {
        emitSocketError(socket, 'booking_error', 'VALIDATION_ERROR', 'bookingId and location are required', { source: 'trip:ongoing', extras: { bookingId } });
        return;
      }
      const booking = await Booking.findOne({ _id: bookingId, driverId: String(socket.user.id) }).lean();
      if (!booking) {
        emitSocketError(socket, 'booking_error', 'NOT_FOUND', 'Booking not found or not assigned to you', { source: 'trip:ongoing', extras: { bookingId } });
        return;
      }
      if (!booking.dropoff || booking.dropoff.latitude == null || booking.dropoff.longitude == null) {
        try { logger.warn('[trip:ongoing] dropoff missing; ETA will be skipped', { bookingId }); } catch (_) {}
      }
      const point = await lifecycle.updateTripLocation(bookingId, String(socket.user.id), location);
      bookingEvents.emitTripOngoing({ _id: booking._id, driverId: booking.driverId, passengerId: booking.passengerId }, point);
      try { logger.info('[socket->room] trip:ongoing', { bookingId, lat: point.lat, lon: point.lng }); } catch (_) {}

      // Live pricing recompute using shared calculator to preserve consistent payloads
      try {
        const pricingStart = Date.now();
        await calculateLivePricing(bookingId, { latitude: Number(location.latitude), longitude: Number(location.longitude) });
        try {
          metrics.timing('pricing.trip_ongoing_trigger_ms', Date.now() - pricingStart, {
            vehicleType: booking.vehicleType || 'unknown'
          });
          metrics.increment('pricing.trip_ongoing_trigger', 1, {
            vehicleType: booking.vehicleType || 'unknown'
          });
        } catch (_) {}
      } catch (e) {
  try { logger.error('[trip:ongoing] live pricing failed', e); } catch (_) {}
        try {
          metrics.increment('pricing.trip_ongoing_error', 1, {
            vehicleType: booking.vehicleType || 'unknown',
            reason: e && e.message ? e.message : 'unknown'
          });
        } catch (_) {}
      }

      // Trigger ETA only while trip is ongoing
      try {
        const { calculateAndBroadcastEta } = require('../services/bookingPricingService');
        const { getIo } = require('./utils');
        const ioRef = getIo && getIo();
        await calculateAndBroadcastEta({ booking, driverLocation: { latitude: Number(location.latitude), longitude: Number(location.longitude) }, io: ioRef });
      } catch (_) {}
    } catch (err) {
      logger.error('[trip:ongoing] error', err);
      emitSocketError(socket, 'booking_error', 'INTERNAL_ERROR', 'Failed to update trip location', { source: 'trip:ongoing', details: err && err.message });
    }
  });

  // trip:completed (driver command)
  socket.on('trip:completed', async (payload) => {
    try { logger.info('[socket<-driver] trip:completed', { sid: socket.id, userId: socket.user && socket.user.id, payload }); } catch (_) {}
    let bookingId = null;
    try {
      const data = typeof payload === 'string' ? JSON.parse(payload) : (payload || {});
      bookingId = String(data.bookingId || '');
      const endLocation = data.endLocation || data.location;
      const surgeMultiplier = data.surgeMultiplier || 1;
      const discount = data.discount || 0;
      const debitPassengerWallet = !!data.debitPassengerWallet;
      if (!socket.user || String(socket.user.type).toLowerCase() !== 'driver') {
        emitSocketError(socket, 'booking_error', 'UNAUTHORIZED', 'Unauthorized: driver token required', { source: 'trip:completed', extras: { bookingId } });
        return;
      }
      if (!bookingId) {
        emitSocketError(socket, 'booking_error', 'VALIDATION_ERROR', 'bookingId is required', { source: 'trip:completed' });
        return;
      }
      const booking = await Booking.findOne({ _id: bookingId, driverId: String(socket.user.id) });
      if (!booking) {
        emitSocketError(socket, 'booking_error', 'NOT_FOUND', 'Booking not found or not assigned to you', { source: 'trip:completed', extras: { bookingId } });
        return;
      }
    const updated = await lifecycle.completeTrip(bookingId, endLocation, { surgeMultiplier, discount, debitPassengerWallet });
    bookingEvents.emitTripCompleted(updated);
    // Stop ETA updates and signal ended
    try {
      const { broadcastEtaEnded } = require('../services/bookingPricingService');
      const { getIo } = require('./utils');
      const ioRef = getIo && getIo();
      broadcastEtaEnded({ booking: updated, io: ioRef });
    } catch (_) {}
    try { logger.info('[socket->room] trip:completed', { bookingId: String(updated._id) }); } catch (_) {}
    } catch (err) {
      logger.error('[trip:completed] error', err);
      const extras = bookingId ? { bookingId } : undefined;
      emitSocketError(socket, 'booking_error', 'INTERNAL_ERROR', 'Failed to complete trip', { source: 'trip:completed', details: err && err.message, extras });
    }
  });
};
