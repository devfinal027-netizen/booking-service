const assert = require('assert');
const sinon = require('sinon');
const proxyquire = require('proxyquire').noCallThru();

function makeRes() {
  const res = {};
  res.statusCode = 200;
  res.status = function (code) { this.statusCode = code; return this; };
  res.body = undefined;
  res.json = function (obj) { this.body = obj; return this; };
  return res;
}

describe('driver.controller.getLocationByPhone', () => {
  let DriverStub;
  let dispatchRegistryStub;
  let controller;
  let crudControllerStub;
  let bookingModelsStub;

  beforeEach(() => {
    DriverStub = {
      findOne: sinon.stub()
    };

    dispatchRegistryStub = {
      getLiveLocation: sinon.stub()
    };

    crudControllerStub = {
      crudController: sinon.stub().returns({})
    };

    bookingModelsStub = {
      Live: {
        findOne: sinon.stub()
      }
    };

    controller = proxyquire('../controllers/driver.controller', {
      '../models/userModels': { Driver: DriverStub },
      '../sockets/dispatchRegistry': dispatchRegistryStub,
      './basic.crud': crudControllerStub,
      '../models/bookingModels': bookingModelsStub
    });
  });

  afterEach(() => sinon.restore());

  function chainFindOneReturn(row) {
    return {
      select: () => ({
        lean: () => Promise.resolve(row)
      })
    };
  }

  function chainLiveFindOneReturn(row) {
    return {
      sort: () => ({
        lean: () => Promise.resolve(row)
      })
    };
  }

  it('returns live location when available', async () => {
    const phone = '251911111111';
    const row = {
      _id: 'driver-1',
      name: 'Alice',
      phone,
      available: true,
      lastKnownLocation: { latitude: 8.9, longitude: 38.7, bearing: 90 },
      updatedAt: new Date('2025-10-10T12:00:00Z')
    };
    DriverStub.findOne.callsFake(() => chainFindOneReturn(row));
    dispatchRegistryStub.getLiveLocation.withArgs('driver-1').returns({
      latitude: 9.001,
      longitude: 38.771,
      bearing: 30,
      updatedAt: Date.parse('2025-10-10T12:05:00Z')
    });

    const req = { params: { phone } };
    const res = makeRes();

    await controller.getLocationByPhone(req, res);

    assert.strictEqual(res.statusCode, 200);
    assert(res.body, 'expected response body');
    assert.strictEqual(res.body.driverId, 'driver-1');
    assert.strictEqual(res.body.phone, phone);
    assert.strictEqual(res.body.source, 'live');
    assert.deepStrictEqual(res.body.location, { latitude: 9.001, longitude: 38.771, bearing: 30 });
    assert.strictEqual(res.body.subscribeEvent, 'driver:location:driver-1');
  });

  it('falls back to DB lastKnownLocation when live not available', async () => {
    const phone = '251922222222';
    const row = {
      _id: 'driver-2',
      name: 'Bob',
      phone,
      available: false,
      lastKnownLocation: { latitude: 8.8, longitude: 38.6 },
      updatedAt: new Date('2025-10-11T09:00:00Z')
    };
    DriverStub.findOne.callsFake(() => chainFindOneReturn(row));
    dispatchRegistryStub.getLiveLocation.withArgs('driver-2').returns(null);
    bookingModelsStub.Live.findOne.returns(chainLiveFindOneReturn(null));

    const req = { params: { phone } };
    const res = makeRes();

    await controller.getLocationByPhone(req, res);

    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(res.body.source, 'db');
    assert.deepStrictEqual(res.body.location, { latitude: 8.8, longitude: 38.6 });
  });

  it('returns 404 when driver is not found', async () => {
    const phone = '251933333333';
    DriverStub.findOne.callsFake(() => chainFindOneReturn(null));

    const req = { params: { phone } };
    const res = makeRes();

    await controller.getLocationByPhone(req, res);

    assert.strictEqual(res.statusCode, 404);
    assert.strictEqual(res.body && res.body.message, 'Driver not found');
  });

  it('returns 400 when phone missing', async () => {
    const req = { params: {} };
    const res = makeRes();

    await controller.getLocationByPhone(req, res);

    assert.strictEqual(res.statusCode, 400);
    assert.strictEqual(res.body && res.body.message, 'phone is required');
  });
});
