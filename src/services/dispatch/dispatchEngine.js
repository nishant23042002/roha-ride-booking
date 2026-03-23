// src/services/dispatch/dispatchEngine.js

import { radiusDriverSearch } from "./radiusSearchRedis.js";
import { calculateDriverETA } from "./etaCalculator.js";
import { rankDrivers } from "./rankDrivers.js";
import Driver from "../../models/Driver.js";
import { getDispatch } from "../../modules/dispatch/dispatch.redis.js";

export async function findBestDrivers({ pickupLat, pickupLng, rideId }) {
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

  // =====================================================
  // 1️⃣ FETCH DRIVER DATA (MINIMAL)
  // =====================================================
  const drivers = await Driver.find({
    _id: { $in: driverIds },
  }).select("currentLocation vehicleType tierLevel lastHeartbeat");

  // 👉 Create map for fast lookup (important)
  const driverMap = new Map(drivers.map((d) => [d._id.toString(), d]));

  // =====================================================
  // 2️⃣ GET REDIS DISPATCH STATE
  // =====================================================
  const dispatchState = await getDispatch(rideId);

  // =====================================================
  // 3️⃣ BUILD DRIVER DATA WITH ETA + REJECTION
  // =====================================================
  const enriched = driverIds
    .map((id) => {
      const driver = driverMap.get(id);
      if (!driver) return null;

      const eta = calculateDriverETA(driver, pickupLat, pickupLng);
      if (!eta) return null;

      const rejectData = dispatchState.rejectedDrivers[id];

      let rejectionCount = 0;
      let rejectionTime = 0;

      if (rejectData) {
        try {
          const parsed = JSON.parse(rejectData);
          rejectionCount = parsed.count || 0;
          rejectionTime = parsed.time || 0;
        } catch {}
      }

      return {
        driver,
        ...eta,
        rejectionCount,
        rejectionTime, // ✅ CRITICAL FIX
      };
    })
    .filter(Boolean);

  if (!enriched.length) {
    console.log("❌ All drivers filtered after ETA");
    return { driverIds: [], radius };
  }

  // =====================================================
  // 4️⃣ RANK DRIVERS (SMART LOGIC)
  // =====================================================
  const ranked = rankDrivers(enriched);

  console.log("🏁 Ranked Drivers:");
  ranked.forEach((d, i) => {
    console.log(
      `#${i + 1} Driver=${d.driver._id} ETA=${d.etaMinutes} Rejects=${d.rejectionCount} Effective=${d.effectiveRejects?.toFixed(2) || 0} Score=${d.score.toFixed(2)}`,
    );
  });

  return {
    driverIds: ranked.map((d) => d.driver._id.toString()),
    radius,
  };
}
