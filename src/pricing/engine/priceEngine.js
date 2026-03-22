
import { createPricingContext } from "./pricingContext.js";
import { applyDistancePricing } from "../layers/distancePricing.js";
import { applyBaseFare } from "../layers/baseFarePricing.js";
import { applySharedFare } from "../layers/sharedFare.layer.js";
import { applyTime } from "../layers/timePricing.js";
import { applyMinimumFare } from "../layers/minimumFare.js";

export function calculateAutoFare(params) {
  const ctx = createPricingContext(params);

  applyDistancePricing(ctx);
  applyBaseFare(ctx);
  applySharedFare(ctx);
  applyTime(ctx);
  applyMinimumFare(ctx);

  return {
    finalFare: Number(ctx.fare.toFixed(2)),
    distanceKm: ctx.computedDistanceKm,
    isNight: ctx.isNight,
    breakdown: ctx.breakdown,
  };
}
