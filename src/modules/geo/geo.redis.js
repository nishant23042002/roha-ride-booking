import redis, { isRedisHealthy } from "../../config/redis.js";
import Driver from "../../models/Driver.js";

const GEO_KEY = "driver:geo";
const GEO_TTL_PREFIX = "driver:geo:ttl:";
const GEO_TTL_SECONDS = 30;

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
    lastFailureTime = Date.now();
    console.log(`❌ ${label} Error:`, err.message);
    return null;
  }
}

// =============================
// 📍 UPDATE DRIVER LOCATION + TTL
// =============================
export async function updateDriverLocation(driverId, lat, lng) {
  if (!driverId || lat == null || lng == null) {
    console.log("❌ INVALID GEO INPUT:", { driverId, lat, lng });
    return;
  }

  const driverKey = driverId.toString();

  await safeRedis(async () => {
    const pipeline = redis.multi();

    // 🔥 ALWAYS store as STRING
    pipeline.geoAdd(GEO_KEY, {
      longitude: Number(lng),
      latitude: Number(lat),
      member: driverKey,
    });

    // TTL marker
    pipeline.set(GEO_TTL_PREFIX + driverKey, "1", {
      EX: GEO_TTL_SECONDS,
    });

    await pipeline.exec();
  }, "GEO_ADD_WITH_TTL");

  console.log("📍 GEO SAVED:", {
    driverId: driverKey,
    lat,
    lng,
  });

  // Mongo fallback
  try {
    await Driver.findByIdAndUpdate(driverId, {
      currentLocation: {
        type: "Point",
        coordinates: [lng, lat], // ✅ correct order
      },
      lastSeen: new Date(),
    });
  } catch (err) {
    console.log("❌ Mongo location update failed:", err.message);
  }
}
// =============================
// 🔍 FIND NEARBY DRIVERS (FIXED)
// =============================
export async function findNearbyDrivers(lat, lng, radiusKm) {
  if (lat == null || lng == null) {
    console.log("❌ GEO SEARCH INVALID INPUT:", { lat, lng });
    return [];
  }

  console.log(`🔍 [REDIS GEO] Searching within ${radiusKm} km`);

  const result = await safeRedis(
    () =>
      redis.geoSearch(
        GEO_KEY,
        { longitude: Number(lng), latitude: Number(lat) },
        { radius: radiusKm, unit: "km" },
        {
          WITHDIST: true,
          SORT: "ASC",
          COUNT: 30,
        },
      ),
    "GEO_SEARCH",
  );

  // 🔥 DEBUG RAW RESULT
  console.log("🧪 RAW GEO RESULT:", result);

  if (!result || !result.length) {
    console.log(`📊 No drivers in ${radiusKm} km`);
    return [];
  }

  // =============================
  // 🔥 TTL FILTER (SAFE)
  // =============================
  const filtered = [];

  for (const item of result) {
    let driverId;
    let distance = null;

    // =============================
    // 🔥 HANDLE ALL REDIS FORMATS
    // =============================
    if (Array.isArray(item)) {
      driverId = item[0];
      distance = item[1] || null;
    } else if (typeof item === "string") {
      driverId = item;
    } else if (typeof item === "object") {
      driverId = item.member || item.name || item.id;
      distance = item.distance || null;
    }

    if (!driverId) continue;

    const alive = await safeRedis(
      () => redis.exists(GEO_TTL_PREFIX + driverId),
      "TTL_CHECK",
    );

    console.log("🔎 TTL CHECK:", driverId, alive);

    if (alive === 1) {
      filtered.push([driverId, distance]);
    }
  }

  console.log("✅ FILTERED DRIVERS:", filtered.length);

  return filtered;
}
// =============================
// ❌ FORCE REMOVE DRIVER
// =============================
export async function removeDriver(driverId) {
  await safeRedis(async () => {
    const pipeline = redis.multi();

    pipeline.zRem(GEO_KEY, driverId);
    pipeline.del(GEO_TTL_PREFIX + driverId);

    await pipeline.exec();
  }, "REMOVE_DRIVER");

  console.log("❌ Driver removed from GEO:", driverId);
}
