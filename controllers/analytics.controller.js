const dayjs = require('dayjs');
const logger = require('../utils/logger');
const { Booking, TripHistory } = require('../models/bookingModels');
const { Driver, Passenger } = require('../models/userModels');
const { Commission, DriverEarnings, AdminEarnings, Payout, RewardRate } = require('../models/commission');
const { DailyReport, WeeklyReport, MonthlyReport, Complaint } = require('../models/analytics');
const { Wallet, Transaction } = require('../models/common');

// Dashboard Statistics
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
      const { listPassengers, listDrivers } = require('../integrations/userServiceClient');
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

    // Commission stats
    // Commission should be derived from completed trips in the period to avoid drift
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

// Revenue Reports
exports.getDailyReport = async (req, res) => {
  try {
    const { date } = req.query;
    const targetDate = date ? dayjs(date).startOf('day').toDate() : dayjs().startOf('day').toDate();
    const nextDay = dayjs(targetDate).add(1, 'day').toDate();
    const commissionRate = Number(process.env.COMMISSION_RATE || 15);

    // Get or create daily report
    let report = await DailyReport.findOne({ date: targetDate });
    
    if (!report) {
      // Generate report for the day
      const rides = await Booking.find({
        createdAt: { $gte: targetDate, $lt: nextDay }
      }).populate('driverId passengerId');
      logger.info('[analytics.daily] fetched rides', { count: rides.length, targetDate });

      const totalRevenue = rides
        .filter(r => r.status === 'completed')
        .reduce((sum, r) => sum + (r.fareFinal || r.fareEstimated), 0);

      const totalCommission = await AdminEarnings.aggregate([
        { $match: { tripDate: { $gte: targetDate, $lt: nextDay } } },
        { $group: { _id: null, total: { $sum: '$commissionEarned' } } }
      ]);

      const completedCountD = rides.filter(r => r.status === 'completed').length;
      const avgFareD = completedCountD > 0 ? totalRevenue / completedCountD : 0;
      report = await DailyReport.create({
        date: targetDate,
        totalRides: rides.length,
        totalRevenue,
        totalCommission: totalCommission[0]?.total || 0,
        completedRides: completedCountD,
        canceledRides: rides.filter(r => r.status === 'canceled').length,
        averageFare: Number.isFinite(avgFareD) ? avgFareD : 0,
        // Persist a basic snapshot; response below will enrich with user details on-the-fly
        rideDetails: rides.map(r => ({
          bookingId: r._id,
          driverId: String(r.driverId?._id || r.driverId || ''),
          driverName: r.driverId && typeof r.driverId === 'object' ? r.driverId.name : r.driverName,
          driverPhone: r.driverId && typeof r.driverId === 'object' ? r.driverId.phone : r.driverPhone,
          driverEmail: r.driverId && typeof r.driverId === 'object' ? r.driverId.email : r.driverEmail,
          passengerId: String(r.passengerId?._id || r.passengerId || ''),
          passengerName: r.passengerId && typeof r.passengerId === 'object' ? r.passengerId.name : r.passengerName,
          passengerPhone: r.passengerId && typeof r.passengerId === 'object' ? r.passengerId.phone : r.passengerPhone,
          passengerEmail: r.passengerId && typeof r.passengerId === 'object' ? r.passengerId.email : r.passengerEmail,
          fare: Number(r.fareFinal || r.fareEstimated || 0),
          commission: Number(r.fareFinal || r.fareEstimated || 0) * (commissionRate / 100),
          status: r.status,
          vehicleType: r.vehicleType,
          distanceKm: Number(r.distanceKm || 0)
        }))
      });
    }

    // Always enrich rideDetails for response with user names/phones
    const ridesForDetails = await Booking.find({
      createdAt: { $gte: targetDate, $lt: nextDay }
    }).populate('driverId passengerId').lean();
    logger.info('[analytics.daily] enrich details', { count: ridesForDetails.length });

    const rideDetails = ridesForDetails.map(r => ({
      bookingId: r._id,
      driverId: String(r.driverId?._id || r.driverId || ''),
      driverName: r.driverId && typeof r.driverId === 'object' ? r.driverId.name : r.driverName,
      driverPhone: r.driverId && typeof r.driverId === 'object' ? r.driverId.phone : r.driverPhone,
      driverEmail: r.driverId && typeof r.driverId === 'object' ? r.driverId.email : r.driverEmail,
      passengerId: String(r.passengerId?._id || r.passengerId || ''),
      passengerName: r.passengerId && typeof r.passengerId === 'object' ? r.passengerId.name : r.passengerName,
      passengerPhone: r.passengerId && typeof r.passengerId === 'object' ? r.passengerId.phone : r.passengerPhone,
      passengerEmail: r.passengerId && typeof r.passengerId === 'object' ? r.passengerId.email : r.passengerEmail,
      fare: Number(r.fareFinal || r.fareEstimated || 0),
      commission: Number(r.fareFinal || r.fareEstimated || 0) * (commissionRate / 100),
      status: r.status,
      vehicleType: r.vehicleType,
      distanceKm: Number(r.distanceKm || 0),
      _id: r._id
    }));

    const payload = report && typeof report.toObject === 'function' ? report.toObject() : report;
    res.json({
      ...payload,
      rideDetails
    });
  } catch (e) {
    logger.error('[analytics.daily] failed', { error: e && e.message, stack: e && e.stack });
    res.status(500).json({ message: `Failed to get daily report: ${e.message}` });
  }
};

