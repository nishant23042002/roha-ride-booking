import redis from "../../config/redis.js";
import { safeRedis } from "../geo/geo.redis.js";

const LOCK_TTL = 30; // seconds

// =============================
// 🔑 KEYS
// =============================
const rideLockKey = (rideId) => `lock:ride:${rideId}`;
const driverLockKey = (driverId) => `lock:driver:${driverId}`;

// =============================
// 🔐 ACQUIRE BOTH LOCKS (ATOMIC STYLE)
// =============================
export async function acquireRideDriverLock(rideId, driverId) {
  // Try ride lock first
  const rideLock = await safeRedis(
    () =>
      redis.set(rideLockKey(rideId), driverId, {
        NX: true,
        EX: LOCK_TTL,
      }),
    "LOCK_RIDE",
  );

  if (!rideLock) return false;

  // Try driver lock
  const driverLock = await safeRedis(
    () =>
      redis.set(driverLockKey(driverId), rideId, {
        NX: true,
        EX: LOCK_TTL,
      }),
    "LOCK_DRIVER",
  );

  // ❌ rollback if driver lock fails
  if (!driverLock) {
    await safeRedis(() => redis.del(rideLockKey(rideId)), "ROLLBACK_RIDE");
    return false;
  }

  console.log("🔒 LOCK SUCCESS:", { rideId, driverId });
  return true;
}

// =============================
// 🔍 CHECK DRIVER LOCK
// =============================
export async function isDriverLocked(driverId) {
  const exists = await safeRedis(
    () => redis.exists(driverLockKey(driverId)),
    "CHECK_DRIVER_LOCK",
  );
  return exists === 1;
}

// =============================
// 🔍 VERIFY LOCK OWNERSHIP
// =============================
export async function verifyLockOwnership(rideId, driverId) {
  const [rideOwner, driverOwner] = await Promise.all([
    safeRedis(() => redis.get(rideLockKey(rideId)), "GET_RIDE_LOCK"),
    safeRedis(() => redis.get(driverLockKey(driverId)), "GET_DRIVER_LOCK"),
  ]);

  // 🔥 strict ownership check
  if (rideOwner !== driverId) return false;
  if (driverOwner !== rideId) return false;

  return true;
}

// =============================
// 🔓 RELEASE LOCKS (OPTIONAL)
// =============================
export async function releaseLocks(rideId, driverId) {
  await safeRedis(
    () => redis.del(rideLockKey(rideId), driverLockKey(driverId)),
    "RELEASE_LOCKS",
  );
}

// =============================
// 🔓 SAFE RELEASE (ONLY OWNER)
// =============================
export async function releaseLockIfOwner(rideId, driverId) {
  const isOwner = await verifyLockOwnership(rideId, driverId);

  if (!isOwner) {
    console.log("⚠️ Release skipped (not owner)", { rideId, driverId });
    return;
  }

  await safeRedis(
    () => redis.del(rideLockKey(rideId), driverLockKey(driverId)),
    "SAFE_RELEASE",
  );

  console.log("🔓 Lock released safely:", { rideId, driverId });
}
