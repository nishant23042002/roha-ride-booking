// src/srvices/etaCalculator.js

import { haversineDistance } from "../../utils/gpsUtils.js";

export function calculateDriverETA(driver, pickupLat, pickupLng) {
  if (!driver?.currentLocation?.coordinates) return null;

  const [lng, lat] = driver.currentLocation.coordinates;

  const distance = haversineDistance(lat, lng, pickupLat, pickupLng);

  // 🚫 Small town → tighter radius
  if (distance > 4) {
    return null;
  }

  const speed = 25; // small town realistic

  const etaMinutes = (distance / speed) * 60;

  return {
    distanceKm: Number(distance.toFixed(2)),
    etaMinutes: Number(etaMinutes.toFixed(2)),
  };
}
