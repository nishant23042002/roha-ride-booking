import { getMetrics } from "../../modules/driverMetrics/driverMetrics.redis.js";

export async function rankDrivers(drivers) {
  const now = Date.now();

  const scoredDrivers = await Promise.all(
    drivers.map(async (d) => {
      try {
        const {
          driver,
          etaMinutes,
          distanceKm,
          rejectionCount = 0,
          rejectionTime = 0,
        } = d;

        // =====================================================
        // 📍 BASE SCORES
        // =====================================================
        const distanceScore = (distanceKm || 0) * 2;
        const etaScore = (etaMinutes || 0) * 3;

        // =====================================================
        // 🔥 REJECTION DECAY
        // =====================================================
        const PENALTY_WINDOW = 60000;

        let effectiveRejects = 0;

        if (rejectionTime) {
          const age = now - rejectionTime;

          if (age < PENALTY_WINDOW) {
            const decayFactor = 1 - age / PENALTY_WINDOW;
            effectiveRejects = rejectionCount * decayFactor;
          }
        }

        if (effectiveRejects > 0 && effectiveRejects < 1) {
          effectiveRejects = 0;
        }

        const rejectionPenalty = effectiveRejects * 1.5;

        // =====================================================
        // 🧠 DRIVER METRICS (SAFE FETCH)
        // =====================================================
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
        } catch {
          // silent fallback
        }

        const acceptRate =
          metrics.totalRequests > 0
            ? metrics.accepts / metrics.totalRequests
            : 1;

        const reliabilityPenalty = (1 - acceptRate) * 5;
        const responsePenalty = metrics.avgResponseTime > 3000 ? 2 : 0;
        const cancelPenalty = metrics.cancels * 2;

        // =====================================================
        // 🕒 FRESHNESS
        // =====================================================
        const lastSeen = new Date(driver.lastHeartbeat).getTime() || now;

        const freshnessMinutes = (now - lastSeen) / (1000 * 60);
        const freshnessPenalty = freshnessMinutes > 1 ? 5 : 0;

        // =====================================================
        // 🎯 FINAL SCORE
        // =====================================================
        const score =
          distanceScore +
          etaScore +
          rejectionPenalty +
          reliabilityPenalty +
          responsePenalty +
          cancelPenalty +
          freshnessPenalty;

        return {
          ...d,
          score,
          effectiveRejects,
          metrics,
        };
      } catch (err) {
        console.log("❌ Ranking error for driver:", d?.driver?._id);

        return {
          ...d,
          score: 9999, // push to bottom
        };
      }
    }),
  );

  // =============================
  // 🧠 DEBUG LOG
  // =============================
  console.log("🐢 SLOW RANKING MODE (fallback)");

  scoredDrivers.forEach((d, i) => {
    const m = d.metrics || {};

    const acceptRate =
      m.totalRequests > 0 ? (m.accepts / m.totalRequests).toFixed(2) : "N/A";

    console.log(`
        #${i + 1} Driver=${d.driver?._id}
        Score=${d.score?.toFixed?.(2)}
        Rejects=${d.rejectionCount}
        AcceptRate=${acceptRate}
        Cancels=${m.cancels || 0}
        Response=${m.avgResponseTime || 0}
        `);
  });

  return scoredDrivers.sort((a, b) => a.score - b.score);
}
