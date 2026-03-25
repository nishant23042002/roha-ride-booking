import redis from "../../config/redis.js";
import { safeRedis } from "../geo/geo.redis.js";

const KEY = "driver:metrics";

// =============================
// 📊 INIT DRIVER METRICS
// =============================
export async function initDriverMetrics(driverId) {
  await safeRedis(
    () =>
      redis.hSet(
        KEY,
        driverId,
        JSON.stringify({
          accepts: 0,
          rejects: 0,
          cancels: 0,
          totalRequests: 0,
          avgResponseTime: 0,
        }),
      ),
    "INIT_DRIVER_METRICS",
  );
}

// =============================
// ✅ ACCEPT TRACK
// =============================
export async function trackAccept(driverId, responseTimeMs) {
  const data = await getMetrics(driverId);

  const newAvg =
    (data.avgResponseTime * data.accepts + responseTimeMs) / (data.accepts + 1);

  data.accepts += 1;
  data.totalRequests += 1;
  data.avgResponseTime = newAvg;

  await saveMetrics(driverId, data);
}

// =============================
// 🚫 REJECT TRACK
// =============================
export async function trackReject(driverId) {
  const data = await getMetrics(driverId);

  data.rejects += 1;
  data.totalRequests += 1;

  await saveMetrics(driverId, data);
}

// =============================
// ❌ CANCEL TRACK
// =============================
export async function trackCancel(driverId) {
  const data = await getMetrics(driverId);

  data.cancels += 1;

  await saveMetrics(driverId, data);
}

// =============================
// 📥 GET METRICS
// =============================
export async function getMetrics(driverId) {
  const raw = await safeRedis(() => redis.hGet(KEY, driverId), "GET_METRICS");

  if (!raw) {
    return {
      accepts: 0,
      rejects: 0,
      cancels: 0,
      totalRequests: 0,
      avgResponseTime: 0,
    };
  }

  return JSON.parse(raw);
}

// =============================
// 💾 SAVE
// =============================
async function saveMetrics(driverId, data) {
  await safeRedis(
    () => redis.hSet(KEY, driverId, JSON.stringify(data)),
    "SAVE_METRICS",
  );
}
