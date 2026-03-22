import { AUTO_PRICING } from "../rules/autoPricingRules.js";

export function applyBaseFare(ctx) {
  const d = ctx.computedDistanceKm;

  let fare;

  if (d <= AUTO_PRICING.BASE_DISTANCE_KM) {
    fare = AUTO_PRICING.BASE_FARE;
  } else {
    fare =
      AUTO_PRICING.BASE_FARE +
      (d - AUTO_PRICING.BASE_DISTANCE_KM) * AUTO_PRICING.PER_KM_RATE;
  }

  ctx.fare = fare;

  ctx.breakdown.baseFare = fare;
}

