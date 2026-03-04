
export const vehicleRules = {
  bike: {
    maxPassengers: 1,
    pricingMode: "perRide", // fixed
    allowedShared: false
  },

  auto: {
    maxPassengers: 3,
    pricingMode: "perRide", // RTO fare regulated
    allowedShared: false
  },

  minidoor: {
    maxPassengers: 9,
    pricingMode: "perSeat",
    allowedShared: true
  },

  shared_auto: {
    maxPassengers: 3,
    pricingMode: "perSeat",
    allowedShared: true
  },

  shared_cab: {
    maxPassengers: 4,
    pricingMode: "perSeat",
    allowedShared: true
  },
};