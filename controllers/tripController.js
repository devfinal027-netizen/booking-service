const { Trip, Subscription, Contract, TripSchedule } = require("../models/indexModel");
const { asyncHandler } = require("../middleware/errorHandler");
const { getUserInfo } = require("../utils/tokenHelper");
const jwt = require('jsonwebtoken');

function decodeToken(req) {
  try {
    const authz = req.headers && req.headers.authorization ? req.headers.authorization : null;
    if (!authz) return null;
    const clean = authz.startsWith('Bearer ') ? authz.slice(7) : authz;
    return jwt.verify(clean, process.env.JWT_SECRET || 'secret');
  } catch (_) { return null; }
}

function findDriverInDecoded(decoded, driverId) {
  if (!decoded) return null;
  const candidates = [
    decoded.drivers,
    decoded.driver,
    decoded.assignedDrivers,
    decoded.assignedDriver,
    decoded.users,
    decoded.userList,
    decoded.data,
    decoded.payload,
    decoded.context,
    decoded.user && decoded.user.drivers,
    decoded.user && decoded.user.driver,
    decoded.user && decoded.user.users,
    decoded.user && decoded.user.data
  ];
  const isMatch = (u) => {
    if (!u) return false;
    const id = u.id || u._id || (u.user && (u.user.id || u.user._id));
    return id != null && String(id) === String(driverId);
  };
  for (const cont of candidates) {
    if (!cont) continue;
    if (Array.isArray(cont)) {
      const found = cont.find(isMatch);
      if (found) return found;
    } else if (typeof cont === 'object') {
      if (cont[String(driverId)]) return cont[String(driverId)];
      const found = Object.values(cont).find(isMatch);
      if (found) return found;
    }
  }
  return null;
}

