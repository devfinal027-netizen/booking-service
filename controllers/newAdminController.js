const { ContractSettings, Subscription, Payment, Trip, TripSchedule, Contract, ContractType } = require("../models/indexModel");
const { asyncHandler } = require("../middleware/errorHandler");
const { getDriverById, getPassengerById, listDrivers } = require("../utils/userService");
// Payment endpoints removed as requested
const { getUserInfo } = require("../utils/tokenHelper");

// POST /admin/contracts/sample - Create sample contracts for testing
exports.createSampleContracts = asyncHandler(async (req, res) => {
  try {
    console.log("🚀 Creating sample contracts...");

    // Get all active contract types
    const contractTypes = await ContractType.findAll({
      where: { is_active: true }
    });

    if (contractTypes.length === 0) {
      return res.status(404).json({
        success: false,
        message: "No contract types found. Please create contract types first."
      });
    }

    console.log(`📋 Found ${contractTypes.length} contract types`);

    // Create sample contracts for each contract type
    const sampleContracts = [];

    for (const contractType of contractTypes) {
      // Create 2 sample contracts per type
      const contractsToCreate = [
        {
          contract_type_id: contractType.id,
          start_date: "2024-01-01",
          end_date: "2024-12-31",
          pickup_location: "Bole International Airport",
          dropoff_location: "Addis Ababa University",
          cost: parseFloat(contractType.base_price_per_km) * 10, // Sample cost
          status: "ACTIVE"
        },
        {
          contract_type_id: contractType.id,
          start_date: "2024-01-01",
          end_date: "2024-12-31",
          pickup_location: "Mercato",
          dropoff_location: "Bole",
          cost: parseFloat(contractType.base_price_per_km) * 8, // Sample cost
          status: "ACTIVE"
        }
      ];

      for (const contractData of contractsToCreate) {
        try {
          const contract = await Contract.create(contractData);
          sampleContracts.push(contract);
          console.log(`✅ Created contract for ${contractType.name}: ${contract.id}`);
        } catch (error) {
          console.error(`❌ Error creating contract for ${contractType.name}:`, error.message);
        }
      }
    }

    console.log(`✅ Created ${sampleContracts.length} sample contracts`);
    
    // Show summary
    const summary = [];
    for (const contractType of contractTypes) {
      const contractsForType = await Contract.count({
        where: { contract_type_id: contractType.id }
      });
      summary.push({
        contract_type: contractType.name,
        contract_count: contractsForType
      });
    }

    res.status(201).json({
      success: true,
      message: `Created ${sampleContracts.length} sample contracts`,
      data: {
        contracts_created: sampleContracts.length,
        summary: summary
      }
    });

  } catch (error) {
    console.error("❌ Error creating sample contracts:", error);
    return res.status(500).json({
      success: false,
      message: "Error creating sample contracts",
      error: error.message
    });
  }
});

