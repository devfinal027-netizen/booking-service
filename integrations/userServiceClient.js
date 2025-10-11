const axios = require('axios');
const logger = require('../utils/logger');

function buildUrlFromTemplate(template, params) {
  if (!template) return null;
  const allParams = params || {};
  let result = template;
  // Replace single-brace placeholders: {key}
  Object.keys(allParams).forEach((key) => {
    const value = allParams[key];
    const encoded = key === 'baseUrl' ? String(value) : encodeURIComponent(String(value));
    result = result.replace(new RegExp(`{${key}}`, 'g'), encoded);
  });
  // Replace mustache placeholders: {{ key }}
  Object.keys(allParams).forEach((key) => {
    const value = allParams[key];
    const encoded = key === 'baseUrl' ? String(value) : encodeURIComponent(String(value));
    result = result.replace(new RegExp(`\\{\\{\\s*${key}\\s*\\}}`, 'g'), encoded);
  });
  return result;
}

function getAuthHeaders(tokenOrHeader) {
  const headers = { 'Accept': 'application/json' };
  if (tokenOrHeader) {
    if (typeof tokenOrHeader === 'string') {
      headers['Authorization'] = tokenOrHeader.startsWith('Bearer ') ? tokenOrHeader : `Bearer ${tokenOrHeader}`;
    } else if (typeof tokenOrHeader === 'object' && tokenOrHeader.Authorization) {
      headers['Authorization'] = tokenOrHeader.Authorization;
    }
  } else if (process.env.AUTH_SERVICE_BEARER) {
    headers['Authorization'] = `Bearer ${process.env.AUTH_SERVICE_BEARER}`;
  }
  return headers;
}

async function httpGet(url, headers) {
  const timeout = parseInt(process.env.USER_SERVICE_TIMEOUT_MS || process.env.HTTP_TIMEOUT_MS || '5000');
  const safeHeaders = headers && headers.Authorization ? { hasAuth: true } : { hasAuth: false };
  try {
    logger.info('[external.httpGet] ->', { url, ...safeHeaders, timeout });
    const res = await axios.get(url, { headers, timeout });
    logger.info('[external.httpGet] <-', { url, status: res.status });
    return res.data;
  } catch (e) {
    const status = e.response?.status;
    const message = e.response?.data?.message || e.message;
    logger.error('[external.httpGet] x', { url, status, message });
    throw e;
  }
}

async function httpPost(url, body, headers) {
  const timeout = parseInt(process.env.USER_SERVICE_TIMEOUT_MS || process.env.HTTP_TIMEOUT_MS || '5000');
  const hdrs = { 'Content-Type': 'application/json', ...(headers || {}) };
  const safeHeaders = hdrs.Authorization ? { hasAuth: true } : { hasAuth: false };
  try {
    logger.info('[external.httpPost] ->', { url, ...safeHeaders, timeout });
    const res = await axios.post(url, body, { headers: hdrs, timeout });
    logger.info('[external.httpPost] <-', { url, status: res.status });
    return res.data;
  } catch (e) {
    const status = e.response?.status;
    const message = e.response?.data?.message || e.message;
    logger.error('[external.httpPost] x', { url, status, message });
    throw e;
  }
}

// Low-level helpers driven by env configuration
function getAuthBase() {
  return (process.env.AUTH_BASE_URL || 'http://localhost:3000').replace(/\/$/, '');
}

// Replace ${ENV_VAR} placeholders in templates with environment values
function expandEnvPlaceholders(template) {
  if (!template) return template;
  return template.replace(/\$\{([A-Z0-9_]+)\}/g, (match, key) => {
    if (key === 'AUTH_BASE_URL') return getAuthBase();
    const value = process.env[key];
    return value != null ? String(value) : '';
  });
}

function getTemplate(name) {
  const tpl = process.env[name] || null;
  return expandEnvPlaceholders(tpl);
}

// External-only API (auth service)
async function getPassengerDetails(id, token) {
  try {
    const tpl = getTemplate('PASSENGER_LOOKUP_URL_TEMPLATE') || `${getAuthBase()}/passengers/{id}`;
    const url = buildUrlFromTemplate(tpl, { id, passengerId: id, baseUrl: getAuthBase() });
    logger.info('[external.passenger.get] request', { id: String(id), url });
    const data = await httpGet(url, getAuthHeaders(token));
    const u = data?.data || data?.user || data?.passenger || data;
    return { success: true, user: { id: String(u.id || u._id || id), name: u.name, phone: u.phone, email: u.email, externalId: u.externalId } };
  } catch (e) {
    const status = e.response?.status;
    const message = e.response?.data?.message || e.message;
    // Fallback: if forbidden using user token, retry with service bearer if available
    if (status === 403) {
      try {
        const tpl = getTemplate('PASSENGER_LOOKUP_URL_TEMPLATE') || `${getAuthBase()}/passengers/{id}`;
        const url = buildUrlFromTemplate(tpl, { id, passengerId: id, baseUrl: getAuthBase() });
        logger.info('[external.passenger.get] retry with service token', { id: String(id), url });
        const data = await httpGet(url, getAuthHeaders(/* no user token -> service bearer */));
        const u = data?.data || data?.user || data?.passenger || data;
        return { success: true, user: { id: String(u.id || u._id || id), name: u.name, phone: u.phone, email: u.email, externalId: u.externalId } };
      } catch (e2) {
        const message2 = e2.response?.data?.message || e2.message;
        logger.error('[external.passenger.get] error', { id: String(id), message: message2 });
        return { success: false, message: message2 };
      }
    }
    logger.error('[external.passenger.get] error', { id: String(id), message });
    return { success: false, message };
  }
}

