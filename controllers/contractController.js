const { Contract, Discount, Subscription, ContractType } = require("../models/indexModel");
const { asyncHandler } = require("../middleware/errorHandler");
const { getPassengerById, getDriverById } = require("../utils/userService");

// Helper function to find an active discount.
const findActiveDiscount = async (discountId) => {
  if (!discountId) return null;
  return await Discount.findOne({
    where: { id: discountId, status: "APPLY" },
  });
};

// CREATE
exports.createContract = asyncHandler(async (req, res) => {
  const { cost, has_discount, discount_id, contract_type_id } = req.body;
  
  // Validate contract type exists
  if (!contract_type_id) {
    return res.status(400).json({
      success: false,
      message: "Contract type ID is required"
    });
  }

  const contractType = await ContractType.findByPk(contract_type_id);
  if (!contractType) {
    return res.status(400).json({
      success: false,
      message: "Invalid contract type ID"
    });
  }
  if (!contractType.is_active) {
    return res.status(400).json({
      success: false,
      message: "Contract type is not active"
    });
  }

  let finalCost = parseFloat(cost);

  if (has_discount === true && discount_id) {
    const discount = await findActiveDiscount(discount_id);
    if (discount) {
      const percentage = parseFloat(discount.discount_percentage);
      const discountAmount = finalCost * (percentage / 100);
      finalCost = finalCost - discountAmount;
    }
  }

  const contractData = { ...req.body, cost: finalCost.toFixed(2) };
  const contract = await Contract.create(contractData);
  
  // Include contract type in response
  const contractWithType = await Contract.findByPk(contract.id, {
    include: [{ model: ContractType, as: "contractType" }]
  });
  
  res.status(201).json({ success: true, data: contractWithType });
});

// UPDATE
exports.updateContract = asyncHandler(async (req, res) => {
  const contractId = req.params.id;
  const updateData = req.body;

  const contract = await Contract.findByPk(contractId);
  if (!contract) {
    return res
      .status(404)
      .json({ success: false, message: "Contract not found" });
  }

  const isCurrentlyDiscounted = contract.has_discount;
  const willBeDiscounted = updateData.hasOwnProperty("has_discount")
    ? updateData.has_discount
    : isCurrentlyDiscounted;

  if (!isCurrentlyDiscounted && willBeDiscounted) {
    // --- SCENARIO A: Turning ON the discount flag ---
    const discountId = updateData.discount_id || contract.discount_id;
    const discount = await Discount.findOne({
      where: { id: discountId, status: "APPLY" },
    }); // Check master switch

    if (discount) {
      // If master switch is ON, apply the discount.
      const baseCost = parseFloat(contract.cost);
      const percentage = parseFloat(discount.discount_percentage);
      updateData.cost = (baseCost - baseCost * (percentage / 100)).toFixed(2);
    }
    // If master switch is OFF, the flag will be set to true, but the cost will not change yet.
  } else if (isCurrentlyDiscounted && !willBeDiscounted) {
    // --- SCENARIO B: Turning OFF the discount flag ---
    const discount = await Discount.findByPk(contract.discount_id);
    if (discount) {
      const currentCost = parseFloat(contract.cost);
      const percentage = parseFloat(discount.discount_percentage);
      // Revert the cost regardless of the discount's status.
      updateData.cost = (currentCost / (1 - percentage / 100)).toFixed(2);
    }
  }

  await contract.update(updateData);
  const updatedContract = await Contract.findByPk(contractId);
  res.json({ success: true, data: updatedContract });
});

// READ all - Admin sees all, Passenger sees only their own
exports.getContracts = asyncHandler(async (req, res) => {
  let whereClause = {};

  // Passengers can only see contracts they're associated with
  if (req.user.type === "passenger") {
    const passengerSubscriptions = await Subscription.findAll({
      where: { passenger_id: req.user.id },
      attributes: ["contract_id"],
    });

    const contractIds = passengerSubscriptions.map((sub) => sub.contract_id);
    if (contractIds.length === 0) {
      return res.json({ success: true, data: [] });
    }
    whereClause.id = contractIds;
  }

  const contracts = await Contract.findAll({
    where: whereClause,
    include: [
      "discount", 
      "subscriptions", 
      "payments", 
      "ride_schedules",
      { model: ContractType, as: "contractType" }
    ],
  });
  const list = contracts.map(c => c.toJSON());
  const passengerIds = new Set();
  const driverIds = new Set();
  list.forEach(c => {
    (c.subscriptions || []).forEach(s => { if (s.passenger_id) passengerIds.add(s.passenger_id); });
    (c.ride_schedules || []).forEach(r => { if (r.driver_id) driverIds.add(r.driver_id); });
    (c.payments || []).forEach(p => { if (p.passenger_id) passengerIds.add(p.passenger_id); });
  });
  const authHeader = req.headers && req.headers.authorization ? { headers: { Authorization: req.headers.authorization } } : {};
  const passengerMap = new Map();
  const driverMap = new Map();
  await Promise.all([
    ...[...passengerIds].map(async pid => { try { const info = await getPassengerById(pid, authHeader); if (info) passengerMap.set(pid, info); } catch(_){} }),
    ...[...driverIds].map(async did => { try { const info = await getDriverById(did, authHeader); if (info) driverMap.set(did, info); } catch(_){} }),
  ]);

  const enriched = list.map(c => ({
    ...c,
    subscriptions: (c.subscriptions || []).map(s => ({
      ...s,
      passenger_name: passengerMap.get(s.passenger_id)?.name || null,
      passenger_phone: passengerMap.get(s.passenger_id)?.phone || null,
      passenger_email: passengerMap.get(s.passenger_id)?.email || null,
    })),
    payments: (c.payments || []).map(p => ({
      ...p,
      passenger_name: passengerMap.get(p.passenger_id)?.name || null,
      passenger_phone: passengerMap.get(p.passenger_id)?.phone || null,
      passenger_email: passengerMap.get(p.passenger_id)?.email || null,
    })),
    ride_schedules: (c.ride_schedules || []).map(r => ({
      ...r,
      driver_name: driverMap.get(r.driver_id)?.name || null,
      driver_phone: driverMap.get(r.driver_id)?.phone || null,
      driver_email: driverMap.get(r.driver_id)?.email || null,
    })),
  }));
  res.json({ success: true, data: enriched });
});

