const geolib = require('geolib');
const mongoose = require('mongoose');
const { Booking, BookingAssignment, TripHistory } = require('../models/bookingModels');
const { Pricing } = require('../models/pricing');
const { Passenger, Driver } = require('../models/userModels');
const { DriverEarnings, AdminEarnings, Commission } = require('../models/commission');
const { Wallet, Transaction } = require('../models/common');
const positionUpdateService = require('./../services/positionUpdate');
const financeService = require('./financeService');
const bookingEvents = require('../events/bookingEvents');
const { buildDriverSnapshot } = require('../lib/driverSnapshot');

async function estimateFare({ vehicleType = 'mini', pickup, dropoff }) {
  const distanceKm = geolib.getDistance(
    { latitude: pickup.latitude, longitude: pickup.longitude },
    { latitude: dropoff.latitude, longitude: dropoff.longitude }
  ) / 1000;
  const p = await Pricing.findOne({ vehicleType, isActive: true }).sort({ updatedAt: -1 }) || { baseFare: 2, perKm: 1, perMinute: 0.2, waitingPerMinute: 0.1, surgeMultiplier: 1 };
  const fareBreakdown = {
    base: p.baseFare,
    distanceCost: distanceKm * p.perKm,
    timeCost: 0,
    waitingCost: 0,
    surgeMultiplier: p.surgeMultiplier,
  };
  const fareEstimated = (fareBreakdown.base + fareBreakdown.distanceCost + fareBreakdown.timeCost + fareBreakdown.waitingCost) * fareBreakdown.surgeMultiplier;
  return { distanceKm, fareEstimated, fareBreakdown };
}

async function resolvePassengerMeta(passengerId, jwtUser, authHeader) {
  let p = null;
  const { Types } = require('mongoose');
  if (Types.ObjectId.isValid(passengerId)) {
    p = await Passenger.findById(passengerId).select({ _id: 1, name: 1, phone: 1 }).lean();
  }
  const tokenMeta = jwtUser ? {
    name: jwtUser.name || jwtUser.fullName || jwtUser.displayName,
    phone: jwtUser.phone || jwtUser.phoneNumber || jwtUser.mobile,
    email: jwtUser.email
  } : {};
  let passengerName = tokenMeta.name || p?.name || undefined;
  let passengerPhone = tokenMeta.phone || p?.phone || undefined;
  if (!passengerName || !passengerPhone) {
    try {
      const { getPassengerById } = require('../integrations/userServiceClient');
      const info = await getPassengerById(passengerId, { headers: authHeader });
      if (info) {
        passengerName = passengerName || info.name;
        passengerPhone = passengerPhone || info.phone;
      }
    } catch (_) {}
  }
  // Soft fallback: proceed with minimal meta from token only to avoid blocking bookings
  if (!passengerName) passengerName = jwtUser?.name || `Passenger ${String(passengerId)}`;
  if (!passengerPhone) passengerPhone = jwtUser?.phone || undefined;
  return { passengerName, passengerPhone };
}

async function createBooking({ passengerId, jwtUser, vehicleType, pickup, dropoff, authHeader, skipPassengerMeta = false }) {
  if (!pickup || !dropoff) {
    const err = new Error('Pickup and dropoff locations are required');
    err.status = 400;
    throw err;
  }
  const est = await estimateFare({ vehicleType, pickup, dropoff });
  let passengerName;
  let passengerPhone;
  if (!skipPassengerMeta) {
    const meta = await resolvePassengerMeta(passengerId, jwtUser, authHeader);
    passengerName = meta.passengerName;
    passengerPhone = meta.passengerPhone;
  }
  const booking = await Booking.create({
    passengerId,
    passengerName,
    passengerPhone,
    vehicleType,
    pickup,
    dropoff,
    distanceKm: est.distanceKm,
    fareEstimated: est.fareEstimated,
    fareBreakdown: est.fareBreakdown
  });
  
  return booking;
}

