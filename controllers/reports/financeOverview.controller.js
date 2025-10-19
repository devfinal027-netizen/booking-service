const dayjs = require('dayjs');
const { Booking } = require('../../models/bookingModels');
const { AdminEarnings, DriverEarnings } = require('../../models/commission');

exports.getFinanceOverview = async (req, res) => {
  try {
    const { period = 'monthly' } = req.query;

  // For financials (AdminEarnings/DriverEarnings), we filter by tripDate.
  // For Booking revenue (completed trips), we must filter by completedAt.
  let earningsDateFilter = {};
  let bookingDateFilter = {};
  if (period === 'daily') {
    const today = dayjs().startOf('day').toDate();
    const tomorrow = dayjs().add(1, 'day').startOf('day').toDate();
    earningsDateFilter = { tripDate: { $gte: today, $lt: tomorrow } };
    bookingDateFilter = { completedAt: { $gte: today, $lt: tomorrow } };
  } else if (period === 'weekly') {
    const weekStart = dayjs().startOf('week').toDate();
    const weekEnd = dayjs().endOf('week').toDate();
    earningsDateFilter = { tripDate: { $gte: weekStart, $lte: weekEnd } };
    bookingDateFilter = { completedAt: { $gte: weekStart, $lte: weekEnd } };
  } else if (period === 'monthly') {
    const monthStart = dayjs().startOf('month').toDate();
    const monthEnd = dayjs().endOf('month').toDate();
    earningsDateFilter = { tripDate: { $gte: monthStart, $lte: monthEnd } };
    bookingDateFilter = { completedAt: { $gte: monthStart, $lte: monthEnd } };
  }

  // Total revenue (from completed bookings in period by completedAt)
  const totalRevenue = await Booking.aggregate([
      { $match: { status: 'completed', ...bookingDateFilter } },
      { $group: { _id: null, total: { $sum: '$fareFinal' } } }
    ]);

    // Commission earned
  const commissionEarned = await AdminEarnings.aggregate([
      { $match: earningsDateFilter },
      { $group: { _id: null, total: { $sum: '$commissionEarned' } } }
    ]);

    // Pending payouts
    const { Payout } = require('../../models/commission');
    const pendingPayouts = await Payout.aggregate([
      { $match: { status: 'pending' } },
      { $group: { _id: null, total: { $sum: '$netPayout' } } }
    ]);

    // Top earning drivers (raw)
  const topDriversRaw = await DriverEarnings.aggregate([
      { $match: earningsDateFilter },
      { $group: { _id: '$driverId', totalEarnings: { $sum: '$netEarnings' }, totalRides: { $sum: 1 } } },
      { $sort: { totalEarnings: -1 } },
      { $limit: 10 }
    ]);

    // Enrich names/phones from local DB and optionally external service
    let topDrivers = topDriversRaw;
    try {
      const { Driver } = require('../../models/userModels');
      const { Types } = require('mongoose');
      const ids = topDriversRaw.map(d => String(d._id));
      const valid = ids.filter(id => Types.ObjectId.isValid(id));
      const local = valid.length ? await Driver.find({ _id: { $in: valid } }).select({ _id: 1, name: 1, phone: 1, email: 1, carName: 1, carModel: 1, carPlate: 1, carColor: 1 }).lean() : [];
      const lmap = Object.fromEntries(local.map(d => [String(d._id), {
        name: d.name,
        phone: d.phone,
        email: d.email,
        carName: d.carName,
        carModel: d.carModel,
        carPlate: d.carPlate,
        carColor: d.carColor
      }]));
      const unresolved = ids.filter(id => !lmap[id]);
      let emap = {};
      if (unresolved.length) {
        try {
          const { getDriversByIds } = require('../../integrations/userServiceClient');
          const token = req.headers && req.headers.authorization ? req.headers.authorization : undefined;
          const infos = await getDriversByIds(unresolved, token);
          emap = Object.fromEntries((infos || []).map(i => [String(i.id), {
            name: i.name,
            phone: i.phone,
            email: i.email,
            carName: i.carName,
            carModel: i.carModel,
            carPlate: i.carPlate,
            carColor: i.carColor
          }]));
        } catch (_) {}
      }
      topDrivers = topDriversRaw.map(d => ({
        ...d,
        driverName: (lmap[String(d._id)] || emap[String(d._id)] || {}).name,
        driverPhone: (lmap[String(d._id)] || emap[String(d._id)] || {}).phone,
        driverEmail: (lmap[String(d._id)] || emap[String(d._id)] || {}).email,
        carName: (lmap[String(d._id)] || emap[String(d._id)] || {}).carName,
        carModel: (lmap[String(d._id)] || emap[String(d._id)] || {}).carModel,
        carPlate: (lmap[String(d._id)] || emap[String(d._id)] || {}).carPlate,
        carColor: (lmap[String(d._id)] || emap[String(d._id)] || {}).carColor,
        name: (lmap[String(d._id)] || emap[String(d._id)] || {}).name,
        phone: (lmap[String(d._id)] || emap[String(d._id)] || {}).phone,
        email: (lmap[String(d._id)] || emap[String(d._id)] || {}).email
      }));
    } catch (_) {}

    // Most profitable routes (by distance)
    const profitableRoutes = await Booking.aggregate([
      { $match: { status: 'completed', ...dateFilter } },
      { $group: {
        _id: {
          pickupLat: { $round: ['$pickup.latitude', 2] },
          pickupLng: { $round: ['$pickup.longitude', 2] },
          dropoffLat: { $round: ['$dropoff.latitude', 2] },
          dropoffLng: { $round: ['$dropoff.longitude', 2] }
        },
        totalRevenue: { $sum: '$fareFinal' },
        rideCount: { $sum: 1 },
        avgFare: { $avg: '$fareFinal' }
      } },
      { $sort: { totalRevenue: -1 } },
      { $limit: 10 }
    ]);

    // Wallet aggregates
    let walletTotals = { totalDriverBalances: 0, totalPassengerBalances: 0 };
    try {
      const { Wallet } = require('../../models/common');
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
    return res.status(500).json({ message: `Failed to get finance overview: ${e.message}` });
  }
};


