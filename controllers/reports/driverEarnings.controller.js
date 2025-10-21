const dayjs = require('dayjs');
const { DriverEarnings } = require('../../models/commission');

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


