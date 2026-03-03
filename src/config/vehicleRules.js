
export const vehicleRules = {
  bike: {
    maxPassengers: 1,
    pricingMode: "perRide", // fixed
  },

  auto: {
    maxPassengers: 3,
    pricingMode: "perRide", // RTO fare regulated
  },

  cab: {
    maxPassengers: 4,
    pricingMode: "perRide",
  },

  suv: {
    maxPassengers: 6,
    pricingMode: "perRide",
  },

  shared_auto: {
    maxPassengers: 3,
    pricingMode: "perSeat",
  },

  shared_cab: {
    maxPassengers: 4,
    pricingMode: "perSeat",
  },
};