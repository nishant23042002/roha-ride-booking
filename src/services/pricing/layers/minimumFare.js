export function applyMinimumFare(ctx) {
  const MIN_FARE = 30;

  if (ctx.fare < MIN_FARE) {
    ctx.fare = MIN_FARE;
  }
}
