const { ContractSettings, Contract, ContractType } = require("../models/indexModel");
const { calculateDistance } = require("../utils/pricingService");

/**
 * Calculate fare for a subscription based on locations and contract type
 * @param {string} pickupLocation - Pickup location name
 * @param {string} dropoffLocation - Dropoff location name
 * @param {number} pickupLat - Pickup latitude
 * @param {number} pickupLon - Pickup longitude
 * @param {number} dropoffLat - Dropoff latitude
 * @param {number} dropoffLon - Dropoff longitude
 * @param {string|Object} contractTypeOrContract - Contract type string or ContractType object
 * @returns {Object} Fare calculation result
 */
async function calculateSubscriptionFare(pickupLocation, dropoffLocation, pickupLat, pickupLon, dropoffLat, dropoffLon, contractTypeOrContract) {
  try {
    let contractType, pricingInfo;
    
    // Handle both contract type string and ContractType object
    if (typeof contractTypeOrContract === 'string') {
      // Legacy: contract type string (INDIVIDUAL, GROUP, INSTITUTIONAL)
      contractType = contractTypeOrContract;
      
      // Get contract settings for the specified type
      const settings = await ContractSettings.findOne({
        where: {
          contract_type: contractType,
          is_active: true,
        },
      });

      if (!settings) {
        return {
          success: false,
          message: `No active pricing settings found for contract type: ${contractType}`,
        };
      }
      
      pricingInfo = {
        base_price_per_km: parseFloat(settings.base_price_per_km),
        discount_percentage: parseFloat(settings.discount_percentage),
        minimum_fare: parseFloat(settings.minimum_fare),
        settings_id: settings.id,
      };
    } else if (contractTypeOrContract && typeof contractTypeOrContract === 'object') {
      // New: ContractType object with pricing info
      contractType = contractTypeOrContract.name || 'INDIVIDUAL';
      
      pricingInfo = {
        base_price_per_km: parseFloat(contractTypeOrContract.base_price_per_km || 0),
        discount_percentage: parseFloat(contractTypeOrContract.discount_percentage || 0),
        minimum_fare: parseFloat(contractTypeOrContract.minimum_fare || 0),
        settings_id: contractTypeOrContract.id,
      };
    } else {
      return {
        success: false,
        message: 'Invalid contract type provided',
      };
    }

    // Calculate distance if coordinates are provided
    let distance = 0;
    if (pickupLat && pickupLon && dropoffLat && dropoffLon) {
      distance = calculateDistance(pickupLat, pickupLon, dropoffLat, dropoffLon);
    }

    // Calculate fare based on distance
    const baseFare = distance * pricingInfo.base_price_per_km;
    const discountAmount = baseFare * (pricingInfo.discount_percentage / 100);
    const fareAfterDiscount = baseFare - discountAmount;
    const finalFare = Math.max(fareAfterDiscount, pricingInfo.minimum_fare);

    // Calculate multiplier based on contract type
    let multiplier = 1;
    
    if (typeof contractTypeOrContract === 'object' && contractTypeOrContract.multiplier) {
      // Use the multiplier field set by admin when creating contract types
      multiplier = parseFloat(contractTypeOrContract.multiplier) || 1;
    } else {
      // Legacy mapping for string-based contract types
      const typeName = contractType.toString().toUpperCase();
      if (typeName.includes("INDIVIDUAL")) {
        multiplier = 1; // Per trip
      } else if (typeName.includes("GROUP")) {
        multiplier = 7; // Weekly rate
      } else if (typeName.includes("INSTITUTIONAL")) {
        multiplier = 30; // Monthly rate
      } else {
        multiplier = 1; // Default to per trip
      }
    }

    const totalFare = finalFare * multiplier;

    return {
      success: true,
      data: {
        pickup_location: pickupLocation,
        dropoff_location: dropoffLocation,
        distance_km: Math.round(distance * 100) / 100,
        contract_type: contractType,
        base_price_per_km: pricingInfo.base_price_per_km,
        base_fare: Math.round(baseFare * 100) / 100,
        discount_percentage: pricingInfo.discount_percentage,
        discount_amount: Math.round(discountAmount * 100) / 100,
        fare_after_discount: Math.round(fareAfterDiscount * 100) / 100,
        minimum_fare: pricingInfo.minimum_fare,
        daily_fare: Math.round(finalFare * 100) / 100,
        multiplier: multiplier,
        total_fare: Math.round(totalFare * 100) / 100,
        settings_id: pricingInfo.settings_id,
      },
    };
  } catch (error) {
    console.error('Error calculating subscription fare:', error);
    return {
      success: false,
      message: 'Error calculating subscription fare',
      error: error.message,
    };
  }
}

/**
 * Get contract type multipliers for different periods
 * @returns {Object} Contract type multipliers
 */
function getContractTypeMultipliers() {
  return {
    INDIVIDUAL: { multiplier: 1, description: 'Per trip' },
    GROUP: { multiplier: 7, description: 'Per week (7 days)' },
    INSTITUTIONAL: { multiplier: 30, description: 'Per month (30 days)' },
  };
}

/**
 * Get available contracts for subscription
 * @param {string} contractType - Contract type filter
 * @returns {Object} Available contracts
 */
async function getAvailableContracts(contractType = null) {
  try {
    let whereClause = { status: 'ACTIVE' };
    if (contractType) {
      whereClause.contract_type = contractType;
    }

    const contracts = await Contract.findAll({
      where: whereClause,
      order: [['contract_type', 'ASC'], ['createdAt', 'DESC']],
    });

    return {
      success: true,
      data: contracts,
    };
  } catch (error) {
    console.error('Error fetching available contracts:', error);
    return {
      success: false,
      message: 'Error fetching available contracts',
      error: error.message,
    };
  }
}

module.exports = {
  calculateSubscriptionFare,
  getContractTypeMultipliers,
  getAvailableContracts,
};