const { Driver } = require('../models/userModels');

// Static payment partners (normalization removed) - provided by user
const ALLOWED_PAYMENT_METHODS = [
  { id: 'telebirr', name: 'Telebirr', description: 'Telebirr is a mobile money service provider in Ethiopia', input: 'phone number', type: 'MOBILE_MONEY' },
  { id: 'cbebirr', name: 'Cbe Birr', description: 'CBE Birr is a mobile money service provider in Ethiopia', input: 'phone number', type: 'MOBILE_MONEY' },
  { id: 'mpesa', name: 'Mpesa', description: 'Mpsea is a mobile money service provider in Ethiopia by Safaricom', input: 'phone number', type: 'MOBILE_MONEY' },
  { id: 'cbe', name: 'Commercial Bank of Ethiopia', description: 'Commercial Bank of Ethiopia is the largest bank Ethiopia', input: 'account number,phone number', type: 'BANK' },
  { id: 'D‑MONEY', name: 'D‑Money', description: 'Mobile money in Djibouti', input: 'phone number', type: 'MOBILE_MONEY' },
  { id: 'WAFFI', name: 'Waffi', description: 'Mobile money in Djibouti', input: 'phone number', type: 'MOBILE_MONEY' },
  { id: 'CAC', name: 'CAC', description: 'Mobile money in Djibouti', input: 'phone number', type: 'MOBILE_MONEY' }
];

function normalizeId(v) {
  return String(v || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');
}

function findMethodByIdLoose(id) {
  const target = normalizeId(id);
  return ALLOWED_PAYMENT_METHODS.find(m => normalizeId(m.id) === target) || null;
}

async function getPaymentOptions() {
  return ALLOWED_PAYMENT_METHODS;
}

async function createPaymentOption() {
  const err = new Error('Payment options are fixed and cannot be created');
  err.status = 405;
  throw err;
}

async function setDriverPaymentPreference(driverId, paymentOptionId, options = {}) {
  const logger = require('../utils/logger');
  // Accept paymentOptionId as method id (normalization removed)
  const opt = findMethodByIdLoose(paymentOptionId);
  if (!opt) { const e = new Error('Payment option not found'); e.status = 404; throw e; }

  // Try update by internal id - add to paymentPreferences array if not already present
  let updated = await Driver.findByIdAndUpdate(
    String(driverId), 
    { $addToSet: { paymentPreferences: opt.id } }, 
    { new: true }
  );

  // Fallback: by externalId if internal id did not match
  if (!updated) {
    try { logger.info('[payment] driver not found by _id, trying externalId', { driverId }); } catch (_) {}
    const existingByExternal = await Driver.findOne({ externalId: String(driverId) }).select({ _id: 1 }).lean();
    if (existingByExternal && existingByExternal._id) {
      updated = await Driver.findByIdAndUpdate(
        String(existingByExternal._id), 
        { $addToSet: { paymentPreferences: opt.id } }, 
        { new: true }
      );
    }
  }

  // Final fallback: upsert from external user-service and retry
  if (!updated) {
    try {
      const { getDriverById } = require('../integrations/userServiceClient');
      const authHeader = options && options.headers ? options.headers.Authorization : undefined;
      try { logger.info('[payment] fetching driver from user-service', { driverId, hasAuth: !!authHeader }); } catch (_) {}
      const ext = await getDriverById(String(driverId), { headers: authHeader ? { Authorization: authHeader } : {} });
      if (ext && ext.id) {
        // Create or update the local driver record using external details
        const payload = {
          _id: String(ext.id),
          externalId: String(ext.id),
          name: ext.name,
          phone: ext.phone,
          email: ext.email,
          vehicleType: ext.vehicleType,
          lastKnownLocation: ext.lastKnownLocation,
          rating: Number.isFinite(ext.rating) ? ext.rating : 5.0
        };
        try { logger.info('[payment] upserting driver from user-service', { _id: payload._id, hasPhone: !!payload.phone }); } catch (_) {}
        await Driver.updateOne({ _id: String(ext.id) }, { $set: payload }, { upsert: true });
        updated = await Driver.findByIdAndUpdate(
          String(ext.id), 
          { $addToSet: { paymentPreferences: opt.id } }, 
          { new: true }
        );
      } else {
        try { logger.warn('[payment] user-service did not return driver', { driverId }); } catch (_) {}
      }
    } catch (e) {
      try { logger.error('[payment] user-service fetch failure', e); } catch (_) {}
    }
  }

  // Absolute last resort: upsert minimal local record AND set preference atomically
  if (!updated) {
    const minimalId = String(driverId);
    try { logger.warn('[payment] creating minimal local driver record', { driverId: minimalId }); } catch (_) {}
    updated = await Driver.findOneAndUpdate(
      { _id: minimalId },
      { 
        $setOnInsert: { _id: minimalId, externalId: minimalId, rating: 5.0 },
        $addToSet: { paymentPreferences: opt.id }
      },
      { new: true, upsert: true }
    );
  }

  if (!updated) {
    const err = new Error('Driver not found');
    try { logger.error('[payment] failed to set payment preference for driver', { driverId, paymentOptionId }); } catch (_) {}
    err.status = 404;
    throw err;
  }
  return updated;
}

async function removeDriverPaymentPreference(driverId, paymentOptionId, options = {}) {
  const logger = require('../utils/logger');
  const opt = findMethodByIdLoose(paymentOptionId);
  if (!opt) { const e = new Error('Payment option not found'); e.status = 404; throw e; }

  // Try update by internal id - remove from paymentPreferences array
  let updated = await Driver.findByIdAndUpdate(
    String(driverId), 
    { $pull: { paymentPreferences: opt.id } }, 
    { new: true }
  );

  // Fallback: by externalId if internal id did not match
  if (!updated) {
    try { logger.info('[payment] driver not found by _id, trying externalId', { driverId }); } catch (_) {}
    const existingByExternal = await Driver.findOne({ externalId: String(driverId) }).select({ _id: 1 }).lean();
    if (existingByExternal && existingByExternal._id) {
      updated = await Driver.findByIdAndUpdate(
        String(existingByExternal._id), 
        { $pull: { paymentPreferences: opt.id } }, 
        { new: true }
      );
    }
  }

  if (!updated) {
    const err = new Error('Driver not found');
    try { logger.error('[payment] failed to remove payment preference for driver', { driverId, paymentOptionId }); } catch (_) {}
    err.status = 404;
    throw err;
  }
  return updated;
}

module.exports = { getPaymentOptions, setDriverPaymentPreference, removeDriverPaymentPreference, createPaymentOption };

