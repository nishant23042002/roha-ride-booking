import redis from "../../config/redis.js";
import { safeRedis } from "../geo/geo.redis.js";

// =============================
// 🔑 KEYS
// =============================
const SCORE_KEY = "drivers:score"; // ZSET
const SCORE_TS_KEY = "drivers:score:ts"; // HASH

// =============================
// ⚙️ CONFIG
// =============================

// 🔥 TEST MODE (FAST DECAY)
// const DECAY_WINDOW = 5000; // 5 sec

// ✅ PROD MODE (later change)
const DECAY_WINDOW = 5 * 60 * 1000; // 5 min

const ENABLE_DEBUG = true;

// =============================
// 🎯 SCORE CALCULATION
// =============================
export function calculateScore(metrics = {}) {
  const {
    accepts = 0,
    rejects = 0,
    cancels = 0,
    totalRequests = 0,
    avgResponseTime = 0,
  } = metrics;

  const acceptRate = totalRequests > 0 ? accepts / totalRequests : 1;

  // -----------------------------
  // 🎯 POSITIVE SIGNALS
  // -----------------------------
  const baseScore = 10;

  const acceptBoost = acceptRate * 5;

  const fastResponseBoost =
    avgResponseTime < 2000 ? 2 : avgResponseTime < 4000 ? 1 : 0;

  // -----------------------------
  // ❌ PENALTIES
  // -----------------------------
  const rejectPenalty = rejects * 1.5;
  const cancelPenalty = cancels * 3;

  // -----------------------------
  // 🧠 FINAL SCORE (LOWER = BETTER)
  // -----------------------------
  const score =
    baseScore - acceptBoost - fastResponseBoost + rejectPenalty + cancelPenalty;

  return Math.max(score, 0);
}

// =============================
// 🚀 UPDATE DRIVER SCORE
// =============================
export async function updateDriverScore(driverId, metrics) {
  const score = calculateScore(metrics);
  const now = Date.now();

  await safeRedis(async () => {
    await redis.zAdd(SCORE_KEY, [{ score, value: driverId }]);
    await redis.hSet(SCORE_TS_KEY, driverId, now);
  }, "UPDATE_DRIVER_SCORE");

  if (ENABLE_DEBUG) {
    console.log(
      `📊 SCORE UPDATED → ${driverId} | score=${score} | metrics=${JSON.stringify(
        metrics,
      )}`,
    );
  }

  return score;
}

// =============================
// 📥 GET DRIVER SCORES (WITH DECAY)
// =============================
export async function getDriverScores(driverIds) {
  if (!driverIds.length) return {};

  const now = Date.now();

  // =============================
  // ⚡ FETCH SCORES (OPTIMIZED)
  // =============================
  const scores = await safeRedis(async () => {
    const result = {};

    for (const id of driverIds) {
      const s = await redis.zScore(SCORE_KEY, id);
      result[id] = Number(s) || 0;
    }

    return result;
  }, "GET_SCORES");

  // =============================
  // ⚡ FETCH TIMESTAMPS
  // =============================
  const timestamps = await safeRedis(
    () => redis.hGetAll(SCORE_TS_KEY),
    "GET_SCORE_TS",
  );

  const scoreMap = {};

  // =============================
  // 🔥 APPLY DECAY
  // =============================
  for (const id of driverIds) {
    const rawScore = scores?.[id] ?? 0;

    const lastUpdate = timestamps?.[id] ? parseInt(timestamps[id]) : now;

    const age = now - lastUpdate;

    let decayFactor = age / DECAY_WINDOW;
    if (decayFactor > 1) decayFactor = 1;

    let decayedScore = rawScore * (1 - decayFactor);

    // 🔥 TEST VISIBILITY BOOST (REMOVE IN PROD)
    if (DECAY_WINDOW <= 5000 && decayFactor > 0.5) {
      decayedScore *= 0.5;
    }

    const finalScore = Number(decayedScore.toFixed(2));
    scoreMap[id] = finalScore;

    if (ENABLE_DEBUG) {
      console.log(
        `⏳ DECAY → ${id}
        raw=${rawScore}
        age=${age}ms
        decay=${decayFactor.toFixed(2)}
        final=${finalScore}`,
      );
    }
  }

  return scoreMap;
}
