const dayjs = require('dayjs');
const logger = require('../../utils/logger');
const { Booking } = require('../../models/bookingModels');
const { Complaint } = require('../../models/analytics');
const { Payout } = require('../../models/commission');

exports.getDashboardStats = async (req, res) => {
  try {
    const today = dayjs().startOf('day').toDate();
    const thisWeek = dayjs().startOf('week').toDate();
    const thisMonth = dayjs().startOf('month').toDate();

    // Total counts
    const totalRides = await Booking.countDocuments();
    // Earnings are only from completed trips with a finalized fare
    const totalEarningsAgg = await Booking.aggregate([
      { $match: { status: 'completed', fareFinal: { $gt: 0 } } },
      { $group: { _id: null, total: { $sum: '$fareFinal' } } }
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
    const todayEarningsAgg = await Booking.aggregate([
      { $match: { status: 'completed', createdAt: { $gte: today }, fareFinal: { $gt: 0 } } },
      { $group: { _id: null, total: { $sum: '$fareFinal' } } }
    ]);

    // This week's stats
    const weekRides = await Booking.countDocuments({
      createdAt: { $gte: thisWeek },
    });
    const weekEarningsAgg = await Booking.aggregate([
      { $match: { status: 'completed', createdAt: { $gte: thisWeek }, fareFinal: { $gt: 0 } } },
      { $group: { _id: null, total: { $sum: '$fareFinal' } } }
    ]);

    // This month's stats
    const monthRides = await Booking.countDocuments({
      createdAt: { $gte: thisMonth },
    });
    const monthEarningsAgg = await Booking.aggregate([
      { $match: { status: 'completed', createdAt: { $gte: thisMonth }, fareFinal: { $gt: 0 } } },
      { $group: { _id: null, total: { $sum: '$fareFinal' } } }
    ]);

    // Commission stats - derived from completed trips
    const commissionRate = Number(process.env.COMMISSION_RATE || 15);
    const commissionsAgg = await Booking.aggregate([
      { $match: { status: 'completed', fareFinal: { $gt: 0 } } },
      { $group: { _id: null, total: { $sum: '$fareFinal' } } }
    ]);
    const totalCommissionVal = ((commissionsAgg[0]?.total || 0) * commissionRate) / 100;

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