exports.getWeeklyReport = async (req, res) => {
  try {
    const { weekStart } = req.query;
    const startDate = weekStart ? dayjs(weekStart).startOf('week').toDate() : dayjs().startOf('week').toDate();
    const endDate = dayjs(startDate).endOf('week').toDate();
    const commissionRate = Number(process.env.COMMISSION_RATE || 15);

    // Always compute from live data for accuracy
    const rides = await Booking.find({ createdAt: { $gte: startDate, $lte: endDate } })
      .populate('driverId passengerId')
      .lean();
    logger.info('[analytics.weekly] rides', { count: rides.length, startDate, endDate });

    const completed = rides.filter(r => r.status === 'completed');
    const totalRevenue = completed.reduce((sum, r) => sum + Number(r.fareFinal || 0), 0);

    const commissionAgg = await AdminEarnings.aggregate([
      { $match: { tripDate: { $gte: startDate, $lte: endDate } } },
      { $group: { _id: null, total: { $sum: '$commissionEarned' } } }
    ]);
    const totalCommission = commissionAgg[0]?.total || 0;

    const avgFare = completed.length > 0 ? totalRevenue / completed.length : 0;

    // Top drivers by net earnings in the week
    const topDriversAgg = await require('../models/commission').DriverEarnings.aggregate([
      { $match: { tripDate: { $gte: startDate, $lte: endDate } } },
      { $group: { _id: '$driverId', rides: { $sum: 1 }, gross: { $sum: '$grossFare' }, commission: { $sum: '$commissionAmount' }, net: { $sum: '$netEarnings' } } },
      { $sort: { net: -1 } },
      { $limit: 10 }
    ]);
    logger.info('[analytics.weekly] topDriversAgg', { count: topDriversAgg.length });

    // Enrich top drivers with name/phone
    let topDrivers = topDriversAgg;
    try {
      const ids = topDriversAgg.map(d => String(d._id)).filter(Boolean);
      const { Types } = require('mongoose');
      const valid = ids.filter(id => Types.ObjectId.isValid(id));
      const local = valid.length ? await Driver.find({ _id: { $in: valid } }).select({ _id: 1, name: 1, phone: 1, email: 1 }).lean() : [];
      const lmap = Object.fromEntries(local.map(d => [String(d._id), { name: d.name, phone: d.phone, email: d.email }]));
      topDrivers = topDriversAgg.map(d => ({
        driverId: String(d._id),
        driverName: lmap[String(d._id)]?.name,
        driverPhone: lmap[String(d._id)]?.phone,
        driverEmail: lmap[String(d._id)]?.email,
        rides: d.rides,
        gross: d.gross,
        commission: d.commission,
        net: d.net,
        name: lmap[String(d._id)]?.name,
        phone: lmap[String(d._id)]?.phone,
        email: lmap[String(d._id)]?.email
      }));
    } catch (_) {}

    // Enrich ride details with user information
    const rideDetails = rides.map(r => ({
      bookingId: r._id,
      driverId: String(r.driverId?._id || r.driverId || ''),
      driverName: r.driverId && typeof r.driverId === 'object' ? r.driverId.name : r.driverName,
      driverPhone: r.driverId && typeof r.driverId === 'object' ? r.driverId.phone : r.driverPhone,
      driverEmail: r.driverId && typeof r.driverId === 'object' ? r.driverId.email : r.driverEmail,
      passengerId: String(r.passengerId?._id || r.passengerId || ''),
      passengerName: r.passengerId && typeof r.passengerId === 'object' ? r.passengerId.name : r.passengerName,
      passengerPhone: r.passengerId && typeof r.passengerId === 'object' ? r.passengerId.phone : r.passengerPhone,
      passengerEmail: r.passengerId && typeof r.passengerId === 'object' ? r.passengerId.email : r.passengerEmail,
      fare: Number(r.fareFinal || r.fareEstimated || 0),
      commission: Number(r.fareFinal || r.fareEstimated || 0) * (commissionRate / 100),
      status: r.status,
      vehicleType: r.vehicleType,
      distanceKm: Number(r.distanceKm || 0),
      _id: r._id
    }));

    res.json({
      weekStart: startDate,
      weekEnd: endDate,
      totalRides: rides.length,
      completedRides: completed.length,
      canceledRides: rides.filter(r => r.status === 'canceled').length,
      totalRevenue,
      totalCommission,
      averageFare: Number.isFinite(avgFare) ? avgFare : 0,
      topDrivers,
      rideDetails
    });
  } catch (e) {
    logger.error('[analytics.weekly] failed', { error: e && e.message, stack: e && e.stack });
    res.status(500).json({ message: `Failed to get weekly report: ${e.message}` });
  }
};

