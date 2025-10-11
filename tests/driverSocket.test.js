const assert = require('assert');
const sinon = require('sinon');
const proxyquire = require('proxyquire').noCallThru();

function createQuery(result) {
  const query = {};
  query.sort = sinon.stub().callsFake(() => query);
  query.select = sinon.stub().callsFake(() => query);
  query.limit = sinon.stub().callsFake(() => query);
  query.lean = sinon.stub().resolves(result);
  return query;
}

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

function tick() {
  return new Promise((resolve) => setImmediate(resolve));
}

describe('driverSocket heavy flows', () => {
  let driverServiceStub;
  let driverEventsStub;
  let calculateLivePricingStub;
  let emitSocketErrorStub;
  let emitBookingTargetsStub;
  let dispatchRegistryStub;
  let bookingModelsStub;
  let liveBulkWriteStub;
  let bookingFindStub;
  let bookingFindQuery;
  let bookingFindResult;
  let loggerStub;
  let mongooseStub;
  let userModelsStub;
  let walletModelStub;
  let financeServiceStub;
  let geolibStub;
  let ioStub;
  let driverDoc;

  beforeEach(() => {
    driverDoc = {
      _id: 'driver-123',
      vehicleType: 'mini',
      available: true,
      lastKnownLocation: { latitude: 8.99, longitude: 38.77, bearing: 90 },
      updatedAt: new Date('2025-10-08T12:00:00Z')
    };

    driverServiceStub = {
      setAvailability: sinon.stub().resolves({ available: true }),
      updateLocation: sinon.stub().resolves(driverDoc)
    };

    driverEventsStub = {
      emitDriverAvailability: sinon.stub(),
      emitDriverLocationUpdate: sinon.stub()
    };

    calculateLivePricingStub = sinon.stub().resolves({
      bookingId: 'booking-price',
      currentFare: 180,
      distanceTraveled: 3.4,
      updatedAt: new Date('2025-10-08T12:05:00Z').toISOString()
    });

    emitSocketErrorStub = sinon.stub();
    emitBookingTargetsStub = sinon.stub();

    dispatchRegistryStub = {
      markDispatched: sinon.stub(),
      wasDispatched: sinon.stub().returns(false),
      registerSocket: sinon.stub(),
      unregisterSocket: sinon.stub(),
      setSocketAvailability: sinon.stub(),
      setLiveLocation: sinon.stub(),
      getDispatchedBookings: sinon.stub().returns(new Set())
    };

    bookingFindResult = [];
    bookingFindStub = sinon.stub().callsFake(() => {
      bookingFindQuery = createQuery(bookingFindResult);
      return bookingFindQuery;
    });

    liveBulkWriteStub = sinon.stub().resolves();

    bookingModelsStub = {
      Booking: {
        find: bookingFindStub,
        findById: sinon.stub()
      },
      Live: {
        bulkWrite: liveBulkWriteStub
      }
    };

    loggerStub = {
      info: sinon.stub(),
      warn: sinon.stub(),
      error: sinon.stub()
    };

    mongooseStub = {
      Types: {
        ObjectId: {
          isValid: sinon.stub().returns(false)
        }
      }
    };

    userModelsStub = {
      Driver: {
        findById: sinon.stub().returns({ select: sinon.stub().returns({ lean: sinon.stub().resolves(null) }) }),
        findOne: sinon.stub().returns({ select: sinon.stub().returns({ lean: sinon.stub().resolves(null) }) })
      },
      Passenger: {
        findById: sinon.stub().returns({ select: sinon.stub().returns({ lean: sinon.stub().resolves(null) }) })
      }
    };

    walletModelStub = {
      findOne: sinon.stub().returns({ lean: sinon.stub().resolves({ balance: 100 }) })
    };

    financeServiceStub = {
      canAcceptBooking: sinon.stub().returns(true)
    };

    geolibStub = {
      getDistance: sinon.stub().returns(0)
    };

    ioStub = {
      to: sinon.stub().callsFake(() => ({ emit: sinon.stub() })),
      emit: sinon.stub()
    };
  });

  afterEach(() => {
    sinon.restore();
  });

  function buildDriverSocket(overrides = {}) {
    return proxyquire('../sockets/driverSocket', {
      '../services/driverService': overrides.driverService || driverServiceStub,
      '../events/driverEvents': overrides.driverEvents || driverEventsStub,
      '../services/bookingPricingService': { calculateLivePricing: overrides.calculateLivePricing || calculateLivePricingStub },
      '../utils/logger': loggerStub,
      '../utils/socketErrors': { emitSocketError: emitSocketErrorStub },
      './utils': { emitBookingTargets: emitBookingTargetsStub },
      './dispatchRegistry': overrides.dispatchRegistry || dispatchRegistryStub,
      '../models/bookingModels': overrides.bookingModels || bookingModelsStub,
      '../models/userModels': overrides.userModels || userModelsStub,
      mongoose: overrides.mongoose || mongooseStub,
      geolib: overrides.geolib || geolibStub,
      '../services/financeService': overrides.financeService || financeServiceStub,
      '../models/common': overrides.commonModels || { Wallet: walletModelStub }
    });
  }

  function setupSocket(user) {
    const socket = createFakeSocket(user);
    const driverSocket = buildDriverSocket();
    driverSocket(ioStub, socket);
    return { socket, handlers: socket.handlers };
  }

  it('acknowledges driver location updates and broadcasts snapshots', async () => {
    bookingFindResult = [
      { _id: 'booking-active', passengerId: 'passenger-1', status: 'ongoing' },
      { _id: 'booking-requested', passengerId: 'passenger-2', status: 'requested' }
    ];

    const { socket, handlers } = setupSocket({ id: 'driver-123', type: 'driver' });

    await tick();

  const joinedRooms = socket.join.getCalls().map((call) => call.args[0]);
  const bookingRooms = joinedRooms.filter((room) => room && room.startsWith('booking:'));
  assert.deepStrictEqual(bookingRooms, ['booking:booking-active']);

    const snapshotCall = socket.emit.withArgs('booking:active_snapshot').firstCall;
    assert(snapshotCall, 'expected active snapshot emission');
    const snapshotPayload = snapshotCall.args[1];
    assert.strictEqual(snapshotPayload.user.id, 'driver-123');
  assert.strictEqual(snapshotPayload.bookings.length, 1);
    assert.strictEqual(snapshotPayload.bookings[0].id, 'booking-active');
    assert.strictEqual(snapshotPayload.bookings[0].status, 'ongoing');

    await handlers['booking:driver_location_update']({
      bookingId: 'booking-active',
      latitude: 9.001,
      longitude: 38.751,
      bearing: 45
    });

  assert(driverServiceStub.updateLocation.calledOnceWith('driver-123', sinon.match({ latitude: 9.001, longitude: 38.751, bearing: 45 }), sinon.match.object));
    assert(dispatchRegistryStub.setLiveLocation.calledWith('driver-123', sinon.match.object));
    assert(liveBulkWriteStub.calledOnce, 'expected Live.bulkWrite to be called');
    assert(emitBookingTargetsStub.calledWith(
      sinon.match.object,
      'booking:driver_location',
      sinon.match({ bookingId: 'booking-active', driverId: 'driver-123' }),
      sinon.match({ includeOps: true })
    ));

    const ackCall = socket.emit.withArgs('booking:driver_location_ack').firstCall;
    assert(ackCall, 'expected acknowledgement emission');
    assert.strictEqual(ackCall.args[1].liveWrite, 'persisted');
    assert.deepStrictEqual(ackCall.args[1].processedBookings, ['booking-active']);
    assert.strictEqual(emitSocketErrorStub.callCount, 0, 'unexpected socket error');
  });

  it('reports persistence issues when live snapshot write fails', async () => {
    bookingFindResult = [
      { _id: 'booking-active', passengerId: 'passenger-1', status: 'ongoing' }
    ];
    liveBulkWriteStub.rejects(new Error('bulk-failure'));

    const { socket, handlers } = setupSocket({ id: 'driver-123', type: 'driver' });

    await handlers['booking:driver_location_update']({
      bookingId: 'booking-active',
      latitude: 8.901,
      longitude: 38.761
    });

    const ackCall = socket.emit.withArgs('booking:driver_location_ack').firstCall;
    assert(ackCall, 'expected acknowledgement emission even on failure');
    assert.strictEqual(ackCall.args[1].liveWrite, 'failed');
    assert(emitSocketErrorStub.calledWith(
      socket,
      'booking_error',
      'INTERNAL_ERROR',
      'Live location persistence failed, please retry shortly',
      sinon.match({ source: 'booking:driver_location_update' })
    ));
  });

  it('returns pricing updates for assigned driver', async () => {
    bookingModelsStub.Booking.findById.withArgs('booking-price').resolves({ _id: 'booking-price', driverId: 'driver-123', status: 'ongoing' });

    const { socket, handlers } = setupSocket({ id: 'driver-123', type: 'driver' });

    await handlers['pricing:update']({
      bookingId: 'booking-price',
      location: { latitude: 9.0, longitude: 38.7 }
    });

  assert(calculateLivePricingStub.calledOnceWith('booking-price', sinon.match({ latitude: 9.0, longitude: 38.7 })));
  assert(socket.emit.calledWith('pricing:update', sinon.match({ bookingId: 'booking-price', currentFare: 180 })), 'expected pricing:update emission');
    assert.strictEqual(emitSocketErrorStub.withArgs(socket, 'pricing:error').callCount, 0);
  });

  it('rejects pricing update when driver is not assigned', async () => {
    bookingModelsStub.Booking.findById.withArgs('booking-price').resolves({ _id: 'booking-price', driverId: 'driver-999', status: 'ongoing' });

    const { socket, handlers } = setupSocket({ id: 'driver-123', type: 'driver' });

    await handlers['pricing:update']({
      bookingId: 'booking-price',
      location: { latitude: 9.0, longitude: 38.7 }
    });

    assert(emitSocketErrorStub.calledWith(
      socket,
      'pricing:error',
      'FORBIDDEN',
      sinon.match.string,
      sinon.match({ source: 'pricing:update', extras: { bookingId: 'booking-price' } })
    ));
    assert.strictEqual(socket.emit.withArgs('pricing:update').callCount, 0, 'should not emit pricing:update on forbidden request');
  });
});
