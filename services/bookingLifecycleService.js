const { Booking } = require('../models/bookingModels');
const TripHistory = require('../models/tripHistoryModel');
const { Pricing } = require('../models/pricing');
const { haversineKm } = require('../utils/distance');
// Defensive require: fall back to simple Haversine-based implementation if utility missing
const { computePathDistance } = (() => {
  try {
    return require('../utils/computePathDistance');
  } catch (_) {
    return {
      computePathDistance(points) {
        if (!Array.isArray(points) || points.length < 2) return 0;
        let total = 0;
        for (let i = 1; i < points.length; i++) {
          const a = points[i - 1];
          const b = points[i];
          const seg = haversineKm({ latitude: a.lat, longitude: a.lng }, { latitude: b.lat, longitude: b.lng });
          if (Number.isFinite(seg)) total += seg;
        }
        return total;
      }
    };
  }
})();
const pricingService = require('./pricingService');
const commissionService = require('./commissionService');
const walletService = require('./walletService');
const financeService = require('./financeService');
const { Commission, DriverEarnings, AdminEarnings } = require('../models/commission');
const metrics = require('../utils/metrics');
const { emitLifecycleUpdate } = require('../events/bookingEvents');
const { buildDriverSnapshot } = require('../lib/driverSnapshot');

async function startTrip(bookingId, startLocation) {
  const booking = await Booking.findById(bookingId);
  if (!booking) throw new Error('Booking not found');
  const previousStatus = booking.status;
  booking.status = 'ongoing';
  booking.startedAt = new Date();
  if (startLocation) booking.startLocation = startLocation;
  await booking.save();
  await TripHistory.findOneAndUpdate(
    { bookingId: booking._id },
    {
      $set: {
        status: booking.status,
        startedAt: booking.startedAt
      },
      $setOnInsert: {
        bookingId: booking._id,
        driverId: booking.driverId,
        passengerId: booking.passengerId,
        vehicleType: booking.vehicleType,
        locations: []
      }
    },
    { upsert: true, new: true }
  );
  try {
    if (booking.acceptedAt) {
      metrics.timing('lifecycle.trip_start_latency_ms', booking.startedAt - booking.acceptedAt, {
        vehicleType: booking.vehicleType || 'unknown'
      });
    }
    metrics.increment('lifecycle.trip_started', {
      vehicleType: booking.vehicleType || 'unknown'
    });
  } catch (_) {}
  let driverSnapshot;
  if (booking.driverId) {
    driverSnapshot = await buildDriverSnapshot(String(booking.driverId), { fallbackVehicleType: booking.vehicleType });
  }
  try { emitLifecycleUpdate(booking, { previousStatus, driver: driverSnapshot }); } catch (_) {}
  return booking;
}

async function updateTripLocation(bookingId, driverId, location) {
  const now = new Date();
  const lat = Number(location.latitude);
  const lon = Number(location.longitude);
  const point = { lat, lng: lon, lon, timestamp: now };

  // Fetch last point and current aggregates with minimal payload
  let lastPoint = null;
  try {
    const prev = await TripHistory.findOne({ bookingId })
      .select({ locations: { $slice: -1 }, distanceAccumulatedKm: 1, movingMinutes: 1, waitingMinutes: 1 })
      .lean();
    if (prev && Array.isArray(prev.locations) && prev.locations.length) {
      lastPoint = prev.locations[0];
    }
  } catch (_) {}

  let incDistanceKm = 0;
  let incMovingMinutes = 0;
  let incWaitingMinutes = 0;
  if (lastPoint) {
    // Compute segment metrics with gating rules
    const from = { latitude: Number(lastPoint.lat), longitude: Number(lastPoint.lng ?? lastPoint.lon) };
    const to = { latitude: lat, longitude: lon };
    const segKm = haversineKm(from, to);
    const meters = Number.isFinite(segKm) ? segKm * 1000 : NaN;
    const t1 = lastPoint.timestamp ? new Date(lastPoint.timestamp).getTime() : undefined;
    const t2 = now.getTime();
    const dtSec = Number.isFinite(t1) ? Math.max(0, (t2 - t1) / 1000) : undefined;
    const minMeters = Number(process.env.DIST_MIN_METERS || 10);
    const minDt = Number(process.env.DIST_MIN_DT_SECONDS || 2);
    const minSpeed = Number(process.env.DIST_MIN_SPEED_MPS || 0.3);
    const speed = dtSec && dtSec > 0 ? meters / dtSec : undefined;
    const passesDist = Number.isFinite(meters) && meters >= minMeters;
    const passesTime = dtSec == null || dtSec >= minDt;
    const passesSpeed = speed == null || speed >= minSpeed;
    if (passesDist && passesTime && passesSpeed && Number.isFinite(segKm)) {
      incDistanceKm = segKm;
      if (dtSec) incMovingMinutes = dtSec / 60;
    } else if (dtSec) {
      incWaitingMinutes = dtSec / 60;
    }
  }

  const updateDoc = {
    $push: { locations: point },
    $set: { status: 'ongoing', driverId },
    $setOnInsert: { startedAt: now },
  };
  const inc = {};
  if (incDistanceKm) inc.distanceAccumulatedKm = incDistanceKm;
  if (incMovingMinutes) inc.movingMinutes = incMovingMinutes;
  if (incWaitingMinutes) inc.waitingMinutes = incWaitingMinutes;
  if (Object.keys(inc).length) updateDoc.$inc = inc;

  await TripHistory.findOneAndUpdate(
    { bookingId },
    updateDoc,
    { upsert: true }
  );
  return point;
}

