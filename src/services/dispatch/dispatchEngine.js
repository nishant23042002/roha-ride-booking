// src/services/dispatch/dispatchEngine.js

import { radiusDriverSearch } from "./radiusSearchRedis.js";
import { calculateDriverETA } from "./etaCalculator.js";
import { rankDrivers } from "./rankDrivers.js";
import Driver from "../../models/Driver.js";
import Ride from "../../models/Ride.js";
import { getDispatch } from "../../modules/dispatch/dispatch.redis.js";
import { isRedisHealthy } from "../../config/redis.js";

export async function findBestDrivers({ pickupLat, pickupLng, rideId }) {
  console.log("\n🔍 FIND BEST DRIVERS START");
  console.log("Pickup:", pickupLat, pickupLng);

  // =====================================================
  // 🧠 LOAD RIDE (FOR RECOVERY MODE)
  // =====================================================
  let ride = null;
  try {
    ride = await Ride.findById(rideId).select("driver recovery");
  } catch {}

  const isRecovery = !!ride?.recovery;

  if (isRecovery) {
    console.log("🧠 RECOVERY DRIVER SEARCH MODE");
  }

  let driverIds = [];
  let radius = 0;

  // =====================================================
  // 🔥 1️⃣ REDIS PRIMARY SEARCH (SAFE)
  // =====================================================
  if (isRedisHealthy()) {
    try {
      const result = await radiusDriverSearch({
        pickupLat,
        pickupLng,
      });

      if (result && Array.isArray(result.driverIds)) {
        driverIds = result.driverIds;
        radius = result.radius || 0;
      }
    } catch (err) {
      console.log("❌ Redis search failed:", err.message);
    }
  } else {
    console.log("⚠️ Redis marked DOWN → skipping Redis search");
  }

  // =====================================================
  // 🛟 2️⃣ MONGO FALLBACK SEARCH
  // =====================================================
  if (!driverIds.length) {
    console.log("🛟 FALLBACK → Mongo driver search");

    try {
      const drivers = await Driver.find({
        isOnline: true,
        driverState: "searching",
        lastHeartbeat: { $gte: new Date(Date.now() - 120000) },
      })
        .limit(20)
        .select("_id currentLocation vehicleType tierLevel lastHeartbeat");

      driverIds = drivers.map((d) => d._id.toString());
    } catch (err) {
      console.log("❌ Mongo fallback failed:", err.message);
    }
  }

  // =====================================================
  // ❌ NO DRIVERS (SAFE EXIT)
  // =====================================================
  if (!driverIds || !driverIds.length) {
    console.log("❌ No drivers found (Redis + Mongo)");
    return { driverIds: [], radius };
  }

  // =====================================================
  // 3️⃣ FETCH DRIVER DATA
  // =====================================================
  let drivers = [];

  try {
    drivers = await Driver.find({
      _id: { $in: driverIds },
    }).select("currentLocation vehicleType tierLevel lastHeartbeat");
  } catch (err) {
    console.log("❌ Driver fetch failed:", err.message);
    return { driverIds: [], radius };
  }

  const driverMap = new Map(drivers.map((d) => [d._id.toString(), d]));

  // =====================================================
  // 4️⃣ GET DISPATCH STATE (SAFE)
  // =====================================================
  let dispatchState = await getDispatch(rideId);

  if (!dispatchState) {
    console.log("⚠️ Redis dispatch unavailable → using defaults");

    dispatchState = {
      rejectedDrivers: {},
      notifiedDrivers: {},
    };
  }

  // =====================================================
  // 5️⃣ BUILD ENRICHED DATA
  // =====================================================
  const enriched = driverIds
    .map((id) => {
      const driver = driverMap.get(id);
      if (!driver) return null;

      // ❌ SKIP SAME DRIVER IN RECOVERY
      if (isRecovery && ride?.driver?.toString() === id) {
        return null;
      }

      const eta = calculateDriverETA(driver, pickupLat, pickupLng);
      if (!eta) return null;

      const rejectData = dispatchState.rejectedDrivers?.[id];

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
        rejectionTime,
      };
    })
    .filter(Boolean);

  // =====================================================
  // ❌ NO VALID DRIVERS AFTER ETA
  // =====================================================
  if (!enriched.length) {
    console.log("⚠️ No enriched drivers → fallback to raw drivers");

    return {
      driverIds,
      radius,
    };
  }

  // =====================================================
  // 🔥 RECOVERY MODE FILTER (IMPORTANT)
  // =====================================================
  let finalDrivers = enriched;

  if (isRecovery) {
    // Prefer fresh drivers (less rejected recently)
    finalDrivers = enriched.filter((d) => d.rejectionCount === 0);

    if (!finalDrivers.length) {
      finalDrivers = enriched; // fallback
    }
  }

  // =====================================================
  // 6️⃣ RANK DRIVERS
  // =====================================================
  const ranked = rankDrivers(enriched);

  console.log("🏁 Ranked Drivers:");
  ranked.forEach((d, i) => {
    console.log(
      `#${i + 1} Driver=${d.driver._id} ETA=${d.etaMinutes} Rejects=${d.rejectionCount} Score=${d.score.toFixed(2)}`,
    );
  });

  return {
    driverIds: ranked.map((d) => d.driver._id.toString()),
    radius,
  };
}
