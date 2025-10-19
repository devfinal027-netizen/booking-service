const { haversineKm } = require('./distance');
let logger;
let metrics;
try { logger = require('./logger'); } catch (_) { logger = console; }
try { metrics = require('./metrics'); } catch (_) { metrics = null; }

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
  // Threshold resolution order: explicit options -> new env -> pricing-specific env -> legacy env -> defaults
  const minDistanceMeters = Number(
    (options.minDistanceMeters != null ? options.minDistanceMeters : undefined) ??
    process.env.MIN_MOVE_METERS ??
    process.env.PRICE_DIST_MIN_METERS ??
    process.env.DIST_MIN_METERS ??
    10
  );
  const minDtSeconds = Number(
    (options.minDtSeconds != null ? options.minDtSeconds : undefined) ??
    process.env.BUCKET_TIME_SEC ??
    process.env.PRICE_DIST_MIN_DT_SECONDS ??
    process.env.DIST_MIN_DT_SECONDS ??
    2
  );
  const minSpeedMps = Number(
    (options.minSpeedMps != null ? options.minSpeedMps : undefined) ??
    process.env.MIN_SPEED_MPS ??
    process.env.PRICE_DIST_MIN_SPEED_MPS ??
    process.env.DIST_MIN_SPEED_MPS ??
    0.3
  );
  const smoothingWindow = Number(
    (options.smoothingWindow != null ? options.smoothingWindow : undefined) ??
    process.env.SMOOTHING_WINDOW ?? 0
  );
  const distanceFn = typeof options.distanceFn === 'function'
    ? options.distanceFn // must return meters
    : (a, b) => haversineKm(a, b) * 1000; // fallback uses haversine and converts to meters

  if (!Array.isArray(points) || points.length < 2) return 0;
  const normalized = points.map(normalizePoint).filter(Boolean);
  if (normalized.length < 2) return 0;

  // Optional smoothing with simple moving average over lat/lon
  let series = normalized;
  if (Number.isFinite(smoothingWindow) && smoothingWindow >= 3) {
    const w = Math.min(Math.max(3, Math.floor(smoothingWindow)), 9);
    const smoothed = [];
    let sumLat = 0;
    let sumLon = 0;
    const queue = [];
    for (let i = 0; i < normalized.length; i++) {
      const p = normalized[i];
      queue.push(p);
      sumLat += p.latitude;
      sumLon += p.longitude;
      if (queue.length > w) {
        const drop = queue.shift();
        sumLat -= drop.latitude;
        sumLon -= drop.longitude;
      }
      const count = queue.length;
      smoothed.push({
        latitude: sumLat / count,
        longitude: sumLon / count,
        timestamp: p.timestamp,
        speed: p.speed,
        source: p.source,
      });
    }
    series = smoothed;
  }

  // Bucketed gating: accumulate until either distance or time threshold is reached
  let totalMeters = 0;
  let bucketMeters = 0;
  let bucketDtSec = 0;

  // Diagnostics counters (optional): enable via DIST_DEBUG=1
  const debug = process.env.DIST_DEBUG === '1' || options.debug;
  let rejectedByDistance = 0;
  let rejectedByTime = 0;
  let rejectedBySpeed = 0;
  let acceptedBuckets = 0;

  for (let i = 1; i < series.length; i++) {
    const a = series[i - 1];
    const b = series[i];
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
    const bucketSpeedMps = bucketDtSec > 0 ? bucketMeters / bucketDtSec : undefined;
    const passesSpeed = bucketSpeedMps == null || bucketSpeedMps >= minSpeedMps; // use bucket average speed

    if (passesSpeed && (passesDistance || passesTime)) {
      totalMeters += bucketMeters;
      bucketMeters = 0;
      bucketDtSec = 0;
      acceptedBuckets++;
    } else if (debug) {
      if (!passesSpeed) rejectedBySpeed++;
      if (!passesDistance) rejectedByDistance++;
      if (!passesTime) rejectedByTime++;
    }
  }

  if (debug && logger && typeof logger.info === 'function') {
    try { logger.info('[distance] debug', { rejectedByDistance, rejectedByTime, rejectedBySpeed, acceptedBuckets, totalMeters }); } catch (_) {}
  }

  if (process.env.DIST_METRICS === '1' && metrics && typeof metrics.increment === 'function') {
    try {
      metrics.increment('distance.compute.invocations', 1, { source: 'computePathDistance' });
      if (acceptedBuckets) metrics.increment('distance.bucket.accept', acceptedBuckets, { source: 'computePathDistance' });
      const totalRejected = rejectedByDistance + rejectedByTime + rejectedBySpeed;
      if (totalRejected) metrics.increment('distance.bucket.reject', totalRejected, { source: 'computePathDistance' });
    } catch (_) {}
  }
  const totalKm = totalMeters / 1000;
  return Math.round(totalKm * 1000_000) / 1000_000; // micro-km precision
}

module.exports = { computePathDistance };
