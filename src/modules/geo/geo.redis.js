import redis, { isRedisHealthy } from "../../config/redis.js";
import Driver from "../../models/Driver.js";

const GEO_KEY = "driver:geo";
const GEO_TTL_PREFIX = "driver:geo:ttl:";
const GEO_TTL_SECONDS = 30; // ⏱️ keep in sync with heartbeat

let lastFailureTime = 0;
const COOLDOWN = 5000;
// =============================
// 🛡️ SAFE REDIS WRAPPER
// =============================
export async function safeRedis(op, label = "Redis") {
  const now = Date.now();

  if (!isRedisHealthy() || now - lastFailureTime < COOLDOWN) {
    return null;
  }

  try {
    const result = await Promise.race([
      op(),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error("Redis timeout")), 1000),
      ),
    ]);

    return result;
  } catch (err) {
    lastFailureTime = Date.now(); // 🔥 cooldown trigger
    console.log(`❌ ${label} Error:`, err.message);
    return null;
  }
}

// =============================
// 📍 UPDATE DRIVER LOCATION + TTL
// =============================
export async function updateDriverLocation(driverId, lat, lng) {
  await safeRedis(async () => {
    await redis.geoAdd(GEO_KEY, {
      longitude: lng,
      latitude: lat,
      member: driverId,
    });

    // ✅ ADD THIS
    await redis.set(GEO_TTL_PREFIX + driverId, "1", {
      EX: GEO_TTL_SECONDS,
    });
  }, "GEO_ADD_WITH_TTL");

  // =============================
  // 🧠 MONGO FALLBACK (NEW)
  // =============================
  try {
    await Driver.findByIdAndUpdate(driverId, {
      currentLocation: {
        type: "Point",
        coordinates: [lng, lat],
      },
      lastSeen: new Date(),
    });
  } catch (err) {
    console.log("❌ Mongo location update failed:", err.message);
  }

  console.log("📍 GEO Updated:", driverId);
}

// =============================
// 🔍 FIND NEARBY DRIVERS
// =============================
export async function findNearbyDrivers(lat, lng, radiusKm) {
  const result = await safeRedis(
    () =>
      redis.geoSearch(
        GEO_KEY,
        { longitude: lng, latitude: lat },
        { radius: radiusKm, unit: "km" },
        {
          WITHDIST: true,
          SORT: "ASC",
          COUNT: 20,
        },
      ),
    "GEO_SEARCH",
  );

  return result || [];
}

// =============================
// ❌ FORCE REMOVE DRIVER (RARE)
// =============================
export async function removeDriver(driverId) {
  await safeRedis(async () => {
    await redis.zRem(GEO_KEY, driverId);
    await redis.del(GEO_TTL_PREFIX + driverId);
  }, "REMOVE_DRIVER");

  console.log("❌ Driver removed from GEO:", driverId);
}

// =============================
// 🧹 CLEANUP EXPIRED DRIVERS
// =============================
// export async function cleanupExpiredDrivers(driverIds = []) {
//   for (const driverId of driverIds) {
//     const alive = await safeRedis(
//       () => redis.exists(GEO_TTL_PREFIX + driverId),
//       "CHECK_GEO_TTL",
//     );

//     if (!alive) {
//       await removeDriver(driverId);
//       console.log("🧹 Cleaned expired GEO driver:", driverId);
//     }
//   }
// }