exports.getMonthlyReport = async (req, res) => {
  try {
    const { month, year } = req.query;
    const targetMonth = month ? parseInt(month) : dayjs().month() + 1;
    const targetYear = year ? parseInt(year) : dayjs().year();
    const startDate = dayjs().month(targetMonth - 1).year(targetYear).startOf('month').toDate();
    const endDate = dayjs().month(targetMonth - 1).year(targetYear).endOf('month').toDate();
    const commissionRate = Number(process.env.COMMISSION_RATE || 15);

    let report = await MonthlyReport.findOne({ month: targetMonth, year: targetYear });
    
    if (!report) {
      // Generate monthly report
      const rides = await Booking.find({
        createdAt: { $gte: startDate, $lte: endDate }
      });

      const totalRevenue = rides
        .filter(r => r.status === 'completed')
        .reduce((sum, r) => sum + (r.fareFinal || r.fareEstimated), 0);

      const totalCommission = await AdminEarnings.aggregate([
        { $match: { tripDate: { $gte: startDate, $lte: endDate } } },
        { $group: { _id: null, total: { $sum: '$commissionEarned' } } }
      ]);

      const completedCountM = rides.filter(r => r.status === 'completed').length;
      const avgFareM = completedCountM > 0 ? totalRevenue / completedCountM : 0;
      report = await MonthlyReport.create({
        month: targetMonth,
        year: targetYear,
        totalRides: rides.length,
        totalRevenue,
        totalCommission: totalCommission[0]?.total || 0,
        completedRides: completedCountM,
        canceledRides: rides.filter(r => r.status === 'canceled').length,
        averageFare: Number.isFinite(avgFareM) ? avgFareM : 0
      });
    }

    // Enrich response with ride details including user info
    const ridesForDetails = await Booking.find({
      createdAt: { $gte: startDate, $lte: endDate }
    }).populate('driverId passengerId').lean();
    logger.info('[analytics.monthly] enrich details', { count: ridesForDetails.length, month: targetMonth, year: targetYear });

    const rideDetails = ridesForDetails.map(r => ({
      bookingId: r._id,
      driverId: String(r.driverId?._id || r.driverId || ''),
      driverName: r.driverId && typeof r.driverId === 'object' ? r.driverId.name : r.driverName,
      driverPhone: r.driverId && typeof r.driverId === 'object' ? r.driverId.phone : r.driverPhone,
      driverEmail: r.driverId && typeof r.driverId === 'object' ? r.driverId.email : r.driverEmail,
      passengerId: String(r.passengerId?._id || r.passengerId || ''),
      passengerName: r.passengerId && typeof r.passengerId === 'object' ? r.passengerId.name : r.passengerName,
      passengerPhone: r.passengerId && typeof r.passengerId === 'object' ? r.passengerId.phone : r.passengerPhone,
      passengerEmail: r.passengerId && typeof r.passengerId === 'object' ? r.passengerId.email : r.passengerEmail,
      fare: Number(r.fareFinal || r.fareEstimated || 0),
      commission: Number(r.fareFinal || r.fareEstimated || 0) * (commissionRate / 100),
      status: r.status,
      vehicleType: r.vehicleType,
      distanceKm: Number(r.distanceKm || 0),
      _id: r._id
    }));

    const payload = report && typeof report.toObject === 'function' ? report.toObject() : report;
    res.json({
      ...payload,
      rideDetails
    });
  } catch (e) {
    logger.error('[analytics.monthly] failed', { error: e && e.message, stack: e && e.stack });
    res.status(500).json({ message: `Failed to get monthly report: ${e.message}` });
  }
};

