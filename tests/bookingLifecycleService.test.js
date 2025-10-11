const assert = require('assert');
const sinon = require('sinon');
const proxyquire = require('proxyquire').noCallThru();

describe('bookingLifecycleService', () => {
  let BookingMock;
  let TripHistoryMock;
  let pricingMock;
  let walletServiceMock;
  let financeMock;
  let commissionModelsMock;
  let metricsMock;
  let bookingEventsMock;
  let commonModelsMock;
  let driverEarningsMock;
  let adminEarningsMock;
  let haversineStub;
  let driverSnapshotStub;
  let service;

  beforeEach(() => {
    BookingMock = {
      findById: sinon.stub()
    };
    TripHistoryMock = {
      findOne: sinon.stub(),
      findOneAndUpdate: sinon.stub()
    };
    pricingMock = {
      calculateFare: sinon.stub()
    };
    walletServiceMock = {
      credit: sinon.stub().resolves(),
      debit: sinon.stub().resolves()
    };
    financeMock = {
      calculateCommission: sinon.stub()
    };
    commissionModelsMock = {
      Commission: {
        findOne: sinon.stub()
      },
      DriverEarnings: {
        create: sinon.stub().resolves()
      },
      AdminEarnings: {
        create: sinon.stub().resolves()
      }
    };
    metricsMock = {
      increment: sinon.stub(),
      timing: sinon.stub()
    };
    bookingEventsMock = {
      emitLifecycleUpdate: sinon.stub()
    };
    commonModelsMock = {
      Wallet: {
        updateOne: sinon.stub().resolves()
      },
      Transaction: {
        create: sinon.stub().resolves()
      }
    };
    driverEarningsMock = commissionModelsMock.DriverEarnings;
    adminEarningsMock = commissionModelsMock.AdminEarnings;
    haversineStub = sinon.stub().returns(1);
    driverSnapshotStub = sinon.stub().resolves(null);

    service = proxyquire('../services/bookingLifecycleService', {
      '../models/bookingModels': { Booking: BookingMock },
      '../models/tripHistoryModel': TripHistoryMock,
      '../utils/distance': { haversineKm: haversineStub },
      './pricingService': pricingMock,
      './commissionService': {},
      './walletService': walletServiceMock,
      './financeService': financeMock,
      '../models/commission': commissionModelsMock,
      '../utils/metrics': metricsMock,
      '../events/bookingEvents': bookingEventsMock,
      '../models/common': commonModelsMock,
      '../lib/driverSnapshot': { buildDriverSnapshot: driverSnapshotStub }
    });
  });

  afterEach(() => {
    sinon.restore();
  });

  it('emits booking:update when trip starts', async () => {
    const saveStub = sinon.stub().resolvesThis();
    const bookingDoc = {
      _id: 'trip-start-1',
      status: 'accepted',
      driverId: 'driver-1',
      passengerId: 'passenger-1',
      vehicleType: 'mini',
      acceptedAt: new Date('2025-10-08T10:00:00Z'),
      save: saveStub
    };
    BookingMock.findById.resolves(bookingDoc);
    TripHistoryMock.findOneAndUpdate.resolves();

    const startLocation = { latitude: 1.0, longitude: 2.0 };
    const result = await service.startTrip('trip-start-1', startLocation);

    assert.strictEqual(result.status, 'ongoing');
    assert(saveStub.calledOnce, 'expected booking.save to be called');
    assert(TripHistoryMock.findOneAndUpdate.calledOnce, 'expected TripHistory update');
    const [, updateDoc] = TripHistoryMock.findOneAndUpdate.firstCall.args;
    assert.strictEqual(updateDoc.$set.status, 'ongoing');
    assert(bookingEventsMock.emitLifecycleUpdate.calledOnce, 'expected lifecycle emit');
    const [payload, options] = bookingEventsMock.emitLifecycleUpdate.firstCall.args;
    assert.strictEqual(payload, result);
    assert.strictEqual(options.previousStatus, 'accepted');
  });

  it('emits booking:update when trip completes', async () => {
    const startedAt = new Date('2025-10-08T10:00:00Z');
    const bookingDoc = {
      _id: 'trip-complete-1',
      status: 'ongoing',
      driverId: 'driver-7',
      passengerId: 'passenger-9',
      vehicleType: 'sedan',
      pickup: { latitude: 0, longitude: 0 },
      dropoff: { latitude: 0, longitude: 0 },
      startedAt,
      fareEstimated: 120,
      save: sinon.stub().callsFake(function save() { return Promise.resolve(this); })
    };
    BookingMock.findById.resolves(bookingDoc);
    TripHistoryMock.findOne.resolves({ bookingId: 'trip-complete-1', startedAt, locations: [{ lat: 0, lng: 0 }, { lat: 0.001, lng: 0.001 }] });
    TripHistoryMock.findOneAndUpdate.resolves();
    pricingMock.calculateFare.resolves(200);
    financeMock.calculateCommission.returns(30);
    commissionModelsMock.Commission.findOne.returns({ sort: sinon.stub().resolves({ percentage: 15 }) });

    const result = await service.completeTrip('trip-complete-1', { latitude: 1, longitude: 1 });

    assert.strictEqual(result.status, 'completed');
    assert(TripHistoryMock.findOne.calledOnce, 'expected TripHistory lookup');
    assert(TripHistoryMock.findOneAndUpdate.calledOnce, 'expected TripHistory summary update');
    const [, tripUpdate] = TripHistoryMock.findOneAndUpdate.firstCall.args;
    assert.strictEqual(tripUpdate.$set.status, 'completed');
    assert(bookingEventsMock.emitLifecycleUpdate.calledOnce, 'expected lifecycle emit');
    const [payload, options] = bookingEventsMock.emitLifecycleUpdate.firstCall.args;
    assert.strictEqual(payload, result);
    assert.strictEqual(options.previousStatus, 'ongoing');
    assert(metricsMock.increment.called, 'expected metrics increment');
    assert(driverEarningsMock.create.calledOnce, 'expected driver earnings write');
    assert(adminEarningsMock.create.calledOnce, 'expected admin earnings write');
  });

  it('returns existing booking when already completed', async () => {
    const bookingDoc = {
      _id: 'trip-complete-2',
      status: 'completed',
      driverId: 'driver-33',
      passengerId: 'passenger-44'
    };
    BookingMock.findById.resolves(bookingDoc);

    const result = await service.completeTrip('trip-complete-2');

    assert.strictEqual(result, bookingDoc);
    assert(TripHistoryMock.findOne.notCalled, 'expected TripHistory lookup to be skipped');
    assert(TripHistoryMock.findOneAndUpdate.notCalled, 'expected TripHistory update to be skipped');
    assert(pricingMock.calculateFare.notCalled, 'expected fare calculation to be skipped');
    assert(walletServiceMock.credit.notCalled, 'expected wallet credit to be skipped');
    assert(adminEarningsMock.create.notCalled, 'expected admin earnings write to be skipped');
  });
});
