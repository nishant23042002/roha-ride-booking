import redis from "../../config/redis.js";
const PREFIX = "dispatch:";

// =============================
// 🚀 INIT
// =============================
export async function initDispatch(rideId) {
  const key = PREFIX + rideId;

  await redis.hSet(key, {
    acceptedDriver: "",
  });

  console.log("🧠 Redis Dispatch INIT:", rideId);
}

// =============================
// ✅ SET ACCEPTED
// =============================
export async function setAccepted(rideId, driverId) {
  const key = PREFIX + rideId;

  await redis.hSet(key, {
    acceptedDriver: driverId,
  });

  console.log("✅ Redis Accepted:", rideId, driverId);
}

// =============================
// ❌ ADD REJECTED
// =============================
export async function addRejected(rideId, driverId) {
  const key = PREFIX + rideId;

  await redis.hSet(key + ":rejected", {
    [driverId]: Date.now(),
  });

  console.log("🚫 Redis Rejected:", driverId);
}

// =============================
// 📥 GET STATE
// =============================
export async function getDispatch(rideId) {
  const key = PREFIX + rideId;

  const accepted = await redis.hGet(key, "acceptedDriver");
  const rejected = await redis.hGetAll(key + ":rejected");

  return {
    acceptedDriver: accepted || null,
    rejectedDrivers: rejected || {},
  };
}

// =============================
// 🧹 CLEAR
// =============================
export async function clearDispatch(rideId) {
  const pattern = `dispatch:${rideId}*`;

  const keys = await redis.keys(pattern);

  if (keys.length > 0) {
    await redis.del(...keys);
  }

  console.log("🧹 Redis Dispatch Cleared:", rideId, keys);
}