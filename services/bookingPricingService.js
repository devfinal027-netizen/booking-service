const { Pricing } = require('../models/pricing');
const { Booking } = require('../models/bookingModels');
const { emitBookingTargets } = require('../sockets/utils');
const logger = require('../utils/logger');
const metrics = require('../utils/metrics');
const geolib = require('geolib');
const axios = require('axios');

// Legacy function - maintained for backward compatibility
async function recalcForBooking(bookingId) {
  const booking = await Booking.findById(bookingId);
  if (!booking) {
    const err = new Error('Booking not found');
    err.status = 404;
    throw err;
  }

  const distanceKm = geolib.getDistance(
    { latitude: booking.pickup.latitude, longitude: booking.pickup.longitude },
    { latitude: booking.dropoff.latitude, longitude: booking.dropoff.longitude }
  ) / 1000;

  const p = await Pricing.findOne({ vehicleType: booking.vehicleType, isActive: true }).sort({ updatedAt: -1 });
  if (!p) {
    const err = new Error('Active pricing not found for vehicleType');
    err.status = 404;
    throw err;
  }

  const fareBreakdown = {
    base: p.baseFare,
    distanceCost: distanceKm * p.perKm,
    timeCost: 0,
    waitingCost: 0,
    surgeMultiplier: p.surgeMultiplier,
  };
  const fareEstimated = (fareBreakdown.base + fareBreakdown.distanceCost + fareBreakdown.timeCost + fareBreakdown.waitingCost) * fareBreakdown.surgeMultiplier;

  booking.distanceKm = distanceKm;
  booking.fareEstimated = fareEstimated;
  booking.fareBreakdown = fareBreakdown;
  await booking.save();

  return {
    bookingId: String(booking._id),
    vehicleType: booking.vehicleType,
    pickup: booking.pickup,
    dropoff: booking.dropoff,
    distanceKm,
    fareEstimated,
    fareBreakdown
  };
}

/**
 * Calculate live pricing based on driver's current location during ongoing trip
 * @param {string} bookingId - The booking ID
 * @param {Object} currentLocation - Driver's current location {latitude, longitude}
 * @returns {Object} Updated pricing calculation
 */
