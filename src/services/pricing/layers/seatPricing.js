import { vehicleRules } from "../../../config/vehicleRules.js";

export function applySeatPricing(ctx) {
  const rule = vehicleRules[ctx.vehicleType];

  if (rule.pricingMode === "perSeat") {
    ctx.fare = ctx.fare * ctx.passengerCount;
  }
}
