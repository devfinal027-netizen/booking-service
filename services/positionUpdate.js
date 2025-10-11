const mongoose = require('mongoose');
const { Live } = require('../models/bookingModels');
const { emitToRooms } = require('../sockets/utils');
const logger = require('../utils/logger');
const metrics = require('../utils/metrics');

const { Types } = mongoose;

const OPS_ROOM = 'ops:booking';
const DEFAULT_INTERVAL_MS = Number(process.env.POSITION_UPDATE_INTERVAL_MS || 5000);
const CHANGE_STREAMS_ENABLED = process.env.LIVE_USE_CHANGE_STREAMS !== 'false';

function toObjectIdOrValue(id) {
  if (Types && typeof Types.ObjectId === 'function' && Types.ObjectId.isValid(id)) {
    try {
      return new Types.ObjectId(id);
    } catch (_) {}
  }
  return id;
}

function isChangeStream(cursor) {
  return cursor && typeof cursor.on === 'function' && typeof cursor.close === 'function';
}

class PositionUpdateService {
  constructor() {
    this.intervalHandles = new Map();
    this.watchers = new Map();
    this.isRunning = false;
    this.intervalMs = DEFAULT_INTERVAL_MS;
    this.useChangeStreams = CHANGE_STREAMS_ENABLED;
  }

  start() {
    if (this.isRunning) return;
    this.isRunning = true;
    try {
      logger.info('[positionUpdate] service started', {
        intervalMs: this.intervalMs,
        changeStreams: this.useChangeStreams
      });
    } catch (_) {}
  }

  stop() {
    if (!this.isRunning) return;

    this.intervalHandles.forEach((interval) => {
      clearInterval(interval);
    });
    this.intervalHandles.clear();

    this.watchers.forEach((watcher, tripId) => {
      if (!watcher) return;
      try {
        watcher.stream.removeAllListeners();
        watcher.stream.close();
      } catch (_) {}
    });
    this.watchers.clear();

    this.isRunning = false;
    try { logger.info('[positionUpdate] service stopped'); } catch (_) {}
  }

  // Start tracking position updates for a trip
  startTracking(tripId, driverId, passengerId) {
    if (!this.isRunning) this.start();

    if (this.useChangeStreams) {
      if (this.watchers.has(tripId)) return;
      const started = this.#startChangeStreamWatcher(tripId, driverId, passengerId);
      if (started) return;
      this.useChangeStreams = false;
    }

    if (this.intervalHandles.has(tripId)) return;
  const interval = this.#createIntervalTracker(tripId, driverId, passengerId);
    this.intervalHandles.set(tripId, interval);
    try {
      logger.info('[positionUpdate] tracking started', {
        tripId,
        driverId,
        passengerId,
        intervalMs: this.intervalMs,
        mode: this.useChangeStreams ? 'changeStream-fallback' : 'interval'
      });
    } catch (_) {}
  }

  // Stop tracking position updates for a trip
  stopTracking(tripId) {
    const interval = this.intervalHandles.get(tripId);
    if (interval) {
      clearInterval(interval);
      this.intervalHandles.delete(tripId);
    }

    const watcher = this.watchers.get(tripId);
    if (watcher) {
      try {
        watcher.stream.removeAllListeners();
        watcher.stream.close();
      } catch (_) {}
      this.watchers.delete(tripId);
    }

    try { logger.info('[positionUpdate] tracking stopped', { tripId }); } catch (_) {}
  }

  // Get active trips being tracked
  getActiveTrips() {
    const keys = new Set();
    this.intervalHandles.forEach((_, key) => keys.add(key));
    this.watchers.forEach((_, key) => keys.add(key));
    return Array.from(keys.values());
  }

