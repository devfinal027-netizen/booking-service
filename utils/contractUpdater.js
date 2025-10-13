// utils/contractUpdater.js
const { Contract } = require("../models/indexModel");

/**
 * Finds all active contracts using a specific discount and reverts their cost to the original base price.
 * @param {object} discount
 * @param {object} transaction
 */
const revertContractsForDiscount = async (discount, transaction) => {
  const contractsToUpdate = await Contract.findAll({
    where: {
      discount_id: discount.id,
      has_discount: true,
    },
    transaction,
  });

  const percentage = parseFloat(discount.discount_percentage);

  if (contractsToUpdate.length === 0 || isNaN(percentage) || percentage === 0) {
    return;
  }

  // Create an array of update promises
  const updatePromises = contractsToUpdate.map((contract) => {
    const currentCost = parseFloat(contract.cost);
    // Reverse the discount calculation to find the original base cost
    const originalCost = currentCost / (1 - percentage / 100);

    return contract.update(
      {
        cost: originalCost.toFixed(2),
        has_discount: false,
        discount_id: null,
      },
      { transaction }
    );
  });

  // Execute all updates in parallel
  await Promise.all(updatePromises);
  console.log(`Reverted cost for ${contractsToUpdate.length} contracts.`);
};

const applyDiscountToContracts = async (discount, transaction) => {
  const contractsToUpdate = await Contract.findAll({
    where: {
      discount_id: discount.id,
      has_discount: true, // Only apply to contracts that have opted in
    },
    transaction,
  });

  const percentage = parseFloat(discount.discount_percentage);

  if (contractsToUpdate.length === 0 || isNaN(percentage)) {
    return;
  }

  const updatePromises = contractsToUpdate.map((contract) => {
    const baseCost = parseFloat(contract.cost);
    const discountAmount = baseCost * (percentage / 100);
    const newFinalCost = baseCost - discountAmount;

    return contract.update(
      {
        cost: newFinalCost.toFixed(2),
      },
      { transaction }
    );
  });

  await Promise.all(updatePromises);
  console.log(`Applied discount to ${contractsToUpdate.length} contracts.`);
};

/**
 * Finds all active contracts using a specific discount and recalculates their cost based on a new percentage.
 * @param {object} discount
 * @param {number} newPercentage
 * @param {object} transaction
 */
const recalculateContractsForDiscount = async (
  discount,
  newPercentage,
  transaction
) => {
  const contractsToUpdate = await Contract.findAll({
    where: {
      discount_id: discount.id,
      has_discount: true,
    },
    transaction,
  });

  const oldPercentage = parseFloat(discount.discount_percentage);

  if (
    contractsToUpdate.length === 0 ||
    isNaN(oldPercentage) ||
    oldPercentage === 0
  ) {
    return;
  }

  const updatePromises = contractsToUpdate.map((contract) => {
    const currentCost = parseFloat(contract.cost);
    // Step 1: Find the original base cost by reversing the OLD discount
    const originalCost = currentCost / (1 - oldPercentage / 100);

    // Step 2: Apply the NEW discount to the original base cost
    const discountAmount = originalCost * (parseFloat(newPercentage) / 100);
    const newFinalCost = originalCost - discountAmount;

    return contract.update(
      {
        cost: newFinalCost.toFixed(2),
      },
      { transaction }
    );
  });

  await Promise.all(updatePromises);
  console.log(`Recalculated cost for ${contractsToUpdate.length} contracts.`);
};

module.exports = {
  revertContractsForDiscount,
  applyDiscountToContracts,
  recalculateContractsForDiscount,
};
