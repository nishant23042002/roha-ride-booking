// src/srvices/etaCalculator.js

import { haversineDistance } from "../../utils/gpsUtils.js";

const AVG_SPEED = {
  auto: 25,
};

export function calculateDriverETA(driver, pickupLat, pickupLng) {
  const [lng, lat] = driver.currentLocation.coordinates;

  const distance = haversineDistance(lat, lng, pickupLat, pickupLng);

  if (distance > 5) {
    console.log(
      `❌ Driver filtered (too far) → ${driver._id} | distance=${distance.toFixed(2)}km`,
    );
    return null;
  }

  const speed = AVG_SPEED[driver.vehicleType] || 25;

  const etaMinutes = (distance / speed) * 60;

  return {
    distanceKm: distance,
    etaMinutes: Number(etaMinutes.toFixed(2)),
  };
}
