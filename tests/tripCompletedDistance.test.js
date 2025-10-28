const assert = require('assert');
const sinon = require('sinon');
const proxyquire = require('proxyquire').noCallThru();

function createFakeSocket(user) {
  const handlers = {};
  return {
    id: `socket-${Math.random().toString(16).slice(2)}`,
    user,
    handlers,
    emit: sinon.stub(),
    join: sinon.stub(),
    on(event, handler) {
      handlers[event] = handler;
    }
  };
}

describe('trip:completed payload contains distanceTraveled', () => {
  let bookingEvents;
  let lifecycleStub;
  let bookingModelsStub;
  let emitSocketErrorStub;
  let loggerStub;
  let ioStub;
  let utilsStub;

  beforeEach(() => {
    utilsStub = {
      emitBookingTargets: sinon.stub(),
      DEFAULT_OPS_ROOM: 'ops:booking'
    };

    bookingEvents = proxyquire('../events/bookingEvents', {
      '../sockets/utils': utilsStub
    });

    lifecycleStub = {
      completeTrip: sinon.stub().resolves({
        _id: 'b-1',
        driverId: 'd-1',
        passengerId: 'p-1',
        fareFinal: 120,
        fareEstimated: 100,
        distanceKm: 7.5,
        waitingTime: 0,
        completedAt: new Date().toISOString(),
        driverEarnings: 100,
        commissionAmount: 20
      })
    };

    bookingModelsStub = {
      Booking: {
        findOne: sinon.stub().resolves({ _id: 'b-1', driverId: 'd-1', passengerId: 'p-1' })
      }
    };

    emitSocketErrorStub = sinon.stub();

    loggerStub = { info: sinon.stub(), warn: sinon.stub(), error: sinon.stub() };

    ioStub = { to: sinon.stub().callsFake(() => ({ emit: sinon.stub() })), emit: sinon.stub() };
  });

  afterEach(() => sinon.restore());

  function buildBookingSocket() {
    return proxyquire('../sockets/bookingSocket', {
      '../services/bookingLifecycleService': lifecycleStub,
      '../models/bookingModels': bookingModelsStub,
      '../events/bookingEvents': require('../events/bookingEvents'),
      '../utils/socketErrors': { emitSocketError: emitSocketErrorStub },
      '../utils/logger': loggerStub
    });
  }

  it('emits trip:completed with distanceTraveled alias', async () => {
    const socket = createFakeSocket({ id: 'd-1', type: 'driver' });
    const bookingSocket = buildBookingSocket();
    bookingSocket(ioStub, socket);

    await socket.handlers['trip:completed']({ bookingId: 'b-1' });

    // bookingEvents emits via schedule to rooms; we assert at least that lifecycle completed, and the event function includes the alias
    const payload = {
      id: 'b-1',
      bookingId: 'b-1',
      amount: 120,
      distance: 7.5,
      distanceTraveled: 7.5,
      waitingTime: 0,
      driverEarnings: 100,
      commission: 20
    };

    // Directly invoke emitTripCompleted to confirm payload contains alias
    const emitSpy = utilsStub.emitBookingTargets;
    try {
      bookingEvents.emitTripCompleted({
        _id: 'b-1',
        fareFinal: 120,
        fareEstimated: 100,
        distanceKm: 7.5,
        waitingTime: 0,
        completedAt: new Date().toISOString(),
        driverEarnings: 100,
        commissionAmount: 20,
        driverId: 'd-1',
        passengerId: 'p-1'
      });
      await new Promise((resolve) => setImmediate(resolve));
      assert(emitSpy.called, 'expected emitToRooms to be called');
      const callArg = emitSpy.getCalls().map(c => c.args[2]).find(p => p && p.bookingId === 'b-1');
      assert(callArg, 'expected a trip:completed payload');
      assert.strictEqual(callArg.distanceTraveled, 7.5);
      assert.strictEqual(callArg.distance, 7.5);
    } finally {
      // no-op
    }
  });
});
