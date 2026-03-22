// src/services/dispatchEngine.js

import { radiusDriverSearch } from "./radiusSearchRedis.js";
import { calculateDriverETA } from "./etaCalculator.js";
import { rankDrivers } from "./rankDrivers.js";

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

  console.log("\n🔍 FIND BEST DRIVERS START");
  console.log("Pickup:", pickupLat, pickupLng);
  console.log("Vehicle:", vehicleType);

  if (!drivers.length) {
    return { drivers: [], radius };
  }

  const driversWithETA = drivers
    .map((driver) => {
      const result = calculateDriverETA(driver, pickupLat, pickupLng);
      if (!result) return null;

      return {
        driver,
        ...result,
      };
    })
    .filter(Boolean);

  // 🔥 ADD THIS
  if (!driversWithETA.length) {
    console.log("❌ All drivers filtered out after ETA calculation");
    return { drivers: [], radius };
  }

  const ranked = rankDrivers(driversWithETA);

  console.log("🏁 Ranked Drivers:");
  ranked.forEach((d, i) => {
    console.log(
      `#${i + 1} Driver=${d.driver._id} ETA=${d.etaMinutes} Score=${d.score}`,
    );
  });

  return {
    drivers: ranked,
    radius,
  };
}