// POST /admin/subscription/:id/assign-driver - Assign driver to passenger subscription
exports.assignDriverToSubscription = asyncHandler(async (req, res) => {
  const subscriptionId = req.params.id;
  const { driver_id, passenger_id } = req.body;

  if (!driver_id) {
    return res.status(400).json({
      success: false,
      message: "driver_id is required"
    });
  }

  try {
    // Find the subscription
    let subscription = await Subscription.findByPk(subscriptionId);
    // If not found and passenger_id provided, fallback to latest active subscription for passenger
    if (!subscription && passenger_id) {
      subscription = await Subscription.findOne({
        where: { passenger_id, status: "ACTIVE" },
        order: [["createdAt", "DESC"]]
      });
    }
    if (!subscription) {
      return res.status(404).json({
        success: false,
        message: "Subscription not found"
      });
    }

    // Fetch driver info from external service
    const authHeader = req.headers && req.headers.authorization ? { headers: { Authorization: req.headers.authorization } } : {};
    console.log(`🔍 [assignDriverToSubscription] Fetching driver ${driver_id} with auth header:`, JSON.stringify(authHeader, null, 2));
    
    const fetchedDriver = await getDriverById(driver_id, authHeader);
    console.log(`🔍 [assignDriverToSubscription] External service result:`, JSON.stringify(fetchedDriver, null, 2));
    
    if (!fetchedDriver) {
      console.log(`❌ [assignDriverToSubscription] Driver ${driver_id} not found in external service`);
      return res.status(404).json({ success: false, message: "Driver not found" });
    }

    const driverInfo = {
      id: String(fetchedDriver.id),
      name: fetchedDriver.name,
      phone: fetchedDriver.phone,
      email: fetchedDriver.email,
      vehicle_info: {
        carModel: fetchedDriver.carModel,
        carPlate: fetchedDriver.carPlate,
        carColor: fetchedDriver.carColor,
        vehicleType: fetchedDriver.vehicleType,
      }
    };

    // Update subscription with driver assignment and store key driver fields for convenience
    await subscription.update({
      driver_id: driver_id,
      driver_name: driverInfo.name || null,
      driver_phone: driverInfo.phone || null,
      driver_email: driverInfo.email || null,
      vehicle_info: {
        car_model: driverInfo.vehicle_info?.carModel || driverInfo.vehicle_info?.vehicleType || null,
        car_plate: driverInfo.vehicle_info?.carPlate || null,
        car_color: driverInfo.vehicle_info?.carColor || null
      }
    });

    // Fetch passenger info from external service
    const { getPassengerById } = require("../utils/userService");
    console.log(`🔍 [assignDriverToSubscription] Fetching passenger ${subscription.passenger_id} with auth header:`, JSON.stringify(authHeader, null, 2));
    
    const fetchedPassenger = await getPassengerById(subscription.passenger_id, authHeader);
    console.log(`🔍 [assignDriverToSubscription] External service passenger result:`, JSON.stringify(fetchedPassenger, null, 2));
    
    const passengerInfo = {
      id: String(fetchedPassenger?.id || subscription.passenger_id),
      name: fetchedPassenger?.name || `Passenger ${String(subscription.passenger_id).slice(-4)}`,
      phone: fetchedPassenger?.phone || 'Not available',
      email: fetchedPassenger?.email || 'Not available',
    };

    res.json({
      success: true,
      message: "Driver assigned to subscription successfully",
      data: {
        subscription: {
          ...subscription.toJSON(),
          passenger_name: passengerInfo?.name || `Passenger ${String(subscription.passenger_id || '').slice(-4)}`,
          passenger_phone: passengerInfo?.phone || 'Not available',
          passenger_email: passengerInfo?.email || 'Not available',
          driver_name: driverInfo.name || null,
          driver_phone: driverInfo.phone || null,
          driver_email: driverInfo.email || null,
          vehicle_info: driverInfo.vehicle_info || null
        },
        full_driver: driverInfo
      }
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Error assigning driver to subscription",
      error: error.message
    });
  }
});

