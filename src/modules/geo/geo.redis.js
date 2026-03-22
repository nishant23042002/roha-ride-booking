import redis from "../../config/redis.js";

const GEO_KEY = "drivers:geo";

// =============================
// 📍 ADD / UPDATE DRIVER LOCATION
// =============================
export async function updateDriverLocation(driverId, lat, lon) {
  await redis.geoAdd(GEO_KEY, {
    longitude: lon,
    latitude: lat,
    member: driverId,
  });

  console.log("📍 GEO Updated:", driverId);
}

// =============================
// 🔍 FIND NEARBY DRIVERS
// =============================
export async function findNearbyDrivers(lat, lng, radiusKm) {
  try {
    const result = await redis.geoSearch(
      "drivers:geo",
      {
        longitude: lng,
        latitude: lat,
      },
      {
        radius: radiusKm,
        unit: "km",
      },
      {
        WITHDIST: true,
        SORT: "ASC",
        COUNT: 20,
      },
    );

    return result; // array of driverIds
  } catch (err) {
    console.log("❌ GEO SEARCH ERROR:", err.message);
    return [];
  }
}

// =============================
// ❌ REMOVE DRIVER
// =============================
export async function removeDriver(driverId) {
  await redis.zRem(GEO_KEY, driverId);
}
