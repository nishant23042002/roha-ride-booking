import redis from "../../config/redis.js";
import { safeRedis } from "../geo/geo.redis.js";

const STATE_KEY = "driver:state";
const TTL = 60;

// =============================
// 🚀 SET DRIVER STATE
// =============================
export async function setDriverState(driverId, state) {
  // 1️⃣ update state
  await safeRedis(
    () => redis.hSet(STATE_KEY, driverId, state),
    "SET_DRIVER_STATE",
  );

  // 3️⃣ optional: keep hash fresh
  await safeRedis(() => redis.expire(STATE_KEY, TTL), "TTL_DRIVER_STATE");
}

// =============================
// 📥 GET DRIVER STATE
// =============================
export async function getDriverState(driverId) {
  return await safeRedis(
    () => redis.hGet(STATE_KEY, driverId),
    "GET_DRIVER_STATE",
  );
}

// =============================
// 📥 GET MULTIPLE STATES
// =============================
export async function getMultipleDriverStates(driverIds) {
  if (!driverIds.length) return {};

  const states = await safeRedis(
    () => redis.hmGet(STATE_KEY, driverIds),
    "HMGET_DRIVER_STATE",
  );

  const result = {};
  driverIds.forEach((id, i) => {
    result[id] = states?.[i] || null;
  });

  return result;
}

// =============================
// ❌ REMOVE DRIVER STATE
// =============================
export async function removeDriverState(driverId) {
  await safeRedis(() => redis.hDel(STATE_KEY, driverId), "REMOVE_DRIVER_STATE");

  await safeRedis(
    () => redis.del(`driver:geo:ttl:${driverId}`),
    "REMOVE_GEO_TTL",
  );
}
