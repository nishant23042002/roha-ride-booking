// src/services/pricing/utils/pricingContext.js

export function createPricingContext(params) {
  return {
    // inputs
    pickupLat: params.pickupLat,
    pickupLon: params.pickupLon,
    dropLat: params.dropLat,
    dropLon: params.dropLon,

    distanceKm: params.distanceKm || null,
    durationMinutes: params.durationMinutes || null,

    rideType: params.rideType || "private",
    passengerCount: params.passengerCount || 1,

    requestTime: new Date(),

    // computed
    computedDistanceKm: 0,
    fare: 0,

    breakdown: {},
    isNight: false,
  };
}
