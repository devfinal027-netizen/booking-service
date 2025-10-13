const { Pricing } = require("../models/indexModel");

/**
 * Calculate distance between two coordinates using Haversine formula
 * @param {number} lat1 - Latitude of first point
 * @param {number} lon1 - Longitude of first point
 * @param {number} lat2 - Latitude of second point
 * @param {number} lon2 - Longitude of second point
 * @returns {number} Distance in kilometers
 */
function calculateDistance(lat1, lon1, lat2, lon2) {
  const R = 6371; // Earth's radius in kilometers
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = 
    Math.sin(dLat/2) * Math.sin(dLat/2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * 
    Math.sin(dLon/2) * Math.sin(dLon/2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  const distance = R * c;
  return Math.round(distance * 100) / 100; // Round to 2 decimal places
}

/**
 * Get active pricing for a contract type
 * @param {string} contractType - Contract type (INDIVIDUAL, GROUP, INSTITUTIONAL)
 * @returns {Object|null} Pricing object or null if not found
 */
async function getActivePricing(contractType) {
  try {
    const pricing = await Pricing.findOne({
      where: {
        contract_type: contractType,
        is_active: true,
      },
      order: [['effective_from', 'DESC']],
    });
    return pricing;
  } catch (error) {
    console.error('Error fetching pricing:', error);
    return null;
  }
}

/**
 * Calculate fare based on distance and contract type
 * @param {number} distanceKm - Distance in kilometers
 * @param {string} contractType - Contract type
 * @returns {Object} Fare calculation result
 */
async function calculateFare(distanceKm, contractType) {
  try {
    const pricing = await getActivePricing(contractType);
    
    if (!pricing) {
      return {
        success: false,
        message: `No active pricing found for contract type: ${contractType}`,
      };
    }

    const baseFare = parseFloat(pricing.base_fare);
    const pricePerKm = parseFloat(pricing.price_per_km);
    const minimumFare = parseFloat(pricing.minimum_fare);

    const calculatedFare = baseFare + (distanceKm * pricePerKm);
    const finalFare = Math.max(calculatedFare, minimumFare);

    return {
      success: true,
      data: {
        distance_km: distanceKm,
        base_fare: baseFare,
        price_per_km: pricePerKm,
        minimum_fare: minimumFare,
        calculated_fare: Math.round(calculatedFare * 100) / 100,
        final_fare: Math.round(finalFare * 100) / 100,
        pricing_id: pricing.id,
      },
    };
  } catch (error) {
    console.error('Error calculating fare:', error);
    return {
      success: false,
      message: 'Error calculating fare',
      error: error.message,
    };
  }
}

/**
 * Calculate fare from coordinates
 * @param {number} pickupLat - Pickup latitude
 * @param {number} pickupLon - Pickup longitude
 * @param {number} dropoffLat - Dropoff latitude
 * @param {number} dropoffLon - Dropoff longitude
 * @param {string} contractType - Contract type
 * @returns {Object} Fare calculation result with distance
 */
async function calculateFareFromCoordinates(pickupLat, pickupLon, dropoffLat, dropoffLon, contractType) {
  try {
    const distance = calculateDistance(pickupLat, pickupLon, dropoffLat, dropoffLon);
    const fareResult = await calculateFare(distance, contractType);
    
    if (!fareResult.success) {
      return fareResult;
    }

    return {
      success: true,
      data: {
        ...fareResult.data,
        pickup_coordinates: { latitude: pickupLat, longitude: pickupLon },
        dropoff_coordinates: { latitude: dropoffLat, longitude: dropoffLon },
      },
    };
  } catch (error) {
    console.error('Error calculating fare from coordinates:', error);
    return {
      success: false,
      message: 'Error calculating fare from coordinates',
      error: error.message,
    };
  }
}

module.exports = {
  calculateDistance,
  getActivePricing,
  calculateFare,
  calculateFareFromCoordinates,
};