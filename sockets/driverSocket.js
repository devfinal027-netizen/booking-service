const driverService = require('../services/driverService');
const driverEvents = require('../events/driverEvents');
const { calculateLivePricing } = require('../services/bookingPricingService');
const logger = require('../utils/logger');
const { emitSocketError } = require('../utils/socketErrors');
const { emitBookingTargets } = require('./utils');
const {
  markDispatched,
  wasDispatched,
  registerSocket,
  unregisterSocket,
  setSocketAvailability,
  setLiveLocation,
  getDispatchedBookings
} = require('./dispatchRegistry');

const DRIVER_ACTIVE_STATUSES = new Set(['accepted', 'ongoing']);

// This is the driver-side socket handler
module.exports = (io, socket) => {
  // On connection, send initial nearby unassigned bookings (pre-existing) and current driver bookings
  try {
    if (socket.user && String(socket.user.type).toLowerCase() === 'driver') {
      // Join driver-specific room so targeted events like booking:new and booking:removed are received
      try {
        (async () => {
          const tokenDriverId = String(socket.user.id);
          const { Driver } = require('../models/userModels');
          const { Types } = require('mongoose');
          let meForRoom = null;
          try {
            if (Types.ObjectId.isValid(tokenDriverId)) {
              meForRoom = await Driver.findById(tokenDriverId).select({ _id: 1, available: 1, lastKnownLocation: 1, vehicleType: 1 }).lean();
            }
            if (!meForRoom && socket.user.email) {
              meForRoom = await Driver.findOne({ email: socket.user.email }).select({ _id: 1, available: 1, lastKnownLocation: 1, vehicleType: 1 }).lean();
            }
            if (!meForRoom && socket.user.phone) {
              meForRoom = await Driver.findOne({ phone: socket.user.phone }).select({ _id: 1, available: 1, lastKnownLocation: 1, vehicleType: 1 }).lean();
            }
          } catch (_) {}

          const driverDbId = String(meForRoom?._id || tokenDriverId);

          // Join both token-based and DB-based ids to handle environments where token id != DB _id
          try { socket.join(`driver:${tokenDriverId}`); } catch (_) {}
          try { socket.join(`driver:${driverDbId}`); } catch (_) {}
          // Also join a shared drivers room for optional broadcasts/fallbacks
          try { socket.join('drivers'); } catch (_) {}

          // Register socket mapping for availability tracking
          try { registerSocket(driverDbId, socket.id); } catch (_) {}
        })();
      } catch (_) {}
      (async () => {
        try {
          const { Booking } = require('../models/bookingModels');
          const { Driver } = require('../models/userModels'); // Re-import Driver model
          const { Wallet } = require('../models/common');
          const financeService = require('../services/financeService');
          const geolib = require('geolib');

          const tokenDriverId = String(socket.user.id);
          const { Types } = require('mongoose');
          let me = null;
          if (Types.ObjectId.isValid(tokenDriverId)) {
            me = await Driver.findById(tokenDriverId).lean();
          }
          if (!me && socket.user.email) me = await Driver.findOne({ email: socket.user.email }).lean();
          if (!me && socket.user.phone) me = await Driver.findOne({ phone: socket.user.phone }).lean();
          const driverId = String(me?._id || tokenDriverId);
          const radiusKm = parseFloat(process.env.BROADCAST_RADIUS_KM || process.env.RADIUS_KM || '5');

          // Current bookings assigned to this driver
          const currentRows = await Booking.find({ driverId, status: { $in: ['accepted', 'ongoing', 'requested'] } })
            .sort({ createdAt: -1 })
            .limit(50)
            .lean();

          const currentBookings = currentRows.map(b => ({
            id: String(b._id),
            status: b.status,
            pickup: b.pickup,
            dropoff: b.dropoff,
            fareEstimated: b.fareEstimated,
            currentFare: b.currentFare,
            fareFinal: b.fareFinal,
            distanceKm: b.distanceKm,
            passenger: b.passengerId ? { id: String(b.passengerId), name: b.passengerName, phone: b.passengerPhone } : undefined,
            createdAt: b.createdAt,
            updatedAt: b.updatedAt,
            patch: {
              status: b.status,
              passengerId: String(b.passengerId || ''),
              vehicleType: b.vehicleType,
              pickup: b.pickup,
              dropoff: b.dropoff,
              passenger: b.passengerId ? { id: String(b.passengerId), name: b.passengerName, phone: b.passengerPhone } : undefined
            }
          }));

          const bookingRoomsToJoin = new Map();
          for (const row of currentRows) {
            const bookingIdStr = String(row._id);
            bookingRoomsToJoin.set(bookingIdStr, row.status);
          }

          const rehydratedDispatches = [];
          try {
            const pendingDispatchIds = Array.from(getDispatchedBookings(driverId) || []);
            if (pendingDispatchIds.length) {
              const dispatchDocs = await Booking.find({ _id: { $in: pendingDispatchIds } })
                .sort({ createdAt: -1 })
                .limit(100)
                .lean();
              if (dispatchDocs && dispatchDocs.length) {
                const passengerIds = [...new Set(dispatchDocs.map((doc) => doc.passengerId).filter(Boolean))];
                let passengerMap = {};
                try {
                  if (passengerIds.length) {
                    const { Passenger } = require('../models/userModels');
                    const docs = await Passenger.find({ _id: { $in: passengerIds } })
                      .select({ _id: 1, name: 1, phone: 1, email: 1 })
                      .lean();
                    passengerMap = Object.fromEntries(docs.map((p) => [String(p._id), { id: String(p._id), name: p.name, phone: p.phone, email: p.email }]));
                  }
                } catch (_) {}

                for (const dispatchDoc of dispatchDocs) {
                  if (dispatchDoc.status && dispatchDoc.status !== 'requested' && String(dispatchDoc.driverId || '') !== driverId) {
                    continue;
                  }
                  const bookingIdStr = String(dispatchDoc._id);
                  bookingRoomsToJoin.set(bookingIdStr, dispatchDoc.status);
                  const passenger = dispatchDoc.passengerId ? (passengerMap[String(dispatchDoc.passengerId)] || { id: String(dispatchDoc.passengerId), name: dispatchDoc.passengerName, phone: dispatchDoc.passengerPhone }) : undefined;
                  const bookingDetails = {
                    id: bookingIdStr,
                    status: dispatchDoc.status,
                    passengerId: dispatchDoc.passengerId ? String(dispatchDoc.passengerId) : undefined,
                    passenger,
                    vehicleType: dispatchDoc.vehicleType,
                    pickup: dispatchDoc.pickup,
                    dropoff: dispatchDoc.dropoff,
                    fareEstimated: dispatchDoc.fareEstimated,
                    currentFare: dispatchDoc.currentFare,
                    fareFinal: dispatchDoc.fareFinal,
                    distanceKm: dispatchDoc.distanceKm,
                    createdAt: dispatchDoc.createdAt,
                    updatedAt: dispatchDoc.updatedAt
                  };
                  const patch = {
                    status: dispatchDoc.status,
                    passengerId: bookingDetails.passengerId,
                    vehicleType: dispatchDoc.vehicleType,
                    pickup: dispatchDoc.pickup,
                    dropoff: dispatchDoc.dropoff,
                    passenger
                  };
                  const payload = {
                    id: bookingIdStr,
                    bookingId: bookingIdStr,
                    booking: bookingDetails,
                    patch
                  };
                  if (passenger) payload.user = { id: passenger.id, type: 'passenger' };
                  rehydratedDispatches.push(payload);
                }
              }
            }
          } catch (err) {
            try { logger.error('[socket->driver] failed to rehydrate dispatches', { userId: driverId, err }); } catch (_) {}
          }

          for (const [bookingId, status] of bookingRoomsToJoin.entries()) {
            const statusLower = String(status || '').toLowerCase();
            if (!DRIVER_ACTIVE_STATUSES.has(statusLower)) {
              continue;
            }
            const room = `booking:${bookingId}`;
            try { socket.join(room); } catch (_) {}
          }

          // Nearby unassigned requested bookings created before connection
let nearby = [];
try {
  if (me && me.lastKnownLocation && Number.isFinite(me.lastKnownLocation.latitude) && Number.isFinite(me.lastKnownLocation.longitude)) {
    const open = await Booking.find({ status: 'requested', $or: [{ driverId: { $exists: false } }, { driverId: null }, { driverId: '' }] })
      .sort({ createdAt: -1 })
      .limit(200)
      .lean();
    const withDistance = open.map(b => ({
      booking: b,
      distanceKm: geolib.getDistance(
        { latitude: me.lastKnownLocation.latitude, longitude: me.lastKnownLocation.longitude },
        { latitude: b.pickup?.latitude, longitude: b.pickup?.longitude }
      ) / 1000
    }))
      .filter(x => Number.isFinite(x.distanceKm) && x.distanceKm <= radiusKm)
      .sort((a, b) => a.distanceKm - b.distanceKm);

    // Filter by package affordability
    const w = await Wallet.findOne({ userId: driverId, role: 'driver' }).lean();
    const balance = w ? Number(w.balance || 0) : 0;
    const filtered = withDistance
      .filter(x => financeService.canAcceptBooking(balance, x.booking.fareFinal || x.booking.fareEstimated || 0))
      .slice(0, 50);

    // Bulk fetch passenger details for enrichment
    let passengerMap = {};
    try {
      const { Passenger } = require('../models/userModels');
      const ids = [...new Set(filtered.map(x => x.booking.passengerId).filter(Boolean))];
      const docs = ids.length ? await Passenger.find({ _id: { $in: ids } }).select({ _id: 1, name: 1, phone: 1, email: 1, emergencyContacts: 1 }).lean() : [];
      passengerMap = Object.fromEntries(docs.map(p => [String(p._id), { id: String(p._id), name: p.name, phone: p.phone, email: p.email, emergencyContacts: p.emergencyContacts }]));
    } catch (_) {}

    nearby = filtered.map(x => ({
      id: String(x.booking._id),
      status: x.booking.status,
      pickup: x.booking.pickup,
      dropoff: x.booking.dropoff,
      fareEstimated: x.booking.fareEstimated,
      currentFare: x.booking.currentFare,
      fareFinal: x.booking.fareFinal,
      distanceKm: Math.round(x.distanceKm * 100) / 100,
      // Keep passenger format as original: { id, name, phone }
      passenger: x.booking.passengerId ? (passengerMap[String(x.booking.passengerId)] || { id: String(x.booking.passengerId), name: x.booking.passengerName, phone: x.booking.passengerPhone }) : undefined,
      createdAt: x.booking.createdAt,
      updatedAt: x.booking.updatedAt
    }));

  }
} catch (_) {}

          const payload = {
            init: true,
            driverId,
            bookings: nearby,
            currentBookings,
            user: { id: driverId, type: 'driver' }
          };
          try { logger.info('[socket->driver] emit booking:nearby ', { sid: socket.id, userId: driverId, nearbyCount: payload.bookings.length, currentCount: payload.currentBookings.length }); } catch (_) {}
          socket.emit('booking:nearby', payload);

          try {
            const activeCurrentBookings = currentBookings.filter(b => DRIVER_ACTIVE_STATUSES.has(String(b.status || '').toLowerCase()));

            // --- START OF MODIFICATION ---
            // Fetch full driver details for active bookings to include carPlate and carColor
            // Ensure we exclude undefined driverIds to avoid querying with "undefined"
            const driverIdsInActiveBookings = [...new Set(activeCurrentBookings.map(b => b.driverId).filter(Boolean).map(String))];
            let driverDetailsMap = {};
            if (driverIdsInActiveBookings.length > 0) {
              const drivers = await Driver.find({ _id: { $in: driverIdsInActiveBookings } })
                .select({ _id: 1, name: 1, phone: 1, email: 1, vehicleType: 1, rating: 1, carPlate: 1, carColor: 1 }) // Select new fields
                .lean();
              driverDetailsMap = Object.fromEntries(drivers.map(d => [String(d._id), d]));
            }

            const enrichedActiveBookings = activeCurrentBookings.map(b => {
              const driverInfo = driverDetailsMap[String(b.driverId)];
              return {
                ...b,
                driver: driverInfo ? {
                  id: String(driverInfo._id),
                  name: driverInfo.name,
                  phone: driverInfo.phone,
                  email: driverInfo.email,
                  vehicleType: driverInfo.vehicleType,
                  rating: driverInfo.rating,
                  carPlate: driverInfo.carPlate, 
                  carColor: driverInfo.carColor,
                } : b.driver, 
              };
            });
            // --- END OF MODIFICATION ---

            socket.emit('booking:active_snapshot', {
              bookings: enrichedActiveBookings, // Use the enriched bookings
              user: { id: driverId, type: 'driver' },
              requestedAt: new Date().toISOString()
            });
          } catch (err) {
            try { logger.warn('[socket->driver] failed to emit active snapshot', { userId: driverId, error: err && err.message }); } catch (_) {}
          }

          if (rehydratedDispatches.length) {
            try { logger.info('[socket->driver] rehydrating dispatched bookings', { userId: driverId, count: rehydratedDispatches.length }); } catch (_) {}
            for (const message of rehydratedDispatches) {
              socket.emit('booking:new', message);
            }
          }

          try {
            const bookingIdsForLive = Array.from(bookingRoomsToJoin.entries())
              .filter(([, status]) => DRIVER_ACTIVE_STATUSES.has(String(status || '').toLowerCase()))
              .map(([bookingId]) => bookingId)
              .filter(Boolean);

            if (bookingIdsForLive.length) {
              const { Live } = require('../models/bookingModels');
              const { Types } = require('mongoose');
              const objectIds = bookingIdsForLive
                .filter((id) => Types.ObjectId.isValid(id))
                .map((id) => new Types.ObjectId(id));

              if (objectIds.length) {
                const snapshots = await Live.find({ bookingId: { $in: objectIds } })
                  .sort({ timestamp: -1 })
                  .lean();

                for (const snap of snapshots) {
                  const bookingStatus = snap.bookingStatus || snap.status;
                  const recordedAt = (snap.timestamp || snap.updatedAt || snap.createdAt || new Date()).toISOString();
                  const payloadSnapshot = {
                    bookingId: snap.bookingId ? String(snap.bookingId) : undefined,
                    driverId,
                    passengerId: snap.passengerId ? String(snap.passengerId) : undefined,
                    location: {
                      latitude: snap.latitude,
                      longitude: snap.longitude,
                      ...(snap.bearing != null ? { bearing: snap.bearing } : {}),
                      recordedAt
                    }
                  };
                  if (bookingStatus) {
                    payloadSnapshot.status = bookingStatus;
                    payloadSnapshot.bookingStatus = bookingStatus;
                  }
                  if (snap.status && (!bookingStatus || snap.status !== bookingStatus)) {
                    payloadSnapshot.locationStatus = snap.status;
                  }
                  socket.emit('booking:driver_location', payloadSnapshot);
                }
              }
            }
          } catch (err) {
            try { logger.warn('[socket->driver] failed to replay live snapshots', { driverId, error: err && err.message }); } catch (_) {}
          }
        } catch (_) {}
      })();
    }
  } catch (_) {}

  // driver:availability
  socket.on('driver:availability', async (payload) => {
    try { logger.info('[socket<-driver] driver:availability', { sid: socket.id, userId: socket.user && socket.user.id, payload }); } catch (_) {}
    try {
      if (!socket.user || String(socket.user.type).toLowerCase() !== 'driver') {
        emitSocketError(socket, 'booking_error', 'UNAUTHORIZED', 'Unauthorized: driver token required', { source: 'driver:availability' });
        return;
      }
      const data = typeof payload === 'string' ? JSON.parse(payload) : (payload || {});
      const available = typeof data.available === 'boolean' ? data.available : undefined;
      if (available == null) {
        emitSocketError(socket, 'booking_error', 'VALIDATION_ERROR', 'available boolean is required', { source: 'driver:availability' });
        return;
      }
      const tokenDriverId = String(socket.user.id);
      const { Driver } = require('../models/userModels');
      const { Types } = require('mongoose');
      let meResolved = null;
      try {
        if (Types.ObjectId.isValid(tokenDriverId)) meResolved = await Driver.findById(tokenDriverId).select({ _id: 1 }).lean();
        if (!meResolved && socket.user.email) meResolved = await Driver.findOne({ email: socket.user.email }).select({ _id: 1 }).lean();
        if (!meResolved && socket.user.phone) meResolved = await Driver.findOne({ phone: socket.user.phone }).select({ _id: 1 }).lean();
      } catch (_) {}
      const driverDbId = String(meResolved?._id || tokenDriverId);
      const updated = await driverService.setAvailability(driverDbId, available, socket.user);
      // Update runtime availability per socket under both ids (token and DB)
      try { setSocketAvailability(driverDbId, socket.id, !!available); } catch (_) {}
      try { if (driverDbId !== tokenDriverId) setSocketAvailability(tokenDriverId, socket.id, !!available); } catch (_) {}
      driverEvents.emitDriverAvailability(driverDbId, !!available);
      try { logger.info('[socket->driver] availability updated', { userId: driverDbId, available }); } catch (_) {}

      // If driver just became available, proactively push nearby open bookings
      if (available === true) {
        try {
          const { Booking } = require('../models/bookingModels');
          const { Driver } = require('../models/userModels');
          const { Wallet } = require('../models/common');
          const financeService = require('../services/financeService');
          const geolib = require('geolib');

          const tokenDriverId = String(socket.user.id);
          const { Types } = require('mongoose');
          let me = null;
          if (Types.ObjectId.isValid(tokenDriverId)) me = await Driver.findById(tokenDriverId).lean();
          if (!me && socket.user.email) me = await Driver.findOne({ email: socket.user.email }).lean();
          if (!me && socket.user.phone) me = await Driver.findOne({ phone: socket.user.phone }).lean();
          const driverId = String(me?._id || tokenDriverId);
          const radiusKm = parseFloat(process.env.BROADCAST_RADIUS_KM || process.env.RADIUS_KM || '5');

          if (me && me.lastKnownLocation && Number.isFinite(me.lastKnownLocation.latitude) && Number.isFinite(me.lastKnownLocation.longitude)) {
            const open = await Booking.find({ status: 'requested', $or: [{ driverId: { $exists: false } }, { driverId: null }, { driverId: '' }] })
              .sort({ createdAt: -1 })
              .limit(200)
              .lean();

            const withDistance = open.map(b => ({
              booking: b,
              distanceKm: geolib.getDistance(
                { latitude: me.lastKnownLocation.latitude, longitude: me.lastKnownLocation.longitude },
                { latitude: b.pickup?.latitude, longitude: b.pickup?.longitude }
              ) / 1000
            }))
            .filter(x => Number.isFinite(x.distanceKm) && x.distanceKm <= radiusKm)
            .sort((a, b) => a.distanceKm - b.distanceKm);

            const w = await Wallet.findOne({ userId: driverId, role: 'driver' }).lean();
            const balance = w ? Number(w.balance || 0) : 0;
            const nearby = withDistance
              .filter(x => financeService.canAcceptBooking(balance, x.booking.fareFinal || x.booking.fareEstimated || 0))
              .slice(0, 50)
              .map(x => ({
                id: String(x.booking._id),
                status: x.booking.status,
                pickup: x.booking.pickup,
                dropoff: x.booking.dropoff,
                fareEstimated: x.booking.fareEstimated,
                currentFare: x.booking.currentFare,
                fareFinal: x.booking.fareFinal,
                distanceKm: Math.round(x.distanceKm * 100) / 100,
                passenger: x.booking.passengerId ? { id: String(x.booking.passengerId), name: x.booking.passengerName, phone: x.booking.passengerPhone } : undefined,
                createdAt: x.booking.createdAt,
                updatedAt: x.booking.updatedAt
              }));

            // Emit incremental nearby snapshot
            const payloadNearby = {
              init: false,
              driverId,
              bookings: nearby,
              currentBookings: [],
              user: { id: driverId, type: 'driver' }
            };
            try { logger.info('[socket->driver] emit booking:nearby (availability=true)', { sid: socket.id, userId: driverId, nearbyCount: payloadNearby.bookings.length }); } catch (_) {}
            socket.emit('booking:nearby', payloadNearby);

            // Also emit booking:new per item for clients relying on this channel
            const channel = `driver:${driverId}`;
            for (const n of nearby) {
              try {
                const patch = {
                  status: n.status,
                  passengerId: n.passenger?.id,
                  vehicleType: undefined,
                  pickup: n.pickup,
                  dropoff: n.dropoff,
                  passenger: n.passenger
                };
                const payloadForDriver = { id: n.id, bookingId: n.id, booking: { ...n }, patch, user: { id: n.passenger?.id, type: 'passenger' }, recipient: { id: driverId, type: 'driver' } };
                io.to(channel).emit('booking:new', payloadForDriver);
              } catch (_) {}
            }
          }
        } catch (_) {}
      }
    } catch (err) {
      emitSocketError(socket, 'booking_error', 'INTERNAL_ERROR', 'Failed to update availability', { source: 'driver:availability', details: err && err.message });
    }
  });

  socket.on('disconnect', () => {
    try {
      if (socket.user && socket.user.id) {
        unregisterSocket(String(socket.user.id), socket.id);
      }
    } catch (_) {}
  });

  // booking:driver_location_update
  socket.on('booking:driver_location_update', async (payload) => {
    try { logger.info('[socket<-driver] booking:driver_location_update', { sid: socket.id, userId: socket.user && socket.user.id, payload }); } catch (_) {}
    try {
      if (!socket.user || String(socket.user.type).toLowerCase() !== 'driver') {
        emitSocketError(socket, 'booking_error', 'UNAUTHORIZED', 'Unauthorized: driver token required', { source: 'booking:driver_location_update' });
        return;
      }
      const raw = typeof payload === 'string' ? JSON.parse(payload) : (payload || {});
      const bearingProvided = Object.prototype.hasOwnProperty.call(raw || {}, 'bearing');
      let bearingValue;
      if (bearingProvided) {
        if (raw.bearing === null || raw.bearing === '') {
          bearingValue = null;
        } else {
          bearingValue = Number(raw.bearing);
          if (!Number.isFinite(bearingValue) || bearingValue < 0 || bearingValue > 360) {
            emitSocketError(socket, 'booking_error', 'VALIDATION_ERROR', 'bearing must be a number between 0 and 360 degrees when provided', { source: 'booking:driver_location_update' });
            return;
          }
        }
      }
      const data = {
        latitude: raw.latitude != null ? Number(raw.latitude) : undefined,
        longitude: raw.longitude != null ? Number(raw.longitude) : undefined,
        ...(bearingProvided && bearingValue != null ? { bearing: bearingValue } : {})
      };
      if (!Number.isFinite(data.latitude) || !Number.isFinite(data.longitude)) {
        emitSocketError(socket, 'booking_error', 'VALIDATION_ERROR', 'latitude and longitude must be numbers', { source: 'booking:driver_location_update' });
        return;
      }
      const tokenDriverId = String(socket.user.id);
      const { Driver } = require('../models/userModels');
      const { Types } = require('mongoose');
      const { Booking, Live } = require('../models/bookingModels');
      let meResolved = null;
      try {
        if (Types.ObjectId.isValid(tokenDriverId)) meResolved = await Driver.findById(tokenDriverId).select({ _id: 1 }).lean();
        if (!meResolved && socket.user.email) meResolved = await Driver.findOne({ email: socket.user.email }).select({ _id: 1 }).lean();
        if (!meResolved && socket.user.phone) meResolved = await Driver.findOne({ phone: socket.user.phone }).select({ _id: 1 }).lean();
      } catch (_) {}
      const driverDbId = String(meResolved?._id || tokenDriverId);
      const driverDoc = await driverService.updateLocation(driverDbId, data, socket.user);
      if (!driverDoc) {
        throw new Error('Driver document missing after location update');
      }

      const ackPayload = {
        driverId: driverDbId,
        recordedAt: new Date().toISOString(),
        location: {
          latitude: driverDoc.lastKnownLocation?.latitude ?? data.latitude,
          longitude: driverDoc.lastKnownLocation?.longitude ?? data.longitude,
          ...(driverDoc.lastKnownLocation?.bearing != null ? { bearing: driverDoc.lastKnownLocation.bearing } : {})
        },
        processedBookings: [],
        liveWrite: 'skipped'
      };

      // Update live location cache for immediate targeting decisions under both ids
      try { setLiveLocation(driverDbId, data); } catch (_) {}
      try { if (driverDbId !== tokenDriverId) setLiveLocation(tokenDriverId, data); } catch (_) {}
      driverEvents.emitDriverLocationUpdate({
        driverId: String(driverDoc._id),
        vehicleType: driverDoc.vehicleType,
        available: driverDoc.available,
        lastKnownLocation: { latitude: driverDoc.lastKnownLocation?.latitude, longitude: driverDoc.lastKnownLocation?.longitude, bearing: driverDoc.lastKnownLocation?.bearing },
        updatedAt: driverDoc.updatedAt
      });
      try { logger.info('[socket->broadcast] driver location updated', { userId: socket.user && socket.user.id, lat: driverDoc.lastKnownLocation?.latitude, lon: driverDoc.lastKnownLocation?.longitude }); } catch (_) {}

      // Persist snapshot to Live collection and broadcast to active booking participants
      let liveWriteError = false;
      try {
        const rawActiveBookings = await Booking.find({ driverId: driverDbId, status: { $in: ['accepted', 'ongoing'] } })
          .select({ _id: 1, passengerId: 1, status: 1, pickup: 1, dropoff: 1, startedAt: 1, driverId: 1 })
          .limit(25)
          .lean();

        const activeBookings = (rawActiveBookings || []).filter(
          (booking) => DRIVER_ACTIVE_STATUSES.has(String(booking.status || '').toLowerCase())
        );

        if (activeBookings && activeBookings.length) {
          const now = new Date();
          const liveOperations = [];
          const payloads = [];

          for (const booking of activeBookings) {
            const bookingIdStr = String(booking._id);
            const passengerIdStr = booking.passengerId ? String(booking.passengerId) : undefined;
            const locationBearing = bearingProvided
              ? (bearingValue != null ? bearingValue : undefined)
              : (driverDoc.lastKnownLocation?.bearing);
            const locationStatus = 'moving';
            const locationPayload = {
              bookingId: bookingIdStr,
              driverId: driverDbId,
              passengerId: passengerIdStr,
              status: booking.status,
              bookingStatus: booking.status,
              locationStatus,
              location: {
                latitude: data.latitude,
                longitude: data.longitude,
                ...(locationBearing != null ? { bearing: locationBearing } : {}),
                recordedAt: now.toISOString()
              }
            };
            payloads.push(locationPayload);
            const liveSet = {
              bookingId: booking._id,
              driverId: driverDbId,
              passengerId: passengerIdStr,
              latitude: data.latitude,
              longitude: data.longitude,
              status: locationStatus,
              bookingStatus: booking.status,
              locationType: 'current',
              tripId: bookingIdStr,
              timestamp: now
            };
            if (locationBearing != null) {
              liveSet.bearing = locationBearing;
            }

            const updateDoc = { $set: liveSet };
            if (bearingProvided && locationBearing == null) {
              updateDoc.$unset = { bearing: '' };
            }

            liveOperations.push({
              updateOne: {
                filter: { bookingId: booking._id },
                update: updateDoc,
                upsert: true
              }
            });
          }

          if (liveOperations.length) {
            try {
              await Live.bulkWrite(liveOperations, { ordered: false });
            } catch (err) {
              liveWriteError = true;
              try { logger.warn('[socket->driver] live snapshot write failed', { err: err && err.message }); } catch (_) {}
            }
          }

          for (const payloadEntry of payloads) {
            emitBookingTargets(
              {
                bookingId: payloadEntry.bookingId,
                driverId: driverDbId,
                passengerId: payloadEntry.passengerId
              },
              'booking:driver_location',
              payloadEntry,
              { includeOps: true }
            );
          }

          // Trigger ETA broadcast for each active booking with throttling handled outside
          try {
            const { calculateAndBroadcastEta } = require('../services/bookingPricingService');
            const { getIo } = require('./utils');
            const ioRef = getIo && getIo();
            for (const booking of activeBookings) {
              await calculateAndBroadcastEta({ booking, driverLocation: { latitude: data.latitude, longitude: data.longitude }, io: ioRef });
            }
          } catch (_) {}

          ackPayload.processedBookings = payloads.map((entry) => entry.bookingId);
          ackPayload.liveWrite = liveWriteError ? 'failed' : 'persisted';
        }
      } catch (err) {
        liveWriteError = true;
        try { logger.error('[socket] driver location live sync failed', { driverId: driverDbId, error: err && err.message }); } catch (_) {}
      }

      socket.emit('booking:driver_location_ack', ackPayload);
      if (liveWriteError) {
        emitSocketError(socket, 'booking_error', 'INTERNAL_ERROR', 'Live location persistence failed, please retry shortly', {
          source: 'booking:driver_location_update',
          extras: {
            driverId: driverDbId,
            processedBookings: ackPayload.processedBookings
          }
        });
      }
    } catch (err) {
      emitSocketError(socket, 'booking_error', 'INTERNAL_ERROR', 'Failed to process location update', { source: 'booking:driver_location_update', details: err && err.message });
    }
  });
   // Handle pricing update requests from driver
  socket.on('pricing:update', async (payload) => {
    const startTime = Date.now();
    let requestBookingId = null;
    try {
      logger.info('[Socket] Received pricing:update request:', { 
        socketId: socket.id, 
        driverId: socket.user && socket.user.id,
        payload,
        timestamp: new Date().toISOString()
      });
      
      if (!socket.user || String(socket.user.type).toLowerCase() !== 'driver') {
        logger.warn('[Socket] Unauthorized pricing:update request:', {
          socketId: socket.id,
          userType: socket.user?.type || 'none',
          userId: socket.user?.id || 'none'
        });
        emitSocketError(socket, 'pricing:error', 'UNAUTHORIZED', 'Unauthorized: driver token required', { source: 'pricing:update' });
        return;
      }

      const raw = typeof payload === 'string' ? JSON.parse(payload) : (payload || {});
  const { bookingId, location } = raw;
  requestBookingId = bookingId || null;
      
      logger.info('[Socket] Parsed pricing:update payload:', {
        socketId: socket.id,
        driverId: socket.user.id,
        bookingId,
        location,
        hasValidLocation: !!(location && location.latitude && location.longitude)
      });
      
      if (!bookingId || !location || !location.latitude || !location.longitude) {
        logger.error('[Socket] Invalid pricing:update payload:', {
          socketId: socket.id,
          driverId: socket.user.id,
          bookingId: bookingId || 'missing',
          location: location || 'missing',
          missingFields: {
            bookingId: !bookingId,
            location: !location,
            latitude: !location?.latitude,
            longitude: !location?.longitude
          }
        });
        emitSocketError(socket, 'pricing:error', 'VALIDATION_ERROR', 'bookingId and location (with latitude/longitude) are required', {
          source: 'pricing:update',
          extras: { bookingId: bookingId || undefined }
        });
        return;
      }

      // Verify this driver is assigned to the booking
      const driverId = String(socket.user.id);
      
      logger.info('[Socket] Verifying booking assignment:', {
        socketId: socket.id,
        driverId,
        bookingId
      });

      const { Booking } = require('../models/bookingModels');
      const booking = await Booking.findById(bookingId);
      
      if (!booking) {
        logger.error('[Socket] Booking not found for pricing update:', {
          socketId: socket.id,
          driverId,
          bookingId
        });
  emitSocketError(socket, 'pricing:error', 'NOT_FOUND', 'Booking not found', { source: 'pricing:update', extras: { bookingId } });
        return;
      }

      logger.info('[Socket] Booking found, verifying assignment:', {
        socketId: socket.id,
        bookingId,
        requestingDriverId: driverId,
        assignedDriverId: booking.driverId,
        bookingStatus: booking.status,
        isAssigned: String(booking.driverId) === driverId
      });

      if (String(booking.driverId) !== driverId) {
        logger.warn('[Socket] Driver not assigned to booking:', {
          socketId: socket.id,
          bookingId,
          requestingDriverId: driverId,
          assignedDriverId: booking.driverId
        });
  emitSocketError(socket, 'pricing:error', 'FORBIDDEN', 'You are not assigned to this booking', { source: 'pricing:update', extras: { bookingId } });
        return;
      }

      // Calculate live pricing based on current location
      logger.info('[Socket] Calling pricing service:', {
        socketId: socket.id,
        driverId,
        bookingId,
        location
      });

      const pricingResult = await calculateLivePricing(bookingId, location);
      
      logger.info('[Socket] Pricing calculation successful, sending to driver:', {
        socketId: socket.id,
        driverId,
        bookingId,
        pricingResult: {
          currentFare: pricingResult.currentFare,
          distanceTraveled: pricingResult.distanceTraveled,
          updatedAt: pricingResult.updatedAt
        }
      });
      
      // Send pricing update back to the driver
      socket.emit('pricing:update', pricingResult);
      
      const processingTime = Date.now() - startTime;
      logger.info('[Socket] Pricing update completed successfully:', { 
        socketId: socket.id,
        driverId, 
        bookingId, 
        currentFare: pricingResult.currentFare,
        distanceTraveled: pricingResult.distanceTraveled,
        processingTimeMs: processingTime,
        timestamp: new Date().toISOString()
      });

    } catch (error) {
      const processingTime = Date.now() - startTime;
      logger.error('[Socket] Error in pricing update flow:', {
        socketId: socket.id,
        driverId: socket.user?.id,
        bookingId: payload?.bookingId || 'unknown',
        error: error.message,
        stack: error.stack,
        processingTimeMs: processingTime,
        timestamp: new Date().toISOString()
      });
      
      emitSocketError(socket, 'pricing:error', 'INTERNAL_ERROR', 'Failed to calculate pricing update', {
        source: 'pricing:update',
        details: error && error.message,
        extras: { bookingId: requestBookingId || undefined }
      });
    }
  });
};

