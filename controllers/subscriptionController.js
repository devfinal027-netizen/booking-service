const { Subscription, Contract } = require("../models/indexModel");
const { asyncHandler } = require("../middleware/errorHandler");
const { getPassengerById } = require("../utils/userService");
const { calculateFareFromCoordinates } = require("../utils/pricingService");

// CREATE
exports.createSubscription = asyncHandler(async (req, res) => {
  const { 
    contract_id, 
    amount_paid, 
    passenger_id,
    pickup_lat,
    pickup_lon,
    dropoff_lat,
    dropoff_lon 
  } = req.body;

  const contract = await Contract.findByPk(contract_id);
  if (!contract)
    return res
      .status(404)
      .json({ success: false, message: "Contract not found" });

  // If coordinates are provided, calculate fare and update contract cost
  let calculatedFare = null;
  let updatedContractCost = contract.cost;

  if (pickup_lat && pickup_lon && dropoff_lat && dropoff_lon) {
    try {
      const fareResult = await calculateFareFromCoordinates(
        parseFloat(pickup_lat), 
        parseFloat(pickup_lon), 
        parseFloat(dropoff_lat), 
        parseFloat(dropoff_lon), 
        contract.contract_type
      );

      if (fareResult.success) {
        calculatedFare = fareResult.data;
        // For monthly subscription, multiply by working days
        updatedContractCost = Math.round(fareResult.data.final_fare * 22 * 100) / 100;
        
        // Update contract with calculated cost if it's different
        if (Math.abs(updatedContractCost - parseFloat(contract.cost)) > 0.01) {
          await contract.update({ cost: updatedContractCost });
        }
      }
    } catch (error) {
      console.error('Error calculating fare for subscription:', error);
    }
  }

  let status = "PENDING";
  const contractCost = parseFloat(updatedContractCost);
  const paidAmount = parseFloat(amount_paid || 0);
  
  if (paidAmount >= contractCost) status = "ACTIVE";
  else if (paidAmount > 0) status = "PARTIAL";

  const subscriptionData = { 
    ...req.body, 
    status,
    calculated_fare: calculatedFare ? JSON.stringify(calculatedFare) : null
  };

  const subscription = await Subscription.create(subscriptionData);
  
  const response = {
    success: true,
    data: subscription,
  };

  // Include fare calculation in response if available
  if (calculatedFare) {
    response.fare_calculation = {
      ...calculatedFare,
      monthly_cost: updatedContractCost,
      contract_cost_updated: Math.abs(updatedContractCost - parseFloat(contract.cost)) > 0.01
    };
  }

  res.status(201).json(response);
});

// READ all - Admin sees all, Passenger sees only their own
exports.getSubscriptions = asyncHandler(async (req, res) => {
  let whereClause = {};

  if (req.user.type === "passenger") {
    whereClause.passenger_id = req.user.id;
  }

  const subscriptions = await Subscription.findAll({
    where: whereClause,
    include: [{ association: "contract" }],
  });
  // Enrich with passenger info
  const list = subscriptions.map(s => s.toJSON());
  const uniquePassengerIds = [...new Set(list.map(s => s.passenger_id).filter(Boolean))];
  const authHeader = req.headers && req.headers.authorization ? { headers: { Authorization: req.headers.authorization } } : {};
  const passengerInfoMap = new Map();
  await Promise.all(uniquePassengerIds.map(async (pid) => {
    try {
      const info = await getPassengerById(pid, authHeader);
      if (info) passengerInfoMap.set(pid, info);
    } catch (_) {}
  }));

  const enriched = list.map(s => {
    const info = passengerInfoMap.get(s.passenger_id);
    if (!info) return s;
    return {
      ...s,
      passenger_name: info.name || null,
      passenger_phone: info.phone || null,
      passenger_email: info.email || null,
    };
  });

  res.json({ success: true, data: enriched });
});

// READ one - Admin sees all, Passenger sees only their own
exports.getSubscription = asyncHandler(async (req, res) => {
  const subscription = await Subscription.findByPk(req.params.id, {
    include: [{ association: "contract" }],
  });

  if (!subscription) {
    return res
      .status(404)
      .json({ success: false, message: "Subscription not found" });
  }

  // Ownership check for passengers
  if (
    req.user.type === "passenger" &&
    subscription.passenger_id !== req.user.id
  ) {
    return res.status(403).json({ success: false, message: "Access denied" });
  }

  const sub = subscription.toJSON();
  try {
    if (sub.passenger_id) {
      const authHeader = req.headers && req.headers.authorization ? { headers: { Authorization: req.headers.authorization } } : {};
      const info = await getPassengerById(sub.passenger_id, authHeader);
      if (info) {
        sub.passenger_name = info.name || null;
        sub.passenger_phone = info.phone || null;
        sub.passenger_email = info.email || null;
      }
    }
  } catch (_) {}
  res.json({ success: true, data: sub });
});

// UPDATE
exports.updateSubscription = asyncHandler(async (req, res) => {
  const [updated] = await Subscription.update(req.body, {
    where: { id: req.params.id },
  });
  if (!updated)
    return res
      .status(404)
      .json({ success: false, message: "Subscription not found" });
  res.json({ success: true, message: "Subscription updated" });
});

// DELETE
exports.deleteSubscription = asyncHandler(async (req, res) => {
  const deleted = await Subscription.destroy({ where: { id: req.params.id } });
  if (!deleted)
    return res
      .status(404)
      .json({ success: false, message: "Subscription not found" });
  res.json({ success: true, message: "Subscription deleted" });
});
