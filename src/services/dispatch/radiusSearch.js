// src/services/radiusSearch.js

import Driver from "../../models/Driver.js";
import { haversineDistance } from "../../utils/gpsUtils.js";

const SEARCH_RADII = [1000, 2000, 3000, 5000]; // meters

export async function radiusDriverSearch({
  pickupLat,
  pickupLng,
  vehicleType,
  passengerCount,
  heartbeatLimit,
}) {
  console.log("\n========== DISPATCH DEBUG ==========");
  console.log("📍 Pickup:", pickupLat, pickupLng);
  console.log("🚗 Vehicle:", vehicleType);

  const allDrivers = await Driver.find({});
  console.log("👥 TOTAL DRIVERS:", allDrivers.length);

  allDrivers.forEach((d) => {
    console.log("----");
    console.log("ID:", d._id);
    console.log("STATE:", d.driverState);
    console.log("VEHICLE:", d.vehicleType);
    console.log("HEARTBEAT:", d.lastHeartbeat);
    console.log("LOCATION:", d.currentLocation);
  });

  for (const radius of SEARCH_RADII) {
    console.log(`🔍 Searching drivers within ${radius} meters`);

    const drivers = await Driver.find({
      vehicleType,
      driverState: "searching",
      vehicleCapacity: { $gte: passengerCount },
      lastHeartbeat: {
        $gte: new Date(Date.now() - heartbeatLimit),
      },
      currentLocation: {
        $near: {
          $geometry: {
            type: "Point",
            coordinates: [pickupLng, pickupLat],
          },
          $maxDistance: radius,
        },
      },
    });

    drivers.forEach((d) => {
      const [lng, lat] = d.currentLocation.coordinates;

      const dist = haversineDistance(lat, lng, pickupLat, pickupLng);

      console.log("📏 DRIVER DIST:", dist, "km");
    });

    console.log(`📊 Drivers found in ${radius}m: ${drivers.length}`);

    if (drivers.length) {
      console.log(`✅ Radius search stopped at ${radius} meters`);
      return {
        drivers,
        radius,
      };
    }
  }
  console.log("❌ No drivers found in any radius");
  return { drivers: [], radius: null };
}
