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

module.exports = { buildUserMaps, computeRewardsForUser };


