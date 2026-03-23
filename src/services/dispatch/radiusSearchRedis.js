import { findNearbyDrivers } from "../../modules/geo/geo.redis.js";
import { getMultipleDriverStates } from "../../modules/driverState/driverState.redis.js";
import { getActiveDrivers } from "../../modules/driverState/driverHeartbeat.redis.js";

const SEARCH_RADII = [1, 2, 3, 5]; // km

export async function radiusDriverSearch({ pickupLat, pickupLng }) {
  for (const radiusKm of SEARCH_RADII) {
    console.log(`🔍 [REDIS GEO] Searching within ${radiusKm} km`);

    const nearby = await findNearbyDrivers(pickupLat, pickupLng, radiusKm);

    if (!nearby?.length) {
      console.log(`📊 No drivers in ${radiusKm} km`);
      continue;
    }

    // ✅ Extract IDs
    const driverIds = nearby.map((d) =>
      typeof d === "string" ? d : d.member || d,
    );

    // =============================
    // 🔥 GET STATE + HEARTBEAT
    // =============================
    const [stateMap, activeDrivers] = await Promise.all([
      getMultipleDriverStates(driverIds),
      getActiveDrivers(30000), // last 30 sec
    ]);

    const activeSet = new Set(activeDrivers);

    // =============================
    // ✅ FINAL FILTER
    // =============================
    const availableDrivers = driverIds.filter(
      (id) => stateMap[id] === "searching" && activeSet.has(id),
    );

    console.log(`📊 Available drivers: ${availableDrivers.length}`);

    if (availableDrivers.length) {
      return {
        driverIds: availableDrivers,
        radius: radiusKm * 1000,
      };
    }
  }

  console.log("❌ No drivers found");
  return { driverIds: [], radius: null };
}