// POST /trip/pickup - Create trip at pickup and return trip_id
exports.createTripOnPickup = asyncHandler(async (req, res) => {
  const { notes, subscription_id } = req.body || {};

  try {
    // Determine passenger context: if admin provided passenger_id, use it; else use authenticated passenger
    const isAdmin = req.user && req.user.type === "admin";
    const passengerId = isAdmin ? (req.body && req.body.passenger_id) : req.user.id;

    if (!passengerId) {
      return res.status(400).json({ success: false, message: "Missing passenger_id for trip creation at pickup" });
    }

    // Select subscription: prefer provided subscription_id, else latest ACTIVE
    let activeSubscription = null;
    if (subscription_id) {
      // Find by ID first, then enforce access and status with clear messages
      activeSubscription = await Subscription.findByPk(String(subscription_id));
      if (!activeSubscription) {
        return res.status(404).json({ success: false, message: "Subscription not found" });
      }
      if (String(activeSubscription.passenger_id) !== String(passengerId)) {
        return res.status(403).json({ success: false, message: "Access denied: subscription does not belong to this passenger" });
      }
      if (String(activeSubscription.status) !== "ACTIVE") {
        return res.status(400).json({ success: false, message: `Subscription is not ACTIVE (current: ${activeSubscription.status})` });
      }
    } else {
      activeSubscription = await Subscription.findOne({
        where: { passenger_id: passengerId, status: "ACTIVE" },
        order: [["createdAt", "DESC"]]
      });
      if (!activeSubscription) {
        return res.status(404).json({ success: false, message: "No active subscription found for passenger" });
      }
    }

    // Require a driver to be assigned somewhere in workflow; fallback to subscription.driver_id if present
    const assignedDriverId = activeSubscription.driver_id;
    if (!assignedDriverId) {
      return res.status(409).json({ success: false, message: "No driver assigned to active subscription" });
    }

    // Create trip using subscription details
    const trip = await Trip.create({
      subscription_id: activeSubscription.id,
      passenger_id: activeSubscription.passenger_id,
      driver_id: assignedDriverId,
      pickup_location: activeSubscription.pickup_location,
      dropoff_location: activeSubscription.dropoff_location,
      pickup_latitude: activeSubscription.pickup_latitude,
      pickup_longitude: activeSubscription.pickup_longitude,
      dropoff_latitude: activeSubscription.dropoff_latitude,
      dropoff_longitude: activeSubscription.dropoff_longitude,
      fare_amount: activeSubscription.final_fare,
      distance_km: activeSubscription.distance_km,
      notes
    });

    // Immediately mark pickup as confirmed by passenger at creation time
    await Trip.update({
      pickup_confirmed_by_passenger: true,
      actual_pickup_time: new Date(),
      // Use valid enum transition: SCHEDULED -> ONGOING
      status: "ONGOING",
      started_at: new Date()
    }, { where: { id: trip.id } });

    const updatedTrip = await Trip.findByPk(trip.id);
    const passengerInfo = await getUserInfo(req, passengerId, 'passenger');
    const decoded = decodeToken(req);
    const driverToken = findDriverInDecoded(decoded, assignedDriverId);
    // Build from token only; no external fallbacks
    const resolvedName = (driverToken && (driverToken.name || driverToken.fullName)) || null;
    const resolvedPhone = (driverToken && (driverToken.phone || driverToken.msisdn)) || null;
    const v = (driverToken && (driverToken.vehicle_info || {
      carModel: driverToken.carModel,
      carPlate: driverToken.carPlate,
      carColor: driverToken.carColor,
      vehicleType: driverToken.vehicleType,
    })) || {};
    // Fallback to subscription stored fields if token lacks details
    const subVeh = activeSubscription && activeSubscription.vehicle_info ? activeSubscription.vehicle_info : {};
    const safeVehicleInfo = {
      carModel: v?.carModel || v?.vehicleType || subVeh?.car_model || 'Not available',
      carPlate: v?.carPlate || subVeh?.car_plate || 'Not available',
      carColor: v?.carColor || subVeh?.car_color || 'Not available'
    };
    const safeDriverNameFinal = resolvedName || activeSubscription.driver_name || `Driver ${String(assignedDriverId).slice(-4)}`;
    const safeDriverPhoneFinal = resolvedPhone || activeSubscription.driver_phone || 'Not available';

    return res.status(201).json({
      success: true,
      message: "Trip created at pickup and pickup confirmed",
      data: {
        trip_id: updatedTrip.id,
        trip: {
          ...updatedTrip.toJSON(),
          passenger_name: passengerInfo?.name || null,
          passenger_phone: passengerInfo?.phone || null,
          passenger_email: passengerInfo?.email || null,
          driver_name: safeDriverNameFinal,
          driver_phone: safeDriverPhoneFinal,
          vehicle_info: safeVehicleInfo
        },
        confirmed_at: updatedTrip.actual_pickup_time,
        confirmed_by: passengerInfo?.name || passengerId,
        links: {
          self: `/trip/${updatedTrip.id}`,
          dropoff: `/trip/${updatedTrip.id}/dropoff`
        }
      }
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: "Error creating trip at pickup", error: error.message });
  }
});

