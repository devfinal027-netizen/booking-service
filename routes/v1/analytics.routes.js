const express = require('express');
const router = express.Router();
const ctrl = require('../../controllers/analytics.controller');
const { authenticate, authorize } = require('../../middleware/auth');
const { RewardRate } = require('../../models/commission');

// Dashboard Statistics - Admin only
router.get('/dashboard', authenticate, authorize('admin', 'superadmin'), ctrl.getDashboardStats);

// Revenue Reports - Admin only
router.get('/reports/daily', authenticate, authorize('admin', 'superadmin'), ctrl.getDailyReport);
router.get('/reports/weekly', authenticate, authorize('admin', 'superadmin'), ctrl.getWeeklyReport);
router.get('/reports/monthly', authenticate, authorize('admin', 'superadmin'), ctrl.getMonthlyReport);

// Driver Earnings Management
router.get('/earnings/driver', authenticate, authorize('driver', 'admin', 'superadmin'), ctrl.getDriverEarnings);
router.get('/reports/combined', authenticate, authorize('admin','superadmin','staff'), ctrl.getCombinedReports);

// Commission Management - Admin only
router.post('/commission', authenticate, authorize('admin', 'superadmin'), ctrl.setCommission);
router.get('/commission', authenticate, authorize('admin', 'superadmin'), ctrl.getCommission);

// Ride History - Available to drivers and passengers
router.get('/rides/history', authenticate, authorize('driver', 'passenger', 'admin', 'superadmin'), ctrl.getRideHistory);

// Trip History by User ID - For user service integration
router.get('/trips/history/:userType/:userId', ctrl.getTripHistoryByUserId);

// Finance Overview - Admin only
router.get('/finance/overview', authenticate, authorize('admin', 'superadmin'), ctrl.getFinanceOverview);

// Rewards endpoints
router.get('/rewards/passenger', authenticate, authorize('passenger','admin','superadmin'), ctrl.getPassengerRewards);
router.get('/rewards/driver', authenticate, authorize('driver','admin','superadmin'), ctrl.getDriverRewards);
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
