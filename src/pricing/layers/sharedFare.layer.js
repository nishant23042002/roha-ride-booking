import { AUTO_PRICING } from "../rules/autoPricingRules.js";

export function applySharedFare(ctx) {
  if (ctx.rideType !== "shared") return;

  const discountedPerSeat = ctx.fare * AUTO_PRICING.SHARED_DISCOUNT;

  const total = discountedPerSeat * ctx.passengerCount;

  ctx.breakdown.shared = {
    perSeat: discountedPerSeat,
    passengers: ctx.passengerCount,
  };

  ctx.fare = total;
}
