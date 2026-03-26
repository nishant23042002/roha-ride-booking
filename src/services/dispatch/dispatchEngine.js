// src/services/dispatch/dispatchEngine.js

import { radiusDriverSearch } from "./radiusSearchRedis.js";
import { calculateDriverETA } from "./etaCalculator.js";
import { getDriverScores } from "../../modules/driverScore/driveScore.redis.js";
import Driver from "../../models/Driver.js";
import Ride from "../../models/Ride.js";
import { getDispatch } from "../../modules/dispatch/dispatch.redis.js";
import { isRedisHealthy } from "../../config/redis.js";

export async function findBestDrivers({ pickupLat, pickupLng, rideId }) {
  console.log("\n🔍 FIND BEST DRIVERS START");
  console.log("Pickup:", pickupLat, pickupLng);

  let ride = null;
  let source = "none";

  // =====================================================
  // 🧠 LOAD RIDE (RECOVERY MODE)
  // =====================================================
  try {
    ride = await Ride.findById(rideId).select("driver recovery");
  } catch {}

  const isRecovery = !!ride?.recovery;

  if (isRecovery) {
    console.log("🧠 RECOVERY MODE ACTIVE");
  }

  let driverIds = [];
  let radius = 0;

  // =====================================================
  // 🔥 REDIS SEARCH (PRIMARY)
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
        source = "redis";
      }
    } catch (err) {
      console.log("❌ Redis search failed:", err.message);
    }
  }

  // =====================================================
  // 🛟 MONGO FALLBACK (ONLY IF REDIS DOWN)
  // =====================================================
  if (!driverIds.length && !isRedisHealthy()) {
    try {
      const drivers = await Driver.find({
        isOnline: true,
        driverState: "searching",
        lastHeartbeat: { $gte: new Date(Date.now() - 120000) },
      })
        .limit(20)
        .select("_id currentLocation vehicleType tierLevel lastHeartbeat");

      driverIds = drivers.map((d) => d._id.toString());
      source = "mongo";
    } catch (err) {
      console.log("❌ Mongo fallback failed:", err.message);
    }
  }

  // =====================================================
  // ❌ NO DRIVERS
  // =====================================================
  if (!driverIds.length) {
    console.log("❌ No drivers found (Redis + Mongo)");
    return { driverIds: [], radius, source };
  }

  // =====================================================
  // 📦 FETCH DRIVER DATA
  // =====================================================
  let drivers = [];

  try {
    drivers = await Driver.find({
      _id: { $in: driverIds },
    }).select("currentLocation vehicleType tierLevel lastHeartbeat");
  } catch (err) {
    console.log("❌ Driver fetch failed:", err.message);
    return { driverIds: [], radius, source };
  }

  const driverMap = new Map(drivers.map((d) => [d._id.toString(), d]));

  // =====================================================
  // 📊 DISPATCH STATE
  // =====================================================
  let dispatchState = await getDispatch(rideId);

  if (!dispatchState) {
    dispatchState = {
      rejectedDrivers: {},
      notifiedDrivers: {},
    };
  }

  const rejectedMap = dispatchState.rejectedDrivers || {};

  // =====================================================
  // 🧠 BUILD ENRICHED DRIVERS
  // =====================================================
  const enriched = [];

  for (const id of driverIds) {
    const driver = driverMap.get(id);
    if (!driver) continue;

    // ❌ Skip same driver in recovery
    if (isRecovery && ride?.driver?.toString() === id) continue;

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

    // =====================================================
    // 🚫 HARD FILTERS (CRITICAL)
    // =====================================================
    if (rejectionCount >= 2) continue;

    if (Date.now() - rejectionTime < 10000) continue;

    enriched.push({
      driver,
      ...eta,
      rejectionCount,
    });
  }

  // =====================================================
  // ❌ NO VALID DRIVERS
  // =====================================================
  if (!enriched.length) {
    console.log("⚠️ No valid drivers after filtering");
    return { driverIds: [], radius, source };
  }

  // =====================================================
  // 🔥 RECOVERY MODE PRIORITY
  // =====================================================
  let finalDrivers = enriched;

  if (isRecovery) {
    const fresh = enriched.filter((d) => d.rejectionCount === 0);
    if (fresh.length) finalDrivers = fresh;
  }

  // =====================================================
  // 📊 SCORE + RANK
  // =====================================================
  const scoreMap = await getDriverScores(
    finalDrivers.map((d) => d.driver._id.toString()),
  );

  const ranked = finalDrivers
    .map((d) => ({
      ...d,
      score:
        d.distanceKm * 2 +
        d.etaMinutes * 3 +
        (scoreMap[d.driver._id.toString()] || 0),
    }))
    .sort((a, b) => a.score - b.score);

  console.log("⚡ FAST RANKING MODE");

  ranked.forEach((d, i) => {
    console.log(
      `#${i + 1} Driver=${d.driver._id} ETA=${d.etaMinutes} Score=${d.score}`,
    );
  });

  // =====================================================
  // 🔒 FINAL SAFETY FILTER
  // =====================================================
  const finalIds = ranked.map((d) => d.driver._id.toString());
 
  const safeDrivers = finalIds.filter((id) => {
    const rejectData = rejectedMap[id];
    if (!rejectData) return true;

    try {
      const { count, time } = JSON.parse(rejectData);

      if (count >= 2) return false;
      if (Date.now() - time < 10000) return false;

      return true;
    } catch {
      return true;
    }
  });
  return {
    driverIds: safeDrivers,
    radius,
    source,
  };
}
