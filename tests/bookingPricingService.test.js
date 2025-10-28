const assert = require('assert');
const sinon = require('sinon');
const proxyquire = require('proxyquire').noCallThru();

describe('bookingPricingService.calculateLivePricing', () => {
  const location = { latitude: 9.03, longitude: 38.74 };
  let bookingDoc;
  let BookingStub;
  let TripHistoryStub;
  let PricingStub;
  let broadcastStub;
  let emitStub;
  let geolibStub;
  let loggerStub;
  let metricsStub;
  let service;

  function loadService() {
    service = proxyquire('../services/bookingPricingService', {
      '../models/bookingModels': { Booking: BookingStub, TripHistory: TripHistoryStub },
      '../models/pricing': { Pricing: PricingStub },
      '../sockets/utils': { broadcast: broadcastStub, emitBookingTargets: emitStub },
      '../utils/logger': loggerStub,
      '../utils/metrics': metricsStub,
      geolib: geolibStub
    });
  }

  beforeEach(() => {
    bookingDoc = {
      _id: 'booking123',
      status: 'ongoing',
      vehicleType: 'mini',
      driverId: 'driver123',
      passengerId: 'passenger456',
      pickup: { latitude: 9.01, longitude: 38.75 },
      startedAt: new Date(Date.now() - (10 * 60 * 1000)),
      fareEstimated: null,
      distanceKm: null,
      save: sinon.stub().resolves()
    };

    BookingStub = {
      findById: sinon.stub().resolves(bookingDoc)
    };

    const t0 = new Date(Date.now() - (10 * 60 * 1000));
    const t1 = new Date();
    TripHistoryStub = {
      findOne: sinon.stub().resolves({ bookingId: bookingDoc._id, locations: [
        { lat: 9.01, lng: 38.75, timestamp: t0 },
        { lat: 9.02, lng: 38.76, timestamp: t1 }
      ] })
    };

    PricingStub = {
      findOne: sinon.stub().returns({
        sort: sinon.stub().resolves({
          _id: 'pricing789',
          baseFare: 10,
          perKm: 2,
          perMinute: 1,
          waitingPerMinute: 0.5,
          minimumFare: 20,
          maximumFare: 100,
          surgeMultiplier: 1.1
        })
      })
    };

    broadcastStub = sinon.stub();
    emitStub = sinon.stub();
    geolibStub = { getDistance: sinon.stub().returns(1500) }; // 1.5 km
    loggerStub = {
      info: sinon.stub(),
      warn: sinon.stub(),
      error: sinon.stub()
    };
    metricsStub = {
      increment: sinon.stub(),
      timing: sinon.stub()
    };

    loadService();
  });

  afterEach(() => {
    sinon.restore();
  });

  it('emits targeted pricing updates with calculated fare snapshot', async () => {
    const clock = sinon.useFakeTimers(Date.now());
    try {
      const result = await service.calculateLivePricing(bookingDoc._id, location);

      assert.strictEqual(result.bookingId, bookingDoc._id);
      assert.strictEqual(result.distanceTraveled, 1.5);
  assert.strictEqual(result.currentFare, 30.8);
      assert.strictEqual(result.fareBreakdown.distanceCost, 3);
      assert.strictEqual(result.fareBreakdown.timeCost, 10);
      assert.strictEqual(result.fareBreakdown.waitingCost, 5);
      assert.strictEqual(result.fareBreakdown.surgeMultiplier, 1.1);
      assert.strictEqual(result.elapsedMinutes, 10);

      assert.strictEqual(emitStub.callCount, 1);
      const [targetInfo, eventName, payload, options] = emitStub.firstCall.args;
      assert.deepStrictEqual(targetInfo, {
        bookingId: bookingDoc._id,
        driverId: bookingDoc.driverId,
        passengerId: bookingDoc.passengerId
      });
      assert.strictEqual(eventName, 'pricing:update');
      assert.strictEqual(payload.bookingId, bookingDoc._id);
      assert.strictEqual(payload.distanceTraveled, 1.5);
  assert.strictEqual(payload.currentFare, 30.8);
      assert.strictEqual(payload.elapsedMinutes, 10);
      assert.ok(options.includeOps);
      assert.ok(!options.aliases);

      assert.strictEqual(broadcastStub.callCount, 0);
      assert(metricsStub.increment.calledWith('pricing.live_calculation_success', sinon.match.number, sinon.match.object));
      assert(metricsStub.timing.calledWith('pricing.live_calculation_ms', sinon.match.number, sinon.match.object));

      assert.strictEqual(bookingDoc.distanceKm, 1.5);
  assert.strictEqual(bookingDoc.fareEstimated, 30.8);
      assert.strictEqual(bookingDoc.save.callCount, 1);
    } finally {
      clock.restore();
    }
  });

  it('rejects updates when booking is neither ongoing nor accepted', async () => {
    bookingDoc.status = 'requested';

    await assert.rejects(
      () => service.calculateLivePricing(bookingDoc._id, location),
      /Pricing updates only available/
    );

    assert.strictEqual(emitStub.callCount, 0);
    assert.strictEqual(broadcastStub.callCount, 0);
    assert(metricsStub.increment.calledWith('pricing.live_calculation_error', sinon.match.number, sinon.match.object));
  });
});
