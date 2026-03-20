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
  for (const radius of SEARCH_RADII) {
    console.log(`🔍 Searching drivers within ${radius} meters`);

    const drivers = await Driver.find({
      vehicleType,
      driverState: "searching",
      isOnline: true,
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
    }).limit(20); 

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
