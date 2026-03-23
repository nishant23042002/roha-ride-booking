import redis from "../../config/redis.js";
import { safeRedis } from "../geo/geo.redis.js";

const PREFIX = "dispatch:";
const TTL_SECONDS = 120; // ⏱️ 2 min (safe for dispatch lifecycle)
const ROTATION_SUFFIX = ":rotation";
const NOTIFIED_SUFFIX = ":notified";

// =============================
// 🔄 MARK DRIVER NOTIFIED (COUNT + TIME)
// =============================
export async function markDriverNotified(rideId, driverId) {
  const rotationKey = PREFIX + rideId + ROTATION_SUFFIX;
  const notifiedKey = PREFIX + rideId + NOTIFIED_SUFFIX;

  // 🔁 Rotation (timestamp)
  await safeRedis(
    () => redis.hSet(rotationKey, driverId, Date.now()),
    "MARK_ROTATION",
  );

  await safeRedis(
    () => redis.hIncrBy(notifiedKey, driverId, 1),
    "INCR_NOTIFY_COUNT",
  );

  // TTL
  await safeRedis(() => redis.expire(rotationKey, TTL_SECONDS), "TTL_ROTATION");
  await safeRedis(() => redis.expire(notifiedKey, TTL_SECONDS), "TTL_NOTIFY");
}

// =============================
// 📥 GET ROTATION DATA
// =============================
export async function getRotation(rideId) {
  const key = PREFIX + rideId + ROTATION_SUFFIX;

  const data = await safeRedis(() => redis.hGetAll(key), "GET_ROTATION");

  return data || {};
}

// =============================
// 🚀 INIT
// =============================
export async function initDispatch(rideId) {
  const key = PREFIX + rideId;
  const rejectedKey = key + ":rejected";

  // ✅ Also prepare rejected key TTL (empty for now)
  await safeRedis(
    () => redis.expire(rejectedKey, TTL_SECONDS),
    "SET_TTL_REJECTED",
  );

  console.log("🧠 Redis Dispatch INIT:", rideId);
}

// =============================
// ✅ SET ACCEPTED
// =============================
export async function setAccepted(rideId, driverId) {
  const key = PREFIX + rideId + ":lock";

  const result = await safeRedis(
    () =>
      redis.set(key, driverId, {
        NX: true, // 🔥 only first wins
        EX: TTL_SECONDS,
      }),
    "SETNX_ACCEPT",
  );

  if (!result) {
    return false; // ❌ already locked
  }

  console.log("✅ LOCK ACQUIRED:", rideId, driverId);
  return true; // ✅ winner
}

// =============================
// ❌ ADD REJECTED (UPGRADED)
// =============================
export async function addRejected(rideId, driverId) {
  const key = PREFIX + rideId + ":rejected";

  // 👉 get existing data
  const existing = await safeRedis(
    () => redis.hGet(key, driverId),
    "GET_REJECTED_DRIVER",
  );

  let count = 1;

  if (existing) {
    try {
      const parsed = JSON.parse(existing);
      count = (parsed.count || 0) + 1;
    } catch {
      count = 1;
    }
  }

  const payload = JSON.stringify({
    time: Date.now(),
    count,
  });

  await safeRedis(() => redis.hSet(key, driverId, payload), "ADD_REJECTED");

  const ttl = await safeRedis(() => redis.ttl(key), "GET_TTL");

  if (ttl < 0) {
    await safeRedis(() => redis.expire(key, TTL_SECONDS), "SET_TTL_REJECTED");
  }

  console.log(`🚫 Rejected: ${driverId} (count=${count})`);
}

// =============================
// 📥 GET STATE
// =============================
export async function getDispatch(rideId) {
  const key = PREFIX + rideId;
  const rejectedKey = key + ":rejected";
  const notifiedKey = key + NOTIFIED_SUFFIX;

  const [rejectedRaw, notifiedRaw] = await Promise.all([
    safeRedis(() => redis.hGetAll(rejectedKey), "GET_REJECTED"),
    safeRedis(() => redis.hGetAll(notifiedKey), "GET_NOTIFIED"),
  ]);

  return {
    rejectedDrivers: rejectedRaw || {},
    notifiedDrivers: notifiedRaw || {}, // ✅ CRITICAL FIX
  };
}

// =============================
// 🧹 CLEAR
// =============================
export async function clearDispatch(rideId) {
  const key = PREFIX + rideId;

  await safeRedis(
    () =>
      redis.del(
        key,
        key + ":rejected",
        key + ":rotation",
        key + NOTIFIED_SUFFIX,
        key + ":lock"
      ),
    "CLEAR_DISPATCH",
  );

  console.log("🧹 Redis Dispatch Cleared:", rideId);
}
