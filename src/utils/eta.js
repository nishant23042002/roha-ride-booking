import { avgSpeeds } from "../config/etaConfig.js";

export function calculateETA(distanceKm, vehicleType) {
  const speed = avgSpeeds[vehicleType] || 20; // default 20 km/h

  const hours = distanceKm / speed;
  const minutes = hours * 60;

  // Round up to nearest minute
  return Math.ceil(minutes);
}