// Combined reports across bookings, commissions, trip history, wallet, and analytics models
exports.getCombinedReports = async (req, res) => {
  try {
    const dayjs = require('dayjs');
    const period = String(req.query.period || 'daily').toLowerCase();
    const baseDate = req.query.date ? dayjs(req.query.date) : dayjs();

    let startDate;
    let endDate;
    if (period === 'weekly') {
      startDate = baseDate.startOf('week').toDate();
      endDate = baseDate.endOf('week').toDate();
    } else if (period === 'monthly') {
      startDate = baseDate.startOf('month').toDate();
      endDate = baseDate.endOf('month').toDate();
    } else {
      startDate = baseDate.startOf('day').toDate();
      endDate = baseDate.endOf('day').toDate();
    }

    // Bookings summary
    const bookings = await Booking.find({ createdAt: { $gte: startDate, $lte: endDate } }).lean();
    logger.info('[analytics.combined] bookings', { count: bookings.length, startDate, endDate });
    const completed = bookings.filter(b => b.status === 'completed');
    const canceled = bookings.filter(b => b.status === 'canceled');
    const totalRevenue = completed.reduce((sum, b) => sum + Number(b.fareFinal || 0), 0);
    const averageFare = completed.length ? totalRevenue / completed.length : 0;
    const uniqueDrivers = new Set(bookings.map(b => b.driverId).filter(Boolean)).size;
    const uniquePassengers = new Set(bookings.map(b => b.passengerId).filter(Boolean)).size;

    // Commissions summary
    const commissionMatch = { tripDate: { $gte: startDate, $lte: endDate } };
    const adminEarningsAgg = await require('../models/commission').AdminEarnings.aggregate([
      { $match: commissionMatch },
      { $group: { _id: null, commission: { $sum: '$commissionEarned' }, gross: { $sum: '$grossFare' } } }
    ]);
    const driverEarningsAgg = await require('../models/commission').DriverEarnings.aggregate([
      { $match: commissionMatch },
      { $group: { _id: null, grossFare: { $sum: '$grossFare' }, commissionAmount: { $sum: '$commissionAmount' }, netEarnings: { $sum: '$netEarnings' } } }
    ]);
    logger.info('[analytics.combined] earningsAgg', { admin: adminEarningsAgg[0], driver: driverEarningsAgg[0] });

    // Driver earnings breakdown by driver with enrichment
    const driverBreakdownAgg = await require('../models/commission').DriverEarnings.aggregate([
      { $match: commissionMatch },
      { $group: { _id: '$driverId', grossFare: { $sum: '$grossFare' }, commissionAmount: { $sum: '$commissionAmount' }, netEarnings: { $sum: '$netEarnings' } } },
      { $sort: { netEarnings: -1 } }
    ]);
    let driverBreakdown = driverBreakdownAgg;
    try {
      const ids = driverBreakdownAgg.map(d => String(d._id)).filter(Boolean);
      const { Types } = require('mongoose');
      const valid = ids.filter(id => Types.ObjectId.isValid(id));
      const local = valid.length ? await Driver.find({ _id: { $in: valid } }).select({ _id: 1, name: 1, phone: 1 }).lean() : [];
      const lmap = Object.fromEntries(local.map(d => [String(d._id), { name: d.name, phone: d.phone }]));
      driverBreakdown = driverBreakdownAgg.map(d => ({
        driverId: String(d._id),
        name: lmap[String(d._id)]?.name,
        phone: lmap[String(d._id)]?.phone,
        grossFare: d.grossFare,
        commissionAmount: d.commissionAmount,
        netEarnings: d.netEarnings
      }));
    } catch (_) {}

    // Trip history summary
    const trips = await TripHistory.find({ createdAt: { $gte: startDate, $lte: endDate } }).lean();
    logger.info('[analytics.combined] trips', { count: trips.length });
    const tripEvents = trips.length;
    const tripDistance = trips.reduce((s, t) => s + Number(t.distance || 0), 0);
    const tripDuration = trips.reduce((s, t) => s + Number(t.duration || 0), 0);

    // Wallet summary
    const txMatch = { createdAt: { $gte: startDate, $lte: endDate } };
    const txAgg = await Transaction.aggregate([
      { $match: txMatch },
      { $group: { _id: { role: '$role', type: '$type' }, count: { $sum: 1 }, total: { $sum: '$amount' } } }
    ]);
    const driverBalanceAgg = await Wallet.aggregate([
      { $match: { role: 'driver' } },
      { $group: { _id: null, total: { $sum: '$balance' } } }
    ]);
    const passengerBalanceAgg = await Wallet.aggregate([
      { $match: { role: 'passenger' } },
      { $group: { _id: null, total: { $sum: '$balance' } } }
    ]);

    // Precomputed analytics snapshot if available
    let analyticsSnapshot = null;
    if (period === 'daily') {
      analyticsSnapshot = await DailyReport.findOne({ date: dayjs(startDate).startOf('day').toDate() }).lean();
    } else if (period === 'weekly') {
      analyticsSnapshot = await WeeklyReport.findOne({ weekStart: dayjs(startDate).startOf('week').toDate() }).lean();
    } else {
      analyticsSnapshot = await MonthlyReport.findOne({ month: baseDate.month() + 1, year: baseDate.year() }).lean();
    }

    // Enriched ride details for period (driver & passenger info)
    const ridesForDetails = await Booking.find({ createdAt: { $gte: startDate, $lte: endDate } })
      .populate('driverId passengerId')
      .lean();
    logger.info('[analytics.combined] rideDetails', { count: ridesForDetails.length });
    const rideCommissionRate = Number(process.env.COMMISSION_RATE || 15);
    const rideDetails = ridesForDetails.map(r => ({
      bookingId: r._id,
      driverId: String(r.driverId?._id || r.driverId || ''),
      driverName: r.driverId && typeof r.driverId === 'object' ? r.driverId.name : r.driverName,
      driverPhone: r.driverId && typeof r.driverId === 'object' ? r.driverId.phone : r.driverPhone,
      passengerId: String(r.passengerId?._id || r.passengerId || ''),
      passengerName: r.passengerId && typeof r.passengerId === 'object' ? r.passengerId.name : r.passengerName,
      passengerPhone: r.passengerId && typeof r.passengerId === 'object' ? r.passengerId.phone : r.passengerPhone,
      fare: Number(r.fareFinal || r.fareEstimated || 0),
      commission: Number(r.fareFinal || r.fareEstimated || 0) * (rideCommissionRate / 100),
      status: r.status,
      vehicleType: r.vehicleType,
      distanceKm: Number(r.distanceKm || 0),
      _id: r._id
    }));

    res.json({
      period,
      range: { start: startDate, end: endDate },
      bookings: {
        total: bookings.length,
        completed: completed.length,
        canceled: canceled.length,
        totalRevenue,
        averageFare,
        uniqueDrivers,
        uniquePassengers
      },
      commissions: {
        admin: { commission: adminEarningsAgg[0]?.commission || 0, grossFare: adminEarningsAgg[0]?.gross || 0 },
        drivers: {
          ...(driverEarningsAgg[0] || { grossFare: 0, commissionAmount: 0, netEarnings: 0 }),
          byDriver: driverBreakdown
        }
      },
      tripHistory: {
        events: tripEvents,
        totalDistanceKm: tripDistance,
        totalDurationMinutes: tripDuration
      },
      wallet: {
        transactions: txAgg,
        totals: {
          driverBalances: driverBalanceAgg[0]?.total || 0,
          passengerBalances: passengerBalanceAgg[0]?.total || 0
        }
      },
      analytics: analyticsSnapshot || null,
      rideDetails
    });
  } catch (e) {
    logger.error('[analytics.combined] failed', { error: e && e.message, stack: e && e.stack });
    res.status(500).json({ message: `Failed to get combined reports: ${e.message}` });
  }
};

