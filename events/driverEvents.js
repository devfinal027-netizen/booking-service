const { broadcast, getIo, emitToRooms, DEFAULT_OPS_ROOM } = require('../sockets/utils');

function emitDriverLocationUpdate(payload) {
  try {
    broadcast('driver:location', payload);
    const io = getIo && getIo();
    if (io && payload && payload.driverId) {
      io.emit(`driver:location:${String(payload.driverId)}`, payload);
      broadcast('driver:position', payload);
    }
  } catch (_) {}
}

function emitDriverAvailability(driverId, available) {
  try {
    const io = getIo && getIo();
    const payload = { driverId: String(driverId), available };
    if (io) io.to(`driver:${String(driverId)}`).emit('driver:availability', payload);
    emitToRooms([DEFAULT_OPS_ROOM], 'driver:availability', payload);
  } catch (_) {}
}

module.exports = { emitDriverLocationUpdate, emitDriverAvailability };

