const { RewardRate, Commission } = require('../../models/commission');
const { computeRewardsForUser } = require('./_utils');

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


