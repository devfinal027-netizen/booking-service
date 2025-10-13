const { Trip, Subscription, Contract, RideSchedule } = require("../models/indexModel");
const { asyncHandler } = require("../middleware/errorHandler");
const { getDriverById } = require("../utils/userService");
const { getUserInfo } = require("../utils/tokenHelper");
const { calculateFareFromCoordinates } = require("../utils/pricingService");

// GET /passenger/subscription/:subscriptionId/driver - Get assigned driver for a subscription
exports.getAssignedDriverBySubscription = asyncHandler(async (req, res) => {
  const subscriptionId = String(req.params.subscriptionId);
  const subscription = await Subscription.findByPk(subscriptionId, { include: [{ model: Contract, as: "contract", include: [{ model: RideSchedule, as: "ride_schedules", where: { is_active: true }, required: false }] }] });
  if (!subscription) return res.status(404).json({ success: false, message: "Subscription not found" });

  if (req.user.type === "passenger" && String(req.user.id) !== String(subscription.passenger_id)) {
    return res.status(403).json({ success: false, message: "Access denied" });
  }

  const driverId = subscription.driver_id || subscription.contract?.ride_schedules?.[0]?.driver_id;
  if (!driverId) return res.status(404).json({ success: false, message: "No driver assigned to this subscription" });

  const authHeader = req.headers && req.headers.authorization ? { headers: { Authorization: req.headers.authorization } } : {};
  let fetched = null;
  let tokenHelperInfo = null;
  try { fetched = await getDriverById(driverId, authHeader); } catch (_) {}
  try { tokenHelperInfo = await getUserInfo(req, driverId, 'driver'); } catch (_) {}

  const subData = subscription.toJSON();
  const safe = (v) => v && String(v).trim() !== '' && v !== 'Not available';
  const name = (fetched && safe(fetched.name) && fetched.name) || (tokenHelperInfo && safe(tokenHelperInfo.name) && tokenHelperInfo.name) || subData.driver_name || `Driver ${String(driverId).slice(-4)}`;
  const phone = (fetched && safe(fetched.phone) && fetched.phone) || (tokenHelperInfo && safe(tokenHelperInfo.phone) && tokenHelperInfo.phone) || subData.driver_phone || 'Not available';
  const email = (fetched && safe(fetched.email) && fetched.email) || (tokenHelperInfo && safe(tokenHelperInfo.email) && tokenHelperInfo.email) || subData.driver_email || 'Not available';
  const assignedDriver = Object.fromEntries(Object.entries({
    id: String(driverId),
    name, phone, email,
    carModel: fetched?.carModel || tokenHelperInfo?.vehicle_info?.carModel || subData.vehicle_info?.car_model || null,
    carPlate: fetched?.carPlate || tokenHelperInfo?.vehicle_info?.carPlate || subData.vehicle_info?.car_plate || null,
    carColor: fetched?.carColor || tokenHelperInfo?.vehicle_info?.carColor || subData.vehicle_info?.car_color || null,
  }).filter(([_, v]) => v != null));

  return res.json({ success: true, data: { subscription_id: subscriptionId, assigned_driver: assignedDriver } });
});

// PATCH /trip/:id/pickup - Passenger confirms pickup
exports.confirmPickup = asyncHandler(async (req, res) => {
  const tripId = req.params.id;
  
  const trip = await Trip.findByPk(tripId);
  if (!trip) {
    return res.status(404).json({ success: false, message: "Trip not found" });
  }

  // Check if user can access this trip
  if (req.user.type === "passenger" && String(req.user.id) !== String(trip.passenger_id)) {
    return res.status(403).json({ success: false, message: "Access denied" });
  }

  // Update trip status
  await trip.update({
    pickup_confirmed_by_passenger: true,
    actual_pickup_time: new Date(),
    status: "IN_PROGRESS",
  });

  res.json({
    success: true,
    message: "Pickup confirmed successfully",
    data: {
      trip_id: trip.id,
      trip,
      links: {
        self: `/trip/${trip.id}`,
        dropoff: `/trip/${trip.id}/dropoff`
      }
    }
  });
});

