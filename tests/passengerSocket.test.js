const assert = require('assert');
const sinon = require('sinon');
const proxyquire = require('proxyquire').noCallThru();

function tick() {
  return new Promise((resolve) => setImmediate(resolve));
}

function createFakeSocket(user = null) {
  const handlers = {};
  return {
    id: `socket-${Math.random().toString(16).slice(2)}`,
    user,
    handshake: { headers: { authorization: 'Bearer token' } },
    handlers,
    join: sinon.stub(),
    emit: sinon.stub(),
    on(event, handler) {
      handlers[event] = handler;
    }
  };
}

describe('passengerSocket active bookings snapshot', () => {
  let bookingServiceStub;
  let loggerStub;
  let passengerSocket;

  beforeEach(() => {
    bookingServiceStub = {
      listBookings: sinon.stub().resolves([
        { id: 'b1', status: 'requested', passengerId: 'passenger-123', pickup: { latitude: 1, longitude: 2 } },
        {
          id: 'b2',
          status: 'accepted',
          passengerId: 'passenger-123',
          driverId: 'driver-99',
          driver: {
            id: 'driver-99',
            name: 'Driver Test',
            phone: '+251900000000',
            email: 'driver@example.com',
            vehicleType: 'mini',
            carName: 'Corolla',
            carPlate: 'ABC-123',
            carColor: 'Blue',
            rating: 4.9
          }
        },
        { id: 'b3', status: 'completed', passengerId: 'passenger-123' },
        { id: 'b4', status: 'ongoing', passengerId: 'someone-else' }
      ])
    };

    loggerStub = {
      info: sinon.stub(),
      error: sinon.stub()
    };

    passengerSocket = proxyquire('../sockets/passengerSocket', {
      '../services/bookingService': bookingServiceStub,
      '../utils/logger': loggerStub
    });
  });

  afterEach(() => {
    sinon.restore();
  });

  it('joins passenger + booking rooms and emits active snapshot on connect', async () => {
    const socket = createFakeSocket({ id: 'passenger-123', type: 'passenger' });
    const ioStub = {};

    passengerSocket(ioStub, socket);
    await tick();

    assert(socket.join.calledWith('passenger:passenger-123'));
    assert(socket.join.calledWith('booking:b1'));
    assert(socket.join.calledWith('booking:b2'));
  assert.strictEqual(socket.join.calledWith('booking:b3'), false, 'completed booking should not join room');
  assert.strictEqual(socket.join.calledWith('booking:b4'), false, 'other passenger booking should not join room');

    const emitCall = socket.emit.withArgs('booking:active_snapshot').firstCall;
    assert(emitCall, 'expected active snapshot emission');
    const payload = emitCall.args[1];
    assert.strictEqual(payload.user.id, 'passenger-123');
  assert.strictEqual(payload.bookings.length, 2);
    assert(payload.bookings.every(b => ['b1', 'b2'].includes(b.id)));
    const accepted = payload.bookings.find((b) => b.id === 'b2');
    assert(accepted, 'expected accepted booking in payload');
    assert.deepStrictEqual(accepted.driver, {
      id: 'driver-99',
      name: 'Driver Test',
      phone: '+251900000000',
      email: 'driver@example.com',
      vehicleType: 'mini',
      carName: 'Corolla',
      carPlate: 'ABC-123',
      carColor: 'Blue',
      rating: 4.9
    });
    assert(bookingServiceStub.listBookings.calledOnce);
    assert.deepStrictEqual(bookingServiceStub.listBookings.firstCall.args[0].requester, socket.user);
  });

  it('skips snapshot if user is not passenger', async () => {
    const socket = createFakeSocket({ id: 'admin-1', type: 'admin' });
    const ioStub = {};

    passengerSocket(ioStub, socket);
    await tick();

    assert.strictEqual(socket.emit.calledWith('booking:active_snapshot'), false);
    assert.strictEqual(bookingServiceStub.listBookings.called, false);
  });
});
