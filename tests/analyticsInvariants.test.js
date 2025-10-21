const assert = require('assert');
const proxyquire = require('proxyquire').noCallThru();

// These tests verify pure aggregation shape by stubbing Mongoose models.
// They do not hit a real database; they validate query filters and usage.

describe('Analytics invariants', () => {
  it('financeOverview uses completedAt for Booking revenue and tripDate for earnings', async () => {
    const BookingAggCalls = [];
    const AdminEarningsAggCalls = [];
    const DriverEarningsAggCalls = [];

    const ctrl = proxyquire('../controllers/reports/financeOverview.controller', {
      '../../models/bookingModels': {
        Booking: { aggregate: async (pipeline) => { BookingAggCalls.push(pipeline); return [{ _id: null, total: 100 }]; } }
      },
      '../../models/commission': {
        AdminEarnings: { aggregate: async (pipeline) => { AdminEarningsAggCalls.push(pipeline); return [{ _id: null, total: 15 }]; } },
        DriverEarnings: { aggregate: async (pipeline) => { DriverEarningsAggCalls.push(pipeline); return []; } },
        Payout: { aggregate: async () => [{ _id: null, total: 0 }] }
      },
      '../../models/common': { Wallet: { aggregate: async () => [] } }
    });

    const req = { query: { period: 'daily' }, headers: {} };
    const jsonOut = await new Promise((resolve) => {
      const res = {
        json: resolve,
        status: () => ({ json: resolve })
      };
      ctrl.getFinanceOverview(req, res);
    });

    assert.ok(Array.isArray(BookingAggCalls[0]), 'Booking.aggregate was called');
    assert.ok(Array.isArray(AdminEarningsAggCalls[0]), 'AdminEarnings.aggregate was called');

    const bookingMatch = BookingAggCalls[0][0].$match;
    const aeMatch = AdminEarningsAggCalls[0][0].$match;

    assert.ok(bookingMatch.status === 'completed', 'Booking match enforces completed status');
    assert.ok(bookingMatch.completedAt, 'Booking match uses completedAt window');
    assert.ok(aeMatch.tripDate, 'AdminEarnings match uses tripDate window');

    // Response shape
    assert.strictEqual(typeof jsonOut.totalRevenue, 'number');
    assert.strictEqual(typeof jsonOut.commissionEarned, 'number');
  });

  it('dashboard pulls earnings/commission from AdminEarnings with tripDate windows', async () => {
    const adminAggCalls = [];
    const Booking = { countDocuments: async () => 42 };
    const ctrl = proxyquire('../controllers/reports/dashboardReport.controller', {
      '../../models/bookingModels': { Booking },
      '../../models/analytics': { Complaint: { countDocuments: async () => 1 } },
      '../../models/commission': { Payout: { aggregate: async () => [{ _id: null, total: 0 }] }, AdminEarnings: { aggregate: async (p) => { adminAggCalls.push(p); return [{ _id: null, total: 100 }]; } } },
      '../../integrations/userServiceClient': { listPassengers: async () => [], listDrivers: async () => [] },
      '../../utils/logger': { info(){}, error(){} }
    });

    const result = await new Promise((resolve, reject) => {
      ctrl.getDashboardStats({ headers: {} }, { json: resolve }, reject);
    });

    assert.ok(adminAggCalls.length >= 4, 'AdminEarnings.aggregate used for totals and periods');
    assert.strictEqual(typeof result.overview.totalEarnings, 'number');
    assert.strictEqual(typeof result.overview.totalCommission, 'number');
  });
});
