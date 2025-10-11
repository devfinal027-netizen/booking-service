const assert = require('assert');
const sinon = require('sinon');
const proxyquire = require('proxyquire').noCallThru();

describe('bookingService.updateBookingLifecycle', () => {
  let BookingMock;
  let TripHistoryMock;
  let bookingEventsMock;
  let DriverMock;
  let WalletMock;
  let TransactionMock;
  let CommissionMock;
  let DriverEarningsMock;
  let AdminEarningsMock;
  let financeMock;
  let walletServiceMock;
  let positionUpdateMock;
  let driverSnapshotStub;
  let service;

  beforeEach(() => {
    BookingMock = {
      findById: sinon.stub(),
      findOneAndUpdate: sinon.stub(),
      findOne: sinon.stub(),
      findByIdAndUpdate: sinon.stub()
    };
    TripHistoryMock = {
      findOneAndUpdate: sinon.stub()
    };
    bookingEventsMock = {
      emitLifecycleUpdate: sinon.stub(),
      emitBookingAssigned: sinon.stub()
    };
    DriverMock = {
      findById: sinon.stub(),
      findOne: sinon.stub(),
      findByIdAndUpdate: sinon.stub()
    };
    WalletMock = {
      findOne: sinon.stub(),
      updateOne: sinon.stub()
    };
    TransactionMock = {
      create: sinon.stub()
    };
    CommissionMock = {
      findOne: sinon.stub()
    };
    DriverEarningsMock = {
      create: sinon.stub()
    };
    AdminEarningsMock = {
      create: sinon.stub()
    };
    financeMock = {
      canAcceptBooking: sinon.stub(),
      calculateCommission: sinon.stub(),
      calculateNetIncome: sinon.stub()
    };
    walletServiceMock = {
      credit: sinon.stub(),
      debit: sinon.stub()
    };
    positionUpdateMock = {
      startTracking: sinon.stub(),
      stopTracking: sinon.stub()
    };
    driverSnapshotStub = sinon.stub().callsFake((driverId, options = {}) => Promise.resolve({
      id: driverId,
      name: 'Stub Driver',
      vehicleType: options.fallbackVehicleType || 'mini'
    }));

    service = proxyquire('../services/bookingService', {
      '../models/bookingModels': {
        Booking: BookingMock,
        BookingAssignment: {},
        TripHistory: TripHistoryMock
      },
      '../models/pricing': { Pricing: {} },
      '../models/userModels': {
        Passenger: { findById: sinon.stub(), find: sinon.stub() },
        Driver: DriverMock
      },
      '../models/commission': {
        DriverEarnings: DriverEarningsMock,
        AdminEarnings: AdminEarningsMock,
        Commission: CommissionMock
      },
      '../models/common': {
        Wallet: WalletMock,
        Transaction: TransactionMock
      },
      './../services/positionUpdate': positionUpdateMock,
      './financeService': financeMock,
      './walletService': walletServiceMock,
      '../events/bookingEvents': bookingEventsMock,
      '../lib/driverSnapshot': { buildDriverSnapshot: driverSnapshotStub },
      mongoose: {
        startSession: sinon.stub().resolves({
          withTransaction: sinon.stub().resolves(),
          endSession: sinon.stub()
        })
      }
    });
  });

  afterEach(() => {
    sinon.restore();
  });

  it('emits lifecycle update after driver accepts a booking', async () => {
    const bookingDoc = {
      _id: 'booking123',
      status: 'requested',
      passengerId: 'passenger1',
      vehicleType: 'mini'
    };
    BookingMock.findById.resolves(bookingDoc);
    DriverMock.findById.resolves({ available: true });
    BookingMock.findOne.resolves(null);
    WalletMock.findOne.resolves({ balance: 500 });
    financeMock.canAcceptBooking.returns(true);

    const acceptedAt = new Date('2025-10-08T00:00:00Z');
    const acceptedDoc = {
      _id: 'booking123',
      status: 'accepted',
      passengerId: 'passenger1',
      driverId: 'driver321',
      vehicleType: 'mini',
      acceptedAt
    };
    BookingMock.findOneAndUpdate.resolves(acceptedDoc);
    TripHistoryMock.findOneAndUpdate.resolves();

    const result = await service.updateBookingLifecycle({ requester: { id: 'driver321', type: 'driver' }, id: 'booking123', status: 'accepted' });

    assert.strictEqual(result.status, 'accepted');
    assert(bookingEventsMock.emitLifecycleUpdate.calledOnce, 'expected lifecycle update emit');
    const [payload, options] = bookingEventsMock.emitLifecycleUpdate.firstCall.args;
    assert.strictEqual(payload, result);
    assert.strictEqual(options.previousStatus, 'requested');
    assert.strictEqual(options.reason, undefined);
    assert(options.driver, 'expected driver payload');
    assert.strictEqual(options.driver.id, 'driver321');
    assert.strictEqual(options.driver.vehicleType, 'mini');
    assert(options.passenger, 'expected passenger payload');
    assert.strictEqual(options.passenger.id, 'passenger1');
    assert(options.extras && options.extras.meta, 'expected meta booking payload');
    const acceptMeta = options.extras.meta.booking;
    assert.strictEqual(acceptMeta.id, 'booking123');
    assert.strictEqual(acceptMeta.vehicleType, 'mini');
    assert.strictEqual(acceptMeta.pickup, undefined);
    assert.strictEqual(acceptMeta.dropoff, undefined);
    assert(TripHistoryMock.findOneAndUpdate.calledOnce);
    const tripArgs = TripHistoryMock.findOneAndUpdate.firstCall.args;
    assert.strictEqual(tripArgs[0].bookingId, acceptedDoc._id);
    assert.strictEqual(tripArgs[1].$set.status, 'accepted');
  });

  it('emits lifecycle update with cancellation metadata', async () => {
    const bookingDoc = {
      _id: 'booking456',
      status: 'accepted',
      passengerId: 'passenger99',
      driverId: 'driver999',
      vehicleType: 'sedan',
      pickup: { latitude: 1, longitude: 2 },
      dropoff: { latitude: 3, longitude: 4 },
      save: sinon.stub().callsFake(function save() { return Promise.resolve(this); })
    };
    BookingMock.findById.resolves(bookingDoc);
    TripHistoryMock.findOneAndUpdate.resolves();
    DriverMock.findByIdAndUpdate.resolves();

    const result = await service.updateBookingLifecycle({
      requester: { id: 'driver999', type: 'driver' },
      id: 'booking456',
      status: 'canceled',
      reason: 'passenger no-show',
      extras: {
        canceledBy: 'driver',
        canceledReason: 'passenger no-show'
      }
    });

    assert.strictEqual(result.status, 'canceled');
    assert(bookingEventsMock.emitLifecycleUpdate.calledOnce);
    const [payload, options] = bookingEventsMock.emitLifecycleUpdate.firstCall.args;
    assert.strictEqual(payload, result);
    assert.strictEqual(options.previousStatus, 'accepted');
    assert.strictEqual(options.reason, 'passenger no-show');
    assert.strictEqual(options.extras.canceledBy, 'driver');
    assert.strictEqual(options.extras.canceledReason, 'passenger no-show');
    assert(options.extras.meta, 'expected lifecycle meta');
    const cancelMeta = options.extras.meta.booking;
    assert.deepStrictEqual(cancelMeta, {
      id: 'booking456',
      vehicleType: 'sedan',
      pickup: { latitude: 1, longitude: 2 },
      dropoff: { latitude: 3, longitude: 4 },
      fareEstimated: undefined,
      fareFinal: undefined,
      distanceKm: undefined
    });
    assert(positionUpdateMock.stopTracking.calledWith('booking456'));
    assert.strictEqual(bookingDoc.canceledReason, 'passenger no-show');
  });
});
