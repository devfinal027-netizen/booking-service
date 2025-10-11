const logger = require('../utils/logger');
const bookingService = require('../services/bookingService');
const { buildDriverSnapshot } = require('../lib/driverSnapshot');

async function emitActiveBookings(socket) {
  const user = socket.user || {};
  if (!user || String(user.type || '').toLowerCase() !== 'passenger' || !user.id) {
    return;
  }

  try {
    const headers = (socket.handshake && socket.handshake.headers) ? socket.handshake.headers : undefined;
    const bookings = await bookingService.listBookings({ requester: user, headers });
    const activeStatuses = new Set(['requested', 'accepted', 'ongoing']);
    const passengerId = String(user.id);
    const activeBookings = (bookings || [])
      .filter(b => b && activeStatuses.has(String(b.status || '').toLowerCase()))
      .filter(b => {
        const ownerId = b ? (b.passengerId != null ? String(b.passengerId) : (b.passenger && b.passenger.id ? String(b.passenger.id) : undefined)) : undefined;
        return ownerId === passengerId;
      })
      .map(b => ({
        ...b,
        status: b.status
      }));

    // Enrich bookings with driver snapshots when assigned but only fetch for bookings missing driver details
    const uniqueDriverIds = [...new Set(activeBookings
      .filter(b => b && b.driverId && !b.driver)
      .map(b => b.driverId)
    )];
    const driverMap = {};
    if (uniqueDriverIds.length) {
      await Promise.all(uniqueDriverIds.map(async (did) => {
        try {
          const snap = await buildDriverSnapshot(did, { fallbackUser: user, fallbackVehicleType: undefined });
          if (snap) driverMap[String(did)] = snap;
        } catch (e) { /* ignore */ }
      }));
    }

    const enriched = activeBookings.map(b => ({
      ...b,
      driver: b.driver || (b.driverId ? driverMap[String(b.driverId)] : undefined)
    }));

    for (const booking of enriched) {
      if (booking && booking.id) {
        try { socket.join(`booking:${String(booking.id)}`); } catch (_) {}
      }
    }

    // Emit passenger + enriched bookings. Include top-level passenger info and single-driver shortcut when applicable.
    const passengerPayload = { id: String(user.id), type: 'passenger' };
    if (user.name) passengerPayload.name = user.name;
    if (user.phone) passengerPayload.phone = user.phone;
    if (user.email) passengerPayload.email = user.email;

    const uniqueDrivers = Object.values(driverMap);
    const topLevelDriver = uniqueDrivers.length === 1 ? uniqueDrivers[0] : undefined;

    socket.emit('booking:active_snapshot', {
      bookings: enriched,
      user: { id: String(user.id), type: 'passenger' },
      passenger: passengerPayload,
      ...(topLevelDriver ? { driver: topLevelDriver } : {}),
      requestedAt: new Date().toISOString()
    });
  } catch (err) {
    try { logger.error('[socket->passenger] failed to emit active bookings', { sid: socket.id, error: err && err.message }); } catch (_) {}
  }
}

module.exports = (io, socket) => {
  try { logger.info('[socket] passenger namespace attached', { sid: socket.id, user: socket.user && { id: socket.user.id, type: socket.user.type } }); } catch (_) {}
  try {
    if (socket.user && String(socket.user.type).toLowerCase() === 'passenger' && socket.user.id) {
      const passengerRoom = `passenger:${String(socket.user.id)}`;
      socket.join(passengerRoom);
      emitActiveBookings(socket);
    }
  } catch (_) {}
  // booking:notes_fetch, booking:note can be handled under booking if desired.
  // Placeholder for passenger-specific socket events (notifications, etc.).
};

