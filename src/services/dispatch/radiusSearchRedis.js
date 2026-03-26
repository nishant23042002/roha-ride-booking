// /src/services/dispatch/radiusSearchRedis.js

import { findNearbyDrivers } from "../../modules/geo/geo.redis.js";
import { getMultipleDriverStates } from "../../modules/driverState/driverState.redis.js";
import Driver from "../../models/Driver.js";
import { isRedisHealthy } from "../../config/redis.js";

const SEARCH_RADII = [1, 2, 3, 5];

// =============================
// 🚀 REDIS PRIMARY SEARCH
// =============================
export async function radiusDriverSearch({ pickupLat, pickupLng }) {
  if (pickupLat == null || pickupLng == null) {
    console.log("❌ Invalid pickup coords");
    return { driverIds: [], radius: null };
  }

  // =============================
  // 🔴 REDIS DOWN → FALLBACK
  // =============================
  if (!isRedisHealthy()) {
    console.log("⚠️ Redis DOWN → using Mongo fallback");

    const fallback = await mongoFallbackSearch({
      pickupLat,
      pickupLng,
      radiusKm: 5,
    });

    return {
      driverIds: fallback,
      radius: fallback.length ? 5000 : null,
    };
  }

  // =============================
  // 🟢 REDIS FLOW
  // =============================
  for (const radiusKm of SEARCH_RADII) {
    console.log(`🔍 [REDIS GEO] Searching within ${radiusKm} km`);

    const nearby = await findNearbyDrivers(pickupLat, pickupLng, radiusKm);

    if (!nearby?.length) {
      console.log(`📊 No drivers in ${radiusKm} km`);
      continue;
    }

    // =============================
    // 🧠 EXTRACT DRIVER IDS (FIXED)
    // =============================
    const driverIds = nearby.map((d) => {
      if (Array.isArray(d)) return d[0]; // [driverId, distance]
      return typeof d === "string" ? d : d?.member;
    });

    if (!driverIds.length) {
      console.log("⚠️ No valid driverIds extracted");
      continue;
    }

    // =============================
    // 🔥 STATE FILTER (CRITICAL)
    // =============================
    let stateMap = {};

    try {
      stateMap = await getMultipleDriverStates(driverIds);
    } catch (err) {
      console.log("❌ Redis state fetch failed:", err.message);
      continue;
    }

    const availableDrivers = driverIds.filter(
      (id) => stateMap[id] === "searching",
    );

    console.log(
      `📊 Radius=${radiusKm}km | total=${driverIds.length} | available=${availableDrivers.length}`,
    );

    if (availableDrivers.length) {
      console.log("📡 DRIVER SOURCE → REDIS");

      return {
        driverIds: availableDrivers,
        radius: radiusKm * 1000,
      };
    }
  }

  // =============================
  // ❌ NO DRIVERS IN REDIS
  // =============================
  console.log("❌ No drivers found in Redis");

  return { driverIds: [], radius: null };
}

// =============================
// 🛟 MONGO FALLBACK (ONLY WHEN REDIS DOWN)
// =============================
async function mongoFallbackSearch({ pickupLat, pickupLng, radiusKm }) {
  try {
    const drivers = await Driver.find({
      driverState: "searching",
      isOnline: true,
      lastHeartbeat: {
        $gte: new Date(Date.now() - 120000),
      },
      currentLocation: {
        $near: {
          $geometry: {
            type: "Point",
            coordinates: [pickupLng, pickupLat],
          },
          $maxDistance: radiusKm * 1000,
        },
      },
    })
      .limit(10)
      .select("_id");

    console.log("📡 DRIVER SOURCE → MONGO");

    return drivers.map((d) => d._id.toString());
  } catch (err) {
    console.log("❌ Mongo fallback failed:", err.message);
    return [];
  }
}