async function calculateLivePricing(bookingId, currentLocation) {
  const startedAt = Date.now();
  try {
    logger.info('[PricingService] Starting live pricing calculation:', {
      bookingId,
      currentLocation,
      timestamp: new Date().toISOString()
    });

    const booking = await Booking.findById(bookingId);
    if (!booking) {
      logger.error('[PricingService] Booking not found:', { bookingId });
      throw new Error('Booking not found');
    }

    logger.info('[PricingService] Booking found:', {
      bookingId,
      status: booking.status,
      vehicleType: booking.vehicleType,
      driverId: booking.driverId,
      pickup: booking.pickup
    });

    if (booking.status !== 'ongoing') {
      // Allow live pricing during accepted status as a preview until trip_started flips to ongoing
      if (booking.status !== 'accepted') {
        logger.warn('[PricingService] Invalid booking status for pricing update:', {
          bookingId,
          currentStatus: booking.status,
          requiredStatus: 'ongoing|accepted'
        });
        throw new Error('Pricing updates only available for ongoing or accepted trips');
      }
    }

    // Get admin-set pricing for vehicle type
    logger.info('[PricingService] Looking up pricing for vehicle type:', {
      bookingId,
      vehicleType: booking.vehicleType
    });

    const pricing = await Pricing.findOne({ 
      vehicleType: booking.vehicleType, 
      isActive: true 
    }).sort({ updatedAt: -1 });

    if (!pricing) {
      logger.error('[PricingService] No active pricing found:', {
        bookingId,
        vehicleType: booking.vehicleType
      });
      throw new Error(`No active pricing found for vehicle type: ${booking.vehicleType}`);
    }

    logger.info('[PricingService] Pricing rules found:', {
      bookingId,
      pricingId: pricing._id,
      baseFare: pricing.baseFare,
      perKm: pricing.perKm,
      minimumFare: pricing.minimumFare,
      surgeMultiplier: pricing.surgeMultiplier
    });

    // Calculate cumulative path distance from TripHistory (with GPS filtering)
    logger.info('[PricingService] Calculating distance:', {
      bookingId,
      pickup: booking.pickup,
      currentLocation
    });

    // Get cumulative path distance from TripHistory with GPS filtering
    const { TripHistory } = require('../models/bookingModels');
    const trip = await TripHistory.findOne({ bookingId: booking._id });
    const locations = trip?.locations || [];
    
    let distanceTraveled = 0;
    let movingMinutes = 0;
    let waitingMinutes = 0;
    if (locations.length >= 2) {
      for (let i = 1; i < locations.length; i++) {
        const a = locations[i - 1];
        const b = locations[i];
        const segmentDistanceKm = geolib.getDistance(
          { latitude: a.lat, longitude: a.lng },
          { latitude: b.lat, longitude: b.lng }
        ) / 1000;
        const t1 = a.timestamp ? new Date(a.timestamp).getTime() : undefined;
        const t2 = b.timestamp ? new Date(b.timestamp).getTime() : undefined;
        const dtSec = (Number.isFinite(t1) && Number.isFinite(t2)) ? Math.max(0, (t2 - t1) / 1000) : undefined;

        const minDistanceKm = 0.025; // 25m
        const minDtSec = 5; // 5s
        const minSpeedMps = 1; // 1 m/s
        const speedMps = (dtSec && dtSec > 0) ? (segmentDistanceKm * 1000) / dtSec : 0;

        if (dtSec != null && dtSec >= minDtSec && segmentDistanceKm >= minDistanceKm && speedMps >= minSpeedMps) {
          distanceTraveled += segmentDistanceKm;
          movingMinutes += dtSec / 60;
        } else if (dtSec != null && dtSec > 0) {
          waitingMinutes += dtSec / 60;
        }
      }
    } else {
      // If not enough points, consider all elapsed time as waiting for now (no distance)
      const referenceStart = booking.startedAt || booking.acceptedAt || booking.createdAt;
      if (referenceStart) {
        try {
          const startTs = new Date(referenceStart).getTime();
          if (Number.isFinite(startTs)) {
            waitingMinutes = Math.max(0, (Date.now() - startTs) / 60000);
          }
        } catch (_) {}
      }
    }

    logger.info('[PricingService] Distance calculated:', {
      bookingId,
      distanceTraveled: Math.round(distanceTraveled * 100) / 100,
      locationCount: locations.length
    });

    const referenceStart = booking.startedAt || booking.acceptedAt || booking.createdAt;
    let elapsedMinutes = 0;
    if (referenceStart) {
      try {
        const startTs = new Date(referenceStart).getTime();
        if (Number.isFinite(startTs)) {
          elapsedMinutes = Math.max(0, (Date.now() - startTs) / 60000);
        }
      } catch (_) {}
    }

  const baseFare = Number(pricing.baseFare || 0);
  const perKm = Number(pricing.perKm || 0);
  const perMinute = Number(pricing.perMinute || 0);
  const waitingPerMinute = Number(pricing.waitingPerMinute || 0);
    const surgeMultiplier = Number(pricing.surgeMultiplier || 1) > 0 ? Number(pricing.surgeMultiplier || 1) : 1;
    const minimumFare = Number(pricing.minimumFare || 0);
    const maximumFare = Number(pricing.maximumFare || 0);

    const distanceCostRaw = distanceTraveled * perKm;
    
    // Standard ride-hailing pricing: separate moving time from waiting time
    const timeCostRaw = movingMinutes * perMinute;
    const waitingCostRaw = waitingMinutes * waitingPerMinute;

    let currentFare = (baseFare + distanceCostRaw + timeCostRaw + waitingCostRaw) * surgeMultiplier;
    if (minimumFare > 0 && currentFare < minimumFare) {
      currentFare = minimumFare;
    }
    if (maximumFare > 0 && currentFare > maximumFare) {
      currentFare = maximumFare;
    }

    currentFare = Number(currentFare.toFixed(2));

    // Calculate live fare based on distance traveled
    const fareBreakdown = {
      base: Number(baseFare.toFixed(2)),
      distanceCost: Number(distanceCostRaw.toFixed(2)),
      timeCost: Number(timeCostRaw.toFixed(2)),
      waitingCost: Number(waitingCostRaw.toFixed(2)),
      movingMinutes: Number(movingMinutes.toFixed(2)),
      waitingMinutes: Number(waitingMinutes.toFixed(2)),
      surgeMultiplier,
    };

    const finalFare = currentFare;

    logger.info('[PricingService] Fare calculation completed:', {
      bookingId,
      fareBreakdown: {
        base: fareBreakdown.base,
        distanceCost: Math.round(fareBreakdown.distanceCost * 100) / 100,
        surgeMultiplier: fareBreakdown.surgeMultiplier
      },
      currentFare: Math.round(currentFare * 100) / 100,
      finalFare: Math.round(finalFare * 100) / 100,
      minimumFareApplied: finalFare > currentFare
    });

  const result = {
      bookingId: String(booking._id),
      driverId: booking.driverId ? String(booking.driverId) : undefined,
      passengerId: booking.passengerId ? String(booking.passengerId) : undefined,
      currentLocation,
      distanceTraveled: Math.round(distanceTraveled * 100) / 100, // Round to 2 decimal places
      currentFare: finalFare,
      fareBreakdown: {
        ...fareBreakdown
      },
      elapsedMinutes: Number(elapsedMinutes.toFixed(2)),
      updatedAt: new Date()
    };

    // Broadcast pricing update to relevant rooms and legacy channels
    logger.info('[PricingService] Broadcasting pricing update:', {
      bookingId,
      targetedRooms: {
        booking: `booking:${String(booking._id)}`,
        driver: booking.driverId ? `driver:${String(booking.driverId)}` : null,
        passenger: booking.passengerId ? `passenger:${String(booking.passengerId)}` : null
      },
      result: {
        distanceTraveled: result.distanceTraveled,
        currentFare: result.currentFare,
        updatedAt: result.updatedAt
      }
    });

    emitBookingTargets(
      {
        bookingId: booking._id,
        driverId: booking.driverId ? String(booking.driverId) : undefined,
        passengerId: booking.passengerId ? String(booking.passengerId) : undefined
      },
      'pricing:update',
      result,
      { includeOps: true }
    );

  try {
    booking.currentFare = result.currentFare;
    booking.distanceKm = result.distanceTraveled;
    await booking.save();
  } catch (_) {}

    logger.info('[PricingService] Live pricing calculation completed successfully:', {
      bookingId: String(booking._id),
      driverId: booking.driverId,
      distanceTraveled: result.distanceTraveled,
      currentFare: result.currentFare,
      processingTimeMs: Date.now() - new Date(result.updatedAt).getTime()
    });

    try {
      metrics.increment('pricing.live_calculation_success', 1, {
        vehicleType: booking.vehicleType || 'unknown'
      });
      metrics.timing('pricing.live_calculation_ms', Date.now() - startedAt, {
        vehicleType: booking.vehicleType || 'unknown'
      });
    } catch (_) {}

    return result;
  } catch (error) {
    logger.error('[PricingService] Error calculating live pricing:', {
      bookingId,
      currentLocation,
      error: error.message,
      stack: error.stack,
      timestamp: new Date().toISOString()
    });
    try {
      metrics.increment('pricing.live_calculation_error', 1, {
        reason: error && error.message ? error.message : 'unknown'
      });
    } catch (_) {}
    throw error;
  }
}

