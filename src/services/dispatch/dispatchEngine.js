// src/services/dispatch/dispatchEngine.js

import { radiusDriverSearch } from "./radiusSearchRedis.js";
import { calculateDriverETA } from "./etaCalculator.js";
import { getDriverScores } from "../../modules/driverScore/driveScore.redis.js";
import Driver from "../../models/Driver.js";
import Ride from "../../models/Ride.js";
import { getDispatch } from "../../modules/dispatch/dispatch.redis.js";
import { isRedisHealthy } from "../../config/redis.js";

// =====================================================
// 🚀 MAIN
// =====================================================
export async function findBestDrivers({ pickupLat, pickupLng, rideId }) {
  console.log("\n🔍 FIND BEST DRIVERS START");
  console.log("📍 Pickup:", pickupLat, pickupLng);
  console.log("🆔 Ride:", rideId);

  let ride = null;
  let isRecovery = false;

  try {
    ride = await Ride.findById(rideId).select("driver recovery");
    isRecovery = !!ride?.recovery;
  } catch {}

  if (isRecovery) console.log("🧠 RECOVERY MODE ACTIVE");

  // =====================================================
  // 🔥 REDIS SEARCH
  // =====================================================
  let driverIds = [];
  let radius = 0;

  try {
    if (!isRedisHealthy()) {
      console.log("❌ Redis unhealthy");
      return { drivers: [], radius, source: "none" };
    }

    const result = await radiusDriverSearch({ pickupLat, pickupLng });

    driverIds = result?.driverIds || [];
    radius = result?.radius || 0;

    console.log("📡 Redis drivers:", driverIds);
  } catch (err) {
    console.log("❌ Redis search error:", err.message);
    return { drivers: [], radius, source: "redis-error" };
  }

  if (!driverIds.length) {
    console.log("❌ No drivers found in Redis");
    return { drivers: [], radius, source: "redis" };
  }

  // =====================================================
  // 📦 FETCH DRIVER DOCS
  // =====================================================
  let drivers = [];

  try {
    drivers = await Driver.find({ _id: { $in: driverIds } }).select(
      "currentLocation vehicleType tierLevel lastHeartbeat",
    );
  } catch (err) {
    console.log("❌ Driver fetch failed:", err.message);
    return { drivers: [], radius, source: "mongo-error" };
  }

  const driverMap = new Map(drivers.map((d) => [d._id.toString(), d]));

  // =====================================================
  // 📊 DISPATCH STATE
  // =====================================================
  let state = await getDispatch(rideId);
  if (!state) state = { rejectedDrivers: {}, notifiedDrivers: {} };

  const rejectedMap = state.rejectedDrivers || {};

  // =====================================================
  // 🧠 ENRICH
  // =====================================================
  const enriched = [];

  for (const id of driverIds) {
    const driver = driverMap.get(id);
    if (!driver) continue;

    if (isRecovery && ride?.driver?.toString() === id) {
      console.log("⛔ Skip same driver (recovery):", id);
      continue;
    }

    const eta = calculateDriverETA(driver, pickupLat, pickupLng);
    if (!eta) continue;

    let rejectionCount = 0;
    let rejectionTime = 0;

    const rejectData = rejectedMap[id];
    if (rejectData) {
      try {
        const parsed = JSON.parse(rejectData);
        rejectionCount = parsed.count || 0;
        rejectionTime = parsed.time || 0;
      } catch {}
    }

    if (rejectionCount >= 2) {
      console.log("🚫 Hard reject:", id);
      continue;
    }

    if (Date.now() - rejectionTime < 10000) {
      console.log("⏳ Cooling reject:", id);
      continue;
    }

    enriched.push({
      driver,
      ...eta,
      rejectionCount,
    });
  }

  if (!enriched.length) {
    console.log("⚠️ No valid drivers after filtering");
    return { drivers: [], radius, source: "filtered" };
  }

  // =====================================================
  // 📊 RANK
  // =====================================================
  const scoreMap = await getDriverScores(
    enriched.map((d) => d.driver._id.toString()),
  );

  const ranked = enriched
    .map((d) => ({
      ...d,
      score:
        d.distanceKm * 2 +
        d.etaMinutes * 3 +
        (scoreMap[d.driver._id.toString()] || 0),
    }))
    .sort((a, b) => a.score - b.score);

  console.log("⚡ RANKED DRIVERS:");

  ranked.forEach((d, i) => {
    console.log(
      `#${i + 1} → ${d.driver._id} | ETA=${d.etaMinutes} | Score=${d.score}`,
    );
  });

  // =====================================================
  // ✅ FINAL FORMAT
  // =====================================================
  const finalDrivers = ranked.map((d) => ({
    id: d.driver._id.toString(),
    eta: d.etaMinutes,
    distance: d.distanceKm,
    score: d.score,
  }));

  return {
    drivers: finalDrivers,
    radius,
    source: "redis",
  };
}