// GET /trip - List trips according to role
exports.listTrips = asyncHandler(async (req, res) => {
  try {
    const whereClause = {};
    const { status } = req.query || {};

    if (status) whereClause.status = status;

    if (req.user.type === "passenger") {
      whereClause.passenger_id = req.user.id;
    } else if (req.user.type === "driver") {
      whereClause.driver_id = req.user.id;
    }

    const trips = await Trip.findAll({ where: whereClause, order: [["createdAt", "DESC"]] });

    return res.json({ success: true, data: { trips } });
  } catch (error) {
    return res.status(500).json({ success: false, message: "Error listing trips", error: error.message });
  }
});
// Deprecated: pickup confirmation now happens at creation
exports.confirmPickup = asyncHandler(async (req, res) => {
  const tripId = req.params.id;
  const { notes } = req.body;

  try {
    const trip = await Trip.findByPk(tripId);
    
    if (!trip) {
      return res.status(404).json({
        success: false,
        message: "Trip not found"
      });
    }

    // Authorization check - only passenger can confirm pickup
    if (req.user.type === "passenger" && req.user.id !== trip.passenger_id) {
      return res.status(403).json({
        success: false,
        message: "Access denied - only the passenger can confirm pickup"
      });
    }

    // Check if trip is in correct state (allow empty/undefined status due to prior inconsistencies)
    if (trip.status && trip.status !== "SCHEDULED") {
      return res.status(400).json({
        success: false,
        message: `Cannot confirm pickup. Trip status is ${trip.status}`
      });
    }

    // Update trip with pickup confirmation (transition to ONGOING)
    await Trip.update({
      status: "ONGOING",
      started_at: new Date(),
      actual_pickup_time: new Date(),
      pickup_confirmed_by_passenger: true,
      notes: notes || trip.notes
    }, {
      where: { id: tripId }
    });

    // Get updated trip with passenger info
    const updatedTrip = await Trip.findByPk(tripId);
    const passengerInfo = await getUserInfo(req, trip.passenger_id, 'passenger');
    const decoded2 = decodeToken(req);
    const driverToken2 = findDriverInDecoded(decoded2, trip.driver_id);
    const v2 = (driverToken2 && (driverToken2.vehicle_info || {
      carModel: driverToken2.carModel,
      carPlate: driverToken2.carPlate,
      carColor: driverToken2.carColor,
      vehicleType: driverToken2.vehicleType,
    })) || {};
    const safeVehicleInfo2 = {
      carModel: v2?.carModel || v2?.vehicleType || 'Not available',
      carPlate: v2?.carPlate || 'Not available',
      carColor: v2?.carColor || 'Not available'
    };

    res.json({
      success: true,
      message: "Pickup confirmed successfully",
      data: {
        trip_id: updatedTrip.id,
        trip: {
          ...updatedTrip.toJSON(),
          passenger_name: passengerInfo?.name || null,
          passenger_phone: passengerInfo?.phone || null,
          passenger_email: passengerInfo?.email || null,
          driver_name: (driverToken2 && (driverToken2.name || driverToken2.fullName)) || `Driver ${String(trip.driver_id).slice(-4)}`,
          driver_phone: (driverToken2 && (driverToken2.phone || driverToken2.msisdn)) || 'Not available',
          vehicle_info: safeVehicleInfo2
        },
        confirmed_at: updatedTrip.actual_pickup_time,
        confirmed_by: passengerInfo?.name || req.user.id,
        links: {
          self: `/trip/${tripId}`,
          dropoff: `/trip/${tripId}/dropoff`
        }
      }
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Error confirming pickup",
      error: error.message
    });
  }
});

// PATCH /trip/:id/dropoff - Confirm dropoff by passenger
exports.confirmDropoff = asyncHandler(async (req, res) => {
  const tripId = req.params.id;
  const { notes, rating } = req.body;

  try {
    const trip = await Trip.findByPk(tripId);
    
    if (!trip) {
      return res.status(404).json({
        success: false,
        message: "Trip not found"
      });
    }

    // Authorization check - only passenger can confirm dropoff
    if (req.user.type === "passenger" && req.user.id !== trip.passenger_id) {
      return res.status(403).json({
        success: false,
        message: "Access denied - only the passenger can confirm dropoff"
      });
    }

    // Check if trip is in correct state: allow if ONGOING or if pickup already confirmed
    const canDropoff = (trip.status === "ONGOING") || (trip.pickup_confirmed_by_passenger === true);
    if (!canDropoff) {
      return res.status(400).json({
        success: false,
        message: `Cannot confirm dropoff. Trip status is ${trip.status || 'UNKNOWN'}. Pickup must be confirmed first.`
      });
    }

    // Calculate trip duration
    const pickupTime = trip.actual_pickup_time || trip.scheduled_pickup_time;
    const dropoffTime = new Date();
    const durationMinutes = pickupTime ? Math.round((dropoffTime - new Date(pickupTime)) / (1000 * 60)) : null;

    // Update trip with dropoff confirmation
    await Trip.update({
      status: "COMPLETED",
      actual_dropoff_time: dropoffTime,
      trip_ended_by_passenger: true,
      notes: notes || trip.notes,
      rating: rating || null
    }, {
      where: { id: tripId }
    });

    // Get updated trip with user info
    const updatedTrip = await Trip.findByPk(tripId);
    const passengerInfo = await getUserInfo(req, trip.passenger_id, 'passenger');
    const driverInfo = await getUserInfo(req, trip.driver_id, 'driver');

    res.json({
      success: true,
      message: "Trip completed successfully",
      data: {
        trip: {
          ...updatedTrip.toJSON(),
          passenger_name: passengerInfo?.name || null,
          passenger_phone: passengerInfo?.phone || null,
          passenger_email: passengerInfo?.email || null,
          driver_name: driverInfo?.name || null,
          driver_phone: driverInfo?.phone || null,
          vehicle_info: driverInfo?.vehicle_info || null,
          trip_duration_minutes: durationMinutes,
        },
        completed_at: updatedTrip.actual_dropoff_time,
        completed_by: passengerInfo?.name || req.user.id,
        trip_summary: {
          pickup_time: updatedTrip.actual_pickup_time,
          dropoff_time: updatedTrip.actual_dropoff_time,
          duration_minutes: durationMinutes,
          distance_km: updatedTrip.distance_km,
          fare_amount: updatedTrip.fare_amount,
          rating: updatedTrip.rating
        }
      }
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Error confirming dropoff",
      error: error.message
    });
  }
});

