import redis from "../../config/redis.js";
import { safeRedis } from "../geo/geo.redis.js";

const KEY = "drivers:state";
const TTL = 120; // seconds

// =============================
// 🚀 SET DRIVER STATE
// =============================
export async function setDriverState(driverId, state) {
  await safeRedis(async () => {
    await redis.hSet(KEY, driverId, state);

    // 🔥 individual TTL key
    await redis.set(`driver:ttl:${driverId}`, "1", {
      EX: TTL,
    });
  }, "SET_DRIVER_STATE");
}

// =============================
// 📥 GET DRIVER STATE
// =============================
export async function getDriverState(driverId) {
  return await safeRedis(() => redis.hGet(KEY, driverId), "GET_DRIVER_STATE");
}

// =============================
// 📥 GET MULTIPLE STATES
// =============================
export async function getMultipleDriverStates(driverIds) {
  if (!driverIds.length) return {};

  const states = await safeRedis(
    () => redis.hmGet(KEY, driverIds),
    "HMGET_DRIVER_STATE",
  );

  const map = {};
  driverIds.forEach((id, i) => {
    map[id] = states?.[i] || null;
  });

  return map;
}

export async function isDriverAlive(driverId) {
  return await safeRedis(
    () => redis.exists(`driver:ttl:${driverId}`),
    "CHECK_DRIVER_TTL",
  );
}

// =============================
// ❌ REMOVE DRIVER
// =============================
export async function removeDriverState(driverId) {
  await safeRedis(() => redis.hDel(KEY, driverId), "REMOVE_DRIVER_STATE");
}