async function fetchEtaUsingGoogle({ origin, destination, apiKey }) {
  if (!origin || !destination) {
    const err = new Error('origin and destination are required');
    err.status = 400;
    throw err;
  }
  const { latitude: oLat, longitude: oLng } = origin;
  const { latitude: dLat, longitude: dLng } = destination;
  const base = 'https://maps.googleapis.com/maps/api/distancematrix/json';
  const url = `${base}?origins=${oLat},${oLng}&destinations=${dLat},${dLng}&mode=driving&departure_time=now&traffic_model=best_guess&key=${encodeURIComponent(apiKey)}`;
  const resp = await axios.get(url, { timeout: 6000 });
  const row = resp && resp.data && Array.isArray(resp.data.rows) && resp.data.rows[0] && resp.data.rows[0].elements && resp.data.rows[0].elements[0];
  const status = row && row.status;
  if (!row || status !== 'OK') {
    const reason = status || 'UNKNOWN';
    const err = new Error(`Distance Matrix error: ${reason}`);
    err.code = reason;
    throw err;
  }
  const duration = row.duration_in_traffic || row.duration;
  return {
    etaSeconds: duration && Number.isFinite(duration.value) ? Number(duration.value) : undefined,
    etaText: duration && duration.text ? String(duration.text) : undefined
  };
}

