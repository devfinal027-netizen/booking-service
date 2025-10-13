const axios = require('axios');

function getAuthBaseUrl() {
  return process.env.AUTH_BASE_URL || process.env.AUTH_SERVICE_URL || '';
}

function getIntrospectUrl() {
  const tpl = process.env.AUTH_INTROSPECT_URL_TEMPLATE || `${getAuthBaseUrl()}/auth/introspect`;
  return tpl.replace('${AUTH_BASE_URL}', getAuthBaseUrl());
}

function buildAuthHeaders(authorizationHeader) {
  const headers = { Accept: 'application/json' };
  if (authorizationHeader) {
    headers.Authorization = authorizationHeader.startsWith('Bearer ') ? authorizationHeader : `Bearer ${authorizationHeader}`;
  } else if (process.env.AUTH_SERVICE_BEARER) {
    headers.Authorization = `Bearer ${process.env.AUTH_SERVICE_BEARER}`;
  }
  return headers;
}

function normalizeUser(payload) {
  if (!payload || typeof payload !== 'object') return null;
  const baseUser = payload.user || payload.data || payload;
  const idCandidates = [
    baseUser && (baseUser.id || baseUser.userId || baseUser._id || baseUser.sub),
  ].filter((v) => v !== undefined && v !== null && v !== '');

  const typeCandidates = [
    baseUser && (baseUser.type || baseUser.role),
    payload.type,
    payload.role,
  ].filter(Boolean);

  const roles = Array.isArray(baseUser?.roles)
    ? baseUser.roles
    : (typeof baseUser?.roles === 'string' ? [baseUser.roles] : []);

  const normalized = {
    id: idCandidates.length > 0 ? String(idCandidates[0]) : undefined,
    type: typeCandidates.length > 0 ? String(typeCandidates[0]).toLowerCase() : undefined,
    roles,
    permissions: baseUser?.permissions || [],
    name: baseUser?.name || null,
    phone: baseUser?.phone || null,
    email: baseUser?.email || null,
    vehicle_info: baseUser?.vehicle_info || null,
  };
  return normalized;
}

async function introspectToken(authorizationHeader) {
  const url = getIntrospectUrl();
  const timeout = parseInt(process.env.AUTH_INTROSPECT_TIMEOUT_MS || process.env.HTTP_TIMEOUT_MS || '5000');
  try {
    const res = await axios.post(url, {}, { headers: buildAuthHeaders(authorizationHeader), timeout });
    const data = res?.data || {};
    // Common patterns: { active: true, user: {...} } OR direct payload
    if (data.active === false) return null;
    const payload = data.user || data.data || data.payload || data;
    const user = normalizeUser(payload);
    return user || null;
  } catch (err) {
    return null;
  }
}

module.exports = {
  introspectToken,
};


