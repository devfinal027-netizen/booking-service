const dayjs = require('dayjs');
const { DriverEarnings, Payout } = require('../../models/commission');
const { buildTimeRange } = require('./_utils');

// GET /v1/analytics/finance/payouts/pending
// Aggregates pending payouts from DriverEarnings (status: 'pending') optionally filtered by period/start-end.
exports.getPendingPayouts = async (req, res) => {
  try {
    const { period, startDate, endDate, driverId } = req.query || {};
    let dateFilter = {};
    if (period) {
      const { start, end, inclusiveEnd } = buildTimeRange(period, { date: startDate, weekStart: startDate, month: req.query?.month, year: req.query?.year });
      dateFilter = inclusiveEnd ? { $gte: start, $lte: end } : { $gte: start, $lt: end };
    } else if (startDate && endDate) {
      dateFilter = { $gte: new Date(startDate), $lte: new Date(endDate) };
    }

    const match = { status: 'pending' };
    if (driverId) match.driverId = String(driverId);
    if (dateFilter && (dateFilter.$gte || dateFilter.$lt)) match.tripDate = dateFilter;

    const groups = await DriverEarnings.aggregate([
      { $match: match },
      {
        $group: {
          _id: '$driverId',
          totalGross: { $sum: '$grossFare' },
          totalCommission: { $sum: '$commissionAmount' },
          totalNet: { $sum: '$netEarnings' },
          count: { $sum: 1 }
        }
      },
      { $sort: { totalNet: -1 } }
    ]);

    res.json({ payouts: groups });
  } catch (e) {
    res.status(500).json({ message: `Failed to aggregate pending payouts: ${e.message}` });
  }
};

// POST /v1/analytics/finance/payouts/generate
// Generates or updates Payout documents for the given period/date range by grouping pending DriverEarnings.
exports.generatePayouts = async (req, res) => {
  try {
    const { period = 'weekly', startDate, endDate } = req.body || {};
    let range;
    if (startDate && endDate) {
      range = { start: new Date(startDate), end: new Date(endDate), inclusiveEnd: true };
    } else {
      range = buildTimeRange(period, req.body || {});
    }
    const tripDateFilter = range.inclusiveEnd
      ? { $gte: range.start, $lte: range.end }
      : { $gte: range.start, $lt: range.end };

    // Find pending DriverEarnings in range
    const earnings = await DriverEarnings.find({ status: 'pending', tripDate: tripDateFilter }).lean();
    if (!earnings.length) return res.json({ message: 'No pending driver earnings found for the requested range', created: 0, updated: 0 });

    // Group by driver
    const byDriver = earnings.reduce((acc, e) => {
      const k = String(e.driverId);
      if (!acc[k]) acc[k] = [];
      acc[k].push(e);
      return acc;
    }, {});

    let created = 0, updated = 0;
    const results = [];
    const payoutPeriod = period && ['daily','weekly','monthly'].includes(String(period)) ? String(period) : 'custom';

    for (const [driverId, arr] of Object.entries(byDriver)) {
      const totalGross = arr.reduce((s, x) => s + Number(x.grossFare || 0), 0);
      const totalCommission = arr.reduce((s, x) => s + Number(x.commissionAmount || 0), 0);
      const netPayout = arr.reduce((s, x) => s + Number(x.netEarnings || 0), 0);
      const earningIds = arr.map(x => x._id);

      const existing = await Payout.findOne({ driverId: String(driverId), periodStart: range.start, periodEnd: range.end }).lean();
      if (existing && existing.status === 'paid') {
        // Do not modify already paid payouts
        results.push({ driverId, payoutId: String(existing._id), status: existing.status, totalGross, totalCommission, netPayout, skipped: 'already_paid' });
        continue;
      }
      const doc = await Payout.findOneAndUpdate(
        { driverId: String(driverId), periodStart: range.start, periodEnd: range.end },
        {
          $set: {
            payoutPeriod,
            totalEarnings: totalGross,
            totalCommission,
            netPayout,
            status: 'pending',
            earnings: earningIds
          }
        },
        { new: true, upsert: true }
      );
      if (existing) updated++; else created++;
      results.push({ driverId, payoutId: String(doc._id), status: doc.status, totalGross, totalCommission, netPayout });
    }

    res.json({ created, updated, period: payoutPeriod, start: range.start, end: range.end, results });
  } catch (e) {
    res.status(500).json({ message: `Failed to generate payouts: ${e.message}` });
  }
};

// POST /v1/analytics/finance/payouts/:id/paid
// Marks payout as paid and updates included DriverEarnings status to 'paid'.
exports.markPayoutPaid = async (req, res) => {
  try {
    const { id } = req.params;
    const { paymentMethod, transactionId } = req.body || {};
    const row = await Payout.findByIdAndUpdate(
      id,
      { $set: { status: 'paid', paidAt: new Date(), ...(paymentMethod ? { paymentMethod } : {}), ...(transactionId ? { transactionId } : {}) } },
      { new: true }
    );
    if (!row) return res.status(404).json({ message: 'Payout not found' });
    try {
      if (Array.isArray(row.earnings) && row.earnings.length) {
        await DriverEarnings.updateMany({ _id: { $in: row.earnings } }, { $set: { status: 'paid', paidAt: new Date(), paymentMethod: paymentMethod || row.paymentMethod } });
      }
    } catch (_) {}
    res.json(row);
  } catch (e) {
    res.status(500).json({ message: `Failed to mark payout as paid: ${e.message}` });
  }
};

// GET /v1/analytics/finance/payouts
exports.listPayouts = async (req, res) => {
  try {
    const { status, driverId, page = 1, limit = 50 } = req.query || {};
    const filter = {};
    if (status) filter.status = status;
    if (driverId) filter.driverId = String(driverId);
    const rows = await Payout.find(filter).sort({ createdAt: -1 }).limit(Number(limit)).skip((Number(page) - 1) * Number(limit)).lean();
    const total = await Payout.countDocuments(filter);
    res.json({ payouts: rows, pagination: { current: Number(page), pages: Math.ceil(total / Number(limit)), total } });
  } catch (e) {
    res.status(500).json({ message: `Failed to list payouts: ${e.message}` });
  }
};

// GET /v1/analytics/finance/payouts/:id
exports.getPayout = async (req, res) => {
  try {
    const row = await Payout.findById(req.params.id).populate('earnings').lean();
    if (!row) return res.status(404).json({ message: 'Payout not found' });
    res.json(row);
  } catch (e) {
    res.status(500).json({ message: `Failed to get payout: ${e.message}` });
  }
};
