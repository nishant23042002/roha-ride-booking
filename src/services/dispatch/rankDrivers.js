// src/services/driveRanking.js

export function rankDrivers(drivers) {
  return drivers
    .map((d) => {
      const {
        driver,
        etaMinutes,
        distanceKm,
        rejectionCount = 0,
        rejectionTime = 0, // 👈 ADD THIS FROM DISPATCH DATA
      } = d;

      // =====================================================
      // 🧠 SMALL TOWN WEIGHTS
      // =====================================================
      const distanceScore = distanceKm * 2;
      const etaScore = etaMinutes * 3;

      // =====================================================
      // 🔥 REJECTION DECAY LOGIC (IMPORTANT)
      // =====================================================
      const PENALTY_WINDOW = 60000; // 60 sec

      let effectiveRejects = 0;

      if (rejectionTime) {
        const age = Date.now() - rejectionTime;

        // 🔥 gradual decay instead of hard cut
        if (age < PENALTY_WINDOW) {
          const decayFactor = 1 - age / PENALTY_WINDOW;
          effectiveRejects = rejectionCount * decayFactor;
        }
      }
      if (effectiveRejects > 0 && effectiveRejects < 1) {
        // ignore tiny penalty (noise)
        effectiveRejects = 0;
      }

      const rejectionPenalty = effectiveRejects * 1.5;

      // =====================================================
      // 🕒 FRESHNESS
      // =====================================================
      const lastSeen = new Date(driver.lastHeartbeat).getTime() || Date.now();

      const freshnessMinutes = (Date.now() - lastSeen) / (1000 * 60);

      const freshnessPenalty = freshnessMinutes > 1 ? 5 : 0;

      // =====================================================
      // 🎯 FINAL SCORE
      // =====================================================
      const score =
        distanceScore + etaScore + rejectionPenalty + freshnessPenalty;

      return {
        ...d,
        score,
        effectiveRejects,
      };
    })
    .sort((a, b) => a.score - b.score);
}
