import { AUTO_PRICING } from "../rules/autoPricingRules.js";

export function applyTime(ctx) {
  const hour = ctx.requestTime.getHours();

  const isNight = hour >= 22 || hour < 5;

  ctx.isNight = isNight;

  if (isNight) {
    ctx.fare *= AUTO_PRICING.NIGHT_MULTIPLIER;
  }
}