// Shared registry to deduplicate booking:new dispatches to the same driver per booking
// Key format: `${bookingId}:${driverId}`
const dispatchedBookingToDriver = new Map();
// Default TTL extended to 24h to strongly enforce one-time send per driver per booking
const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000;
const DISPATCH_TTL_MS = Number.parseInt(process.env.DISPATCH_TTL_MS || `${DEFAULT_TTL_MS}`, 10);

// Track dispatched driver ids per booking for reconciliation/removal
const bookingToDrivers = new Map();
// Track dispatched booking ids per driver for reconnection rehydration
const driverToBookings = new Map();

// Runtime registry for connected drivers and their socket-level availability
// Structure: driverId -> { socketIds: Set<string>, availableSockets: Set<string> }
const driverConnectionRegistry = new Map();
// Live location cache: driverId -> { latitude, longitude, bearing, updatedAt }
const liveLocationByDriver = new Map();
function ensureDriverEntry(driverId) {
  const id = String(driverId);
  if (!driverConnectionRegistry.has(id)) {
    driverConnectionRegistry.set(id, { socketIds: new Set(), availableSockets: new Set() });
  }
  return driverConnectionRegistry.get(id);
}
function registerSocket(driverId, socketId) {
  const entry = ensureDriverEntry(driverId);
  entry.socketIds.add(String(socketId));
}
function unregisterSocket(driverId, socketId) {
  const id = String(driverId);
  const entry = driverConnectionRegistry.get(id);
  if (!entry) return;
  entry.socketIds.delete(String(socketId));
  entry.availableSockets.delete(String(socketId));
  if (entry.socketIds.size === 0 && entry.availableSockets.size === 0) {
    driverConnectionRegistry.delete(id);
    const bookings = driverToBookings.get(id);
    if (bookings && bookings.size) {
      driverToBookings.delete(id);
      for (const bid of bookings) {
        const set = bookingToDrivers.get(bid);
        if (set) {
          set.delete(id);
          if (set.size === 0) bookingToDrivers.delete(bid);
        }
        dispatchedBookingToDriver.delete(makeKey(bid, id));
      }
    }
  }
}
function setSocketAvailability(driverId, socketId, available) {
  const entry = ensureDriverEntry(driverId);
  const sid = String(socketId);
  if (available) entry.availableSockets.add(sid); else entry.availableSockets.delete(sid);
}
function isDriverAvailableBySocket(driverId) {
  const entry = driverConnectionRegistry.get(String(driverId));
  return !!(entry && entry.availableSockets && entry.availableSockets.size > 0);
}

function setLiveLocation(driverId, location) {
  if (!location || location.latitude == null || location.longitude == null) return;
  liveLocationByDriver.set(String(driverId), {
    latitude: Number(location.latitude),
    longitude: Number(location.longitude),
    bearing: location.bearing != null ? Number(location.bearing) : undefined,
    updatedAt: Date.now()
  });
}

function getLiveLocation(driverId) {
  return liveLocationByDriver.get(String(driverId));
}

function makeKey(bookingId, driverId) {
  return `${String(bookingId)}:${String(driverId)}`;
}

function markDispatched(bookingId, driverId) {
  const key = makeKey(bookingId, driverId);
  if (!dispatchedBookingToDriver.has(key)) {
    dispatchedBookingToDriver.set(key, Date.now());
  }
  const bid = String(bookingId);
  const did = String(driverId);
  if (!bookingToDrivers.has(bid)) bookingToDrivers.set(bid, new Set());
  bookingToDrivers.get(bid).add(did);
  if (!driverToBookings.has(did)) driverToBookings.set(did, new Set());
  driverToBookings.get(did).add(bid);
}

function wasDispatched(bookingId, driverId) {
  const key = makeKey(bookingId, driverId);
  const ts = dispatchedBookingToDriver.get(key);
  if (!ts) return false;
  if (Date.now() - ts > DISPATCH_TTL_MS) {
    dispatchedBookingToDriver.delete(key);
    return false;
  }
  return true;
}

function getDispatchedDrivers(bookingId) {
  const entry = bookingToDrivers.get(String(bookingId));
  if (!entry) return new Set();
  return new Set(entry);
}

function clearDriverDispatch(bookingId, driverId) {
  const bid = String(bookingId);
  const did = String(driverId);
  const entry = bookingToDrivers.get(bid);
  if (!entry) return;
  entry.delete(did);
  if (entry.size === 0) bookingToDrivers.delete(bid);
  const driverEntry = driverToBookings.get(did);
  if (driverEntry) {
    driverEntry.delete(bid);
    if (driverEntry.size === 0) driverToBookings.delete(did);
  }
}

function clearBookingDispatch(bookingId) {
  const bid = String(bookingId);
  const drivers = bookingToDrivers.get(bid);
  if (drivers && drivers.size) {
    for (const did of drivers) {
      const driverEntry = driverToBookings.get(did);
      if (driverEntry) {
        driverEntry.delete(bid);
        if (driverEntry.size === 0) driverToBookings.delete(did);
      }
    }
  }
  bookingToDrivers.delete(bid);
  for (const key of dispatchedBookingToDriver.keys()) {
    if (key.startsWith(`${bid}:`)) {
      dispatchedBookingToDriver.delete(key);
    }
  }
}

function getDispatchedBookings(driverId) {
  const entry = driverToBookings.get(String(driverId));
  if (!entry) return new Set();
  return new Set(entry);
}

function clearDriverBookings(driverId) {
  const did = String(driverId);
  const bookings = driverToBookings.get(did);
  if (!bookings || bookings.size === 0) return;
  for (const bid of bookings) {
    const set = bookingToDrivers.get(bid);
    if (set) {
      set.delete(did);
      if (set.size === 0) bookingToDrivers.delete(bid);
    }
    dispatchedBookingToDriver.delete(makeKey(bid, did));
  }
  driverToBookings.delete(did);
}

function cleanupDispatches() {
  const now = Date.now();
  for (const [key, ts] of dispatchedBookingToDriver.entries()) {
    if (now - ts > DISPATCH_TTL_MS) dispatchedBookingToDriver.delete(key);
  }
  for (const [bookingId, set] of bookingToDrivers.entries()) {
    const filtered = Array.from(set).filter((driverId) => {
      const ts = dispatchedBookingToDriver.get(makeKey(bookingId, driverId));
      return ts && (now - ts) <= DISPATCH_TTL_MS;
    });
    if (!filtered.length) {
      bookingToDrivers.delete(bookingId);
    } else {
      bookingToDrivers.set(bookingId, new Set(filtered));
    }
  }
  for (const [driverId, bookings] of driverToBookings.entries()) {
    const filteredBookings = Array.from(bookings).filter((bookingId) => {
      const ts = dispatchedBookingToDriver.get(makeKey(bookingId, driverId));
      return ts && (now - ts) <= DISPATCH_TTL_MS;
    });
    if (!filteredBookings.length) driverToBookings.delete(driverId);
    else driverToBookings.set(driverId, new Set(filteredBookings));
  }
}

setInterval(cleanupDispatches, DISPATCH_TTL_MS).unref();

module.exports = {
  markDispatched,
  wasDispatched,
  registerSocket,
  unregisterSocket,
  setSocketAvailability,
  isDriverAvailableBySocket,
  setLiveLocation,
  getLiveLocation,
  getDispatchedDrivers,
  getDispatchedBookings,
  clearDriverDispatch,
  clearBookingDispatch,
  clearDriverBookings
};

