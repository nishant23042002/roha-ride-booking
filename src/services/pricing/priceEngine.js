import { createPricingContext } from "./utils/pricingContext.js";

import { applyDistancePricing } from "./layers/distancePricing.js";
import { applyBaseFare } from "./layers/baseFarePricing.js";
import { applySeatPricing } from "./layers/seatPricing.js";
import { applyTimePricing } from "./layers/timePricing.js";
import { applySurgePricing } from "./layers/surgePricing.js";
import { applyMinimumFare } from "./layers/minimumFare.js";

export function calculateFare(params) {
  const ctx = createPricingContext(params);

  applyDistancePricing(ctx);

  applyBaseFare(ctx);

  applySeatPricing(ctx);

  applyTimePricing(ctx);

  applySurgePricing(ctx);

  applyMinimumFare(ctx);

  if (!Number.isFinite(ctx.fare)) {
    throw new Error("Fare calculation failed");
  }

  return {
    finalFare: Number(ctx.fare.toFixed(2)),
    distanceKm: ctx.distanceKm,
    surge: ctx.surge,
    isNight: ctx.isNight,
  };
}