// Driver Earnings Management
exports.getDriverEarnings = async (req, res) => {
  try {
    const { driverId, period, startDate, endDate } = req.query;
    const driverIdFilter = driverId || req.user.id;

    let dateFilter = {};
    if (period === 'daily') {
      const today = dayjs().startOf('day').toDate();
      const tomorrow = dayjs().add(1, 'day').startOf('day').toDate();
      dateFilter = { tripDate: { $gte: today, $lt: tomorrow } };
    } else if (period === 'weekly') {
      const weekStart = dayjs().startOf('week').toDate();
      const weekEnd = dayjs().endOf('week').toDate();
      dateFilter = { tripDate: { $gte: weekStart, $lte: weekEnd } };
    } else if (period === 'monthly') {
      const monthStart = dayjs().startOf('month').toDate();
      const monthEnd = dayjs().endOf('month').toDate();
      dateFilter = { tripDate: { $gte: monthStart, $lte: monthEnd } };
    } else if (startDate && endDate) {
      dateFilter = { tripDate: { $gte: new Date(startDate), $lte: new Date(endDate) } };
    }

    let earnings = await DriverEarnings.find({
      driverId: String(driverIdFilter),
      ...dateFilter
    }).populate('bookingId').sort({ tripDate: -1 });
    // Only include completed bookings
    earnings = earnings.filter(e => e.bookingId && e.bookingId.status === 'completed');

    const summary = await DriverEarnings.aggregate([
      { $match: { driverId: String(driverIdFilter), ...dateFilter } },
      { $lookup: { from: 'bookings', localField: 'bookingId', foreignField: '_id', as: 'booking' } },
      { $unwind: '$booking' },
      { $match: { 'booking.status': 'completed' } },
      {
        $group: {
          _id: null,
          totalRides: { $sum: 1 },
          totalFareCollected: { $sum: '$grossFare' },
          totalCommissionDeducted: { $sum: '$commissionAmount' },
          netEarnings: { $sum: '$netEarnings' }
        }
      }
    ]);

    // Integrate wallet balance
    let walletBalance = 0;
    try {
      const { Wallet } = require('../models/common');
      const wallet = await Wallet.findOne({ userId: String(driverIdFilter), role: 'driver' }).lean();
      walletBalance = wallet ? wallet.balance : 0;
    } catch (_) {}

    res.json({
      summary: summary[0] || {
        totalRides: 0,
        totalFareCollected: 0,
        totalCommissionDeducted: 0,
        netEarnings: 0
      },
      wallet: { balance: walletBalance },
      earnings
    });
  } catch (e) {
    res.status(500).json({ message: `Failed to get driver earnings: ${e.message}` });
  }
};

