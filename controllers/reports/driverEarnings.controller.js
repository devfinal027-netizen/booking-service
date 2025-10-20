const dayjs = require('dayjs');
const { DriverEarnings } = require('../../models/commission');
const { buildUserMaps } = require('./_utils');

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

    // Persistent monthly/weekly rollups: upsert into Payout with status 'pending' summary if configured
    try {
      const autoRollup = process.env.EARNINGS_AUTO_ROLLUP === '1';
      if (autoRollup && Array.isArray(earnings) && earnings.length) {
        const { Payout } = require('../../models/commission');
        const period = period || 'custom';
        const start = (dateFilter.tripDate && (dateFilter.tripDate.$gte || dateFilter.tripDate.$gte)) || new Date();
        const end = (dateFilter.tripDate && (dateFilter.tripDate.$lt || dateFilter.tripDate.$lte)) || new Date();
        const gross = earnings.reduce((s, e) => s + Number(e.grossFare || 0), 0);
        const comm = earnings.reduce((s, e) => s + Number(e.commissionAmount || 0), 0);
        const net = earnings.reduce((s, e) => s + Number(e.netEarnings || 0), 0);
        await Payout.findOneAndUpdate(
          { driverId: String(driverIdFilter), periodStart: start, periodEnd: end },
          { $setOnInsert: { payoutPeriod: period, status: 'pending' }, $set: { totalEarnings: gross, totalCommission: comm, netPayout: net } },
          { upsert: true }
        );
      }
    } catch (_) {}

    // Integrate wallet balance
    let walletBalance = 0;
    try {
      const { Wallet } = require('../../models/common');
      const wallet = await Wallet.findOne({ userId: String(driverIdFilter), role: 'driver' }).lean();
      walletBalance = wallet ? wallet.balance : 0;
    } catch (_) {}

    // Enrich driver and passenger info where IDs exist
    let driverInfo = undefined;
    try {
      const { Driver } = require('../../models/userModels');
      const { Types } = require('mongoose');
      if (Types.ObjectId.isValid(String(driverIdFilter))) {
        const d = await Driver.findById(String(driverIdFilter)).select({ _id: 1, name: 1, phone: 1, email: 1, vehicleType: 1, carPlate: 1 }).lean();
        if (d) driverInfo = { id: String(d._id), name: d.name, phone: d.phone, email: d.email, vehicleType: d.vehicleType, carPlate: d.carPlate };
      }
    } catch (_) {}
    if (!driverInfo) {
      try {
        const { getDriverById } = require('../../integrations/userServiceClient');
        const headers = req.headers && req.headers.authorization ? { headers: { Authorization: req.headers.authorization } } : undefined;
        const info = await getDriverById(String(driverIdFilter), headers || {});
        if (info) driverInfo = { id: String(info.id), name: info.name, phone: info.phone, email: info.email, vehicleType: info.vehicleType, carPlate: info.carPlate };
      } catch (_) {}
    }

    const passengerIds = Array.from(new Set((earnings || [])
      .map(e => e.bookingId && e.bookingId.passengerId)
      .filter(Boolean)
      .map(String)));
    let passengerMap = {};
    try {
      const maps = await buildUserMaps([], passengerIds);
      passengerMap = maps.passengerMap || {};
    } catch (_) {}
    // External fallback for unresolved passengers
    try {
      const unresolved = passengerIds.filter(id => !passengerMap[id]);
      if (unresolved.length) {
        const { getPassengerById } = require('../../integrations/userServiceClient');
        const headers = req.headers && req.headers.authorization ? { headers: { Authorization: req.headers.authorization } } : {};
        const results = await Promise.all(unresolved.map(id => getPassengerById(id, headers).catch(() => null)));
        const pmap = Object.fromEntries((results || []).filter(Boolean).map(u => [String(u.id), { id: String(u.id), name: u.name, phone: u.phone, email: u.email }]));
        passengerMap = { ...passengerMap, ...pmap };
      }
    } catch (_) {}

    const enrichedEarnings = (earnings || []).map(e => ({
      ...e.toObject(),
      driver: driverInfo ? { ...driverInfo } : undefined,
      passenger: e.bookingId && e.bookingId.passengerId ? (passengerMap[String(e.bookingId.passengerId)] || { id: String(e.bookingId.passengerId) }) : undefined
    }));

    res.json({
      driver: driverInfo,
      summary: summary[0] || {
        totalRides: 0,
        totalFareCollected: 0,
        totalCommissionDeducted: 0,
        netEarnings: 0
      },
      wallet: { balance: walletBalance },
      earnings: enrichedEarnings
    });
  } catch (e) {
    res.status(500).json({ message: `Failed to get driver earnings: ${e.message}` });
  }
};


