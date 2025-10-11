let ioRef = null;
const logger = require('../utils/logger');

const DEFAULT_OPS_ROOM = 'ops:booking';

function setIo(io) {
  ioRef = io;
}

function getIo() {
  return ioRef;
}

function broadcast(event, data) {
  const io = ioRef;
  if (io) {
    try {
      io.emit(event, data);
    } catch (e) {
      logger.error('Failed to broadcast event', event, e);
    }
  } else {
    logger.warn('Socket.io not initialized for broadcast.');
  }
}

const sendMessageToSocketId = (socketId, messageObject) => {
  const io = ioRef;
  if (io) {
    try {
      logger.info('message sent to: ', socketId);
      io.to(socketId).emit(messageObject.event, messageObject.data);
    } catch (e) {
      logger.error('Failed to send message to socket', socketId, e);
    }
  } else {
    logger.warn('Socket.io not initialized.');
  }
};

function emitToRooms(rooms, event, data) {
  const io = ioRef;
  if (!io) {
    logger.warn('Socket.io not initialized for targeted emit.');
    return;
  }
  const uniqueRooms = Array.from(new Set((rooms || []).filter(Boolean).map((room) => String(room))));
  if (!uniqueRooms.length) return;
  try {
    uniqueRooms.forEach((room) => {
      io.to(room).emit(event, data);
    });
  } catch (e) {
    logger.error('Failed to emit to rooms', { event, rooms: uniqueRooms, error: e.message });
  }
}

function emitBookingTargets({ bookingId, driverId, passengerId }, event, data, options = {}) {
  const rooms = [];
  if (bookingId) rooms.push(`booking:${String(bookingId)}`);
  if (driverId) rooms.push(`driver:${String(driverId)}`);
  if (passengerId) rooms.push(`passenger:${String(passengerId)}`);
  const includeOps = options.includeOps === true;
  if (includeOps) rooms.push(options.opsRoom || DEFAULT_OPS_ROOM);
  emitToRooms(rooms, event, data);
}

module.exports = { setIo, getIo, broadcast, sendMessageToSocketId, emitToRooms, emitBookingTargets, DEFAULT_OPS_ROOM };
