const MAX_SURGE = 2;
const MIN_SURGE = 1;

export function applySurgePricing(ctx) {
  const surge = Math.min(Math.max(ctx.demandMultiplier, MIN_SURGE), MAX_SURGE);

  ctx.surge = surge;

  ctx.fare = ctx.fare * surge;
}
