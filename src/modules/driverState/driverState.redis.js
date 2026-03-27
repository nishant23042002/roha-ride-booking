import redis from "../../config/redis.js";
import { safeRedis } from "../geo/geo.redis.js";

const STATE_KEY = "driver:state";
const TTL = 60;
const key = (driverId) => `driver:${driverId}:state`;

// =============================
// 🚀 SET DRIVER STATE
// =============================
export async function setDriverState(driverId, state) {
  const key = `driver:${driverId}:state`;

  console.log("🧠 SET STATE:", driverId, state);

  await safeRedis(
    () => redis.set(key, String(state), { EX: 60 }),
    "SET_DRIVER_STATE",
  );
}

export async function getDriverState(driverId) {
  return await safeRedis(() => redis.get(key(driverId)), "GET_DRIVER_STATE");
}

// =============================
// 📥 GET MULTIPLE STATES
// =============================
export async function getMultipleDriverStates(driverIds) {
  if (!driverIds.length) return {};

  const pipeline = redis.multi();

  driverIds.forEach((id) => {
    pipeline.get(`driver:${id}:state`);
  });

  const results = await pipeline.exec();

  console.log("RAW REDIS RESULT:", results);

  const stateMap = {};

  driverIds.forEach((id, i) => {
    const raw = results[i];

    let value = null;

    // ✅ Case 1: node-redis (direct value)
    if (typeof raw === "string") {
      value = raw;
    }

    // ✅ Case 2: ioredis style [err, value]
    else if (Array.isArray(raw)) {
      value = raw[1] ?? raw[0] ?? null;
    }

    // ✅ Case 3: null / undefined
    else {
      value = null;
    }

    // normalize
    if (typeof value === "string") {
      value = value.trim();
    }

    if (value && value.length > 1) {
      stateMap[id] = value;
    } else {
      console.log("⚠️ Corrupt state detected:", id, value, raw);
      stateMap[id] = null;
    }
  });
  return stateMap;
}

// =============================
// ❌ REMOVE DRIVER STATE
// =============================
export async function removeDriverState(driverId) {
  await safeRedis(() => redis.del(`driver:${driverId}:state`));

  await safeRedis(
    () => redis.del(`driver:geo:ttl:${driverId}`),
    "REMOVE_GEO_TTL",
  );
}
