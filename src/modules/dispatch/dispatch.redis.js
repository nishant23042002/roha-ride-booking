import redis from "../../config/redis.js";
import { safeRedis } from "../geo/geo.redis.js";

const PREFIX = "dispatch:ride:";
const TTL = 120;

// =============================
// 🧠 KEY HELPERS
// =============================
const base = (rideId) => `${PREFIX}${rideId}:meta`;
const notifiedKey = (rideId) => `${PREFIX}${rideId}:notified`;
const rotationKey = (rideId) => `${PREFIX}${rideId}:rotation`;
const rejectedKey = (rideId) => `${PREFIX}${rideId}:rejected`;

// =============================
// 🧠 INIT DISPATCH
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
// 🔄 MARK DRIVER NOTIFIED (PIPELINED)
// =============================
export async function markDriverNotified(rideId, driverId) {
  await safeRedis(async () => {
    const pipeline = redis.multi();

    pipeline.hSet(rotationKey(rideId), driverId, Date.now());
    pipeline.hIncrBy(notifiedKey(rideId), driverId, 1);

    // TTL refresh together (important)
    pipeline.expire(rotationKey(rideId), TTL);
    pipeline.expire(notifiedKey(rideId), TTL);
    pipeline.expire(base(rideId), TTL);

    await pipeline.exec();
  }, "MARK_DRIVER_NOTIFIED");
}

// =============================
// 📥 GET ROTATION (SAFE)
// =============================
export async function getRotation(rideId) {
  const data = await safeRedis(
    () => redis.hGetAll(rotationKey(rideId)),
    "GET_ROTATION",
  );

  return data || {};
}

// =============================
// ❌ ADD REJECTED DRIVER (PIPELINED)
// =============================
export async function addRejected(rideId, driverId) {
  const key = rejectedKey(rideId);
  console.log("🧠 WRITE KEY:", rejectedKey(rideId));

  let count = 1;

  const existing = await safeRedis(
    () => redis.hGet(key, driverId),
    "GET_REJECTED",
  );

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

  await safeRedis(async () => {
    const pipeline = redis.multi();

    pipeline.hSet(key, driverId, payload);
    pipeline.expire(key, TTL);
    pipeline.expire(base(rideId), TTL);

    await pipeline.exec();
  }, "SET_REJECTED");

  console.log(`🚫 Rejected → ${driverId} (count=${count})`);
}

// =============================
// 📥 GET DISPATCH STATE (OPTIMIZED)
// =============================
export async function getDispatch(rideId) {
  const rejected = await redis.hGetAll(rejectedKey(rideId));
  const notified = await redis.hGetAll(notifiedKey(rideId));

  console.log("🧠 RAW REDIS:", { rejected, notified });

  return {
    rejectedDrivers: rejected || {},
    notifiedDrivers: notified || {},
  };
}

// =============================
// 🔍 CHECK DISPATCH ACTIVE
// =============================
export async function isDispatchRunning(rideId) {
  const exists = await safeRedis(
    () => redis.exists(base(rideId)),
    "CHECK_DISPATCH_ACTIVE",
  );

  return exists === 1;
}

// =============================
// 🧹 CLEAR DISPATCH (PIPELINED)
// =============================
export async function clearDispatch(rideId) {
  await safeRedis(async () => {
    const pipeline = redis.multi();

    pipeline.del(base(rideId));
    pipeline.del(rotationKey(rideId));
    pipeline.del(notifiedKey(rideId));
    pipeline.del(rejectedKey(rideId));

    await pipeline.exec();
  }, "CLEAR_DISPATCH");

  console.log("🧹 Dispatch cleared:", rideId);
}