// GET /admin/subscriptions - Get all subscriptions for admin management
exports.getAllSubscriptions = asyncHandler(async (req, res) => {
  const { status, payment_status, contract_type } = req.query;

  try {
    let whereClause = {};
    
    if (status) {
      whereClause.status = status;
    }
    if (payment_status) {
      whereClause.payment_status = payment_status;
    }
    if (contract_type) {
      whereClause.contract_type = contract_type;
    }

    const subscriptions = await Subscription.findAll({
      where: whereClause,
      include: [{ model: ContractType, as: 'contractType', attributes: ['id','name'] }],
      order: [['createdAt', 'DESC']],
    });

    // Enrich subscriptions with user information and trip history
    const enrichedSubscriptions = await Promise.all(
      subscriptions.map(async (subscription) => {
        const subData = subscription.toJSON();
        
        // Get user information from external service for complete data
        const { getPassengerById, getDriverById } = require("../utils/userService");
        const authHeader = req.headers && req.headers.authorization ? { headers: { Authorization: req.headers.authorization } } : {};
        
        const fetchedPassenger = await getPassengerById(subscription.passenger_id, authHeader);
        const passengerInfo = {
          id: String(fetchedPassenger?.id || subscription.passenger_id),
          name: fetchedPassenger?.name || `Passenger ${String(subscription.passenger_id).slice(-4)}`,
          phone: fetchedPassenger?.phone || 'Not available',
          email: fetchedPassenger?.email || 'Not available',
        };
        
        let driverInfo = null;
        if (subscription.driver_id) {
          const fetchedDriver = await getDriverById(subscription.driver_id, authHeader);
          if (fetchedDriver) {
            driverInfo = {
              id: String(fetchedDriver.id),
              name: fetchedDriver.name,
              phone: fetchedDriver.phone,
              email: fetchedDriver.email,
              vehicle_info: {
                carModel: fetchedDriver.carModel,
                carPlate: fetchedDriver.carPlate,
                carColor: fetchedDriver.carColor,
                vehicleType: fetchedDriver.vehicleType,
              }
            };
          }
        }

        // Get trip history for this subscription
        const trips = await Trip.findAll({
          where: { subscription_id: subscription.id },
          order: [['createdAt', 'DESC']],
          limit: 5 // Last 5 trips
        });

        // Calculate expiration details
        const endDate = new Date(subscription.end_date);
        const today = new Date();
        const daysUntilExpiry = Math.ceil((endDate - today) / (1000 * 60 * 60 * 24));
        
        const cleaned = {
          ...subData,
          passenger_id: subscription.passenger_id,
          contract_type_name: subscription.contractType?.name || null,
          passenger_name: passengerInfo?.name || `Passenger ${String(subscription.passenger_id || '').slice(-4)}`,
          passenger_phone: passengerInfo?.phone || 'Not available',
          passenger_email: passengerInfo?.email || 'Not available',
          driver_id: subscription.driver_id,
          driver_name: driverInfo?.name || (subscription.driver_id ? `Driver ${String(subscription.driver_id).slice(-4)}` : null),
          driver_phone: driverInfo?.phone || (subscription.driver_id ? 'Not available' : null),
          driver_email: driverInfo?.email || (subscription.driver_id ? 'Not available' : null),
          vehicle_info: driverInfo?.vehicle_info || subData.vehicle_info || null,
          expiration_date: subscription.end_date,
          days_until_expiry: daysUntilExpiry,
          is_expired: daysUntilExpiry < 0,
          trip_history: trips.map(trip => ({
            id: trip.id,
            status: trip.status,
            pickup_location: trip.pickup_location,
            dropoff_location: trip.dropoff_location,
            scheduled_pickup_time: trip.scheduled_pickup_time,
            actual_pickup_time: trip.actual_pickup_time,
            actual_dropoff_time: trip.actual_dropoff_time,
            distance_km: trip.distance_km,
            fare_amount: trip.fare_amount,
            pickup_confirmed: trip.pickup_confirmed_by_passenger,
            trip_ended: trip.trip_ended_by_passenger,
          })),
          trip_count: trips.length,
        };

        // Remove nested contractType and contract_id to avoid redundancy
        delete cleaned.contractType;
        delete cleaned.contract_id;
        return cleaned;
      })
    );

    // Separate by status for better organization
    const activeSubscriptions = enrichedSubscriptions.filter(s => s.status === "ACTIVE" && !s.is_expired);
    const pendingSubscriptions = enrichedSubscriptions.filter(s => s.status === "PENDING");
    const expiredSubscriptions = enrichedSubscriptions.filter(s => s.is_expired);

    res.json({
      success: true,
      data: {
        subscriptions: enrichedSubscriptions,
        active_subscriptions: activeSubscriptions,
        pending_subscriptions: pendingSubscriptions,
        expired_subscriptions: expiredSubscriptions,
        counters: {
          total_count: enrichedSubscriptions.length,
          active_count: activeSubscriptions.length,
          pending_count: pendingSubscriptions.length,
          expired_count: expiredSubscriptions.length,
        },
        filters_applied: { status, payment_status, contract_type }
      }
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Error fetching subscriptions",
      error: error.message
    });
  }
});