// Commission Management
exports.setCommission = async (req, res) => {
  try {
    const { driverId, percentage, description } = req.body;
    const adminId = req.user.id;

    if (percentage < 0 || percentage > 100) {
      return res.status(400).json({ message: 'Commission percentage must be between 0 and 100' });
    }

    if (!driverId) {
      return res.status(400).json({ message: 'driverId is required to set commission' });
    }

    // Create driver-specific commission entry (latest wins)
    const commission = await Commission.create({
      driverId: String(driverId),
      percentage,
      description,
      createdBy: adminId
    });

    res.json(commission);
  } catch (e) {
    res.status(500).json({ message: `Failed to set commission: ${e.message}` });
  }
};

exports.getCommission = async (req, res) => {
  try {
    const driverId = req.query.driverId || req.params.driverId || req.user?.id;
    if (!driverId) {
      return res.json({ percentage: Number(process.env.COMMISSION_RATE || 15) });
    }
    const commission = await Commission.findOne({ driverId: String(driverId) }).sort({ createdAt: -1 });
    res.json(commission || { percentage: Number(process.env.COMMISSION_RATE || 15) });
  } catch (e) {
    res.status(500).json({ message: `Failed to get commission: ${e.message}` });
  }
};

// Ride History
exports.getRideHistory = async (req, res) => {
  try {
    const userType = req.user.type;
    const userId = req.user.id;
    const { page = 1, limit = 10, status } = req.query;

    let query = {};
    if (userType === 'driver') {
      query.driverId = userId;
    } else if (userType === 'passenger') {
      query.passengerId = userId;
    }

    if (status) {
      query.status = status;
    }

    const rides = await Booking.find(query)
      .sort({ createdAt: -1 })
      .limit(limit * 1)
      .skip((page - 1) * limit)
      .lean();

    // enrich driver basic info via external service using externalId when present
  // Enrich driver details from local DB when possible
  const driverIds = [...new Set(rides.map(r => r.driverId).filter(Boolean))].map(String);
  const validDriverIds = driverIds.filter(id => require('mongoose').Types.ObjectId.isValid(id));
  let driverInfoMap = {};
  if (validDriverIds.length) {
    try {
      const drivers = await Driver.find({ _id: { $in: validDriverIds } }).select({ _id: 1, name: 1, phone: 1, email: 1 }).lean();
      driverInfoMap = Object.fromEntries(drivers.map(d => [String(d._id), { id: String(d._id), name: d.name, phone: d.phone, email: d.email }]));
    } catch (_) {}
  }

  // Enrich passenger details from local DB when possible
  const passengerIds = [...new Set(rides.map(r => r.passengerId).filter(Boolean))].map(String);
  const validPassengerIds = passengerIds.filter(id => require('mongoose').Types.ObjectId.isValid(id));
  let passengerMap = {};
  if (validPassengerIds.length) {
    try {
      const passengers = await Passenger.find({ _id: { $in: validPassengerIds } }).select({ _id: 1, name: 1, phone: 1, email: 1 }).lean();
      passengerMap = Object.fromEntries(passengers.map(p => [String(p._id), { id: String(p._id), name: p.name, phone: p.phone, email: p.email }]));
    } catch (_) {}
  }

    const total = await Booking.countDocuments(query);

  const data = rides.map(r => {
    const passenger = r.passengerId
      ? (passengerMap[String(r.passengerId)] || { id: String(r.passengerId), name: r.passengerName, phone: r.passengerPhone })
      : undefined;
    const driver = r.driverId ? driverInfoMap[String(r.driverId)] : undefined;
    return {
      ...r,
      passenger,
      driver
    };
  });

    res.json({
      rides: data,
      pagination: {
        current: parseInt(page),
        pages: Math.ceil(total / limit),
        total
      }
    });
  } catch (e) {
    res.status(500).json({ message: `Failed to get ride history: ${e.message}` });
  }
};

