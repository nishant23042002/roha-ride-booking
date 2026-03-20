// src/services/driveRanking.js

const TIER_WEIGHT = {
  bronze: 4,
  silver: 3,
  gold: 2,
  platinum: 1,
  diamond: 0
};

export function rankDrivers(driversWithETA) {
  const ranked = driversWithETA.map((entry) => {
    const { driver, etaMinutes } = entry;

    const tierWeight = TIER_WEIGHT[driver.tier] ?? 3;

    const idleMinutes =
      (Date.now() - new Date(driver.lastRideCompleted || Date.now())) /
      (1000 * 60);

    const score =
      etaMinutes * 0.7 + tierWeight * 2 + (1 / (idleMinutes + 1)) * 5;

    return {
      ...entry,
      score,
    };
  });

  ranked.sort((a, b) => a.score - b.score);

  return ranked;
}