// PATCH /admin/subscription/:id/approve - Approve subscription only (payments removed)
exports.approveSubscription = asyncHandler(async (req, res) => {
  const subscriptionId = String(req.params.id);
  const adminId = req.user.id;

  try {
    let subscription = await Subscription.findByPk(subscriptionId, {
      include: [
        {
          model: Payment,
          as: "payments",
          where: { status: "PENDING" },
          required: false
        }
      ]
    });

    if (!subscription) {
      // Try external fetch by passenger, then map to nearest local subscription
      const authHeader = req.headers && req.headers.authorization ? { headers: { Authorization: req.headers.authorization } } : {};
      // No external subscription service helper present; as a fallback, try to find by passenger using token info
      // This keeps behavior consistent with local store
      const { getUserInfo } = require("../utils/tokenHelper");
      const passengerInfo = await getUserInfo(req, null, 'passenger');
      if (passengerInfo && passengerInfo.id) {
        subscription = await Subscription.findOne({ where: { id: subscriptionId } });
      }
      if (!subscription) {
        return res.status(404).json({ success: false, message: "Subscription not found" });
      }
    }

    if (subscription.status !== "PENDING") {
      return res.status(400).json({
        success: false,
        message: `Cannot approve subscription with status: ${subscription.status}`
      });
    }

    // Enforce: admin can approve ONLY if payment_status is PAID
    if (subscription.payment_status !== "PAID") {
      return res.status(400).json({
        success: false,
        message: `Cannot approve subscription. Payment status must be PAID, got: ${subscription.payment_status || "null"}`
      });
    }

    // Update subscription status only (payment already handled by webhook)
    await Subscription.update({
      status: "ACTIVE"
    }, {
      where: { id: subscriptionId }
    });

    // Approve any pending payments for this subscription
    // Payment approval removed

    // Get admin info for response (from token)
    const adminInfo = await getUserInfo(req, adminId, 'admin');
    const passengerInfo = await getUserInfo(req, subscription.passenger_id, 'passenger');

    res.json({
      success: true,
      message: "Subscription approved successfully",
      data: {
        subscription_id: subscriptionId,
        approved_by: adminInfo?.name || String(adminId),
        approver: {
          id: String(adminId),
          name: adminInfo?.name || `admin ${String(adminId)}`,
          phone: adminInfo?.phone || 'Not available',
          email: adminInfo?.email || 'Not available',
        },
        approved_at: new Date(),
        passenger: {
          id: passengerInfo?.id || String(subscription.passenger_id || ''),
          name: passengerInfo?.name || `Passenger ${String(subscription.passenger_id || '').slice(-4)}`,
          phone: passengerInfo?.phone || 'Not available',
          email: passengerInfo?.email || 'Not available',
        },
        new_status: "ACTIVE"
      }
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Error approving subscription",
      error: error.message
    });
  }
});

// DELETE /admin/subscription/:id - Delete a subscription (admin only)
exports.deleteSubscriptionByAdmin = asyncHandler(async (req, res) => {
  const subscriptionId = String(req.params.id);

  try {
    const deleted = await Subscription.destroy({ where: { id: subscriptionId } });
    if (!deleted) {
      return res.status(404).json({ success: false, message: "Subscription not found" });
    }

    return res.json({
      success: true,
      message: "Subscription deleted successfully",
      data: { subscription_id: subscriptionId }
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Error deleting subscription",
      error: error.message
    });
  }
});

// PUT /admin/subscription/:id - Update a subscription (admin only)
exports.updateSubscriptionByAdmin = asyncHandler(async (req, res) => {
  const subscriptionId = String(req.params.id);
  const allowed = [
    'pickup_location','dropoff_location','pickup_latitude','pickup_longitude',
    'dropoff_latitude','dropoff_longitude','start_date','end_date','status','payment_status',
    'driver_id','driver_name','driver_phone','driver_email','vehicle_info'
  ];
  const updateData = {};
  for (const key of allowed) {
    if (Object.prototype.hasOwnProperty.call(req.body || {}, key)) {
      updateData[key] = req.body[key];
    }
  }
  const sub = await Subscription.findByPk(subscriptionId);
  if (!sub) return res.status(404).json({ success: false, message: 'Subscription not found' });
  await sub.update(updateData);
  const updated = await Subscription.findByPk(subscriptionId);
  return res.json({ success: true, message: 'Subscription updated successfully', data: updated });
});

// PUT /admin/contract-types/:id - Update contract type (already exists via controller)
// DELETE /admin/contract-types/:id - Delete contract type (already exists via controller)

