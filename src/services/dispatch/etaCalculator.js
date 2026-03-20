// src/srvices/etaCalculator.js

import { haversineDistance } from "../../utils/gpsUtils.js";

const AVG_SPEED = {
  auto: 25,
  bike: 35,
  cab: 30,
  minidoor: 20,
};

export function calculateDriverETA(driver, pickupLat, pickupLng) {
  const [lng, lat] = driver.currentLocation.coordinates;

  const distance = haversineDistance(lat, lng, pickupLat, pickupLng);

  if (distance > 0.5) {
    // >500m jump
    return; // reject
  }

  const speed = AVG_SPEED[driver.vehicleType] || 25;

  const etaMinutes = (distance / speed) * 60;

  return {
    distanceKm: distance,
    etaMinutes: Number(etaMinutes.toFixed(2)),
  };
}
