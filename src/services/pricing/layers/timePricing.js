export function applyTimePricing(ctx) {
  const date = ctx.rideStartTime || ctx.requestTime;

  const hour = date.getHours();

  const isNight = hour >= 22 || hour < 5;

  ctx.isNight = isNight;

  if (isNight) {
    ctx.fare = ctx.fare * 1.20;
  }
}