// GET /trip/:id - Get trip details with passenger and driver info
exports.getTripDetails = asyncHandler(async (req, res) => {
  const tripId = req.params.id;

  try {
    const trip = await Trip.findByPk(tripId);
    
    if (!trip) {
      return res.status(404).json({
        success: false,
        message: "Trip not found"
      });
    }

    // Authorization check - passenger or driver can view trip details
    if (req.user.type === "passenger" && req.user.id !== trip.passenger_id) {
      return res.status(403).json({
        success: false,
        message: "Access denied"
      });
    }
    
    if (req.user.type === "driver" && req.user.id !== trip.driver_id) {
      return res.status(403).json({
        success: false,
        message: "Access denied"
      });
    }

    // Get user information
    const passengerInfo = await getUserInfo(req, trip.passenger_id, 'passenger');
    const driverInfo = await getUserInfo(req, trip.driver_id, 'driver');

    // Calculate trip duration if both times are available
    let durationMinutes = null;
    if (trip.actual_pickup_time && trip.actual_dropoff_time) {
      durationMinutes = Math.round((new Date(trip.actual_dropoff_time) - new Date(trip.actual_pickup_time)) / (1000 * 60));
    }

    res.json({
      success: true,
      data: {
        trip: {
          ...trip.toJSON(),
          passenger_name: passengerInfo?.name || null,
          passenger_phone: passengerInfo?.phone || null,
          passenger_email: passengerInfo?.email || null,
          driver_name: driverInfo?.name || null,
          driver_phone: driverInfo?.phone || null,
          driver_email: driverInfo?.email || null,
          vehicle_info: driverInfo?.vehicle_info || null,
          trip_duration_minutes: durationMinutes,
        }
      }
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Error fetching trip details",
      error: error.message
    });
  }
});

