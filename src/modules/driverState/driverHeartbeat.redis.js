import redis from "../../config/redis.js";
import { safeRedis } from "../geo/geo.redis.js";

const KEY = "drivers:lastSeen";

// =============================
// 💓 UPDATE HEARTBEAT
// =============================
export async function updateHeartbeat(driverId) {
  const now = Date.now();

  await safeRedis(
    () => redis.zAdd(KEY, [{ score: now, value: driverId }]),
    "SET_HEARTBEAT",
  );
}

// =============================
// 📥 GET ACTIVE DRIVERS
// =============================
export async function getActiveDrivers(windowMs = 30000) {
  const cutoff = Date.now() - windowMs;

  return await safeRedis(
    () => redis.zRangeByScore(KEY, cutoff, "+inf"),
    "GET_ACTIVE_DRIVERS",
  );
}

// =============================
// ❌ REMOVE DRIVER
// =============================
export async function removeHeartbeat(driverId) {
  await safeRedis(() => redis.zRem(KEY, driverId), "REMOVE_HEARTBEAT");
}
