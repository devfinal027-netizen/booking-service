const express = require('express');
const router = express.Router();
const dashboardCtrl = require('../../controllers/reports/dashboardReport.controller');
const periodicCtrl = require('../../controllers/reports/periodicReports.controller');
const earningsCtrl = require('../../controllers/reports/driverEarnings.controller');
const financeCtrl = require('../../controllers/reports/financeOverview.controller');
const rewardsBaseCtrl = require('../../controllers/analytics.controller');
const historyCtrl = require('../../controllers/reports/rideHistory.controller');
const { authenticate, authorize } = require('../../middleware/auth');
const { RewardRate } = require('../../models/commission');

// Dashboard Statistics - Admin only
router.get('/dashboard', authenticate, authorize('admin', 'superadmin'), dashboardCtrl.getDashboardStats);

// Revenue Reports - Admin only
router.get('/reports/daily', authenticate, authorize('admin', 'superadmin'), periodicCtrl.getDailyReport);
router.get('/reports/weekly', authenticate, authorize('admin', 'superadmin'), periodicCtrl.getWeeklyReport);
router.get('/reports/monthly', authenticate, authorize('admin', 'superadmin'), periodicCtrl.getMonthlyReport);

// Driver Earnings Management
router.get('/earnings/driver', authenticate, authorize('driver', 'admin', 'superadmin'), earningsCtrl.getDriverEarnings);
// Combined report removed per plan

// Commission Management - Admin only
router.post('/commission', authenticate, authorize('admin', 'superadmin'), rewardsBaseCtrl.setCommission);
router.get('/commission', authenticate, authorize('admin', 'superadmin'), rewardsBaseCtrl.getCommission);

// Ride History - Available to drivers and passengers
router.get('/rides/history', authenticate, authorize('driver', 'passenger', 'admin', 'superadmin'), historyCtrl.getRideHistory);

// Trip History by User ID - For user service integration
router.get('/trips/history/:userType/:userId', historyCtrl.getTripHistoryByUserId);

// Finance Overview - Admin only
router.get('/finance/overview', authenticate, authorize('admin', 'superadmin'), financeCtrl.getFinanceOverview);

// Rewards endpoints
router.get('/rewards/passenger', authenticate, authorize('passenger','admin','superadmin'), rewardsBaseCtrl.getPassengerRewards);
router.get('/rewards/driver', authenticate, authorize('driver','admin','superadmin'), rewardsBaseCtrl.getDriverRewards);
// Admin: set rewards per km for passenger/driver
router.post('/rewards/config', authenticate, authorize('admin','superadmin'), async (req, res) => {
  try {
    const { role, perKm, currency } = req.body || {};
    if (!['driver','passenger'].includes(String(role))) return res.status(400).json({ message: 'role must be driver or passenger' });
    if (!Number.isFinite(Number(perKm)) || Number(perKm) < 0) return res.status(400).json({ message: 'perKm must be a non-negative number' });
    const updated = await RewardRate.findOneAndUpdate(
      { role: String(role) },
      { $set: { perKm: Number(perKm), currency: currency || 'ETB', updatedBy: String(req.user.id) } },
      { new: true, upsert: true }
    ).lean();
    return res.json(updated);
  } catch (e) { return res.status(500).json({ message: e.message }); }
});

module.exports = router;
