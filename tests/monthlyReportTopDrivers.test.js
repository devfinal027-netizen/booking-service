const assert = require('assert');
const proxyquire = require('proxyquire').noCallThru();

describe('Monthly Report Top Drivers', () => {
  it('should include topDrivers with driver information in monthly report', async () => {
    const DriverEarningsAggCalls = [];
    const buildUserMapsCalls = [];
    
    const mockDriverEarnings = [
      { _id: 'driver1', rides: 149, gross: 9104.55, commission: 1365.68, net: 7738.87 },
      { _id: 'driver2', rides: 72, gross: 4135.51, commission: 620.33, net: 3515.18 },
      { _id: 'driver3', rides: 2, gross: 86.30, commission: 12.95, net: 73.35 }
    ];

    const mockDriverMap = {
      'driver1': { id: 'driver1', name: 'John Doe', phone: '+251911234567', email: 'john@example.com' },
      'driver2': { id: 'driver2', name: 'Jane Smith', phone: '+251922345678', email: 'jane@example.com' },
      'driver3': { id: 'driver3', name: 'Bob Johnson', phone: '+251933456789', email: 'bob@example.com' }
    };

    const ctrl = proxyquire('../controllers/reports/periodicReports.controller.js', {
      '../../models/bookingModels': {
        Booking: { 
          find: async () => [],
          aggregate: async () => []
        }
      },
      '../../models/commission': {
        AdminEarnings: { 
          aggregate: async () => [{ _id: null, total: 2000 }] 
        },
        DriverEarnings: { 
          aggregate: async (pipeline) => { 
            DriverEarningsAggCalls.push(pipeline);
            return mockDriverEarnings;
          } 
        }
      },
      './_utils': {
        buildUserMaps: async (driverIds, passengerIds) => {
          buildUserMapsCalls.push({ driverIds, passengerIds });
          return { 
            driverMap: mockDriverMap, 
            passengerMap: {} 
          };
        },
        buildTimeRange: () => ({
          start: new Date('2024-01-01'),
          end: new Date('2024-01-31'),
          inclusiveEnd: true
        })
      }
    });

    const req = { 
      query: { month: 1, year: 2024 }, 
      headers: { authorization: 'Bearer test-token' } 
    };
    
    const jsonOut = await new Promise((resolve) => {
      const res = {
        json: resolve,
        status: () => ({ json: resolve })
      };
      ctrl.getMonthlyReport(req, res);
    });

    // Verify the aggregation pipeline was called
    assert.ok(Array.isArray(DriverEarningsAggCalls[0]), 'DriverEarnings.aggregate was called');
    
    // Verify the pipeline structure
    const pipeline = DriverEarningsAggCalls[0];
    assert.ok(pipeline[0].$match, 'Pipeline has $match stage');
    assert.ok(pipeline[1].$group, 'Pipeline has $group stage');
    assert.ok(pipeline[2].$sort, 'Pipeline has $sort stage');
    assert.ok(pipeline[3].$limit, 'Pipeline has $limit stage');
    assert.strictEqual(pipeline[3].$limit, 10, 'Limit is set to 10');

    // Verify buildUserMaps was called with correct driver IDs
    assert.ok(buildUserMapsCalls.length > 0, 'buildUserMaps was called');
    const driverIds = buildUserMapsCalls[0].driverIds;
    assert.ok(driverIds.includes('driver1'), 'Driver1 ID included');
    assert.ok(driverIds.includes('driver2'), 'Driver2 ID included');
    assert.ok(driverIds.includes('driver3'), 'Driver3 ID included');

    // Verify response structure
    assert.ok(Array.isArray(jsonOut.topDrivers), 'Response includes topDrivers array');
    assert.strictEqual(jsonOut.topDrivers.length, 3, 'Top drivers array has correct length');

    // Verify driver information is properly enriched
    const topDriver = jsonOut.topDrivers[0];
    assert.strictEqual(topDriver.driverId, 'driver1', 'Driver ID is correct');
    assert.strictEqual(topDriver.name, 'John Doe', 'Driver name is correct');
    assert.strictEqual(topDriver.phone, '+251911234567', 'Driver phone is correct');
    assert.strictEqual(topDriver.email, 'john@example.com', 'Driver email is correct');
    assert.strictEqual(topDriver.rides, 149, 'Driver rides count is correct');
    assert.strictEqual(topDriver.netEarnings, 7738.87, 'Driver net earnings is correct');

    // Verify sorting (highest earnings first)
    assert.ok(jsonOut.topDrivers[0].netEarnings >= jsonOut.topDrivers[1].netEarnings, 'Drivers are sorted by earnings');
    assert.ok(jsonOut.topDrivers[1].netEarnings >= jsonOut.topDrivers[2].netEarnings, 'Drivers are sorted by earnings');
  });

  it('should handle missing driver information gracefully', async () => {
    const mockDriverEarnings = [
      { _id: 'unknown-driver', rides: 5, gross: 100, commission: 15, net: 85 }
    ];

    const ctrl = proxyquire('../controllers/reports/periodicReports.controller.js', {
      '../../models/bookingModels': {
        Booking: { 
          find: async () => [],
          aggregate: async () => []
        }
      },
      '../../models/commission': {
        AdminEarnings: { 
          aggregate: async () => [{ _id: null, total: 2000 }] 
        },
        DriverEarnings: { 
          aggregate: async () => mockDriverEarnings
        }
      },
      './_utils': {
        buildUserMaps: async () => ({ 
          driverMap: {}, // Empty driver map
          passengerMap: {} 
        }),
        buildTimeRange: () => ({
          start: new Date('2024-01-01'),
          end: new Date('2024-01-31'),
          inclusiveEnd: true
        })
      }
    });

    const req = { 
      query: { month: 1, year: 2024 }, 
      headers: { authorization: 'Bearer test-token' } 
    };
    
    const jsonOut = await new Promise((resolve) => {
      const res = {
        json: resolve,
        status: () => ({ json: resolve })
      };
      ctrl.getMonthlyReport(req, res);
    });

    // Verify response handles missing driver info gracefully
    assert.ok(Array.isArray(jsonOut.topDrivers), 'Response includes topDrivers array');
    assert.strictEqual(jsonOut.topDrivers.length, 1, 'Top drivers array has correct length');

    const topDriver = jsonOut.topDrivers[0];
    assert.strictEqual(topDriver.driverId, 'unknown-driver', 'Driver ID is correct');
    assert.strictEqual(topDriver.name, 'Driver unknown-driver', 'Fallback name is used');
    assert.strictEqual(topDriver.phone, 'N/A', 'Fallback phone is used');
    assert.strictEqual(topDriver.email, 'N/A', 'Fallback email is used');
    assert.strictEqual(topDriver.rides, 5, 'Driver rides count is correct');
    assert.strictEqual(topDriver.netEarnings, 85, 'Driver net earnings is correct');
  });
});