async function getDriverDetails(id, token) {
  try {
    const tpl = getTemplate('DRIVER_LOOKUP_URL_TEMPLATE') || `${getAuthBase()}/drivers/{id}`;
    const url = buildUrlFromTemplate(tpl, { id, driverId: id, baseUrl: getAuthBase() });
    logger.info('[external.driver.get] request', { id: String(id), url });
    const data = await httpGet(url, getAuthHeaders(token));
    const u = data?.data || data?.user || data?.driver || data;
    return { success: true, user: { id: String(u.id || u._id || id), name: u.name, phone: u.phone, email: u.email, externalId: u.externalId, vehicleType: u.vehicleType, carPlate: u.carPlate, carModel: u.carModel, carColor: u.carColor, rating: u.rating, available: u.available, lastKnownLocation: u.lastKnownLocation, paymentPreference: u.paymentPreference,} };
  } catch (e) {
    const status = e.response?.status;
    const message = e.response?.data?.message || e.message;
    // Fallback: if detail lookup 404s, try searching via list endpoint
    if (status === 404) {
      try {
        const base = getAuthBase();
        const headers = getAuthHeaders(token);
        const buildListUrl = (params = {}) => {
          const u = new URL(`${base}/drivers`);
          // Ask for a large page to increase hit chance when unfiltered
          if (!('limit' in params)) u.searchParams.set('limit', '1000');
          Object.entries(params).forEach(([k, v]) => { if (v != null) u.searchParams.set(k, String(v)); });
          return u.toString();
        };
        logger.info('[external.driver.get] fallback search', { id: String(id) });
        // Try common query keys first to avoid large payloads
        const queryCandidates = [
          { id },
          { driverId: id },
          { externalId: id },
          { userId: id },
        ];
        let found = null;
        for (const params of queryCandidates) {
          try {
            const listData = await httpGet(buildListUrl(params), headers);
            const arr = Array.isArray(listData?.data) ? listData.data : Array.isArray(listData) ? listData : [];
            found = (arr || []).find((u) => {
              const candidates = [u.id, u._id, u.externalId, u.driverId, u.userId];
              return candidates.some((val) => val != null && String(val) === String(id));
            });
            if (found) break;
          } catch (_) { /* ignore and try next */ }
        }
        // Final fallback: fetch list with no filters and search locally
        if (!found) {
          try {
            const listData = await httpGet(buildListUrl(), headers);
            const arr = Array.isArray(listData?.data) ? listData.data : Array.isArray(listData) ? listData : [];
            found = (arr || []).find((u) => {
              const candidates = [u.id, u._id, u.externalId, u.driverId, u.userId];
              return candidates.some((val) => val != null && String(val) === String(id));
            });
          } catch (_) { /* ignore */ }
        }
        if (found) {
          return { success: true, user: { id: String(found.id || found._id || id), name: found.name, phone: found.phone, email: found.email, externalId: found.externalId, vehicleType: found.vehicleType, carPlate: found.carPlate, carModel: found.carModel, carColor: found.carColor, rating: found.rating, available: found.available, lastKnownLocation: found.lastKnownLocation, paymentPreference: found.paymentPreference } };
        }
      } catch (fallbackErr) {
        logger.error('[external.driver.get] fallback error', { id: String(id), message: fallbackErr.response?.data?.message || fallbackErr.message });
      }
    }
    logger.error('[external.driver.get] error', { id: String(id), message });
    return { success: false, message };
  }
}

async function getDriverById(id, options) {
  const token = options && options.headers ? options.headers.Authorization : undefined;
  let res = await getDriverDetails(id, token);
  if (!res.success) return null;
  return {
    id: String(res.user.id),
    name: res.user.name,
    phone: res.user.phone,
    email: res.user.email,
    vehicleType: res.user.vehicleType,
    carPlate: res.user.carPlate,
    carModel: res.user.carModel,
    carColor: res.user.carColor,
    rating: res.user.rating,
    available: res.user.available,
    lastKnownLocation: res.user.lastKnownLocation,
    paymentPreference: res.user.paymentPreference,
  };
}

