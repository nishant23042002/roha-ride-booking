import { AUTO_PRICING } from "../rules/autoPricingRules.js";

export function applyMinimumFare(ctx) {
  if (ctx.fare < AUTO_PRICING.MIN_FARE) {
    ctx.fare = AUTO_PRICING.MIN_FARE;
  }
}