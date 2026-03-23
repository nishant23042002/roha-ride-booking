// src/services/dispatch/dispatchEngine.js

import { radiusDriverSearch } from "./radiusSearchRedis.js";

export async function findBestDrivers({ pickupLat, pickupLng }) {
  const { driverIds, radius } = await radiusDriverSearch({
    pickupLat,
    pickupLng,
  });

  console.log("\n🔍 FIND BEST DRIVERS START");
  console.log("Pickup:", pickupLat, pickupLng);

  if (!driverIds.length) {
    console.log("❌ No drivers found after Redis filtering");
    return { driverIds: [], radius };
  }

  console.log("🏁 Selected Drivers:");
  driverIds.forEach((id, i) => {
    console.log(`#${i + 1} Driver=${id}`);
  });

  return {
    driverIds,
    radius,
  };
}
