import { getMetrics } from "../../modules/driverMetrics/driverMetrics.redis.js";

export async function rankDrivers(drivers) {
  const now = Date.now();

  const scoredDrivers = await Promise.all(
    drivers.map(async (d) => {
      try {
        const { driver, etaMinutes, distanceKm } = d;

        // =============================
        // 📍 BASE SCORES
        // =============================
        const distanceScore = (distanceKm || 0) * 2;
        const etaScore = (etaMinutes || 0) * 3;

        // =============================
        // 🧠 DRIVER METRICS
        // =============================
        let metrics = {
          accepts: 0,
          rejects: 0,
          cancels: 0,
          totalRequests: 0,
          avgResponseTime: 0,
        };

        try {
          const m = await getMetrics(driver._id.toString());
          if (m) metrics = m;
        } catch {}

        const acceptRate =
          metrics.totalRequests > 0
            ? metrics.accepts / metrics.totalRequests
            : 1;

        const reliabilityPenalty = (1 - acceptRate) * 5;
        const responsePenalty = metrics.avgResponseTime > 3000 ? 2 : 0;
        const cancelPenalty = metrics.cancels * 2;

        // =============================
        // 🕒 FRESHNESS
        // =============================
        const lastSeen = new Date(driver.lastHeartbeat).getTime() || now;
        const freshnessMinutes = (now - lastSeen) / (1000 * 60);
        const freshnessPenalty = freshnessMinutes > 1 ? 5 : 0;

        // =============================
        // 🎯 FINAL SCORE
        // =============================
        const score =
          distanceScore +
          etaScore +
          reliabilityPenalty +
          responsePenalty +
          cancelPenalty +
          freshnessPenalty;

        return {
          ...d,
          score,
          metrics,
        };
      } catch (err) {
        console.log("❌ Ranking error for driver:", d?.driver?._id);

        return {
          ...d,
          score: 9999,
        };
      }
    }),
  );

  console.log("⚡ RANKING COMPLETE");

  return scoredDrivers.sort((a, b) => a.score - b.score);
}