// READ one - Admin sees all, Passenger sees only their own
exports.getContract = asyncHandler(async (req, res) => {
  const contract = await Contract.findByPk(req.params.id, {
    include: [
      "discount", 
      "subscriptions", 
      "payments", 
      "ride_schedules",
      { model: ContractType, as: "contractType" }
    ],
  });

  if (!contract) {
    return res
      .status(404)
      .json({ success: false, message: "Contract not found" });
  }

  // Ownership check for passengers
  if (req.user.type === "passenger") {
    const subscription = await Subscription.findOne({
      where: { passenger_id: req.user.id, contract_id: contract.id },
    });
    if (!subscription) {
      return res.status(403).json({ success: false, message: "Access denied" });
    }
  }

  const c = contract.toJSON();
  const passengerIds = new Set();
  const driverIds = new Set();
  (c.subscriptions || []).forEach(s => { if (s.passenger_id) passengerIds.add(s.passenger_id); });
  (c.ride_schedules || []).forEach(r => { if (r.driver_id) driverIds.add(r.driver_id); });
  (c.payments || []).forEach(p => { if (p.passenger_id) passengerIds.add(p.passenger_id); });
  const authHeader = req.headers && req.headers.authorization ? { headers: { Authorization: req.headers.authorization } } : {};
  const [passengerMapEntries, driverMapEntries] = await Promise.all([
    Promise.all([...passengerIds].map(async pid => { try { const info = await getPassengerById(pid, authHeader); return [pid, info]; } catch(_) { return [pid, null]; } })),
    Promise.all([...driverIds].map(async did => { try { const info = await getDriverById(did, authHeader); return [did, info]; } catch(_) { return [did, null]; } })),
  ]);
  const passengerMap = new Map(passengerMapEntries.filter(([,v]) => v));
  const driverMap = new Map(driverMapEntries.filter(([,v]) => v));

  c.subscriptions = (c.subscriptions || []).map(s => ({
    ...s,
    passenger_name: passengerMap.get(s.passenger_id)?.name || null,
    passenger_phone: passengerMap.get(s.passenger_id)?.phone || null,
    passenger_email: passengerMap.get(s.passenger_id)?.email || null,
  }));
  c.payments = (c.payments || []).map(p => ({
    ...p,
    passenger_name: passengerMap.get(p.passenger_id)?.name || null,
    passenger_phone: passengerMap.get(p.passenger_id)?.phone || null,
    passenger_email: passengerMap.get(p.passenger_id)?.email || null,
  }));
  c.ride_schedules = (c.ride_schedules || []).map(r => ({
    ...r,
    driver_name: driverMap.get(r.driver_id)?.name || null,
    driver_phone: driverMap.get(r.driver_id)?.phone || null,
    driver_email: driverMap.get(r.driver_id)?.email || null,
  }));

  res.json({ success: true, data: c });
});

// NEW: Get only ACTIVE contracts
exports.getActiveContracts = asyncHandler(async (req, res) => {
  const contracts = await Contract.findAll({
    where: { status: "ACTIVE" },
    // include: ["discount", "subscriptions", "payments", "ride_schedules"],
  });

  // Return empty array instead of error when no contracts found
  res.json({ success: true, data: contracts });
});

// NEW: Get contracts by contract type ID
exports.getContractsByType = asyncHandler(async (req, res) => {
  const { contractTypeId } = req.params;
  
  // Validate contract type exists
  const contractType = await ContractType.findByPk(contractTypeId);
  if (!contractType) {
    return res.status(404).json({
      success: false,
      message: "Contract type not found"
    });
  }

  // Check if contract type is active
  if (!contractType.is_active) {
    return res.status(400).json({
      success: false,
      message: "Contract type is not active"
    });
  }

  const contracts = await Contract.findAll({
    where: { contract_type_id: contractTypeId },
    include: [
      "discount", 
      "subscriptions", 
      "payments", 
      "ride_schedules",
      { model: ContractType, as: "contractType" }
    ],
  });
  
  // If no contracts exist for this type, return the contract type info
  // This allows the system to work with contract types directly
  if (contracts.length === 0) {
    return res.json({ 
      success: true, 
      data: [{
        id: contractType.id,
        name: contractType.name,
        description: contractType.description,
        base_price_per_km: contractType.base_price_per_km,
        discount_percentage: contractType.discount_percentage,
        minimum_fare: contractType.minimum_fare,
        maximum_passengers: contractType.maximum_passengers,
        multiplier: contractType.multiplier,
        features: contractType.features,
        is_active: contractType.is_active,
        contract_type_id: contractType.id,
        status: "ACTIVE", // Treat contract type as active contract
        cost: contractType.base_price_per_km,
        created_at: contractType.createdAt,
        updated_at: contractType.updatedAt
      }]
    });
  }
  
  res.json({ success: true, data: contracts });
});
// DELETE
exports.deleteContract = asyncHandler(async (req, res) => {
  const deleted = await Contract.destroy({ where: { id: req.params.id } });
  if (!deleted)
    return res
      .status(404)
      .json({ success: false, message: "Contract not found" });
  res.json({ success: true, message: "Contract deleted" });
});
