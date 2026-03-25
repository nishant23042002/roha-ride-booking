// /src/services/dispatch/radiusSearchRedis.js

import redis from "../../config/redis.js";
import { findNearbyDrivers } from "../../modules/geo/geo.redis.js";
import { getMultipleDriverStates } from "../../modules/driverState/driverState.redis.js";
import Driver from "../../models/Driver.js";
import { isRedisHealthy } from "../../config/redis.js";

const SEARCH_RADII = [1, 2, 3, 5];

// =============================
// 🚀 REDIS PRIMARY SEARCH
// =============================
export async function radiusDriverSearch({ pickupLat, pickupLng }) {
  // =============================
  // 🔴 REDIS DOWN → ONLY THEN MONGO
  // =============================
  if (!isRedisHealthy()) {
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
  // 🟢 REDIS FLOW ONLY
  // =============================
  for (const radiusKm of SEARCH_RADII) {
    console.log(`🔍 [REDIS GEO] Searching within ${radiusKm} km`);

    const nearby = await findNearbyDrivers(pickupLat, pickupLng, radiusKm);

    if (!nearby?.length) {
      console.log(`📊 No drivers in ${radiusKm} km`);
      continue;
    }

    // =============================
    // 🧠 EXTRACT DRIVER IDS
    // =============================
    const driverIds = nearby.map((d) =>
      typeof d === "string" ? d : d.member || d,
    );

    // =============================
    // 🔥 STRICT TTL FILTER (GEO + ALIVE)
    // =============================
    let results;

    try {
      const pipeline = redis.multi();

      driverIds.forEach((id) => {
        pipeline.exists(`driver:geo:ttl:${id}`); // GEO TTL
      });
      results = await pipeline.exec();
    } catch (err) {
      console.log("❌ Redis pipeline failed:", err.message);
      return { driverIds: [], radius: null };
    }

    if (!results) {
      console.log("⚠️ Redis returned null");
      return { driverIds: [], radius: null };
    }

    const aliveDrivers = [];

    for (let i = 0; i < driverIds.length; i++) {
      const geoAlive = results[i] && results[i][1] === 1;

      if (geoAlive) {
        aliveDrivers.push(driverIds[i]);
      }
    }

    if (!aliveDrivers.length) {
      console.log("⚠️ TTL miss → using fallback drivers");
      return driverIds; // early return for clarity
    }

    // =============================
    // 🔥 STATE FILTER
    // =============================
    const stateMap = await getMultipleDriverStates(aliveDrivers);

    const availableDrivers = aliveDrivers.filter(
      (id) => stateMap[id] === "searching",
    );

    console.log(
      `📊 Radius=${radiusKm}km | total=${driverIds.length} | alive=${aliveDrivers.length} | available=${availableDrivers.length}`,
    );
    if (availableDrivers.length) {
      return {
        driverIds: availableDrivers,
        radius: radiusKm * 1000,
      };
    }
  }

  // =============================
  // ❌ REDIS HAD NO MATCH → NOT FAILURE
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

    return drivers.map((d) => d._id.toString());
  } catch (err) {
    console.log("❌ Mongo fallback failed:", err.message);
    return [];
  }
}
