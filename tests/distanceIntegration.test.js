const assert = require('assert');
const sinon = require('sinon');

// Integration-style unit test: increment TripHistory via lifecycle and compute pricing distance

describe('Distance integration - incremental accumulation and live pricing', () => {
  let BookingStub;
  let TripHistoryStub;
  let PricingStub;
  let loggerStub;
  let metricsStub;
  let service;

  beforeEach(() => {
    BookingStub = {
      findById: sinon.stub(),
    };
    TripHistoryStub = {
      findOne: sinon.stub(),
      findOneAndUpdate: sinon.stub().resolves(),
    };
    PricingStub = {
      findOne: sinon.stub().returns({ sort: sinon.stub().resolves({ baseFare: 10, perKm: 5, minimumFare: 10, surgeMultiplier: 1 }) })
    };
    loggerStub = { info: sinon.stub(), warn: sinon.stub(), error: sinon.stub() };
    metricsStub = { increment: sinon.stub(), timing: sinon.stub() };

    // Use proxyquire to load pricing service with stubs
    service = require('proxyquire').noCallThru()('../services/bookingPricingService', {
      '../models/bookingModels': { Booking: BookingStub, TripHistory: TripHistoryStub },
      '../models/pricing': { Pricing: PricingStub },
      '../sockets/utils': { emitBookingTargets: sinon.stub() },
      '../utils/logger': loggerStub,
      '../utils/metrics': metricsStub,
    });
  });

  afterEach(() => sinon.restore());

  it('accumulates distance across multiple small movements', async () => {
    const bookingId = 'b1';
    const bookingDoc = {
      _id: bookingId,
      status: 'ongoing',
      vehicleType: 'mini',
      driverId: 'd1',
      passengerId: 'p1',
      pickup: { latitude: 8.9378447, longitude: 38.7209755 },
      createdAt: new Date(Date.now() - 120000),
    };
    BookingStub.findById.resolves(bookingDoc);

    const baseTs = Date.now();
    const points = [
      { lat: 8.9378447, lng: 38.7209755, timestamp: new Date(baseTs - 5000) },
      { lat: 8.9379000, lng: 38.7210500, timestamp: new Date(baseTs - 3000) },
      { lat: 8.9379500, lng: 38.7211000, timestamp: new Date(baseTs - 1000) },
    ];
    TripHistoryStub.findOne.resolves({ bookingId, locations: points });

    const result = await service.calculateLivePricing(bookingId, { latitude: 8.9380000, longitude: 38.7211500 });

    assert(result.distanceTraveled >= 0.05, 'expected distance to accumulate beyond zero');
    assert(metricsStub.increment.calledWith('pricing.live_calculation_success', sinon.match.number, sinon.match.object));
  });
});
