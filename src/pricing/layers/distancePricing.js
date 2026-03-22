import { calculateDistance } from "../../utils/distance.js";

const ROAD_MULTIPLIER = 1.3;

export function applyDistancePricing(ctx) {
  // ✅ Use frontend distance if available
  if (ctx.inputDistanceKm) {
    const d = Number(ctx.inputDistanceKm.toFixed(2));

    ctx.distanceKm = d;
    ctx.computedDistanceKm = d; // 🔥 FIX

    return;
  }

  const straightDistance = calculateDistance(
    ctx.pickupLat,
    ctx.pickupLon,
    ctx.dropLat,
    ctx.dropLon,
  );

  const roadDistance = straightDistance * ROAD_MULTIPLIER;

  ctx.distanceKm = Number(roadDistance.toFixed(2));
  ctx.computedDistanceKm = ctx.distanceKm; // 🔥 consistency
}
