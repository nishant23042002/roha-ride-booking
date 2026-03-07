import { calculateDistance } from "../../../utils/distance.js";
const ROAD_MULTIPLIER = 1.3;

export function applyDistancePricing(ctx) {
  const straightDistance = calculateDistance(
    ctx.pickupLat,
    ctx.pickupLon,
    ctx.dropLat,
    ctx.dropLon,
  );

  const roadDistance = straightDistance * ROAD_MULTIPLIER;

  ctx.distanceKm = Number(roadDistance.toFixed(2));
}
