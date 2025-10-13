const { Discount, sequelize } = require("../models/indexModel");
const { asyncHandler } = require("../middleware/errorHandler");
const {
  revertContractsForDiscount,
  applyDiscountToContracts,
  recalculateContractsForDiscount,
} = require("../utils/contractUpdater");

// CREATE
exports.createDiscount = asyncHandler(async (req, res) => {
  const discount = await Discount.create(req.body);
  res.status(201).json({ success: true, data: discount });
});

// READ all
exports.getDiscounts = asyncHandler(async (req, res) => {
  const discounts = await Discount.findAll();
  res.json({ success: true, data: discounts });
});

// READ one
exports.getDiscount = asyncHandler(async (req, res) => {
  const discount = await Discount.findByPk(req.params.id);
  if (!discount)
    return res
      .status(404)
      .json({ success: false, message: "Discount not found" });
  res.json({ success: true, data: discount });
});

// UPDATE
exports.updateDiscount = asyncHandler(async (req, res) => {
  const discountId = req.params.id;
  const { status: newStatus, discount_percentage: newPercentageStr } = req.body;

  // Start a managed Sequelize transaction
  const t = await sequelize.transaction();

  try {
    const discount = await Discount.findByPk(discountId, {
      transaction: t,
      lock: true,
    });

    if (!discount) {
      await t.rollback();
      return res
        .status(404)
        .json({ success: false, message: "Discount not found" });
    }

    const oldStatus = discount.status;
    const oldPercentage = parseFloat(discount.discount_percentage);
    const newPercentage = newPercentageStr
      ? parseFloat(newPercentageStr)
      : null;

    // --- Core Business Logic ---

    // 1. If status is being changed from APPLY to UNAPPLY...
    if (oldStatus === "APPLY" && newStatus === "UNAPPLY") {
      // ...revert the cost for all associated contracts.
      console.log(
        `Discount ${discountId} is being deactivated. Reverting contracts...`
      );
      await revertContractsForDiscount(discount, t);
    }
    // 2. If status is being changed from UNAPPLY to APPLY...
    else if (oldStatus === "UNAPPLY" && newStatus === "APPLY") {
      // ...apply the discount to all eligible contracts.
      console.log(
        `Discount ${discountId} is being activated. Applying to eligible contracts...`
      );
      await applyDiscountToContracts(discount, t);
    }

    // 3. If the percentage is changing while the discount is already active...
    if (
      oldStatus === "APPLY" &&
      newPercentage !== null &&
      newPercentage !== oldPercentage
    ) {
      // ...recalculate the cost for all associated contracts.
      console.log(
        `Discount ${discountId} percentage is changing. Recalculating contracts...`
      );
      await recalculateContractsForDiscount(discount, newPercentage, t);
    }

    // After cascading changes, update the discount record itself with the new data.
    await discount.update(req.body, { transaction: t });

    // If all database operations were successful, commit the transaction to save the changes.
    await t.commit();

    // Return the updated discount object.
    res.json({ success: true, data: discount });
  } catch (error) {
    // If any step inside the 'try' block fails, this will be triggered.
    // We must roll back the transaction to undo all changes.
    await t.rollback();

    console.error("Discount update transaction failed:", error);
    res.status(500).json({
      success: false,
      message:
        "An error occurred during the update process. All changes have been reverted.",
    });
  }
});

// DELETE
exports.deleteDiscount = asyncHandler(async (req, res) => {
  const deleted = await Discount.destroy({ where: { id: req.params.id } });
  if (!deleted)
    return res
      .status(404)
      .json({ success: false, message: "Discount not found" });
  res.json({ success: true, message: "Discount deleted" });
});
