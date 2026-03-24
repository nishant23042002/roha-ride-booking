import redis from "../../config/redis.js";
import { findNearbyDrivers } from "../../modules/geo/geo.redis.js";
import { getMultipleDriverStates } from "../../modules/driverState/driverState.redis.js";
import Driver from "../../models/Driver.js";

const SEARCH_RADII = [1, 2, 3, 5]; // km
const GEO_TTL_PREFIX = "driver:geo:ttl:";

export async function radiusDriverSearch({ pickupLat, pickupLng }) {
  for (const radiusKm of SEARCH_RADII) {
    console.log(`🔍 [REDIS GEO] Searching within ${radiusKm} km`);

    const nearby = await findNearbyDrivers(pickupLat, pickupLng, radiusKm);

    // =============================
    // ❌ NO REDIS DRIVERS → TRY MONGO
    // =============================
    if (!nearby?.length) {
      console.log(`📊 No drivers in ${radiusKm} km`);

      const fallbackDrivers = await mongoFallbackSearch({
        pickupLat,
        pickupLng,
        radiusKm,
      });

      if (fallbackDrivers.length) {
        console.log(`🛟 Mongo fallback found: ${fallbackDrivers.length}`);

        return {
          driverIds: fallbackDrivers,
          radius: radiusKm * 1000,
        };
      }

      continue;
    }

    // =============================
    // 🧠 EXTRACT DRIVER IDS
    // =============================
    const driverIds = nearby.map((d) =>
      typeof d === "string" ? d : d.member || d,
    );

    // =============================
    // 🔥 FILTER BY GEO TTL (ALIVE)
    // =============================
    const ttlChecks = await Promise.all(
      driverIds.map((id) => redis.exists(GEO_TTL_PREFIX + id)),
    );

    const aliveDrivers = driverIds.filter((id, i) => ttlChecks[i] === 1);

    if (!aliveDrivers.length) {
      console.log("⚠️ All drivers expired by GEO TTL");

      // 🛟 TRY MONGO FALLBACK HERE ALSO
      const fallbackDrivers = await mongoFallbackSearch({
        pickupLat,
        pickupLng,
        radiusKm,
      });

      if (fallbackDrivers.length) {
        console.log(`🛟 Mongo fallback found: ${fallbackDrivers.length}`);

        return {
          driverIds: fallbackDrivers,
          radius: radiusKm * 1000,
        };
      }

      continue;
    }

    // =============================
    // 🔥 GET DRIVER STATES
    // =============================
    const stateMap = await getMultipleDriverStates(aliveDrivers);

    // =============================
    // ✅ FINAL FILTER
    // =============================
    const availableDrivers = aliveDrivers.filter(
      (id) => stateMap[id] === "searching",
    );

    console.log(`📊 Available drivers: ${availableDrivers.length}`);

    if (availableDrivers.length) {
      return {
        driverIds: availableDrivers,
        radius: radiusKm * 1000,
      };
    }

    // =============================
    // 🛟 LAST CHANCE FALLBACK
    // =============================
    const fallbackDrivers = await mongoFallbackSearch({
      pickupLat,
      pickupLng,
      radiusKm,
    });

    if (fallbackDrivers.length) {
      console.log(`🛟 Mongo fallback found: ${fallbackDrivers.length}`);

      return {
        driverIds: fallbackDrivers,
        radius: radiusKm * 1000,
      };
    }
  }

  console.log("❌ No drivers found (Redis + Mongo)");
  return { driverIds: [], radius: null };
}

async function mongoFallbackSearch({ pickupLat, pickupLng, radiusKm }) {
  try {
    console.log("🛟 FALLBACK → Mongo driver search");

    const drivers = await Driver.find({
      driverState: "searching",

      // 🔥 FIXED LOGIC
      $or: [
        {
          lastHeartbeat: {
            $gte: new Date(Date.now() - 180000), // 3 min window
          },
        },
        {
          isOnline: true,
        },
      ],

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