// GET /passenger/:id/driver - Get assigned driver information for passenger
exports.getAssignedDriver = asyncHandler(async (req, res) => {
  const passengerId = req.params.id;

  // Authorization check - passengers can only view their own driver info
  if (req.user.type === "passenger" && req.user.id !== passengerId) {
    return res.status(403).json({
      success: false,
      message: "Access denied"
    });
  }

  try {
    // Find active subscription for passenger
    const activeSubscription = await Subscription.findOne({
      where: {
        passenger_id: passengerId,
        status: "ACTIVE",
        driver_id: { [require("sequelize").Op.ne]: null }
      },
      order: [['createdAt', 'DESC']]
    });

    if (!activeSubscription || !activeSubscription.driver_id) {
      return res.status(404).json({
        success: false,
        message: "No active driver assigned to this passenger"
      });
    }

    // Get driver information
    const driverInfo = await getUserInfo(req, activeSubscription.driver_id, 'driver');
    const passengerInfo = await getUserInfo(req, passengerId, 'passenger');

    res.json({
      success: true,
      data: {
        passenger_id: passengerId,
        passenger_name: passengerInfo?.name || null,
        assigned_driver: {
          driver_id: activeSubscription.driver_id,
          driver_name: driverInfo?.name || activeSubscription.driver_name || null,
          driver_phone: driverInfo?.phone || activeSubscription.driver_phone || null,
          driver_email: driverInfo?.email || activeSubscription.driver_email || null,
          vehicle_info: driverInfo?.vehicle_info || activeSubscription.vehicle_info || null,
        },
        subscription: {
          id: activeSubscription.id,
          contract_type: activeSubscription.contract_type,
          pickup_location: activeSubscription.pickup_location,
          dropoff_location: activeSubscription.dropoff_location,
          start_date: activeSubscription.start_date,
          end_date: activeSubscription.end_date,
          status: activeSubscription.status
        }
      }
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Error fetching assigned driver information",
      error: error.message
    });
  }
});

// POST /trip - Create a new trip
exports.createTrip = asyncHandler(async (req, res) => {
  const {
    subscription_id,
    driver_id,
    pickup_location,
    dropoff_location,
    pickup_latitude,
    pickup_longitude,
    dropoff_latitude,
    dropoff_longitude,
    fare_amount,
    distance_km,
    scheduled_time,
    notes
  } = req.body;

  if (!subscription_id || !driver_id || !pickup_location || !dropoff_location) {
    return res.status(400).json({
      success: false,
      message: "Missing required fields: subscription_id, driver_id, pickup_location, dropoff_location"
    });
  }

  try {
    // Get subscription details
    const subscription = await Subscription.findByPk(subscription_id);
    if (!subscription) {
      return res.status(404).json({
        success: false,
        message: "Subscription not found"
      });
    }

    // Create the trip
    const trip = await Trip.create({
      subscription_id,
      passenger_id: subscription.passenger_id,
      driver_id,
      pickup_location,
      dropoff_location,
      pickup_latitude,
      pickup_longitude,
      dropoff_latitude,
      dropoff_longitude,
      fare_amount: fare_amount || subscription.final_fare,
      distance_km: distance_km || subscription.distance_km,
      status: "SCHEDULED",
      scheduled_pickup_time: scheduled_time ? new Date(scheduled_time) : new Date(),
      notes
    });

    // Create trip schedule if scheduled_time is provided
    let tripSchedule = null;
    if (scheduled_time) {
      tripSchedule = await TripSchedule.create({
        trip_id: trip.id,
        scheduled_time: new Date(scheduled_time),
        notified: false
      });
    }

    // Get user info for response
    const passengerInfo = await getUserInfo(req, subscription.passenger_id, 'passenger');
    const driverInfo = await getUserInfo(req, driver_id, 'driver');

    res.status(201).json({
      success: true,
      message: "Trip created successfully",
      data: {
        trip: {
          ...trip.toJSON(),
          passenger_name: passengerInfo?.name,
          passenger_phone: passengerInfo?.phone,
          driver_name: driverInfo?.name,
          driver_phone: driverInfo?.phone,
          vehicle_info: driverInfo?.vehicle_info,
          schedule: tripSchedule?.toJSON() || null
        }
      }
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Error creating trip",
      error: error.message
    });
  }
});

