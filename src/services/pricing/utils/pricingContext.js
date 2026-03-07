// src/services/pricing/utils/pricingContext.js

export function createPricingContext(params) {
  return {
    vehicleType: params.vehicleType,
    passengerCount: params.passengerCount || 1,
    rideType: params.rideType || "private",
    requestTime: params.requestTime || new Date(),
    rideStartTime: params.rideStartTime,

    pickupLat: params.pickupLat,
    pickupLon: params.pickupLon,
    dropLat: params.dropLat,
    dropLon: params.dropLon,

    demandMultiplier: params.demandMultiplier || 1,

    distanceKm: 0,
    baseFare: 0,
    fare: 0,
    surge: 1,
    isNight: false,
  };
}