// GET /admin/trips - Get all trips with filters
exports.getAllTrips = asyncHandler(async (req, res) => {
  const { status, driverId, passengerId, start_date, end_date } = req.query;

  try {
    let whereClause = {};

    // Apply filters
    if (status) {
      whereClause.status = status;
    }
    if (driverId) {
      whereClause.driver_id = driverId;
    }
    if (passengerId) {
      whereClause.passenger_id = passengerId;
    }

    // Date range filter
    if (start_date || end_date) {
      whereClause.createdAt = {};
      if (start_date) {
        whereClause.createdAt[require("sequelize").Op.gte] = new Date(start_date);
      }
      if (end_date) {
        whereClause.createdAt[require("sequelize").Op.lte] = new Date(end_date);
      }
    }

    const trips = await Trip.findAll({
      where: whereClause,
      include: [
        {
          model: Subscription,
          as: "subscription",
          attributes: ['id', 'contract_type_id', 'status', 'payment_status']
        },
        {
          model: TripSchedule,
          as: "schedule",
          required: false
        }
      ],
      order: [['createdAt', 'DESC']],
    });

    // Enrich trips with user information
    const enrichedTrips = await Promise.all(
      trips.map(async (trip) => {
        const tripData = trip.toJSON();
        
        // Get user information from external service for complete data
        const { getPassengerById, getDriverById } = require("../utils/userService");
        const authHeader = req.headers && req.headers.authorization ? { headers: { Authorization: req.headers.authorization } } : {};
        
        const fetchedPassenger = await getPassengerById(trip.passenger_id, authHeader);
        const passengerInfo = {
          id: String(fetchedPassenger?.id || trip.passenger_id),
          name: fetchedPassenger?.name || `Passenger ${String(trip.passenger_id).slice(-4)}`,
          phone: fetchedPassenger?.phone || 'Not available',
          email: fetchedPassenger?.email || 'Not available',
        };
        
        const fetchedDriver = await getDriverById(trip.driver_id, authHeader);
        const driverInfo = {
          id: String(fetchedDriver?.id || trip.driver_id),
          name: fetchedDriver?.name || `Driver ${String(trip.driver_id).slice(-4)}`,
          phone: fetchedDriver?.phone || 'Not available',
          email: fetchedDriver?.email || 'Not available',
          vehicle_info: fetchedDriver ? {
            carModel: fetchedDriver.carModel,
            carPlate: fetchedDriver.carPlate,
            carColor: fetchedDriver.carColor,
            vehicleType: fetchedDriver.vehicleType,
          } : null
        };

        // Calculate trip duration if both times are available
        let durationMinutes = null;
        if (trip.started_at && trip.completed_at) {
          durationMinutes = Math.round((new Date(trip.completed_at) - new Date(trip.started_at)) / (1000 * 60));
        }

        return {
          ...tripData,
          passenger_id: trip.passenger_id,
          passenger_name: passengerInfo?.name || `Passenger ${String(trip.passenger_id || '').slice(-4)}`,
          passenger_phone: passengerInfo?.phone || 'Not available',
          passenger_email: passengerInfo?.email || 'Not available',
          driver_id: trip.driver_id,
          driver_name: driverInfo?.name || `Driver ${String(trip.driver_id || '').slice(-4)}`,
          driver_phone: driverInfo?.phone || 'Not available',
          driver_email: driverInfo?.email || 'Not available',
          vehicle_info: driverInfo?.vehicle_info || null,
          trip_duration_minutes: durationMinutes,
          is_scheduled: !!tripData.schedule,
          notification_sent: tripData.schedule?.notified || false,
        };
      })
    );

    // Separate by status for better organization
    const scheduledTrips = enrichedTrips.filter(t => t.status === "SCHEDULED");
    const ongoingTrips = enrichedTrips.filter(t => t.status === "ONGOING");
    const completedTrips = enrichedTrips.filter(t => t.status === "COMPLETED");
    const cancelledTrips = enrichedTrips.filter(t => t.status === "CANCELLED");

    // Calculate statistics
    const totalDistance = completedTrips.reduce((sum, trip) => sum + (parseFloat(trip.distance_km) || 0), 0);
    const totalFare = completedTrips.reduce((sum, trip) => sum + (parseFloat(trip.fare_amount) || 0), 0);

    res.json({
      success: true,
      data: {
        trips: enrichedTrips,
        scheduled_trips: scheduledTrips,
        ongoing_trips: ongoingTrips,
        completed_trips: completedTrips,
        cancelled_trips: cancelledTrips,
        statistics: {
          total_trips: enrichedTrips.length,
          scheduled_count: scheduledTrips.length,
          ongoing_count: ongoingTrips.length,
          completed_count: completedTrips.length,
          cancelled_count: cancelledTrips.length,
          total_distance_km: Math.round(totalDistance * 100) / 100,
          total_fare: Math.round(totalFare * 100) / 100,
          average_trip_distance: completedTrips.length > 0 ? Math.round((totalDistance / completedTrips.length) * 100) / 100 : 0,
          average_fare_per_trip: completedTrips.length > 0 ? Math.round((totalFare / completedTrips.length) * 100) / 100 : 0,
        },
        filters_applied: { status, driverId, passengerId, start_date, end_date }
      }
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Error fetching trips",
      error: error.message
    });
  }
});