// Get trip history by user ID (for user service integration)
exports.getTripHistoryByUserId = async (req, res) => {
  try {
    const { userType, userId } = req.params;
    const { status } = req.query;

    if (!userType || !userId) {
      return res.status(400).json({ message: 'userType and userId are required' });
    }

    if (userType !== 'driver' && userType !== 'passenger') {
      return res.status(400).json({ message: 'userType must be either driver or passenger' });
    }

    let query = {};
    if (userType === 'driver') {
      query.driverId = userId;
    } else if (userType === 'passenger') {
      query.passengerId = userId;
    }

    if (status) {
      query.status = status;
    }

    const trips = await Booking.find(query).sort({ createdAt: -1 }).lean();

    const { getDriversByIds } = require('../integrations/userServiceClient');
    const driverExternalIds = [...new Set(trips.map(r => r.driverId).filter(Boolean))].map(String);
    let driverInfoMap = {};
    if (driverExternalIds.length) {
      try {
        const infos = await getDriversByIds(driverExternalIds, req.headers.authorization);
        driverInfoMap = Object.fromEntries(infos.map(i => [String(i.id), { id: String(i.id), name: i.name, phone: i.phone }]));
      } catch (_) {}
    }

    const data = trips.map(t => ({
      ...t,
      driver: t.driverId ? driverInfoMap[String(t.driverId)] : undefined
    }));

    res.json({ trips: data });
  } catch (e) {
    res.status(500).json({ message: `Failed to get trip history: ${e.message}` });
  }
};

// Finance Overview
exports.getFinanceOverview = async (req, res) => {
  try {
    const { period = 'monthly' } = req.query;
    
    let dateFilter = {};
    if (period === 'daily') {
      const today = dayjs().startOf('day').toDate();
      const tomorrow = dayjs().add(1, 'day').startOf('day').toDate();
      dateFilter = { tripDate: { $gte: today, $lt: tomorrow } };
    } else if (period === 'weekly') {
      const weekStart = dayjs().startOf('week').toDate();
      const weekEnd = dayjs().endOf('week').toDate();
      dateFilter = { tripDate: { $gte: weekStart, $lte: weekEnd } };
    } else if (period === 'monthly') {
      const monthStart = dayjs().startOf('month').toDate();
      const monthEnd = dayjs().endOf('month').toDate();
      dateFilter = { tripDate: { $gte: monthStart, $lte: monthEnd } };
    }

    // Total revenue
    const totalRevenue = await Booking.aggregate([
      { $match: { status: 'completed', ...dateFilter } },
      { $group: { _id: null, total: { $sum: '$fareFinal' } } }
    ]);

    // Commission earned
    const commissionEarned = await AdminEarnings.aggregate([
      { $match: dateFilter },
      { $group: { _id: null, total: { $sum: '$commissionEarned' } } }
    ]);

    // Pending payouts
    const pendingPayouts = await Payout.aggregate([
      { $match: { status: 'pending' } },
      { $group: { _id: null, total: { $sum: '$netPayout' } } }
    ]);

    // Top earning drivers with basic user info
    const topDriversRaw = await DriverEarnings.aggregate([
      { $match: dateFilter },
      {
        $group: {
          _id: '$driverId',
          totalEarnings: { $sum: '$netEarnings' },
          totalRides: { $sum: 1 }
        }
      },
      { $sort: { totalEarnings: -1 } },
      { $limit: 10 }
    ]);
    // Enrich names/phones from local DB and external service
    let topDrivers = topDriversRaw;
    try {
      const { Driver } = require('../models/userModels');
      const { Types } = require('mongoose');
      const ids = topDriversRaw.map(d => String(d._id));
      const valid = ids.filter(id => Types.ObjectId.isValid(id));
      const local = valid.length ? await Driver.find({ _id: { $in: valid } }).select({ _id: 1, name: 1, phone: 1, email: 1 }).lean() : [];
      const lmap = Object.fromEntries(local.map(d => [String(d._id), { name: d.name, phone: d.phone, email: d.email }]));
      const unresolved = ids.filter(id => !lmap[id]);
      let emap = {};
      if (unresolved.length) {
        try {
          const { getDriversByIds } = require('../integrations/userServiceClient');
          const headers = req.headers && req.headers.authorization ? { Authorization: req.headers.authorization } : undefined;
          const infos = await getDriversByIds(unresolved, { headers });
          emap = Object.fromEntries((infos || []).map(i => [String(i.id), { name: i.name, phone: i.phone, email: i.email }]));
        } catch (_) {}
      }
      topDrivers = topDriversRaw.map(d => ({
        ...d,
        name: (lmap[String(d._id)] || emap[String(d._id)] || {}).name,
        phone: (lmap[String(d._id)] || emap[String(d._id)] || {}).phone,
        email: (lmap[String(d._id)] || emap[String(d._id)] || {}).email
      }));
    } catch (_) {}

    // Most profitable routes (by distance)
    const profitableRoutes = await Booking.aggregate([
      { $match: { status: 'completed', ...dateFilter } },
      {
        $group: {
          _id: {
            pickupLat: { $round: ['$pickup.latitude', 2] },
            pickupLng: { $round: ['$pickup.longitude', 2] },
            dropoffLat: { $round: ['$dropoff.latitude', 2] },
            dropoffLng: { $round: ['$dropoff.longitude', 2] }
          },
          totalRevenue: { $sum: '$fareFinal' },
          rideCount: { $sum: 1 },
          avgFare: { $avg: '$fareFinal' }
        }
      },
      { $sort: { totalRevenue: -1 } },
      { $limit: 10 }
    ]);

    // Wallet aggregates
    let walletTotals = { totalDriverBalances: 0, totalPassengerBalances: 0 };
    try {
      const { Wallet } = require('../models/common');
      const driverAgg = await Wallet.aggregate([
        { $match: { role: 'driver' } },
        { $group: { _id: null, total: { $sum: '$balance' } } }
      ]);
      const passengerAgg = await Wallet.aggregate([
        { $match: { role: 'passenger' } },
        { $group: { _id: null, total: { $sum: '$balance' } } }
      ]);
      walletTotals.totalDriverBalances = driverAgg[0]?.total || 0;
      walletTotals.totalPassengerBalances = passengerAgg[0]?.total || 0;
    } catch (_) {}

    res.json({
      totalRevenue: totalRevenue[0]?.total || 0,
      commissionEarned: commissionEarned[0]?.total || 0,
      pendingPayouts: pendingPayouts[0]?.total || 0,
      wallet: walletTotals,
      topEarningDrivers: topDrivers,
      mostProfitableRoutes: profitableRoutes
    });
  } catch (e) {
    logger.error('[analytics.finance] failed', { error: e && e.message, stack: e && e.stack });
    res.status(500).json({ message: `Failed to get finance overview: ${e.message}` });
  }
};