async function listBookings({ requester, headers }) {
  const userType = requester?.type;
  const userId = requester?.id;
  const query = {};
  if (userType === 'passenger') query.passengerId = String(userId);
  const rows = await Booking.find(query).sort({ createdAt: -1 }).lean();

  const { Types } = require('mongoose');
  const passengerIds = [...new Set(rows.map(r => r.passengerId))];
  const validObjectIds = passengerIds.filter(id => Types.ObjectId.isValid(id));
  const passengers = validObjectIds.length
    ? await Passenger.find({ _id: { $in: validObjectIds } }).select({ _id: 1, name: 1, phone: 1 }).lean()
    : [];
  const pidToPassenger = Object.fromEntries(passengers.map(p => [String(p._id), { id: String(p._id), name: p.name, phone: p.phone }]));

  const nonObjectIdPassengerIds = passengerIds.filter(id => !Types.ObjectId.isValid(id));
  let additionalPassengers = {};
  if (nonObjectIdPassengerIds.length > 0) {
    try {
      const { getPassengerById } = require('../integrations/userServiceClient');
      const additionalPassengerResults = await Promise.all(nonObjectIdPassengerIds.map(async (id) => {
        try {
          const info = await getPassengerById(id, { headers });
          return info ? { id, info } : null;
        } catch (_) { return null; }
      }));
      additionalPassengers = Object.fromEntries(additionalPassengerResults.filter(Boolean).map(r => [r.id, { id: r.id, name: r.info.name, phone: r.info.phone }]));
    } catch (_) {}
  }

  let jwtPassengerInfo = null;
  if (requester && requester.id && requester.type === 'passenger') {
    jwtPassengerInfo = {
      id: String(requester.id),
      name: requester.name || requester.fullName || requester.displayName,
      phone: requester.phone || requester.phoneNumber || requester.mobile,
      email: requester.email
    };
  }

  const authHeader = headers && headers.authorization ? { Authorization: headers.authorization } : undefined;
  const driverIds = [...new Set(rows.map(r => r.driverId).filter(Boolean).map(String))];
  const driverInfoMap = new Map();
  const mergeDriverInfo = (raw) => {
    if (!raw) return;
    const idCandidate = raw.id ?? raw._id ?? raw.driverId;
    if (!idCandidate) return;
    const id = String(idCandidate);
    const normalized = { id };
    if (raw.name) normalized.name = raw.name;
    if (raw.phone) normalized.phone = raw.phone;
    if (raw.email) normalized.email = raw.email;
    if (raw.vehicleType) normalized.vehicleType = raw.vehicleType;
    const carName = raw.carName || raw.carModel || raw.vehicleName;
    if (carName) normalized.carName = carName;
    if (raw.carModel) normalized.carModel = raw.carModel;
    if (raw.carPlate) normalized.carPlate = raw.carPlate;
    if (raw.carColor) normalized.carColor = raw.carColor;
    if (raw.rating != null && raw.rating !== '') normalized.rating = Number(raw.rating);
    if (raw.available != null) normalized.available = !!raw.available;
    if (raw.paymentPreference != null) normalized.paymentPreference = raw.paymentPreference;
    const existing = driverInfoMap.get(id) || {};
    driverInfoMap.set(id, { ...existing, ...normalized });
  };

  if (driverIds.length) {
    try {
      const { getDriversByIds } = require('../integrations/userServiceClient');
      const infos = await getDriversByIds(driverIds, { headers: authHeader });
      (infos || []).forEach(mergeDriverInfo);
    } catch (_) {}

    try {
      const { Driver } = require('../models/userModels');
      const docs = await Driver.find({ _id: { $in: driverIds } })
        .select({ _id: 1, name: 1, phone: 1, email: 1, vehicleType: 1, carModel: 1, carName: 1, carPlate: 1, carColor: 1, rating: 1 })
        .lean();
      (docs || []).forEach((doc) => mergeDriverInfo({ ...doc, id: doc && doc._id ? String(doc._id) : undefined }));
    } catch (_) {}
  }

  const normalized = rows.map(b => {
    let passenger = undefined;
    if (jwtPassengerInfo && String(jwtPassengerInfo.id) === String(b.passengerId)) {
      passenger = jwtPassengerInfo;
    } else if (b.passengerName || b.passengerPhone) {
      passenger = { id: b.passengerId, name: b.passengerName, phone: b.passengerPhone };
    } else if (pidToPassenger[b.passengerId]) {
      passenger = pidToPassenger[b.passengerId];
    } else if (additionalPassengers[b.passengerId]) {
      passenger = additionalPassengers[b.passengerId];
    }
    const driverRecord = b.driverId ? driverInfoMap.get(String(b.driverId)) : undefined;
    let driver = driverRecord ? { ...driverRecord } : undefined;
    if (!driver && b.driverId) {
      driver = { id: String(b.driverId) };
    }
    if (driver) {
      if (!driver.vehicleType && b.vehicleType) driver.vehicleType = b.vehicleType;
      if (!driver.carName && driver.carModel) driver.carName = driver.carModel;
    }
    return {
      id: String(b._id),
      passengerId: b.passengerId,
      passenger,
      driverId: b.driverId,
      driver,
      vehicleType: b.vehicleType,
      pickup: b.pickup,
      dropoff: b.dropoff,
      distanceKm: b.distanceKm,
      fareEstimated: b.fareEstimated,
      currentFare: b.currentFare,
      fareFinal: b.fareFinal,
      fareBreakdown: b.fareBreakdown,
      status: b.status,
      createdAt: b.createdAt,
      updatedAt: b.updatedAt
    };
  });
  return normalized;
}

