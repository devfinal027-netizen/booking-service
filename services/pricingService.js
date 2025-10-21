const { Pricing } = require('../models/pricing');

async function calculateFare(distanceKm, waitingTimeMinutes, vehicleType, surgeMultiplier, discount = 0) {
  const vehicle = (vehicleType || 'mini').toLowerCase();
  const pricing = await Pricing.findOne({ vehicleType: vehicle, isActive: true }).sort({ updatedAt: -1 });

  if (!pricing) {
    const fallbackRatePerKm = 0.5;
    const fallbackWaitingRate = 0.1;
    let fallbackFare = (Number(distanceKm || 0) * fallbackRatePerKm) + (Number(waitingTimeMinutes || 0) * fallbackWaitingRate);
  let fallbackMultiplier = surgeMultiplier != null ? Number(surgeMultiplier) : 1;
  if (!Number.isFinite(fallbackMultiplier) || fallbackMultiplier <= 0) fallbackMultiplier = 1;
  fallbackFare *= fallbackMultiplier;
    fallbackFare -= Number(discount || 0);
    return Math.max(Number(fallbackFare.toFixed(2)), 2);
  }

  const baseFare = Number(pricing.baseFare || 0);
  const perKm = Number(pricing.perKm || 0);
  const perMinute = Number(pricing.perMinute || 0);
  const waitingPerMinute = Number(pricing.waitingPerMinute || 0);
  const minimumFare = Number(pricing.minimumFare || 0);
  const enforceMaxFare = process.env.ENFORCE_MAX_FARE === '1';
  const maximumFare = enforceMaxFare ? Number(pricing.maximumFare || 0) : 0;
  const multiplierSource = surgeMultiplier != null ? surgeMultiplier : (pricing.surgeMultiplier || 1);
  let multiplier = Number(multiplierSource);
  if (!Number.isFinite(multiplier) || multiplier <= 0) {
    multiplier = 1;
  }

  const distanceCost = Number(distanceKm || 0) * perKm;
  const timeMinutes = Number(waitingTimeMinutes || 0);
  const timeCost = timeMinutes * perMinute;
  const waitingCost = timeMinutes * waitingPerMinute;

  let fare = (baseFare + distanceCost + timeCost + waitingCost) * multiplier;
  fare -= Number(discount || 0);

  if (minimumFare > 0) {
    fare = Math.max(fare, minimumFare);
  }
  if (enforceMaxFare && maximumFare > 0) {
    fare = Math.min(fare, maximumFare);
  }

  return Number(Math.max(fare, 0).toFixed(2));
}

module.exports = { calculateFare };