function computePathDistanceKm(locations) {
  return computePathDistance(locations);
}

async function completeTrip(bookingId, endLocation, options = {}) {
  const { surgeMultiplier, discount = 0, debitPassengerWallet = false, adminUserId = process.env.ADMIN_USER_ID } = options;
  const booking = await Booking.findById(bookingId);
  if (!booking) throw new Error('Booking not found');
  const previousStatus = booking.status;

  if (booking.status === 'completed') {
    return booking;
  }
  if (booking.status === 'canceled') {
    throw new Error('Cannot complete a canceled booking');
  }
  if (booking.status && booking.status !== 'ongoing' && booking.status !== 'accepted') {
    throw new Error(`Cannot complete booking in current status: ${booking.status}`);
  }

  const trip = await TripHistory.findOne({ bookingId: booking._id });
  const startedAt = booking.startedAt || (trip && trip.startedAt) || new Date();
  const completedAt = new Date();

  // Determine the actual completion location to use for metrics and dropoff
  let completionLocation = null;
  if (endLocation && endLocation.latitude != null && endLocation.longitude != null) {
    completionLocation = { latitude: Number(endLocation.latitude), longitude: Number(endLocation.longitude), address: endLocation.address };
  } else if (trip && Array.isArray(trip.locations) && trip.locations.length > 0) {
    const last = trip.locations[trip.locations.length - 1];
    if (last && last.lat != null && last.lng != null) {
      completionLocation = { latitude: Number(last.lat), longitude: Number(last.lng) };
    }
  }
  if (completionLocation) {
    booking.endLocation = completionLocation;
  }

  // Compute distance
  let distanceKm = 0;
  if (trip && Array.isArray(trip.locations) && trip.locations.length >= 2) {
    distanceKm = computePathDistanceKm(trip.locations);
  } else if (booking.startLocation && completionLocation) {
    distanceKm = haversineKm(
      { latitude: booking.startLocation.latitude, longitude: booking.startLocation.longitude },
      { latitude: completionLocation.latitude, longitude: completionLocation.longitude }
    );
  } else if (booking.pickup && booking.dropoff) {
    distanceKm = haversineKm(
      { latitude: booking.pickup.latitude, longitude: booking.pickup.longitude },
      { latitude: booking.dropoff.latitude, longitude: booking.dropoff.longitude }
    );
  }

  const waitingTimeMinutes = Math.max(0, Math.round(((completedAt - new Date(startedAt)) / 60000)));

  // Use the live pricing from currentFare (updated during trip) as the base fare
  // This ensures consistency between what users see during the trip and the final charge
  let fare = booking.currentFare;
  
  // Fallback: if currentFare is missing or invalid, use fareEstimated, then calculate from scratch
  if (!fare || !Number.isFinite(fare) || fare <= 0) {
    fare = booking.fareEstimated;
    if (!fare || !Number.isFinite(fare) || fare <= 0) {
      fare = await pricingService.calculateFare(distanceKm, waitingTimeMinutes, booking.vehicleType, surgeMultiplier, discount);
    } else {
      // Apply minimum/maximum fare constraints to the initial estimate (skip DB lookup in test env without MONGO_URI)
      try {
        if (process.env.MONGO_URI) {
          const pricing = await Pricing.findOne({ vehicleType: booking.vehicleType, isActive: true }).sort({ updatedAt: -1 });
          if (pricing) {
            const minimumFare = Number(pricing.minimumFare || 0);
            const maximumFare = Number(pricing.maximumFare || 0);
            if (minimumFare > 0) fare = Math.max(fare, minimumFare);
            if (maximumFare > 0) fare = Math.min(fare, maximumFare);
          }
        }
      } catch (_) {}
      
      // Apply surge multiplier and discount to the initial estimate
      const multiplier = Number(surgeMultiplier || 1);
      if (Number.isFinite(multiplier) && multiplier > 0) {
        fare = fare * multiplier;
      }
      fare -= Number(discount || 0);
      fare = Math.max(fare, 0);
    }
  } else {
    // Apply minimum/maximum fare constraints to the live pricing (skip DB lookup in test env without MONGO_URI)
    try {
      if (process.env.MONGO_URI) {
        const pricing = await Pricing.findOne({ vehicleType: booking.vehicleType, isActive: true }).sort({ updatedAt: -1 });
        if (pricing) {
          const minimumFare = Number(pricing.minimumFare || 0);
          const maximumFare = Number(pricing.maximumFare || 0);
          if (minimumFare > 0) fare = Math.max(fare, minimumFare);
          if (maximumFare > 0) fare = Math.min(fare, maximumFare);
        }
      }
    } catch (_) {}
    
    // Apply surge multiplier and discount to the live pricing
    const multiplier = Number(surgeMultiplier || 1);
    if (Number.isFinite(multiplier) && multiplier > 0) {
      fare = fare * multiplier;
    }
    fare -= Number(discount || 0);
    fare = Math.max(fare, 0);
  }
  // Get per-driver commission rate set by admin; fallback to env default
  let commissionRate = Number(process.env.COMMISSION_RATE || 15);
  if (booking.driverId) {
    const commissionDoc = await Commission.findOne({ driverId: String(booking.driverId) }).sort({ createdAt: -1 });
    if (commissionDoc && Number.isFinite(commissionDoc.percentage)) {
      commissionRate = commissionDoc.percentage;
    }
  }
  const commission = financeService.calculateCommission(fare, commissionRate);
  const driverEarnings = fare - commission;

  // Update booking
  booking.status = 'completed';
  booking.completedAt = completedAt;
  booking.fareFinal = fare;
  booking.distanceKm = distanceKm;
  booking.waitingTime = waitingTimeMinutes;
  booking.commissionAmount = commission;
  booking.driverEarnings = driverEarnings;
  // Overwrite booking.dropoff with actual completion location if available
  if (completionLocation) {
    booking.dropoff = {
      latitude: completionLocation.latitude,
      longitude: completionLocation.longitude,
      // preserve existing address if end address is not provided
      address: completionLocation.address || (booking.dropoff && booking.dropoff.address) || undefined
    };
  }
  await booking.save();

  // Wallet operations (best effort)
  // Deduct commission from driver package balance (driver wallet) upon trip completion
  try {
    if (booking.driverId && Number.isFinite(commission) && commission > 0) {
      const { Wallet, Transaction } = require('../models/common');
      await Wallet.updateOne(
        { userId: String(booking.driverId), role: 'driver' },
        { $inc: { balance: -commission } },
        { upsert: true }
      );
      try {
        await Transaction.create({
          userId: String(booking.driverId),
          role: 'driver',
          amount: commission,
          type: 'debit',
          method: booking.paymentMethod || 'cash',
          status: 'success',
          metadata: { bookingId: String(booking._id), reason: 'Commission deduction' }
        });
      } catch (_) {}
    }
  } catch (_) {}
  try {
    if (adminUserId && Number.isFinite(commission) && commission > 0) await walletService.credit(adminUserId, commission, 'Commission from trip');
  } catch (_) {}
  try {
    if (debitPassengerWallet && booking.passengerId) await walletService.debit(booking.passengerId, fare, 'Trip fare');
  } catch (_) {}

  // Persist trip summary
  await TripHistory.findOneAndUpdate(
    { bookingId: booking._id },
    {
      $set: {
        status: booking.status,
        fare,
        distance: distanceKm,
        waitingTime: waitingTimeMinutes,
        vehicleType: booking.vehicleType,
        startedAt,
        completedAt,
        driverId: booking.driverId,
        passengerId: booking.passengerId,
        // Persist final dropoff location for this trip if available
        ...(completionLocation ? { dropoffLocation: {
          latitude: completionLocation.latitude,
          longitude: completionLocation.longitude,
          address: completionLocation.address
        } } : {}),
        commission,
        netIncome: driverEarnings
      }
    },
    { upsert: true }
  );

  // Persist earnings
  try {
    if (booking.driverId) {
      await DriverEarnings.create({
        driverId: String(booking.driverId),
        bookingId: booking._id,
        // Use the canonical completion time for all financial reports
        tripDate: completedAt,
        grossFare: fare,
        commissionAmount: commission,
        netEarnings: driverEarnings,
        commissionPercentage: commissionRate
      });
    }
    await AdminEarnings.create({
      bookingId: booking._id,
      // Use the canonical completion time for all financial reports
      tripDate: completedAt,
      grossFare: fare,
      commissionEarned: commission,
      commissionPercentage: commissionRate,
      driverId: String(booking.driverId || ''),
      passengerId: String(booking.passengerId || '')
    });
  } catch (_) {}


  // Broadcast lifecycle updates for admin dashboard
  try {
    if (booking.startedAt) {
      metrics.timing('lifecycle.trip_complete_latency_ms', completedAt - booking.startedAt, {
        vehicleType: booking.vehicleType || 'unknown'
      });
    }
    metrics.increment('lifecycle.trip_completed', {
      vehicleType: booking.vehicleType || 'unknown'
    });
  } catch (_) {}

  let driverSnapshot;
  if (booking.driverId) {
    driverSnapshot = await buildDriverSnapshot(String(booking.driverId), { fallbackVehicleType: booking.vehicleType });
  }
  try { emitLifecycleUpdate(booking, { previousStatus, driver: driverSnapshot }); } catch (_) {}

  return booking;
}

module.exports = { startTrip, updateTripLocation, completeTrip };

