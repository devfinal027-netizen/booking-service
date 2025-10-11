const assert = require('assert');
const sinon = require('sinon');
const EventEmitter = require('events');
const proxyquire = require('proxyquire').noCallThru();

describe('positionUpdateService', () => {
  const originalInterval = process.env.POSITION_UPDATE_INTERVAL_MS;
  const originalChangeStreamFlag = process.env.LIVE_USE_CHANGE_STREAMS;

  let clock;
  let emitToRoomsStub;
  let metricsStub;
  let loggerStub;
  let findOneStub;
  let sortStub;
  let ObjectIdStub;
  let buildService;
  let service;

  beforeEach(() => {
    process.env.POSITION_UPDATE_INTERVAL_MS = '1000';
    process.env.LIVE_USE_CHANGE_STREAMS = 'false';
    clock = sinon.useFakeTimers();

    emitToRoomsStub = sinon.stub();
    metricsStub = {
      increment: sinon.stub(),
      timing: sinon.stub()
    };
    loggerStub = {
      info: sinon.stub(),
      warn: sinon.stub(),
      error: sinon.stub()
    };

    sortStub = sinon.stub().resolves({
      bookingId: '507f191e810c19729de860ea',
      bookingStatus: 'ongoing',
      status: 'moving',
      latitude: 9.0,
      longitude: 38.8,
      bearing: 123,
      timestamp: new Date('2025-10-08T12:00:00Z')
    });

    findOneStub = sinon.stub().returns({ sort: sortStub });

    ObjectIdStub = function ObjectId(id) {
      this.value = id;
    };
    ObjectIdStub.isValid = sinon.stub().returns(true);

    buildService = (overrides = {}) => {
      const LiveMock = Object.assign({ findOne: findOneStub }, overrides.live);
      const mongooseMock = overrides.mongoose || { Types: { ObjectId: ObjectIdStub } };

      return proxyquire('../services/positionUpdate', {
        '../models/bookingModels': { Live: LiveMock },
        '../sockets/utils': { emitToRooms: emitToRoomsStub },
        '../utils/logger': loggerStub,
        '../utils/metrics': metricsStub,
        mongoose: mongooseMock
      });
    };

    service = buildService();
  });

  afterEach(() => {
    if (service && typeof service.stop === 'function') {
      service.stop();
    }
    if (clock && typeof clock.restore === 'function') {
      clock.restore();
    }
    process.env.POSITION_UPDATE_INTERVAL_MS = originalInterval;
    process.env.LIVE_USE_CHANGE_STREAMS = originalChangeStreamFlag;
    sinon.restore();
  });

  it('relays latest Live snapshot to ops room on interval', async () => {
    service.start();
    service.startTracking('booking123', 'driverABC', 'passengerXYZ');

    clock.tick(1000);
    await Promise.resolve();

    assert.strictEqual(findOneStub.callCount, 1);
    assert(emitToRoomsStub.calledOnce, 'expected emitToRooms to be invoked');
    const [rooms, event, payload] = emitToRoomsStub.firstCall.args;
    assert.deepStrictEqual(rooms, ['ops:booking']);
    assert.strictEqual(event, 'booking:driver_location');
    assert.strictEqual(payload.driverId, 'driverABC');
    assert.strictEqual(payload.passengerId, 'passengerXYZ');
    assert.strictEqual(payload.bookingStatus, 'ongoing');
    assert.strictEqual(payload.locationStatus, 'moving');
    assert.strictEqual(payload.location.latitude, 9.0);
    assert.strictEqual(payload.location.longitude, 38.8);
    assert(metricsStub.increment.calledWithMatch('live.ops_snapshot_emit'));

    service.stopTracking('booking123');
  });

  it('streams live updates via MongoDB change streams when enabled', async () => {
    service.stop();
    emitToRoomsStub.resetHistory();
    metricsStub.increment.resetHistory();

    process.env.LIVE_USE_CHANGE_STREAMS = 'true';

    const changeStream = new EventEmitter();
    changeStream.close = sinon.stub();
    const watchStub = sinon.stub().returns(changeStream);

    service = buildService({ live: { findOne: findOneStub, watch: watchStub } });
    service.start();
    service.startTracking('507f191e810c19729de860ea', 'driverABC', 'passengerXYZ');

    const liveDoc = {
      bookingId: '507f191e810c19729de860ea',
      bookingStatus: 'ongoing',
      status: 'moving',
      latitude: 11.5,
      longitude: 39.2,
      timestamp: new Date('2025-10-08T12:00:00Z')
    };

    changeStream.emit('change', { fullDocument: liveDoc });

    assert(emitToRoomsStub.calledOnce, 'expected emitToRooms call from change stream');
    const [rooms, event, payload] = emitToRoomsStub.firstCall.args;
    assert.deepStrictEqual(rooms, ['ops:booking']);
    assert.strictEqual(event, 'booking:driver_location');
    assert.strictEqual(payload.location.latitude, 11.5);
    assert(metricsStub.increment.calledWithMatch('live.ops_snapshot_emit'));

    service.stopTracking('507f191e810c19729de860ea');
    assert(changeStream.close.called, 'expected change stream to close on stop');
  });
});
