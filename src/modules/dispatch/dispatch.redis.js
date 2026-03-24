import redis from "../../config/redis.js";
import { safeRedis } from "../geo/geo.redis.js";

const PREFIX = "dispatch:ride:";
const TTL = 300;

// =============================
// 🧠 KEY HELPERS
// =============================
const base = (rideId) => `${PREFIX}${rideId}:meta`;
const lockKey = (rideId) => `${PREFIX}${rideId}:lock`;
const notifiedKey = (rideId) => `${PREFIX}${rideId}:notified`;
const rotationKey = (rideId) => `${PREFIX}${rideId}:rotation`;
const rejectedKey = (rideId) => `${PREFIX}${rideId}:rejected`;

const touchTTL = async (rideId) => {
  await safeRedis(() => redis.expire(base(rideId), TTL), "TTL_BASE");
};

// =============================
// 🚀 INIT DISPATCH
// =============================
export async function initDispatch(rideId) {
  await safeRedis(
    () =>
      redis.set(base(rideId), "active", {
        NX: true,
        EX: TTL,
      }),
    "INIT_DISPATCH",
  );

  console.log("🧠 Dispatch INIT:", rideId);
}

// =============================
// 🔄 MARK DRIVER NOTIFIED
// =============================
export async function markDriverNotified(rideId, driverId) {
  await safeRedis(
    () => redis.hSet(rotationKey(rideId), driverId, Date.now()),
    "ROTATION_SET",
  );

  await safeRedis(
    () => redis.hIncrBy(notifiedKey(rideId), driverId, 1),
    "NOTIFIED_INCREMENT",
  );

  await safeRedis(() => redis.expire(rotationKey(rideId), TTL), "TTL_ROTATION");

  await safeRedis(() => redis.expire(notifiedKey(rideId), TTL), "TTL_NOTIFIED");

  await touchTTL(rideId);
}

// =============================
// 📥 GET ROTATION
// =============================
export async function getRotation(rideId) {
  const data = await safeRedis(
    () => redis.hGetAll(rotationKey(rideId)),
    "GET_ROTATION",
  );

  return data || {};
}

// =============================
// ✅ LOCK (FIRST DRIVER WINS)
// =============================
export async function setAccepted(rideId, driverId) {
  const result = await safeRedis(
    () =>
      redis.set(lockKey(rideId), driverId, {
        NX: true,
        EX: TTL,
      }),
    "SET_LOCK",
  );

  await touchTTL(rideId);

  if (!result) return false;

  console.log("✅ LOCK ACQUIRED:", rideId, driverId);
  return true;
}

// =============================
// ❌ ADD REJECTED DRIVER
// =============================
export async function addRejected(rideId, driverId) {
  const key = rejectedKey(rideId);

  const existing = await safeRedis(
    () => redis.hGet(key, driverId),
    "GET_REJECTED",
  );

  let count = 1;

  if (existing) {
    try {
      const parsed = JSON.parse(existing);
      count = (parsed.count || 0) + 1;
    } catch {}
  }

  const payload = JSON.stringify({
    count,
    time: Date.now(),
  });

  await safeRedis(() => redis.hSet(key, driverId, payload), "SET_REJECTED");

  await safeRedis(() => redis.expire(key, TTL), "TTL_REJECTED");

  await touchTTL(rideId);

  console.log(`🚫 Rejected → ${driverId} (count=${count})`);
}

// =============================
// 📥 GET DISPATCH STATE
// =============================
export async function getDispatch(rideId) {
  const [rejectedRaw, notifiedRaw] = await Promise.all([
    safeRedis(() => redis.hGetAll(rejectedKey(rideId)), "GET_REJECTED_ALL"),
    safeRedis(() => redis.hGetAll(notifiedKey(rideId)), "GET_NOTIFIED_ALL"),
  ]);

  return {
    rejectedDrivers: rejectedRaw || {},
    notifiedDrivers: notifiedRaw || {},
  };
}

// =============================
// 🔍 CHECK DISPATCH ACTIVE
// =============================
export async function isDispatchRunning(rideId) {
  const keys = [
    base(rideId),
    lockKey(rideId),
    rotationKey(rideId),
    notifiedKey(rideId),
  ];

  const results = await Promise.all(
    keys.map((k) => safeRedis(() => redis.exists(k), "CHECK_KEY")),
  );

  return results.some((r) => r === 1);
}

// =============================
// 🧹 CLEAR DISPATCH
// =============================
export async function clearDispatch(rideId) {
  await safeRedis(
    () =>
      redis.del(
        base(rideId),
        lockKey(rideId),
        rotationKey(rideId),
        notifiedKey(rideId),
        rejectedKey(rideId),
      ),
    "CLEAR_DISPATCH",
  );

  console.log("🧹 Dispatch cleared:", rideId);
}
