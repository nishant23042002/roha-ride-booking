// src/services/radiusSearch.js

import Driver from "../../models/Driver.js";
import mongoose from "mongoose";
import { findNearbyDrivers } from "../../modules/geo/geo.redis.js";

const SEARCH_RADII = [1, 2, 3, 5]; // km

export async function radiusDriverSearch({
  pickupLat,
  pickupLng,
  vehicleType,
  passengerCount,
  heartbeatLimit,
}) {
  for (const radiusKm of SEARCH_RADII) {
    console.log(`🔍 [REDIS GEO] Searching within ${radiusKm} km`);

    // =============================
    // 1️⃣ GET DRIVER IDS FROM REDIS
    // =============================
    const nearby = await findNearbyDrivers(pickupLat, pickupLng, radiusKm);

    // 🔥 DEBUG (keep this for now)
    console.log("🧠 GEO RAW:", nearby);

    if (!nearby || !nearby.length) {
      console.log(`📊 No drivers in ${radiusKm} km`);
      continue;
    }

    // =============================
    // 2️⃣ EXTRACT IDS SAFELY
    // =============================
    const driverIds = nearby.map((d) =>
      typeof d === "string" ? d : d.member || d.driverId,
    );

    console.log("🧠 GEO IDS:", driverIds);

    if (!driverIds.length) continue;

    // =============================
    // 3️⃣ CONVERT TO OBJECT IDS
    // =============================
    const objectIds = driverIds.map((id) => new mongoose.Types.ObjectId(id));

    // =============================
    // 4️⃣ FETCH FROM MONGO
    // =============================
    const drivers = await Driver.find({
      _id: { $in: objectIds },
      vehicleType,
      driverState: "searching",
      isOnline: true,
      vehicleCapacity: { $gte: passengerCount },
      lastHeartbeat: {
        $gte: new Date(Date.now() - heartbeatLimit),
      },
    }).limit(20);

    console.log(`📊 Drivers after filtering: ${drivers.length}`);

    if (drivers.length) {
      console.log(`✅ Radius search stopped at ${radiusKm} km`);

      return {
        drivers,
        radius: radiusKm * 1000, // meters (keep compatibility)
      };
    }
  }

  console.log("❌ No drivers found in any radius");

  return {
    drivers: [],
    radius: null,
  };
}
