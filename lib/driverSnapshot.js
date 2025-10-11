const { Driver } = require('../models/userModels');
const logger = require('../utils/logger');

const DRIVER_PROJECTION = {
  name: 1,
  phone: 1,
  email: 1,
  vehicleType: 1,
  carName: 1,
  carModel: 1,
  carPlate: 1,
  carColor: 1,
  rating: 1
};

function getPath(source, path) {
  if (!source || !path) return undefined;
  if (typeof path !== 'string') return undefined;
  return path.split('.').reduce((acc, segment) => (acc && acc[segment] != null ? acc[segment] : undefined), source);
}

function pick(source, keys) {
  if (!source) return undefined;
  for (const key of keys) {
    const value = key.includes('.') ? getPath(source, key) : source[key];
    if (value != null && value !== '') return value;
  }
  return undefined;
}

function sanitizeSnapshot(snapshot) {
  return Object.fromEntries(
    Object.entries(snapshot)
      .filter(([, value]) => value != null && value !== '')
      .map(([key, value]) => [key, typeof value === 'string' ? value.trim() : value])
  );
}

async function fetchDriverDoc(driverId) {
  try {
    return await Driver.findById(driverId).select(DRIVER_PROJECTION).lean();
  } catch (err) {
    try { logger.warn('[driverSnapshot] fetch failed', { driverId, error: err && err.message }); } catch (_) {}
    return null;
  }
}

async function buildDriverSnapshot(driverId, { source, fallbackUser, fallbackVehicleType } = {}) {
  if (!driverId) return undefined;
  let doc = source;
  if (doc && typeof doc.toObject === 'function') {
    doc = doc.toObject();
  }
  if (!doc) {
    doc = await fetchDriverDoc(driverId);
  }

  const fallback = fallbackUser || {};
  const snapshot = {
    id: String(driverId),
    name: pick(doc, ['name', 'fullName']) || pick(fallback, ['name', 'fullName', 'displayName', 'user.name']),
    phone: pick(doc, ['phone', 'phoneNumber', 'mobile']) || pick(fallback, ['phone', 'phoneNumber', 'mobile', 'user.phone']),
    email: pick(doc, ['email']) || pick(fallback, ['email', 'user.email']),
    vehicleType: pick(doc, ['vehicleType']) || pick(fallback, ['vehicleType', 'user.vehicleType']) || fallbackVehicleType,
    carName: pick(doc, ['carName', 'vehicleName']) || pick(fallback, ['carName', 'vehicleName']),
    carModel: pick(doc, ['carModel']) || pick(fallback, ['carModel']),
    carPlate: pick(doc, ['carPlate', 'carPlateNumber', 'plateNumber', 'plate', 'car_plate']) || pick(fallback, ['carPlate', 'carPlateNumber', 'plateNumber', 'plate', 'car_plate']),
    carColor: pick(doc, ['carColor', 'vehicleColor', 'color']) || pick(fallback, ['carColor', 'vehicleColor', 'color']),
    rating: pick(doc, ['rating'])
  };

  return sanitizeSnapshot(snapshot);
}

module.exports = { buildDriverSnapshot };