// Rewards: 10 ETB per 2km of completed rides
async function computeRewardsForUser(userType, userId) {
  const match = { status: 'completed' };
  if (userType === 'driver') match.driverId = String(userId);
  if (userType === 'passenger') match.passengerId = String(userId);

  const agg = await Booking.aggregate([
    { $match: match },
    { $group: { _id: null, totalKm: { $sum: '$distanceKm' }, rides: { $sum: 1 } } }
  ]);

  const totalDistanceKm = agg[0]?.totalKm || 0;
  const completedRides = agg[0]?.rides || 0;
  const rewardPoints = Math.floor(totalDistanceKm / 2) * 10; // 10 ETB per 2km
  return { totalDistanceKm, completedRides, rewardPoints };
}

exports.getPassengerRewards = async (req, res) => {
  try {
    const passengerId = req.query.passengerId || req.user.id;
    const out = await computeRewardsForUser('passenger', passengerId);
    res.json({
      passengerId: String(passengerId),
      rule: '10 ETB per 2km of completed trips',
      ...out
    });
  } catch (e) {
    res.status(500).json({ message: `Failed to compute passenger rewards: ${e.message}` });
  }
};

exports.getDriverRewards = async (req, res) => {
  try {
    const driverId = req.query.driverId || req.user.id;
    const out = await computeRewardsForUser('driver', driverId);
    // Apply admin-configured perKm if present
    try {
      const cfg = await RewardRate.findOne({ role: 'driver' }).lean();
      if (cfg && Number.isFinite(cfg.perKm)) {
        const points = Math.floor((out.totalDistanceKm || 0) * cfg.perKm);
        out.rewardPoints = points;
        out.perKm = cfg.perKm;
        out.currency = cfg.currency || 'ETB';
      }
    } catch (_) {}
    res.json({
      driverId: String(driverId),
      rule: out.perKm ? `${out.perKm} ${out.currency || 'ETB'} per km` : '10 ETB per 2km of completed trips',
      ...out
    });
  } catch (e) {
    res.status(500).json({ message: `Failed to compute driver rewards: ${e.message}` });
  }
};