// PATCH /trip/:id/start - Start a trip
exports.startTrip = asyncHandler(async (req, res) => {
  const tripId = req.params.id;
  const { notes } = req.body;

  try {
    const trip = await Trip.findByPk(tripId, {
      include: [
        { model: Subscription, as: "subscription" },
        { model: TripSchedule, as: "schedule" }
      ]
    });

    if (!trip) {
      return res.status(404).json({
        success: false,
        message: "Trip not found"
      });
    }

    // Check authorization
    if (req.user.type === "driver" && String(req.user.id) !== String(trip.driver_id)) {
      return res.status(403).json({
        success: false,
        message: "Access denied - only assigned driver can start this trip"
      });
    }

    if (trip.status !== "SCHEDULED") {
      return res.status(400).json({
        success: false,
        message: `Cannot start trip with status: ${trip.status}`
      });
    }

    // Update trip status
    await trip.update({
      status: "ONGOING",
      started_at: new Date(),
      notes: notes || trip.notes
    });

    // Get user info for response
    const passengerInfo = await getUserInfo(req, trip.passenger_id, 'passenger');
    const driverInfo = await getUserInfo(req, trip.driver_id, 'driver');

    res.json({
      success: true,
      message: "Trip started successfully",
      data: {
        trip: {
          ...trip.toJSON(),
          status: "ONGOING",
          started_at: new Date(),
          passenger_name: passengerInfo?.name,
          passenger_phone: passengerInfo?.phone,
          driver_name: driverInfo?.name,
          driver_phone: driverInfo?.phone,
          vehicle_info: driverInfo?.vehicle_info
        },
        started_at: new Date(),
        started_by: driverInfo?.name || `Driver ${trip.driver_id.slice(-4)}`
      }
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Error starting trip",
      error: error.message
    });
  }
});

// Deprecated: use confirmDropoff instead
exports.completeTrip = asyncHandler(async (req, res) => {
  const tripId = req.params.id;
  const { notes, rating } = req.body;

  try {
    const trip = await Trip.findByPk(tripId, {
      include: [
        { model: Subscription, as: "subscription" },
        { model: TripSchedule, as: "schedule" }
      ]
    });

    if (!trip) {
      return res.status(404).json({
        success: false,
        message: "Trip not found"
      });
    }

    // Check authorization - both driver and passenger can complete
    if (req.user.type === "driver" && String(req.user.id) !== String(trip.driver_id)) {
      return res.status(403).json({
        success: false,
        message: "Access denied - only assigned driver can complete this trip"
      });
    }
    if (req.user.type === "passenger" && String(req.user.id) !== String(trip.passenger_id)) {
      return res.status(403).json({
        success: false,
        message: "Access denied - only assigned passenger can complete this trip"
      });
    }

    if (trip.status !== "ONGOING") {
      return res.status(400).json({
        success: false,
        message: `Cannot complete trip with status: ${trip.status}`
      });
    }

    // Calculate trip duration
    const completedAt = new Date();
    let durationMinutes = null;
    if (trip.started_at) {
      durationMinutes = Math.round((completedAt - new Date(trip.started_at)) / (1000 * 60));
    }

    // Update trip status
    await trip.update({
      status: "COMPLETED",
      completed_at: completedAt,
      notes: notes || trip.notes,
      rating: rating || trip.rating,
      trip_ended_by_passenger: req.user.type === "passenger"
    });

    // Get user info for response
    const passengerInfo = await getUserInfo(req, trip.passenger_id, 'passenger');
    const driverInfo = await getUserInfo(req, trip.driver_id, 'driver');

    res.json({
      success: true,
      message: "Trip completed successfully",
      data: {
        trip: {
          ...trip.toJSON(),
          status: "COMPLETED",
          completed_at: completedAt,
          trip_duration_minutes: durationMinutes,
          passenger_name: passengerInfo?.name,
          passenger_phone: passengerInfo?.phone,
          driver_name: driverInfo?.name,
          driver_phone: driverInfo?.phone,
          vehicle_info: driverInfo?.vehicle_info
        },
        completed_at: completedAt,
        completed_by: req.user.type === "passenger" ? passengerInfo?.name : driverInfo?.name,
        trip_summary: {
          started_at: trip.started_at,
          completed_at: completedAt,
          duration_minutes: durationMinutes,
          distance_km: trip.distance_km,
          fare_amount: trip.fare_amount,
          rating: rating || trip.rating
        }
      }
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Error completing trip",
      error: error.message
    });
  }
});