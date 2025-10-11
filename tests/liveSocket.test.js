const assert = require('assert');
const sinon = require('sinon');
const proxyquire = require('proxyquire').noCallThru();

function createFakeSocket(user = {}) {
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

describe('liveSocket namespace', () => {
  let emitSocketErrorStub;
  let sendMessageStub;
  let loggerStub;
  let bookingModelStub;
  let userModelStub;
  let buildLifecyclePayloadStub;

  beforeEach(() => {
    emitSocketErrorStub = sinon.stub();
    sendMessageStub = sinon.stub();
    loggerStub = {
      info: sinon.stub(),
      warn: sinon.stub(),
      error: sinon.stub()
    };

    bookingModelStub = {
      Booking: {
        findById: sinon.stub()
      },
      Live: {}
    };

    userModelStub = {
      Driver: {
        findById: sinon.stub().returns({ lean: sinon.stub().resolves(null) })
      },
      Passenger: {
        findById: sinon.stub().returns({
          select: sinon.stub().returns({ lean: sinon.stub().resolves(null) })
        })
      }
    };

    buildLifecyclePayloadStub = sinon.stub().returns({ bookingId: 'booking-123', status: 'accepted' });
  });

  afterEach(() => {
    sinon.restore();
  });

  function buildLiveSocket(overrides = {}) {
    return proxyquire('../sockets/liveSocket', {
      '../models/bookingModels': { ...bookingModelStub, ...(overrides.bookingModels || {}) },
      './utils': { sendMessageToSocketId: sendMessageStub },
      '../utils/logger': loggerStub,
      '../utils/socketErrors': { emitSocketError: emitSocketErrorStub },
      '../models/userModels': overrides.userModels || userModelStub,
      '../events/bookingEvents': { buildLifecyclePayload: overrides.buildLifecyclePayload || buildLifecyclePayloadStub }
    });
  }

  it('emits booking:update snapshot for valid booking status request', async () => {
    const bookingDoc = {
      _id: 'booking-123',
      status: 'accepted',
      driverId: 'driver-42',
      passengerId: 'passenger-9',
      pickup: { latitude: 8.98, longitude: 38.79 },
      dropoff: { latitude: 8.99, longitude: 38.8 },
      vehicleType: 'mini'
    };
    bookingModelStub.Booking.findById.withArgs('booking-123').returns({ lean: sinon.stub().resolves(bookingDoc) });

    const liveSocket = buildLiveSocket();
    const socket = createFakeSocket({ id: 'passenger-9', type: 'passenger' });
    liveSocket({}, socket);

    await socket.handlers['booking:status_request']({ bookingId: 'booking-123' });

    assert(buildLifecyclePayloadStub.calledOnceWith(bookingDoc, sinon.match.object));
  assert(socket.emit.calledWith('booking:update', sinon.match({ bookingId: 'booking-123', status: 'accepted' })));
    assert.strictEqual(emitSocketErrorStub.callCount, 0, 'expected no socket errors');
  });

  it('emits validation error when bookingId is missing', async () => {
    const liveSocket = buildLiveSocket();
    const socket = createFakeSocket({ id: 'user-1', type: 'passenger' });
    liveSocket({}, socket);

    await socket.handlers['booking:status_request']({});

    assert(emitSocketErrorStub.calledOnce);
    const [targetSocket, eventName, code] = emitSocketErrorStub.firstCall.args;
    assert.strictEqual(targetSocket, socket);
    assert.strictEqual(eventName, 'booking_error');
    assert.strictEqual(code, 'VALIDATION_ERROR');
  });

  it('emits not found error when booking does not exist', async () => {
    bookingModelStub.Booking.findById.withArgs('missing').returns({ lean: sinon.stub().resolves(null) });

    const liveSocket = buildLiveSocket();
    const socket = createFakeSocket({ id: 'user-1', type: 'passenger' });
    liveSocket({}, socket);

    await socket.handlers['booking:status_request']({ bookingId: 'missing' });

    assert(emitSocketErrorStub.calledOnce);
    const [, eventName, code] = emitSocketErrorStub.firstCall.args;
    assert.strictEqual(eventName, 'booking_error');
    assert.strictEqual(code, 'NOT_FOUND');
  });

  it('forwards booking:ETA_update from assigned driver to booking room', async () => {
    const etaSocket = createFakeSocket({ id: 'driver-1', type: 'driver' });
    bookingModelStub.Booking.findById.withArgs('booking-eta').returns({ lean: sinon.stub().resolves({ _id: 'booking-eta', driverId: 'driver-1' }) });

    const liveSocket = buildLiveSocket();
    liveSocket({}, etaSocket);

    await etaSocket.handlers['booking:ETA_update']({ bookingId: 'booking-eta', etaMinutes: 7, message: 'Arriving soon' });

    assert(sendMessageStub.calledOnce);
    const [room, payload] = sendMessageStub.firstCall.args;
    assert.strictEqual(room, 'booking:booking-eta');
    assert.strictEqual(payload.event, 'booking:ETA_update');
    assert.strictEqual(payload.data.etaMinutes, 7);
    assert.strictEqual(payload.data.driverId, 'driver-1');
    assert.strictEqual(emitSocketErrorStub.callCount, 0, 'unexpected socket error during ETA flow');
  });

  it('rejects booking:ETA_update from non-driver clients', async () => {
    const etaSocket = createFakeSocket({ id: 'passenger-1', type: 'passenger' });
    const liveSocket = buildLiveSocket();
    liveSocket({}, etaSocket);

    await etaSocket.handlers['booking:ETA_update']({ bookingId: 'booking-eta', etaMinutes: 5 });

    assert(emitSocketErrorStub.calledOnce);
    const [, eventName, code] = emitSocketErrorStub.firstCall.args;
    assert.strictEqual(eventName, 'booking_error');
    assert.strictEqual(code, 'UNAUTHORIZED');
    assert.strictEqual(sendMessageStub.callCount, 0);
  });
});
