// /src/modules/ride/ride.redis.js

import redis from "../../config/redis.js";
import { safeRedis } from "../geo/geo.redis.js";

const PREFIX = "ride:";
const TTL = 1800;

const key = (rideId) => `${PREFIX}${rideId}`;

// =============================
// 🚀 CREATE RIDE STATE
// =============================
export async function createRideState(ride) {
  const rideId = ride._id.toString();

  const payload = {
    status: "SEARCHING",
    customerId: ride.customer.toString(),
    driverId: "",
    pickupLat: String(ride.pickupLocation.coordinates[1]),
    pickupLng: String(ride.pickupLocation.coordinates[0]),
    createdAt: String(Date.now()),
  };

  await redis.hSet(key(rideId), payload);
  await redis.expire(key(rideId), TTL);

  console.log("🧠 [RIDE] CREATED:", rideId);
}

export async function getRideState(rideId) {
  const data = await redis.hGetAll(key(rideId));

  console.log("🧠 [REDIS] Ride state fetched:", rideId, data);

  return data;
}

// =============================
// 🔗 ASSIGN DRIVER TO RIDE
// =============================
export async function assignDriverToRide(rideId, driverId) {
  const pipeline = redis.multi();

  pipeline.hSet(key(rideId), {
    driverId,
    status: "ACCEPTED",
  });

  pipeline.set(`driver:${driverId}:ride`, rideId, { EX: TTL });
  pipeline.set(`ride:${rideId}:driver`, driverId, { EX: TTL });

  await pipeline.exec();

  console.log("✅ [RIDE] ASSIGNED:", { rideId, driverId });
}
