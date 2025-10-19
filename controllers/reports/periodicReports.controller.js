const dayjs = require('dayjs');
const { Booking } = require('../../models/bookingModels');
const { AdminEarnings, DriverEarnings } = require('../../models/commission');
const { buildUserMaps, buildTimeRange } = require('./_utils');

exports.getDailyReport = async (req, res) => {
  try {
    const { date } = req.query;
    const { start: targetDate, end: nextDay } = buildTimeRange('daily', { date });
    const commissionRate = Number(process.env.COMMISSION_RATE || 15);

    // Use completedAt for rides within period
    const rides = await Booking.find({ completedAt: { $gte: targetDate, $lt: nextDay }, status: 'completed' }).populate('driverId passengerId');
    const completed = rides; // already filtered
    const totalRevenue = completed.reduce((sum, r) => sum + Number(r.fareFinal || 0), 0);
    const totalCommission = await AdminEarnings.aggregate([
      { $match: { tripDate: { $gte: targetDate, $lt: nextDay } } },
      { $group: { _id: null, total: { $sum: '$commissionEarned' } } }
    ]);

    const rideDetailsRaw = rides.map(r => ({
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
    let { driverMap, passengerMap } = await buildUserMaps(rideDetailsRaw.map(x => x.driverId), rideDetailsRaw.map(x => x.passengerId));
    // Fallback enrich unresolved via external user service
    try {
      const unresolvedDriverIds = Array.from(new Set(rideDetailsRaw.map(x => x.driverId).filter(Boolean).map(String)))
        .filter(id => !driverMap[id]);
      if (unresolvedDriverIds.length) {
        const { getDriversByIds } = require('../../integrations/userServiceClient');
        const token = req.headers && req.headers.authorization ? req.headers.authorization : undefined;
        const infos = await getDriversByIds(unresolvedDriverIds, token);
        const emap = Object.fromEntries((infos || []).map(i => [String(i.id), {
          id: String(i.id), name: i.name, phone: i.phone, email: i.email,
          vehicleType: i.vehicleType, carName: i.carName, carModel: i.carModel, carPlate: i.carPlate, carColor: i.carColor
        }]));
        driverMap = { ...driverMap, ...emap };
      }
    } catch (_) {}
    try {
      const unresolvedPassengerIds = Array.from(new Set(rideDetailsRaw.map(x => x.passengerId).filter(Boolean).map(String)))
        .filter(id => !passengerMap[id]);
      if (unresolvedPassengerIds.length) {
        const { getPassengerById } = require('../../integrations/userServiceClient');
        const headers = req.headers && req.headers.authorization ? { headers: { Authorization: req.headers.authorization } } : {};
        const results = await Promise.all(unresolvedPassengerIds.map(id => getPassengerById(id, headers).catch(() => null)));
        const pmap = Object.fromEntries((results || []).filter(Boolean).map(u => [String(u.id), { id: String(u.id), name: u.name, phone: u.phone, email: u.email }]));
        passengerMap = { ...passengerMap, ...pmap };
      }
    } catch (_) {}
    const rideDetails = rideDetailsRaw.map(x => ({
      ...x,
      driver: x.driverId ? (driverMap[String(x.driverId)] || { id: String(x.driverId) }) : undefined,
      passenger: x.passengerId ? (passengerMap[String(x.passengerId)] || { id: String(x.passengerId) }) : undefined
    }));

    const completedCountD = completed.length;
    const avgFareD = completedCountD > 0 ? totalRevenue / completedCountD : 0;
    res.json({
      date: targetDate,
      totalRides: rides.length,
      totalRevenue,
      totalCommission: totalCommission[0]?.total || 0,
      completedRides: completedCountD,
      canceledRides: rides.filter(r => r.status === 'canceled').length,
      averageFare: Number.isFinite(avgFareD) ? avgFareD : 0,
      rideDetails
    });
  } catch (e) {
    return res.status(500).json({ message: `Failed to get daily report: ${e.message}` });
  }
};

exports.getWeeklyReport = async (req, res) => {
  try {
    const { weekStart } = req.query;
    const { start: startDate, end: endDate, inclusiveEnd } = buildTimeRange('weekly', { weekStart });
    const commissionRate = Number(process.env.COMMISSION_RATE || 15);

    const rides = await Booking.find({ status: 'completed', completedAt: inclusiveEnd ? { $gte: startDate, $lte: endDate } : { $gte: startDate, $lt: endDate } }).populate('driverId passengerId').lean();
    const completed = rides; // already filtered
    const totalRevenue = completed.reduce((sum, r) => sum + Number(r.fareFinal || 0), 0);

    const rideDetailsRaw = rides.map(r => ({
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
    let { driverMap, passengerMap } = await buildUserMaps(rideDetailsRaw.map(x => x.driverId), rideDetailsRaw.map(x => x.passengerId));
    // Fallback external enrich
    try {
      const unresolvedDriverIds = Array.from(new Set(rideDetailsRaw.map(x => x.driverId).filter(Boolean).map(String)))
        .filter(id => !driverMap[id]);
      if (unresolvedDriverIds.length) {
        const { getDriversByIds } = require('../../integrations/userServiceClient');
        const token = req.headers && req.headers.authorization ? req.headers.authorization : undefined;
        const infos = await getDriversByIds(unresolvedDriverIds, token);
        const emap = Object.fromEntries((infos || []).map(i => [String(i.id), {
          id: String(i.id), name: i.name, phone: i.phone, email: i.email,
          vehicleType: i.vehicleType, carName: i.carName, carModel: i.carModel, carPlate: i.carPlate, carColor: i.carColor
        }]));
        driverMap = { ...driverMap, ...emap };
      }
    } catch (_) {}
    try {
      const unresolvedPassengerIds = Array.from(new Set(rideDetailsRaw.map(x => x.passengerId).filter(Boolean).map(String)))
        .filter(id => !passengerMap[id]);
      if (unresolvedPassengerIds.length) {
        const { getPassengerById } = require('../../integrations/userServiceClient');
        const headers = req.headers && req.headers.authorization ? { headers: { Authorization: req.headers.authorization } } : {};
        const results = await Promise.all(unresolvedPassengerIds.map(id => getPassengerById(id, headers).catch(() => null)));
        const pmap = Object.fromEntries((results || []).filter(Boolean).map(u => [String(u.id), { id: String(u.id), name: u.name, phone: u.phone, email: u.email }]));
        passengerMap = { ...passengerMap, ...pmap };
      }
    } catch (_) {}
    const rideDetails = rideDetailsRaw.map(x => ({
      ...x,
      driver: x.driverId ? (driverMap[String(x.driverId)] || { id: String(x.driverId) }) : undefined,
      passenger: x.passengerId ? (passengerMap[String(x.passengerId)] || { id: String(x.passengerId) }) : undefined
    }));

    const topDriversAgg = await DriverEarnings.aggregate([
      { $match: { tripDate: inclusiveEnd ? { $gte: startDate, $lte: endDate } : { $gte: startDate, $lt: endDate } } },
      { $group: { _id: '$driverId', rides: { $sum: 1 }, gross: { $sum: '$grossFare' }, commission: { $sum: '$commissionAmount' }, net: { $sum: '$netEarnings' } } },
      { $sort: { net: -1 } },
      { $limit: 10 }
    ]);

    res.json({
      weekStart: startDate,
      weekEnd: endDate,
      totalRides: rides.length,
      completedRides: completed.length,
      canceledRides: rides.filter(r => r.status === 'canceled').length,
      totalRevenue,
      totalCommission: await (async () => {
        const adminAgg = await AdminEarnings.aggregate([
          { $match: { tripDate: inclusiveEnd ? { $gte: startDate, $lte: endDate } : { $gte: startDate, $lt: endDate } } },
          { $group: { _id: null, total: { $sum: '$commissionEarned' } } }
        ]);
        return adminAgg[0]?.total || 0;
      })(),
      averageFare: completed.length > 0 ? totalRevenue / completed.length : 0,
      topDrivers: topDriversAgg,
      rideDetails
    });
  } catch (e) {
    return res.status(500).json({ message: `Failed to get weekly report: ${e.message}` });
  }
};

exports.getMonthlyReport = async (req, res) => {
  try {
    const { month, year } = req.query;
    const { start: startDate, end: endDate, inclusiveEnd } = buildTimeRange('monthly', { month, year });
    const commissionRate = Number(process.env.COMMISSION_RATE || 15);

    const rides = await Booking.find({ status: 'completed', completedAt: inclusiveEnd ? { $gte: startDate, $lte: endDate } : { $gte: startDate, $lt: endDate } }).populate('driverId passengerId').lean();
    const completed = rides; // already filtered
    const totalRevenue = completed.reduce((sum, r) => sum + Number(r.fareFinal || 0), 0);

    const rideDetailsRaw = rides.map(r => ({
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
    let { driverMap, passengerMap } = await buildUserMaps(rideDetailsRaw.map(x => x.driverId), rideDetailsRaw.map(x => x.passengerId));
    // Fallback external enrich
    try {
      const unresolvedDriverIds = Array.from(new Set(rideDetailsRaw.map(x => x.driverId).filter(Boolean).map(String)))
        .filter(id => !driverMap[id]);
      if (unresolvedDriverIds.length) {
        const { getDriversByIds } = require('../../integrations/userServiceClient');
        const token = req.headers && req.headers.authorization ? req.headers.authorization : undefined;
        const infos = await getDriversByIds(unresolvedDriverIds, token);
        const emap = Object.fromEntries((infos || []).map(i => [String(i.id), {
          id: String(i.id), name: i.name, phone: i.phone, email: i.email,
          vehicleType: i.vehicleType, carName: i.carName, carModel: i.carModel, carPlate: i.carPlate, carColor: i.carColor
        }]));
        driverMap = { ...driverMap, ...emap };
      }
    } catch (_) {}
    try {
      const unresolvedPassengerIds = Array.from(new Set(rideDetailsRaw.map(x => x.passengerId).filter(Boolean).map(String)))
        .filter(id => !passengerMap[id]);
      if (unresolvedPassengerIds.length) {
        const { getPassengerById } = require('../../integrations/userServiceClient');
        const headers = req.headers && req.headers.authorization ? { headers: { Authorization: req.headers.authorization } } : {};
        const results = await Promise.all(unresolvedPassengerIds.map(id => getPassengerById(id, headers).catch(() => null)));
        const pmap = Object.fromEntries((results || []).filter(Boolean).map(u => [String(u.id), { id: String(u.id), name: u.name, phone: u.phone, email: u.email }]));
        passengerMap = { ...passengerMap, ...pmap };
      }
    } catch (_) {}
    const rideDetails = rideDetailsRaw.map(x => ({
      ...x,
      driver: x.driverId ? (driverMap[String(x.driverId)] || { id: String(x.driverId) }) : undefined,
      passenger: x.passengerId ? (passengerMap[String(x.passengerId)] || { id: String(x.passengerId) }) : undefined
    }));

    const adminAgg = await AdminEarnings.aggregate([
      { $match: { tripDate: { $gte: startDate, $lte: endDate } } },
      { $group: { _id: null, total: { $sum: '$commissionEarned' } } }
    ]);

    res.json({
      month: targetMonth,
      year: targetYear,
      totalRides: rides.length,
      totalRevenue,
      totalCommission: adminAgg[0]?.total || 0,
      completedRides: completed.length,
      canceledRides: rides.filter(r => r.status === 'canceled').length,
      averageFare: completed.length > 0 ? totalRevenue / completed.length : 0,
      rideDetails
    });
  } catch (e) {
    return res.status(500).json({ message: `Failed to get monthly report: ${e.message}` });
  }
};