async function getBooking({ requester, id }) {
  const userType = requester?.type;
  const query = { _id: id };
  if (userType === 'passenger') query.passengerId = String(requester?.id);
  const item = await Booking.findOne(query).lean();
  if (!item) {
    const err = new Error('Booking not found or you do not have permission to access it');
    err.status = 404;
    throw err;
  }
  const { Types } = require('mongoose');
  let passenger = undefined;
  if (requester && requester.id && requester.type === 'passenger' && String(requester.id) === String(item.passengerId)) {
    passenger = {
      id: String(requester.id),
      name: requester.name || requester.fullName || requester.displayName,
      phone: requester.phone || requester.phoneNumber || requester.mobile,
      email: requester.email
    };
  }
  if (!passenger && item.passengerId && Types.ObjectId.isValid(item.passengerId)) {
    const p = await Passenger.findById(item.passengerId).select({ _id: 1, name: 1, phone: 1 }).lean();
    if (p) passenger = { id: String(p._id), name: p.name, phone: p.phone };
  }
  if (!passenger && (item.passengerName || item.passengerPhone)) {
    passenger = { id: String(item.passengerId), name: item.passengerName, phone: item.passengerPhone };
  }
  if (!passenger) {
    passenger = { id: String(item.passengerId), name: `Passenger ${item.passengerId}`, phone: `+123456789${item.passengerId}` };
  }
  return {
    id: String(item._id),
    passengerId: item.passengerId,
    passenger,
    vehicleType: item.vehicleType,
    pickup: item.pickup,
    dropoff: item.dropoff,
    distanceKm: item.distanceKm,
    fareEstimated: item.fareEstimated,
    currentFare: item.currentFare,
    fareFinal: item.fareFinal,
    fareBreakdown: item.fareBreakdown,
    status: item.status,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt
  };
}