// GET /admin/passenger/:id/trips - Trip history for a passenger (admin only)
exports.getTripsByPassenger = asyncHandler(async (req, res) => {
  const passengerId = String(req.params.id);
  try {
    const trips = await Trip.findAll({
      where: { passenger_id: passengerId },
      include: [
        { model: Subscription, as: "subscription", attributes: ['id', 'contract_type_id', 'status', 'payment_status'], include: [{ model: ContractType, as: 'contractType', attributes: ['name'] }] },
        { model: TripSchedule, as: "schedule", required: false }
      ],
      order: [['createdAt', 'DESC']]
    });
    const mapped = trips.map(t => {
      const j = t.toJSON();
      if (j.subscription && j.subscription.contractType) {
        j.subscription.contract_type_name = j.subscription.contractType.name || null;
        delete j.subscription.contractType;
      }
      return j;
    });
    return res.json({ success: true, data: { passenger_id: passengerId, trips: mapped } });
  } catch (error) {
    return res.status(500).json({ success: false, message: "Error fetching passenger trips", error: error.message });
  }
});

// GET /admin/driver/:id/trips - Trip history for a driver (admin only)
exports.getTripsByDriver = asyncHandler(async (req, res) => {
  const driverId = String(req.params.id);
  try {
    const trips = await Trip.findAll({
      where: { driver_id: driverId },
      include: [
        { model: Subscription, as: "subscription", attributes: ['id', 'contract_type_id', 'status', 'payment_status'], include: [{ model: ContractType, as: 'contractType', attributes: ['name'] }] },
        { model: TripSchedule, as: "schedule", required: false }
      ],
      order: [['createdAt', 'DESC']]
    });
    const mapped = trips.map(t => {
      const j = t.toJSON();
      if (j.subscription && j.subscription.contractType) {
        j.subscription.contract_type_name = j.subscription.contractType.name || null;
        delete j.subscription.contractType;
      }
      return j;
    });
    return res.json({ success: true, data: { driver_id: driverId, trips: mapped } });
  } catch (error) {
    return res.status(500).json({ success: false, message: "Error fetching driver trips", error: error.message });
  }
});

// Payment approval methods - delegate to paymentController
// Removed: getPendingPayments, approvePayment, rejectPayment

// GET /admin/drivers - List drivers from external user service (not token)
exports.getDrivers = asyncHandler(async (req, res) => {
  const { available, search, limit, page } = req.query;
  const query = {};
  if (available != null) query.available = String(available) === 'true';
  if (search) query.search = search;
  if (limit) query.limit = parseInt(limit);
  if (page) query.page = parseInt(page);

  const authHeader = req.headers && req.headers.authorization ? { headers: { Authorization: req.headers.authorization } } : {};
  const drivers = await listDrivers(query, authHeader);

  res.json({
    success: true,
    data: drivers.map(d => ({
      id: String(d.id || ''),
      name: d.name || null,
      phone: d.phone || null,
      email: d.email || null,
      vehicleType: d.vehicleType || null,
      carPlate: d.carPlate || null,
      rating: d.rating != null ? d.rating : null,
      available: !!d.available,
      paymentPreference: d.paymentPreference || null,
    })),
    total_count: drivers.length,
    filters_applied: { available: query.available ?? null, search: search || null }
  });
});

// GET /admin/driver/:id - Always fetch from external user service (no token fallbacks)
exports.getDriverDetail = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const authHeader = req.headers && req.headers.authorization ? { headers: { Authorization: req.headers.authorization } } : {};

  // External service by id (primary)
  let d = await getDriverById(String(id), authHeader);

  // As a resilient fallback, list and match by id
  if (!d) {
    try {
      const list = await listDrivers({}, authHeader);
      const found = (list || []).find(x => String(x.id) === String(id));
      if (found) {
        d = {
          id: found.id,
          name: found.name,
          phone: found.phone,
          email: found.email,
          vehicleType: found.vehicleType,
          carModel: found.carModel,
          carPlate: found.carPlate,
          carColor: found.carColor,
          rating: found.rating,
          available: found.available,
          lastKnownLocation: found.lastKnownLocation,
          paymentPreference: found.paymentPreference,
        };
      }
    } catch (_) {}
  }

  if (!d) {
    return res.status(404).json({ success: false, message: 'Driver not found' });
  }

  res.json({
    success: true,
    data: {
      id: String(d.id || id),
      name: d.name || null,
      phone: d.phone || null,
      email: d.email || null,
      vehicleType: d.vehicleType || null,
      carModel: d.carModel || null,
      carPlate: d.carPlate || null,
      carColor: d.carColor || null,
      rating: d.rating != null ? d.rating : null,
      available: d.available != null ? !!d.available : null,
      lastKnownLocation: d.lastKnownLocation || null,
      paymentPreference: d.paymentPreference || null,
    }
  });
});