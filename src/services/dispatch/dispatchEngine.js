// src/services/dispatchEngine.js

import { radiusDriverSearch } from "./radiusSearch.js";
import { calculateDriverETA } from "./etaCalculator.js";
import { rankDrivers } from "./driverRanking.js";

export async function findBestDrivers({
  pickupLat,
  pickupLng,
  vehicleType,
  passengerCount,
  heartbeatLimit,
}) {
  const { drivers, radius } = await radiusDriverSearch({
    pickupLat,
    pickupLng,
    vehicleType,
    passengerCount,
    heartbeatLimit,
  });

  if (!drivers.length) {
    return { drivers: [], radius };
  }

  const driversWithETA = drivers.map((driver) => {
    const { etaMinutes, distanceKm } = calculateDriverETA(
      driver,
      pickupLat,
      pickupLng,
    );

    return {
      driver,
      etaMinutes,
      distanceKm,
    };
  });

  const ranked = rankDrivers(driversWithETA);

  return {
    drivers: ranked,
    radius,
  };
}