async function calculateAndBroadcastEta({ booking, driverLocation, io }) {
  try {
    if (!booking || !driverLocation) return;
    if (String(booking.status || '').toLowerCase() !== 'ongoing') return; // start ETA only when trip is ongoing
    const GOOGLE_MAPS_API_KEY = process.env.GOOGLE_MAPS_API_KEY || process.env.GMAPS_API_KEY;
    if (!GOOGLE_MAPS_API_KEY) return;

    const dest = (booking.startedAt ? booking.dropoff : booking.pickup) || booking.dropoff || booking.pickup;
    if (!dest || dest.latitude == null || dest.longitude == null) return;

    const origin = { latitude: Number(driverLocation.latitude), longitude: Number(driverLocation.longitude) };
    const destination = { latitude: Number(dest.latitude), longitude: Number(dest.longitude) };

    const { etaSeconds, etaText } = await fetchEtaUsingGoogle({ origin, destination, apiKey: GOOGLE_MAPS_API_KEY });
    if (!etaSeconds) return;

    const payload = {
      bookingId: String(booking._id),
      etaSeconds,
      etaText,
      driverLocation: origin,
      destination
    };
    const roomBooking = `booking:${String(booking._id)}`;
    const roomDriver = booking.driverId ? `driver:${String(booking.driverId)}` : undefined;
    const roomPassenger = booking.passengerId ? `passenger:${String(booking.passengerId)}` : undefined;
    if (io) {
      try { io.to(roomBooking).emit('eta:update', payload); } catch (_) {}
      if (roomDriver) { try { io.to(roomDriver).emit('eta:update', payload); } catch (_) {} }
      if (roomPassenger) { try { io.to(roomPassenger).emit('eta:update', payload); } catch (_) {} }
    }
    try { metrics.increment('eta.update_sent', 1, { vehicleType: booking.vehicleType || 'unknown' }); } catch (_) {}
  } catch (e) {
    try { logger.warn('[eta] calculate/broadcast failed', { error: e && e.message }); } catch (_) {}
    try { metrics.increment('eta.update_error', 1, { reason: e && e.code ? e.code : (e && e.message) || 'unknown' }); } catch (_) {}
  }
}

function broadcastEtaEnded({ booking, io }) {
  try {
    if (!booking || !io) return;
    const payload = {
      bookingId: String(booking._id),
      etaSeconds: 0,
      etaText: 'arrived',
      ended: true
    };
    const roomBooking = `booking:${String(booking._id)}`;
    const roomDriver = booking.driverId ? `driver:${String(booking.driverId)}` : undefined;
    const roomPassenger = booking.passengerId ? `passenger:${String(booking.passengerId)}` : undefined;
    try { io.to(roomBooking).emit('eta:update', payload); } catch (_) {}
    if (roomDriver) { try { io.to(roomDriver).emit('eta:update', payload); } catch (_) {} }
    if (roomPassenger) { try { io.to(roomPassenger).emit('eta:update', payload); } catch (_) {} }
  } catch (_) {}
}

module.exports = { 
  recalcForBooking,
  calculateLivePricing,
  fetchEtaUsingGoogle,
  calculateAndBroadcastEta,
  broadcastEtaEnded
};

