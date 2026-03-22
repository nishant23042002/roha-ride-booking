import redis from "../../config/redis.js";

const GEO_KEY = "drivers:geo";

export async function safeRedis(op, label = "Redis") {
  try {
    return await op();
  } catch (err) {
    console.log(`❌ ${label} Error:`, err.message);
    return null;
  }
}

// =============================
// 📍 ADD / UPDATE DRIVER LOCATION
// =============================
export async function updateDriverLocation(driverId, lat, lng) {
  await safeRedis(
    () =>
      redis.geoAdd("drivers:geo", {
        longitude: lng,
        latitude: lat,
        member: driverId,
      }),
    "GEO_ADD",
  );

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
        { WITHDIST: true, SORT: "ASC", COUNT: 20 },
      ),
    "GEO_SEARCH",
  );

  return result || [];
}

// =============================
// ❌ REMOVE DRIVER
// =============================
export async function removeDriver(driverId) {
  await safeRedis(() => redis.zRem(GEO_KEY, driverId), "REMOVE_DRIVER");
}