  #createIntervalTracker(tripId, driverId, passengerId) {
    return setInterval(async () => {
      try {
        if (!this.isRunning) return;

        const bookingId = toObjectIdOrValue(tripId);
        const latestPosition = await Live.findOne({
          bookingId,
          locationType: 'current'
        }).sort({ timestamp: -1, updatedAt: -1 });

        if (latestPosition) {
          this.#emitSnapshot(latestPosition, tripId, driverId, passengerId, 'interval');
        }
      } catch (error) {
        this.#handleSnapshotError(tripId, error);
      }
    }, this.intervalMs);
  }

  #startChangeStreamWatcher(tripId, driverId, passengerId) {
    if (typeof Live.watch !== 'function') {
      try { logger.warn('[positionUpdate] change streams unavailable, falling back to interval'); } catch (_) {}
      return false;
    }

    const bookingKey = toObjectIdOrValue(tripId);
    const pipeline = [
      { $match: { 'fullDocument.bookingId': bookingKey } }
    ];

    let stream;
    try {
      stream = Live.watch(pipeline, { fullDocument: 'updateLookup' });
    } catch (error) {
      this.#handleWatcherBootstrapError(tripId, error);
      return false;
    }

    if (!isChangeStream(stream)) {
      try { logger.warn('[positionUpdate] Live.watch did not return a change stream, falling back to interval'); } catch (_) {}
      return false;
    }

    const listenerContext = { stream, driverId, passengerId };

    stream.on('change', (change) => {
      if (!change || !change.fullDocument) return;
      this.#emitSnapshot(change.fullDocument, tripId, driverId, passengerId, 'changeStream');
    });

    stream.on('error', (error) => {
      this.watchers.delete(tripId);
      this.#handleWatcherError(tripId, error);
      try { stream.close(); } catch (_) {}
      const interval = this.#createIntervalTracker(tripId, driverId, passengerId);
      this.intervalHandles.set(tripId, interval);
    });

    stream.on('close', () => {
      this.watchers.delete(tripId);
    });

    this.watchers.set(tripId, listenerContext);
    try {
      logger.info('[positionUpdate] change stream watcher started', { tripId, driverId, passengerId });
    } catch (_) {}
    return true;
  }

  #emitSnapshot(liveDoc, tripId, driverId, passengerId, mode) {
    try {
      const payload = {
        bookingId: liveDoc.bookingId ? String(liveDoc.bookingId) : String(tripId),
        driverId,
        passengerId,
        bookingStatus: liveDoc.bookingStatus || liveDoc.status,
        locationStatus: liveDoc.status,
        location: {
          latitude: liveDoc.latitude,
          longitude: liveDoc.longitude,
          ...(liveDoc.bearing != null ? { bearing: liveDoc.bearing } : {}),
          recordedAt: (liveDoc.timestamp || liveDoc.updatedAt || liveDoc.createdAt || new Date()).toISOString()
        }
      };

      emitToRooms([OPS_ROOM], 'booking:driver_location', payload);
      try {
        metrics.increment('live.ops_snapshot_emit', 1, {
          bookingStatus: payload.bookingStatus || 'unknown',
          mode: mode || 'interval'
        });
      } catch (_) {}
    } catch (error) {
      this.#handleSnapshotError(tripId, error);
    }
  }

  #handleSnapshotError(tripId, error) {
    try {
      logger.error('[positionUpdate] failed to relay snapshot', {
        tripId,
        error: error && error.message
      });
      metrics.increment('live.ops_snapshot_error', 1, {
        reason: error && error.message ? error.message : 'unknown'
      });
    } catch (_) {}
  }

  #handleWatcherBootstrapError(tripId, error) {
    try {
      logger.error('[positionUpdate] change stream bootstrap failed', {
        tripId,
        error: error && error.message
      });
      metrics.increment('live.ops_change_stream_bootstrap_error', 1, {
        reason: error && error.message ? error.message : 'unknown'
      });
    } catch (_) {}
  }

  #handleWatcherError(tripId, error) {
    try {
      logger.error('[positionUpdate] change stream error; switching to interval', {
        tripId,
        error: error && error.message
      });
      metrics.increment('live.ops_change_stream_error', 1, {
        reason: error && error.message ? error.message : 'unknown'
      });
    } catch (_) {}
  }
}

// Singleton instance
const positionUpdateService = new PositionUpdateService();

module.exports = positionUpdateService;