async function updateBookingLifecycle({ requester, id, status, reason, extras = {}, driverContext }) {
  const requesterType = String(requester?.type || '').toLowerCase();
  let booking = await Booking.findById(id);
  try { require('../utils/logger').info('[lifecycle] start', { id: String(id), requesterType, status, current: booking && booking.status }); } catch (_) {}
  if (!booking) {
    const err = new Error('Booking not found');
    err.status = 404;
    throw err;
  }
  const previousStatus = booking.status;
  const lifecycleExtras = extras && typeof extras === 'object' ? { ...extras } : {};
  let driverProfile = driverContext || null;
  if (!['requested','accepted','ongoing','completed','canceled'].includes(status)) {
    const err = new Error(`Invalid status '${status}'. Allowed values: requested, accepted, ongoing, completed, canceled`);
    err.status = 400;
    throw err;
  }
  if (booking.status === 'completed') {
    const err = new Error('Cannot change status of completed bookings');
    err.status = 400;
    throw err;
  }
  if (status === 'accepted' && requesterType === 'driver') {
    if (!driverProfile) {
      try {
        const driverQuery = Driver.findById(requester.id);
        if (driverQuery && typeof driverQuery.lean === 'function') {
          driverProfile = await driverQuery.lean();
        } else {
          const driverDoc = await driverQuery;
          driverProfile = driverDoc && typeof driverDoc.toObject === 'function'
            ? driverDoc.toObject()
            : driverDoc;
        }
      } catch (_) {}
    }
    if (!driverProfile || !driverProfile.available) {
      const err = new Error('Driver must be available to accept bookings. Driver is currently unavailable.');
      err.status = 400;
      throw err;
    }
    const activeBooking = await Booking.findOne({ driverId: requester.id, status: { $in: ['accepted', 'ongoing'] } });
    if (activeBooking) {
      const err = new Error('Driver already has an active booking');
      err.status = 400;
      throw err;
    }
    // Finance rule: ensure driver has enough package balance to accept
    try {
      const wallet = await Wallet.findOne({ userId: String(requester.id), role: 'driver' });
      const packageBalance = wallet ? Number(wallet.balance || 0) : 0;
      const targetFare = booking.fareFinal || booking.fareEstimated || 0;
      if (!financeService.canAcceptBooking(packageBalance, targetFare)) {
        const err = new Error('Insufficient package balance to accept booking');
        err.status = 403;
        throw err;
      }
    } catch (e) {
      if (e && e.status) throw e;
    }

    // Perform atomic conditional accept to avoid races
    const now = new Date();
    const updated = await Booking.findOneAndUpdate(
      { _id: id, status: 'requested' },
      { $set: { driverId: String(requester.id), status: 'accepted', acceptedAt: now } },
      { new: true }
    );
    if (!updated) {
      const err = new Error('Booking is no longer available to accept');
      err.status = 409;
      throw err;
    }
    booking = updated;
    await Driver.findByIdAndUpdate(requester.id, { available: false });
    try { require('../utils/logger').info('[lifecycle] accepted-atomic', { id: String(booking._id), status: booking.status, driverId: booking.driverId }); } catch (_) {}
  }
  if (requesterType === 'driver' && booking.driverId && booking.driverId !== String(requester.id)) {
    const err = new Error('Only the assigned driver can change this booking status');
    err.status = 403;
    throw err;
  }
  // If accepted via atomic update above, skip redundant mutation
  if (!(status === 'accepted' && requesterType === 'driver')) {
    booking.status = status;
    if (status === 'accepted') booking.acceptedAt = new Date();
  }
  if (status === 'ongoing') {
    booking.startedAt = new Date();
    if (booking.driverId && booking.passengerId) {
      positionUpdateService.startTracking(booking._id.toString(), booking.driverId, booking.passengerId);
    }
  }
  if (status === 'completed') {
    // Delegate completion flow to lifecycle service to compute final fare consistently
    const lifecycle = require('./bookingLifecycleService');
    const completed = await lifecycle.completeTrip(String(booking._id), /* endLocation */ undefined, {});
    try { bookingEvents.emitLifecycleUpdate(completed, { previousStatus, driver: await buildDriverSnapshot(String(completed.driverId || ''), { fallbackVehicleType: completed.vehicleType }) }); } catch (_) {}
    return completed;
  }
  if (status === 'canceled') {
    if (booking.driverId) await Driver.findByIdAndUpdate(booking.driverId, { available: true });
    positionUpdateService.stopTracking(booking._id.toString());
    if (lifecycleExtras.canceledBy) booking.canceledBy = lifecycleExtras.canceledBy;
    const cancelReason = lifecycleExtras.canceledReason || reason;
    if (cancelReason) booking.canceledReason = cancelReason;
  }
  // For atomic accept we already persisted changes
  if (!(status === 'accepted' && requesterType === 'driver')) {
    await booking.save();
    try { require('../utils/logger').info('[lifecycle] saved', { id: String(booking._id), status: booking.status }); } catch (_) {}
  }
  await TripHistory.findOneAndUpdate(
    { bookingId: booking._id },
    {
      $set: {
        driverId: booking.driverId,
        passengerId: booking.passengerId,
        status: booking.status,
        pickupLocation: booking.pickup,
        dropoffLocation: booking.dropoff,
        startTime: booking.startedAt,
        endTime: booking.completedAt
      },
      $setOnInsert: {
        bookingId: booking._id,
        dateOfTravel: booking.createdAt || new Date()
      }
    },
    { upsert: true }
  );
  try { require('../utils/logger').info('[lifecycle] done', { id: String(booking._id), status: booking.status, driverId: booking.driverId }); } catch (_) {}
  let driverPayload;
  if (booking.driverId) {
    if (!driverProfile) {
      try {
        const driverQuery = Driver.findById(String(booking.driverId));
        if (driverQuery && typeof driverQuery.lean === 'function') {
          driverProfile = await driverQuery.lean();
        } else {
          const driverDoc = await driverQuery;
          driverProfile = driverDoc && typeof driverDoc.toObject === 'function'
            ? driverDoc.toObject()
            : driverDoc;
        }
      } catch (_) {}
    }
    driverPayload = await buildDriverSnapshot(String(booking.driverId), {
      source: driverProfile,
      fallbackUser: requester,
      fallbackVehicleType: booking.vehicleType
    });
  }

  let passengerPayload;
  if (booking.passengerId) {
    passengerPayload = {
      id: String(booking.passengerId),
      name: booking.passengerName,
      phone: booking.passengerPhone
    };
    if ((!passengerPayload.name || !passengerPayload.phone) && booking.passengerId) {
      try {
        const passengerDoc = await Passenger.findById(String(booking.passengerId)).select({ _id: 1, name: 1, phone: 1 }).lean();
        if (passengerDoc) {
          passengerPayload.name = passengerPayload.name || passengerDoc.name;
          passengerPayload.phone = passengerPayload.phone || passengerDoc.phone;
        }
      } catch (_) {}
    }
  }

  const extrasPayload = {
    ...lifecycleExtras,
    meta: {
      ...(lifecycleExtras.meta || {}),
      booking: {
        id: String(booking._id),
        vehicleType: booking.vehicleType,
        pickup: booking.pickup,
        dropoff: booking.dropoff,
        fareEstimated: booking.fareEstimated,
        fareFinal: booking.fareFinal,
        distanceKm: booking.distanceKm
      }
    }
  };

  try {
    bookingEvents.emitLifecycleUpdate(booking, { previousStatus, reason, driver: driverPayload, passenger: passengerPayload, extras: extrasPayload });
  } catch (_) {}
  return booking;
}

