const dayjs = require('dayjs');
const logger = require('../../utils/logger');
const { Booking } = require('../../models/bookingModels');
const { Complaint } = require('../../models/analytics');
const { Payout, AdminEarnings } = require('../../models/commission');

exports.getDashboardStats = async (req, res) => {
  try {
    const today = dayjs().startOf('day').toDate();
    const thisWeek = dayjs().startOf('week').toDate();
    const thisMonth = dayjs().startOf('month').toDate();

    // Total counts
    const totalRides = await Booking.countDocuments();
    // Earnings are sourced from AdminEarnings for accuracy
    const totalEarningsAgg = await AdminEarnings.aggregate([
      { $group: { _id: null, total: { $sum: '$grossFare' } } }
    ]);
    // Fetch user counts from external service
    let totalUsers = 0;
    let totalDrivers = 0;
    let totalCars = 0;
    try {
      const { listPassengers, listDrivers } = require('../../integrations/userServiceClient');
      const authHeader = req.headers && req.headers.authorization ? { Authorization: req.headers.authorization } : undefined;
      const [p, d] = await Promise.all([
        listPassengers({}, { headers: authHeader }),
        listDrivers({}, { headers: authHeader })
      ]);
      totalUsers = Array.isArray(p) ? p.length : 0;
      totalDrivers = Array.isArray(d) ? d.length : 0;
      totalCars = totalDrivers;
    } catch (_) {}
    const totalComplaints = await Complaint.countDocuments();

    // Today's stats
    const todayRides = await Booking.countDocuments({
      createdAt: { $gte: today },
    });
    const tomorrow = dayjs(today).add(1, 'day').toDate();
    const todayEarningsAgg = await AdminEarnings.aggregate([
      { $match: { tripDate: { $gte: today, $lt: tomorrow } } },
      { $group: { _id: null, total: { $sum: '$grossFare' } } }
    ]);

    // This week's stats
    const weekRides = await Booking.countDocuments({
      createdAt: { $gte: thisWeek },
    });
    const weekEnd = dayjs(thisWeek).endOf('week').toDate();
    const weekEarningsAgg = await AdminEarnings.aggregate([
      { $match: { tripDate: { $gte: thisWeek, $lte: weekEnd } } },
      { $group: { _id: null, total: { $sum: '$grossFare' } } }
    ]);

    // This month's stats
    const monthRides = await Booking.countDocuments({
      createdAt: { $gte: thisMonth },
    });
    const monthEnd = dayjs(thisMonth).endOf('month').toDate();
    const monthEarningsAgg = await AdminEarnings.aggregate([
      { $match: { tripDate: { $gte: thisMonth, $lte: monthEnd } } },
      { $group: { _id: null, total: { $sum: '$grossFare' } } }
    ]);

    // Commission stats - from AdminEarnings
    const commissionsAgg = await AdminEarnings.aggregate([
      { $group: { _id: null, total: { $sum: '$commissionEarned' } } }
    ]);
    const totalCommissionVal = commissionsAgg[0]?.total || 0;

    // Pending payouts
    const pendingPayoutsAgg = await Payout.aggregate([
      { $match: { status: 'pending' } },
      { $group: { _id: null, total: { $sum: '$netPayout' } } }
    ]);

    res.json({
      overview: {
        totalRides,
        totalEarnings: totalEarningsAgg[0]?.total || 0,
        totalUsers,
        totalDrivers,
        totalCars,
        totalComplaints,
        totalCommission: totalCommissionVal,
        pendingPayouts: pendingPayoutsAgg[0]?.total || 0
      },
      today: {
        rides: todayRides,
        earnings: todayEarningsAgg[0]?.total || 0
      },
      thisWeek: {
        rides: weekRides,
        earnings: weekEarningsAgg[0]?.total || 0
      },
      thisMonth: {
        rides: monthRides,
        earnings: monthEarningsAgg[0]?.total || 0
      }
    });
  } catch (e) {
    logger.error('[analytics.dashboard] failed', { error: e && e.message, stack: e && e.stack });
    res.status(500).json({ message: `Failed to get dashboard stats: ${e.message}` });
  }
};


