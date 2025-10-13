const { ContractType } = require("../models/indexModel");
const { asyncHandler } = require("../middleware/errorHandler");

// CREATE contract type - Admin only
exports.createContractType = asyncHandler(async (req, res) => {
  const {
    name,
    description,
    base_price_per_km,
    discount_percentage,
    minimum_fare,
    maximum_passengers,
    multiplier = 1.00,
    features,
    is_active = true
  } = req.body;

  // Validate required fields
  if (!name) {
    return res.status(400).json({
      success: false,
      message: "Contract type name is required"
    });
  }

  // Check if contract type with same name already exists
  const existingContractType = await ContractType.findOne({
    where: { name: name.trim() }
  });

  if (existingContractType) {
    return res.status(409).json({
      success: false,
      message: "Contract type with this name already exists"
    });
  }

  const contractTypeData = {
    name: name.trim(),
    description: description?.trim() || null,
    base_price_per_km: parseFloat(base_price_per_km) || 0.00,
    discount_percentage: parseFloat(discount_percentage) || 0.00,
    minimum_fare: parseFloat(minimum_fare) || 0.00,
    maximum_passengers: maximum_passengers ? parseInt(maximum_passengers) : null,
    multiplier: parseFloat(multiplier) || 1.00,
    features: features || {},
    is_active: Boolean(is_active),
    created_by: req.user.id
  };

  const contractType = await ContractType.create(contractTypeData);
  
  res.status(201).json({
    success: true,
    message: "Contract type created successfully",
    data: contractType
  });
});

// GET all contract types - Admin and Passenger
exports.getContractTypes = asyncHandler(async (req, res) => {
  const { active_only = false } = req.query;
  
  let whereClause = {};
  
  // If passenger or active_only is requested, only show active contract types
  if (req.user.type === "passenger" || active_only === "true") {
    whereClause.is_active = true;
  }

  const contractTypes = await ContractType.findAll({
    where: whereClause,
    order: [['name', 'ASC']]
  });

  res.json({
    success: true,
    data: contractTypes
  });
});

// GET single contract type by ID
exports.getContractType = asyncHandler(async (req, res) => {
  const contractType = await ContractType.findByPk(req.params.id);

  if (!contractType) {
    return res.status(404).json({
      success: false,
      message: "Contract type not found"
    });
  }

  // Passengers can only see active contract types
  if (req.user.type === "passenger" && !contractType.is_active) {
    return res.status(404).json({
      success: false,
      message: "Contract type not found"
    });
  }

  res.json({
    success: true,
    data: contractType
  });
});

// UPDATE contract type - Admin only
exports.updateContractType = asyncHandler(async (req, res) => {
  const contractType = await ContractType.findByPk(req.params.id);

  if (!contractType) {
    return res.status(404).json({
      success: false,
      message: "Contract type not found"
    });
  }

  const {
    name,
    description,
    base_price_per_km,
    discount_percentage,
    minimum_fare,
    maximum_passengers,
    multiplier,
    features,
    is_active
  } = req.body;

  // Check if name is being changed and if it conflicts with existing
  if (name && name.trim() !== contractType.name) {
    const existingContractType = await ContractType.findOne({
      where: { name: name.trim() }
    });

    if (existingContractType) {
      return res.status(409).json({
        success: false,
        message: "Contract type with this name already exists"
      });
    }
  }

  const updateData = {
    updated_by: req.user.id
  };

  if (name !== undefined) updateData.name = name.trim();
  if (description !== undefined) updateData.description = description?.trim() || null;
  if (base_price_per_km !== undefined) updateData.base_price_per_km = parseFloat(base_price_per_km) || 0.00;
  if (discount_percentage !== undefined) updateData.discount_percentage = parseFloat(discount_percentage) || 0.00;
  if (minimum_fare !== undefined) updateData.minimum_fare = parseFloat(minimum_fare) || 0.00;
  if (maximum_passengers !== undefined) updateData.maximum_passengers = maximum_passengers ? parseInt(maximum_passengers) : null;
  if (multiplier !== undefined) updateData.multiplier = parseFloat(multiplier) || 1.00;
  if (features !== undefined) updateData.features = features || {};
  if (is_active !== undefined) updateData.is_active = Boolean(is_active);

  await contractType.update(updateData);
  
  const updatedContractType = await ContractType.findByPk(req.params.id);
  
  res.json({
    success: true,
    message: "Contract type updated successfully",
    data: updatedContractType
  });
});

// DELETE contract type - Admin only
exports.deleteContractType = asyncHandler(async (req, res) => {
  const contractType = await ContractType.findByPk(req.params.id);

  if (!contractType) {
    return res.status(404).json({
      success: false,
      message: "Contract type not found"
    });
  }

  // Check if any contracts are using this contract type
  const { Contract } = require("../models/indexModel");
  const contractsUsingType = await Contract.count({
    where: { contract_type_id: req.params.id }
  });

  if (contractsUsingType > 0) {
    return res.status(400).json({
      success: false,
      message: `Cannot delete contract type. ${contractsUsingType} contract(s) are currently using this type.`
    });
  }

  await contractType.destroy();
  
  res.json({
    success: true,
    message: "Contract type deleted successfully"
  });
});

// GET active contract types only - For passengers
exports.getActiveContractTypes = asyncHandler(async (req, res) => {
  const contractTypes = await ContractType.findAll({
    where: { is_active: true },
    order: [['name', 'ASC']]
  });

  res.json({
    success: true,
    data: contractTypes
  });
});
