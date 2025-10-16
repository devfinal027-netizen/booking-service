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

describe('bookingSocket booking:cancel flow', () => {
  let bookingServiceStub;
  let bookingEventsStub;
  let lifecycleStub;
  let pricingStub;
  let emitSocketErrorStub;
  let dispatchRegistryStub;
  let sendMessageStub;
  let emitOnceStub;
  let loggerStub;
  let bookingModelsStub;
  let metricsStub;
  let ioStub;
  let bookingDoc;
  let dispatchedDrivers;

  beforeEach(() => {
    bookingDoc = {
      _id: 'booking-1',
      status: 'requested',
      driverId: null
    };

    bookingServiceStub = {
      updateBookingLifecycle: sinon.stub().resolves({ _id: 'booking-1' })
    };

    bookingEventsStub = {
      emitTripStarted: sinon.stub(),
      emitTripOngoing: sinon.stub(),
      emitTripCompleted: sinon.stub(),
      emitLifecycleUpdate: sinon.stub()
    };

    lifecycleStub = {
      startTrip: sinon.stub(),
      updateTripLocation: sinon.stub()
    };

    pricingStub = {
      calculateLivePricing: sinon.stub()
    };

    emitSocketErrorStub = sinon.stub();

    dispatchedDrivers = new Set();
    dispatchRegistryStub = {
      markDispatched: sinon.stub(),
      wasDispatched: sinon.stub(),
      getDispatchedDrivers: sinon.stub().callsFake(() => new Set(dispatchedDrivers)),
      clearBookingDispatch: sinon.stub().callsFake(() => { dispatchedDrivers.clear(); }),
      clearDriverDispatch: sinon.stub().callsFake((_bookingId, driverId) => { dispatchedDrivers.delete(String(driverId)); })
    };

    sendMessageStub = sinon.stub();

    emitOnceStub = {
      wasEmitted: sinon.stub().returns(false),
      markEmitted: sinon.stub()
    };

    loggerStub = {
      info: sinon.stub(),
      warn: sinon.stub(),
      error: sinon.stub()
    };

    bookingModelsStub = {
      Booking: {
        findById: sinon.stub().callsFake(() => ({
          lean: sinon.stub().callsFake(() => Promise.resolve({ ...bookingDoc }))
        })),
        findOne: sinon.stub(),
        find: sinon.stub()
      }
    };

    metricsStub = {
      timing: sinon.stub(),
      increment: sinon.stub()
    };

    ioStub = {
      to: sinon.stub().callsFake(() => ({ emit: sinon.stub() })),
      emit: sinon.stub()
    };
  });

  afterEach(() => {
    sinon.restore();
  });

  function buildBookingSocket() {
    return proxyquire('../sockets/bookingSocket', {
      '../services/bookingService': bookingServiceStub,
      '../events/bookingEvents': bookingEventsStub,
      './utils': { sendMessageToSocketId: sendMessageStub },
      '../services/bookingLifecycleService': lifecycleStub,
      '../services/bookingPricingService': pricingStub,
      '../utils/socketErrors': { emitSocketError: emitSocketErrorStub },
      './dispatchRegistry': dispatchRegistryStub,
      './emitOnce': emitOnceStub,
      '../utils/logger': loggerStub,
      '../models/bookingModels': bookingModelsStub,
      '../utils/metrics': metricsStub
    });
  }

  function setupSocket(user) {
    const socket = createFakeSocket(user);
    const bookingSocket = buildBookingSocket();
    bookingSocket(ioStub, socket);
    return socket;
  }

  it('does not cancel booking when unassigned driver declines and others remain', async () => {
    dispatchedDrivers = new Set(['driver-1', 'driver-2']);
    const socket = setupSocket({ id: 'driver-1', type: 'driver' });

    await socket.handlers['booking:cancel']({ bookingId: 'booking-1' });

    assert(emitSocketErrorStub.notCalled, 'unexpected socket error');
    assert(dispatchRegistryStub.clearDriverDispatch.calledOnceWith('booking-1', 'driver-1'));
    assert.strictEqual(bookingServiceStub.updateBookingLifecycle.callCount, 0, 'should not cancel booking for passenger');
    assert(sendMessageStub.calledWith(
      'driver:driver-1',
      sinon.match({ event: 'booking:removed', data: { bookingId: 'booking-1', reason: 'driver_declined' } })
    ));
    assert.deepStrictEqual(Array.from(dispatchedDrivers), ['driver-2']);
  });

  it('cancels booking when last dispatched driver declines', async () => {
    dispatchedDrivers = new Set(['driver-1']);
    const socket = setupSocket({ id: 'driver-1', type: 'driver' });

    await socket.handlers['booking:cancel']({ bookingId: 'booking-1' });

    assert(dispatchRegistryStub.clearDriverDispatch.calledOnceWith('booking-1', 'driver-1'));
    assert(bookingServiceStub.updateBookingLifecycle.calledOnce);
    const args = bookingServiceStub.updateBookingLifecycle.firstCall.args[0];
    assert.strictEqual(args.id, 'booking-1');
    assert.strictEqual(args.status, 'canceled');
    assert.strictEqual(args.reason, 'drivers_declined');
    assert.deepStrictEqual(args.extras, { canceledBy: 'driver_pool', canceledReason: 'drivers_declined' });
    assert(dispatchRegistryStub.clearBookingDispatch.calledOnceWith('booking-1'));
  });

  it('excludes accepted driver from booking:removed notification', async () => {
    // Arrange: two dispatched drivers, driver-1 accepts
    dispatchedDrivers = new Set(['driver-1', 'driver-2']);
    bookingModelsStub.Booking.findById.resolves({ _id: 'booking-accept-1', status: 'requested' });
    bookingServiceStub.updateBookingLifecycle.resolves({ _id: 'booking-accept-1', status: 'accepted', driverId: 'driver-1' });

    const socket = setupSocket({ id: 'driver-1', type: 'driver' });

    // Act
    await socket.handlers['booking:accept']({ bookingId: 'booking-accept-1' });

    // Assert: booking:removed sent only to driver-2
    const calls = sendMessageStub.getCalls().map(c => c.args[0]);
    const bookingRemovedCalls = sendMessageStub.getCalls().filter(c => c.args[1] && c.args[1].event === 'booking:removed');
    // No direct send to accepted driver
    assert(!calls.includes('driver:driver-1'));
    // At least one send to other driver
    assert(bookingRemovedCalls.some(c => c.args[0] === 'driver:driver-2'));
  });
});