async function assignDriver({ bookingId, driverId, dispatcherId, passengerId }) {
  const booking = await Booking.findById(bookingId);
  if (!booking) {
    const err = new Error('Booking not found');
    err.status = 404;
    throw err;
  }
  if (booking.status !== 'requested') {
    const err = new Error(`Cannot assign booking with status '${booking.status}'. Only 'requested' bookings can be assigned.`);
    err.status = 400;
    throw err;
  }
  const driver = await Driver.findById(driverId);
  if (!driver || !driver.available) {
    const err = new Error('Driver is not available for assignment. Driver must be available to accept bookings.');
    err.status = 400;
    throw err;
  }
  const activeBooking = await Booking.findOne({ driverId: String(driverId), status: { $in: ['accepted', 'ongoing'] } });
  if (activeBooking) {
    const err = new Error('Driver already has an active booking');
    err.status = 400;
    throw err;
  }
  // Rate-limit reassignment attempts to prevent flapping
  try {
    const cooldownSec = Number(process.env.REASSIGN_COOLDOWN_SECONDS || 15);
    if (cooldownSec > 0) {
      const since = new Date(Date.now() - cooldownSec * 1000);
      const recent = await BookingAssignment.findOne({ bookingId, createdAt: { $gte: since } })
        .sort({ createdAt: -1 })
        .lean();
      if (recent) {
        const err = new Error(`Assignment cooldown active. Please wait ${cooldownSec}s before reassigning`);
        err.status = 429;
        throw err;
      }
    }
  } catch (e) {
    if (e && e.status) throw e;
  }
  // Finance rule: check driver's package balance before assignment
  try {
    const wallet = await Wallet.findOne({ userId: String(driverId), role: 'driver' });
    const packageBalance = wallet ? Number(wallet.balance || 0) : 0;
    const targetFare = booking.fareFinal || booking.fareEstimated || 0;
    if (!financeService.canAcceptBooking(packageBalance, targetFare)) {
      const err = new Error('Driver cannot be assigned due to insufficient package balance');
      err.status = 403;
      throw err;
    }
  } catch (e) {
    if (e && e.status) throw e;
  }
  const assignment = await BookingAssignment.create({ bookingId, driverId: String(driverId), dispatcherId: String(dispatcherId), passengerId: String(passengerId || booking.passengerId) });
  booking.driverId = String(driverId);
  booking.status = 'accepted';
  booking.acceptedAt = new Date();
  await booking.save();
  await Driver.findByIdAndUpdate(driverId, { available: false });
  return { booking, assignment };
}

