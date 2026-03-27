// /src/modules/driverState/driverScore.redis.js

import redis from "../../config/redis.js";

const KEY = "driver:scores"; // ✅ add this at top

export async function updateDriverScore(driverId, score) {
  await redis.zAdd(KEY, [{ score, value: driverId }]);
}

export async function getDriverScores(driverIds) {
  if (!driverIds.length) return {};

  const pipeline = redis.multi();

  driverIds.forEach((id) => {
    pipeline.zScore("driver:scores", id);
  });

  const results = await pipeline.exec();

  console.log("🧠 SCORE RAW:", results);

  const scores = {};

  driverIds.forEach((id, i) => {
    const raw = results[i];

    let value = 0;

    // ✅ node-redis (direct value)
    if (typeof raw === "string" || typeof raw === "number") {
      value = raw;
    }

    // ✅ ioredis ([err, value])
    else if (Array.isArray(raw)) {
      value = raw[1] ?? raw[0] ?? 0;
    }

    // ✅ null / undefined
    else {
      value = 0;
    }

    scores[id] = Number(value) || 0;
  });

  return scores;
}
