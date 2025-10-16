const { Booking } = require('../../models/bookingModels');
const { Driver, Passenger } = require('../../models/userModels');

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
      return { ...r, passenger, driver };
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

    const { getDriversByIds } = require('../../integrations/userServiceClient');
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