async function listNearbyBookings({ latitude, longitude, radiusKm = 5, vehicleType, limit = 20, driverId, headers }) {
  const query = { status: 'requested', ...(vehicleType ? { vehicleType } : {}) };
  const rows = await Booking.find(query).sort({ createdAt: -1 }).lean();
  const withDistance = rows.map(b => {
    const dKm = geolib.getDistance(
      { latitude, longitude },
      { latitude: b.pickup?.latitude, longitude: b.pickup?.longitude }
    ) / 1000;
    return { booking: b, distanceKm: dKm };
  }).filter(x => isFinite(x.distanceKm) && x.distanceKm <= radiusKm);
  withDistance.sort((a, b) => a.distanceKm - b.distanceKm);
  // Finance rule: optionally filter out bookings the driver cannot afford (package balance)
  let filtered = withDistance;
  if (driverId) {
    try {
      const wallet = await Wallet.findOne({ userId: String(driverId), role: 'driver' });
      const packageBalance = wallet ? Number(wallet.balance || 0) : 0;
      filtered = withDistance.filter(x => financeService.canAcceptBooking(packageBalance, x.booking.fareFinal || x.booking.fareEstimated || 0));
    } catch (_) {}
  }
  const selected = filtered.slice(0, Math.min(parseInt(limit, 10) || 20, 100));
  // Attempt to enrich passenger info for drivers if missing on booking
  let passengerInfoMap = {};
  try {
    const missingPassengerIds = [...new Set(selected
      .map(x => x.booking)
      .filter(b => b && (!b.passengerName || !b.passengerPhone))
      .map(b => String(b.passengerId))
      .filter(Boolean))];
    if (missingPassengerIds.length) {
      const { getPassengerById } = require('../integrations/userServiceClient');
      const authHeader = headers && headers.authorization ? { Authorization: headers.authorization } : undefined;
      const lookups = await Promise.all(missingPassengerIds.map(async (pid) => {
        try {
          const info = await getPassengerById(pid, { headers: authHeader });
          return info ? [pid, { id: pid, name: info.name, phone: info.phone }] : null;
        } catch (_) { return null; }
      }));
      passengerInfoMap = Object.fromEntries(lookups.filter(Boolean));
    }
  } catch (_) {}

  return selected.map(x => ({
    id: String(x.booking._id),
    passengerId: x.booking.passengerId,
    passenger: (x.booking.passengerName || x.booking.passengerPhone)
      ? { id: x.booking.passengerId, name: x.booking.passengerName, phone: x.booking.passengerPhone }
      : (passengerInfoMap[String(x.booking.passengerId)] || undefined),
    vehicleType: x.booking.vehicleType,
    pickup: x.booking.pickup,
    dropoff: x.booking.dropoff,
    distanceKm: Math.round(x.distanceKm * 100) / 100,
    fareEstimated: x.booking.fareEstimated,
    status: x.booking.status,
    createdAt: x.booking.createdAt,
    updatedAt: x.booking.updatedAt
  }));
}

