async function buildUserMaps(driverIdsRaw, passengerIdsRaw) {
  const { Driver, Passenger } = require('../../models/userModels');
  const { Types } = require('mongoose');
  const uniq = (arr) => Array.from(new Set((arr || []).filter(Boolean).map(String)));
  const driverIds = uniq(driverIdsRaw).filter(id => Types.ObjectId.isValid(id));
  const passengerIds = uniq(passengerIdsRaw).filter(id => Types.ObjectId.isValid(id));
  let driverMap = {}, passengerMap = {};
  try {
    if (driverIds.length) {
      const rows = await Driver.find({ _id: { $in: driverIds } })
        .select({ _id: 1, name: 1, phone: 1, email: 1, vehicleType: 1, carName: 1, carModel: 1, carPlate: 1, carColor: 1 })
        .lean();
      driverMap = Object.fromEntries(rows.map(d => [String(d._id), {
        id: String(d._id), name: d.name, phone: d.phone, email: d.email,
        vehicleType: d.vehicleType, carName: d.carName, carModel: d.carModel, carPlate: d.carPlate, carColor: d.carColor
      }]));
    }
  } catch (_) {}
  try {
    if (passengerIds.length) {
      const rows = await Passenger.find({ _id: { $in: passengerIds } })
        .select({ _id: 1, name: 1, phone: 1, email: 1 })
        .lean();
      passengerMap = Object.fromEntries(rows.map(p => [String(p._id), {
        id: String(p._id), name: p.name, phone: p.phone, email: p.email
      }]));
    }
  } catch (_) {}
  return { driverMap, passengerMap };
}

// Rewards helper shared by rewards controllers
async function computeRewardsForUser(userType, userId) {
  const { Booking } = require('../../models/bookingModels');
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

function buildTimeRange(period, params = {}, tz) {
  const dayjs = require('dayjs');
  const useUtc = process.env.REPORTS_USE_UTC === '1';
  const d = useUtc && dayjs.utc ? dayjs.utc : dayjs;
  if (period === 'daily') {
    const date = params.date ? d(params.date) : d();
    const start = date.startOf('day').toDate();
    const end = date.add(1, 'day').startOf('day').toDate();
    return { start, end };
  }
  if (period === 'weekly') {
    const base = params.weekStart ? d(params.weekStart) : d();
    const start = base.startOf('week').toDate();
    const end = base.endOf('week').toDate();
    return { start, end, inclusiveEnd: true };
  }
  if (period === 'monthly') {
    const m = params.month ? parseInt(params.month) : (d().month() + 1);
    const y = params.year ? parseInt(params.year) : d().year();
    const start = d().month(m - 1).year(y).startOf('month').toDate();
    const end = d().month(m - 1).year(y).endOf('month').toDate();
    return { start, end, inclusiveEnd: true };
  }
  // fallback: today
  const start = d().startOf('day').toDate();
  const end = d().add(1, 'day').startOf('day').toDate();
  return { start, end };
}

module.exports = { buildUserMaps, computeRewardsForUser, buildTimeRange };