async function getPassengerById(id, options) {
  const token = options && options.headers ? options.headers.Authorization : undefined;
  const res = await getPassengerDetails(id, token);
  if (!res.success) return null;
  return { 
    id: String(res.user.id), 
    name: res.user.name, 
    phone: res.user.phone, 
    email: res.user.email,
    externalId: res.user.externalId,
    vehicleType: res.user.vehicleType,
    paymentPreference: res.user.paymentPreference
  };
}

async function getDriversByIds(ids = [], token) {
  try {
    const base = getAuthBase();
    const url = `${base}/drivers/batch`;
    const data = await httpPost(url, { ids }, getAuthHeaders(token));
    const arr = Array.isArray(data?.data) ? data.data : Array.isArray(data) ? data : [];
    return arr.map((u) => ({
      id: String(u.id || u._id || ''),
      name: u.name,
      phone: u.phone,
      email: u.email,
      vehicleType: u.vehicleType,
      carName: u.carName || u.carModel || u.vehicleName,
      carModel: u.carModel,
      carPlate: u.carPlate,
      carColor: u.carColor,
      rating: u.rating,
      available: u.available,
      paymentPreference: u.paymentPreference
    }));
  } catch (e) { return []; }
}

async function listDrivers(query = {}, options) {
  try {
    const base = getAuthBase();
    const url = new URL(`${base}/drivers`);
    Object.entries(query || {}).forEach(([k, v]) => { if (v != null) url.searchParams.set(k, v); });
    const token = options && options.headers ? options.headers.Authorization : undefined;
    let data = await httpGet(url.toString(), getAuthHeaders(token));
    const arr = Array.isArray(data?.data) ? data.data : Array.isArray(data) ? data : [];
    return arr.map(u => ({ id: String(u.id || u._id || ''), name: u.name, phone: u.phone, email: u.email, vehicleType: u.vehicleType, carPlate: u.carPlate, rating: u.rating, available: u.available, paymentPreference: u.paymentPreference }));
  } catch (_) { return []; }
}

async function listPassengers(query = {}, options) {
  try {
    const base = getAuthBase();
    const url = new URL(`${base}/passengers`);
    Object.entries(query || {}).forEach(([k, v]) => { if (v != null) url.searchParams.set(k, v); });
    const data = await httpGet(url.toString(), getAuthHeaders(options && options.headers ? options.headers.Authorization : undefined));
    const arr = Array.isArray(data?.data) ? data.data : Array.isArray(data) ? data : [];
    return arr.map(u => ({ id: String(u.id || u._id || ''), name: u.name, phone: u.phone, email: u.email }));
  } catch (_) { return []; }
}

async function getStaffById(id) {
  try {
    const base = getAuthBase();
    const url = `${base}/staff/${encodeURIComponent(String(id))}`;
    const data = await httpGet(url, getAuthHeaders());
    const u = data?.data || data || {};
    return { id: String(u.id || u._id || id), name: u.name, phone: u.phone };
  } catch (_) { return null; }
}

async function listStaff(query = {}) {
  try {
    const base = getAuthBase();
    const url = new URL(`${base}/staff`);
    Object.entries(query || {}).forEach(([k, v]) => { if (v != null) url.searchParams.set(k, v); });
    const data = await httpGet(url.toString(), getAuthHeaders());
    const arr = Array.isArray(data?.data) ? data.data : Array.isArray(data) ? data : [];
    return arr.map(u => ({ id: String(u.id || u._id || ''), name: u.name, phone: u.phone }));
  } catch (_) { return []; }
}

async function getAdminById(id) {
  try {
    const base = getAuthBase();
    const url = `${base}/admins/${encodeURIComponent(String(id))}`;
    const data = await httpGet(url, getAuthHeaders());
    const u = data?.data || data || {};
    return { id: String(u.id || u._id || id), name: u.name, phone: u.phone };
  } catch (_) { return null; }
}

async function listAdmins(query = {}) {
  try {
    const base = getAuthBase();
    const url = new URL(`${base}/admins`);
    Object.entries(query || {}).forEach(([k, v]) => { if (v != null) url.searchParams.set(k, v); });
    const data = await httpGet(url.toString(), getAuthHeaders());
    const arr = Array.isArray(data?.data) ? data.data : Array.isArray(data) ? data : [];
    return arr.map(u => ({ id: String(u.id || u._id || ''), name: u.name, phone: u.phone }));
  } catch (_) { return []; }
}

module.exports = {
  // high level
  getPassengerDetails,
  getDriverDetails,
  getDriversByIds,
  // compatibility with existing controllers
  getPassengerById,
  getDriverById,
  listDrivers,
  listPassengers,
  getStaffById,
  listStaff,
  getAdminById,
  listAdmins
};