async function ratePassenger({ bookingId, driverId, rating, comment }) {
  if (!rating || rating < 1 || rating > 5) {
    const err = new Error('Rating must be between 1 and 5');
    err.status = 400;
    throw err;
  }
  const booking = await Booking.findById(bookingId);
  if (!booking) {
    const err = new Error('Booking not found');
    err.status = 404;
    throw err;
  }
  if (String(booking.driverId) !== String(driverId)) {
    const err = new Error('Only the assigned driver can rate the passenger');
    err.status = 403;
    throw err;
  }
  if (booking.status !== 'completed') {
    const err = new Error('Can only rate after trip completion');
    err.status = 400;
    throw err;
  }
  booking.passengerRating = rating;
  if (comment) booking.passengerComment = comment;
  await booking.save();
  // Update passenger aggregate rating locally
  try {
    const pid = String(booking.passengerId);
    if (pid && mongoose.Types.ObjectId.isValid(pid)) {
      const agg = await Booking.aggregate([
        { $match: { passengerId: pid, passengerRating: { $gte: 1 } } },
        { $group: { _id: '$passengerId', count: { $sum: 1 }, avg: { $avg: '$passengerRating' } } }
      ]);
      const avg = agg[0]?.avg;
      if (Number.isFinite(avg)) {
        await Passenger.findByIdAndUpdate(pid, { $set: { rating: Math.round(avg * 10) / 10, ratingCount: agg[0].count } });
      }
    }
  } catch (_) {}
  return { booking, rating, comment };
}

async function rateDriver({ bookingId, passengerId, rating, comment }) {
  if (!rating || rating < 1 || rating > 5) {
    const err = new Error('Rating must be between 1 and 5');
    err.status = 400;
    throw err;
  }
  const booking = await Booking.findById(bookingId);
  if (!booking) {
    const err = new Error('Booking not found');
    err.status = 404;
    throw err;
  }
  if (String(booking.passengerId) !== String(passengerId)) {
    const err = new Error('Only the passenger can rate the driver');
    err.status = 403;
    throw err;
  }
  if (booking.status !== 'completed') {
    const err = new Error('Can only rate after trip completion');
    err.status = 400;
    throw err;
  }
  booking.driverRating = rating;
  if (comment) booking.driverComment = comment;
  await booking.save();
  // Update driver aggregate rating locally
  try {
    const did = String(booking.driverId);
    if (did) {
      const agg = await Booking.aggregate([
        { $match: { driverId: did, driverRating: { $gte: 1 } } },
        { $group: { _id: '$driverId', count: { $sum: 1 }, avg: { $avg: '$driverRating' } } }
      ]);
      const avg = agg[0]?.avg;
      if (Number.isFinite(avg)) {
        await Driver.findByIdAndUpdate(did, { $set: { rating: Math.round(avg * 10) / 10, ratingCount: agg[0].count } });
      }
    }
  } catch (_) {}
  return { message: 'Driver rated successfully' };
}

module.exports = {
  estimateFare,
  createBooking,
  listBookings,
  getBooking,
  updateBookingLifecycle,
  assignDriver,
  listNearbyBookings,
  ratePassenger,
  rateDriver
};

