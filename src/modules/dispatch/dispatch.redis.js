import redis from "../../config/redis.js";
import { safeRedis } from "../geo/geo.redis.js";

const PREFIX = "dispatch:";
const TTL_SECONDS = 120; // ⏱️ 2 min (safe for dispatch lifecycle)

// =============================
// 🚀 INIT
// =============================
export async function initDispatch(rideId) {
  const key = PREFIX + rideId;

  await safeRedis(
    () => redis.hSet(key, { acceptedDriver: "" }),
    "INIT_DISPATCH",
  );

  // ✅ Also prepare rejected key TTL (empty for now)
  await safeRedis(() => redis.expire(key, TTL_SECONDS), "SET_TTL");

  console.log("🧠 Redis Dispatch INIT:", rideId);
}

// =============================
// ✅ SET ACCEPTED
// =============================
export async function setAccepted(rideId, driverId) {
  const key = PREFIX + rideId;

  await safeRedis(
    () =>
      redis.hSet(key, {
        acceptedDriver: driverId,
      }),
    "SET_ACCEPTED",
  );

  // ✅ Refresh TTL (important!)
  await safeRedis(() => redis.expire(key, TTL_SECONDS), "REFRESH_TTL");

  console.log("✅ Redis Accepted:", rideId, driverId);
}

// =============================
// ❌ ADD REJECTED
// =============================
export async function addRejected(rideId, driverId) {
  const rejectedKey = PREFIX + rideId + ":rejected";

  await safeRedis(
    () =>
      redis.hSet(rejectedKey, {
        [driverId]: Date.now(),
      }),
    "ADD_REJECTED",
  );

  // ✅ Ensure TTL
  await safeRedis(() => redis.expire(rejectedKey, TTL_SECONDS), "TTL_REJECTED");

  console.log("🚫 Redis Rejected:", driverId);
}

// =============================
// 📥 GET STATE
// =============================
export async function getDispatch(rideId) {
  const key = PREFIX + rideId;
  const rejectedKey = key + ":rejected";

  const accepted = await safeRedis(
    () => redis.hGet(key, "acceptedDriver"),
    "GET_ACCEPTED",
  );

  const rejected = await safeRedis(
    () => redis.hGetAll(rejectedKey),
    "GET_REJECTED",
  );

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
  const rejectedKey = key + ":rejected";

  await safeRedis(() => redis.del(key, rejectedKey), "CLEAR_DISPATCH");

  console.log("🧹 Redis Dispatch Cleared:", rideId);
}