// PATCH /trip/:id/end - Passenger confirms end of trip
exports.confirmTripEnd = asyncHandler(async (req, res) => {
  const tripId = req.params.id;
  
  const trip = await Trip.findByPk(tripId);
  if (!trip) {
    return res.status(404).json({ success: false, message: "Trip not found" });
  }

  // Check if user can access this trip
  if (req.user.type === "passenger" && String(req.user.id) !== String(trip.passenger_id)) {
    return res.status(403).json({ success: false, message: "Access denied" });
  }

  // Update trip status
  await trip.update({
    trip_ended_by_passenger: true,
    actual_dropoff_time: new Date(),
    status: "COMPLETED",
  });

  res.json({
    success: true,
    message: "Trip ended successfully",
    data: trip
  });
});

// GET /passenger/:id/trips - Get trip history for passenger
exports.getTripHistory = asyncHandler(async (req, res) => {
  const passengerId = req.params.id;

  // Check if user can access this passenger's data
  if (req.user.type === "passenger" && String(req.user.id) !== String(passengerId)) {
    return res.status(403).json({ success: false, message: "Access denied" });
  }

  const trips = await Trip.findAll({
    where: { passenger_id: passengerId },
    include: [
      {
        model: Contract,
        as: "contract",
        attributes: ["id", "contract_type", "pickup_location", "dropoff_location"]
      },
      {
        model: Subscription,
        as: "subscription",
        attributes: ["id", "status", "start_date", "end_date"]
      }
    ],
    order: [['createdAt', 'DESC']],
  });

  // Enrich with driver information
  const uniqueDriverIds = [...new Set(trips.map(t => t.driver_id).filter(Boolean))];
  const authHeader = req.headers && req.headers.authorization ? { headers: { Authorization: req.headers.authorization } } : {};
  const driverInfoMap = new Map();
  
  await Promise.all(uniqueDriverIds.map(async (driverId) => {
    try {
      const info = await getDriverById(driverId, authHeader);
      if (info) driverInfoMap.set(driverId, info);
    } catch (_) {}
  }));

  const enrichedTrips = trips.map(trip => {
    const tripData = trip.toJSON();
    const driverInfo = driverInfoMap.get(trip.driver_id);
    
    return {
      ...tripData,
      driver_name: driverInfo?.name || null,
      driver_phone: driverInfo?.phone || null,
      driver_email: driverInfo?.email || null,
      vehicle_info: driverInfo ? {
        car_model: driverInfo.carModel,
        car_plate: driverInfo.carPlate,
        car_color: driverInfo.carColor,
      } : null,
    };
  });

  res.json({
    success: true,
    data: enrichedTrips
  });
});

// GET /subscription/price - Calculate subscription price based on pickup/dropoff
exports.calculateSubscriptionPrice = asyncHandler(async (req, res) => {
  const { pickup_lat, pickup_lon, dropoff_lat, dropoff_lon, contract_type = "INDIVIDUAL" } = req.query;

  if (!pickup_lat || !pickup_lon || !dropoff_lat || !dropoff_lon) {
    return res.status(400).json({
      success: false,
      message: "Missing required parameters: pickup_lat, pickup_lon, dropoff_lat, dropoff_lon"
    });
  }

  try {
    const pickupLat = parseFloat(pickup_lat);
    const pickupLon = parseFloat(pickup_lon);
    const dropoffLat = parseFloat(dropoff_lat);
    const dropoffLon = parseFloat(dropoff_lon);

    const fareResult = await calculateFareFromCoordinates(
      pickupLat, pickupLon, dropoffLat, dropoffLon, contract_type
    );

    if (!fareResult.success) {
      return res.status(400).json(fareResult);
    }

    res.json({
      success: true,
      data: {
        ...fareResult.data,
        contract_type,
        estimated_monthly_cost: Math.round(fareResult.data.final_fare * 22 * 100) / 100, // 22 working days
      }
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Error calculating subscription price",
      error: error.message
    });
  }
});