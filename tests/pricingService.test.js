const assert = require('assert');
const sinon = require('sinon');

describe('pricingService.calculateFare', () => {
  const { Pricing } = require('../models/pricing');
  const pricingService = require('../services/pricingService');

  afterEach(() => {
    sinon.restore();
  });

  it('uses provided surge multiplier when supplied explicitly', async () => {
    const pricingDoc = {
      baseFare: 30,
      perKm: 10,
      perMinute: 2,
      waitingPerMinute: 1,
      surgeMultiplier: 1.2,
      minimumFare: 50,
      maximumFare: 400
    };

    sinon.stub(Pricing, 'findOne').callsFake(() => ({
      sort: () => Promise.resolve(pricingDoc)
    }));

    const fare = await pricingService.calculateFare(10, 5, 'SEDAN', 1.5, 20);

    const expected = ((30 + (10 * 10) + (5 * 2) + (5 * 1)) * 1.5) - 20;
    assert.strictEqual(fare, Number(expected.toFixed(2)));
    sinon.assert.calledWithMatch(Pricing.findOne, { vehicleType: 'sedan', isActive: true });
  });

  it('falls back to pricing document surge multiplier when not provided', async () => {
    const pricingDoc = {
      baseFare: 25,
      perKm: 8,
      perMinute: 1,
      waitingPerMinute: 0.5,
      surgeMultiplier: 1.3,
      minimumFare: 40,
      maximumFare: 0
    };

    sinon.stub(Pricing, 'findOne').callsFake(() => ({
      sort: () => Promise.resolve(pricingDoc)
    }));

    const fare = await pricingService.calculateFare(5, 3, 'mini');

    const expected = (25 + (5 * 8) + (3 * 1) + (3 * 0.5)) * 1.3;
    assert.strictEqual(fare, Number(expected.toFixed(2)));
  });

  it('enforces minimum fare and returns rounded currency', async () => {
    const pricingDoc = {
      baseFare: 20,
      perKm: 1,
      perMinute: 0,
      waitingPerMinute: 0,
      surgeMultiplier: 1,
      minimumFare: 75,
      maximumFare: 0
    };

    sinon.stub(Pricing, 'findOne').callsFake(() => ({
      sort: () => Promise.resolve(pricingDoc)
    }));

    const fare = await pricingService.calculateFare(1, 0, 'mini');
    assert.strictEqual(fare, 75);
  });

  it('falls back to legacy calculation when no pricing document exists', async () => {
    sinon.stub(Pricing, 'findOne').callsFake(() => ({
      sort: () => Promise.resolve(null)
    }));

    const fare = await pricingService.calculateFare(1, 0, 'unknown');
    assert.strictEqual(fare, 2);
  });
});
