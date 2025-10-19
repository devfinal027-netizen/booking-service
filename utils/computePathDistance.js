const { haversineKm } = require('./distance');

function isFiniteNumber(n) {
  return typeof n === 'number' && Number.isFinite(n);
}

function normalizePoint(p) {
  if (!p) return null;
  const lat = isFiniteNumber(p.lat) ? p.lat : (isFiniteNumber(p.latitude) ? p.latitude : undefined);
  const lngLike = isFiniteNumber(p.lng) ? p.lng : (isFiniteNumber(p.lon) ? p.lon : (isFiniteNumber(p.longitude) ? p.longitude : undefined));
  if (!isFiniteNumber(lat) || !isFiniteNumber(lngLike)) return null;
  const timestamp = p.timestamp ? new Date(p.timestamp) : (p.recordedAt ? new Date(p.recordedAt) : undefined);
  return {
    latitude: lat,
    longitude: lngLike,
    timestamp: timestamp && Number.isFinite(timestamp.getTime()) ? timestamp : undefined,
    speed: isFiniteNumber(p.speed) ? p.speed : undefined,
    source: p.source || undefined,
  };
}

/**
 * Compute total path distance applying gating to suppress GPS noise.
 * options:
 *  - minDistanceMeters (default 25)
 *  - minDtSeconds (default 5)
 *  - minSpeedMps (default 1)
 */
function computePathDistance(points, options = {}) {
  const minDistanceMeters = Number(process.env.DIST_MIN_METERS || options.minDistanceMeters || 25);
  const minDtSeconds = Number(process.env.DIST_MIN_DT_SECONDS || options.minDtSeconds || 5);
  const minSpeedMps = Number(process.env.DIST_MIN_SPEED_MPS || options.minSpeedMps || 1);
  const distanceFn = typeof options.distanceFn === 'function'
    ? options.distanceFn // must return meters
    : (a, b) => haversineKm(a, b) * 1000; // fallback uses haversine and converts to meters

  if (!Array.isArray(points) || points.length < 2) return 0;
  const normalized = points.map(normalizePoint).filter(Boolean);
  if (normalized.length < 2) return 0;

  // Bucketed gating: accumulate until either distance or time threshold is reached
  let totalMeters = 0;
  let bucketMeters = 0;
  let bucketDtSec = 0;

  // Diagnostics counters (optional): enable via DIST_DEBUG=1
  const debug = process.env.DIST_DEBUG === '1' || options.debug;
  let rejectedByDistance = 0;
  let rejectedByTime = 0;
  let rejectedBySpeed = 0;

  for (let i = 1; i < normalized.length; i++) {
    const a = normalized[i - 1];
    const b = normalized[i];
    const meters = distanceFn({ latitude: a.latitude, longitude: a.longitude }, { latitude: b.latitude, longitude: b.longitude });
    if (!isFiniteNumber(meters)) continue;

    let dtSec;
    const t1 = a.timestamp && a.timestamp.getTime();
    const t2 = b.timestamp && b.timestamp.getTime();
    if (Number.isFinite(t1) && Number.isFinite(t2)) {
      dtSec = Math.max(0, (t2 - t1) / 1000);
    }
    const speedMps = dtSec && dtSec > 0 ? meters / dtSec : undefined;

    bucketMeters += meters;
    bucketDtSec += dtSec || 0;
    const passesDistance = bucketMeters >= minDistanceMeters;
    const passesTime = bucketDtSec >= minDtSeconds; // allow accumulation
    const passesSpeed = speedMps == null || speedMps >= minSpeedMps; // tolerate missing timestamps

    if (passesSpeed && (passesDistance || passesTime)) {
      totalMeters += bucketMeters;
      bucketMeters = 0;
      bucketDtSec = 0;
    } else if (debug) {
      if (!passesSpeed) rejectedBySpeed++;
      if (!passesDistance) rejectedByDistance++;
      if (!passesTime) rejectedByTime++;
    }
  }

  if (debug && typeof console !== 'undefined') {
    try {
      // eslint-disable-next-line no-console
      console.log('[distance] debug', { rejectedByDistance, rejectedByTime, rejectedBySpeed });
    } catch (_) {}
  }
  const totalKm = totalMeters / 1000;
  return Math.round(totalKm * 1000_000) / 1000_000; // micro-km precision
}

module.exports = { computePathDistance };
