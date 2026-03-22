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
  const key = PREFIX + rideId;

  await redis.del(key);
  await redis.del(key + ":rejected");

  console.log("🧹 Redis Dispatch Cleared:", rideId);
}