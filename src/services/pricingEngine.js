// /src/services/pricingEnging.js

import { calculateDistance } from "../utils/distance.js";
import { vehicleRules } from "../config/vehicleRules.js";

const ROAD_MULTIPLIER = 1.3;

// Surge guardrails
const MAX_SURGE = 2;
const MIN_SURGE = 1;

// 🔵 Unified Night Window (10 PM – 5 AM)
function isNightTime(date) {
  if (!date) return false;
  const hour = date.getHours();
  return hour >= 22 || hour < 5;
}

export function calculateFare({
  vehicleType,
  pickupLat,
  pickupLon,
  dropLat,
  dropLon,
  requestTime = new Date(),
  demandMultiplier = 1,
  passengerCount = 1,
  rideType = "private",
  rideStartTime,
}) {
  //Validate vehicle rules
  const rule = vehicleRules[vehicleType];
  if (!rule) {
    throw new Error("Unsupported vehicle type");
  }

  if (passengerCount < 1 || passengerCount > rule.maxPassengers) {
    throw new Error(
      `Passenger count exceeds legal capacity for ${vehicleType}`,
    );
  }

  if (!["private", "shared"].includes(rideType)) {
    throw new Error("Invalid ride type");
  }

  // 1️⃣ Single Source Distance
  const straightDistance = calculateDistance(
    pickupLat,
    pickupLon,
    dropLat,
    dropLon,
  );

  const roadDistance = straightDistance * ROAD_MULTIPLIER;

  const night = isNightTime(rideStartTime || requestTime);

  let baseFare;

  switch (vehicleType) {
    case "auto":
      baseFare = autoFare(roadDistance, night);
      break;

    case "bike":
      baseFare = bikeFare(roadDistance);
      break;

    case "minidoor":
      baseFare = minidoorFare({
        distanceKm: roadDistance,
        isNight: night,
      });
      break;

    case "cab":
    case "taxi":
    case "car":
    case "suv":
      baseFare = cabFare(roadDistance);
      break;

    case "shared_auto":
      baseFare = autoFare(roadDistance);
      break;

    case "shared_cab":
      baseFare = cabFare(roadDistance);
      break;

    default:
      throw new Error("Vehicle not configured");
  }

  let passengerAdjustedFare = baseFare;

  if (rule.pricingMode === "perSeat") {
    passengerAdjustedFare = baseFare * passengerCount;
  }

  // 2️⃣ Safe Surge Application
  const safeMultiplier = Math.min(
    Math.max(demandMultiplier, MIN_SURGE),
    MAX_SURGE,
  );

  const finalFare = passengerAdjustedFare * safeMultiplier;

  if (!Number.isFinite(finalFare)) {
    throw new Error("Invalid fare calculation");
  }

  return {
    finalFare: Number(finalFare.toFixed(2)),
    distanceKm: Number(roadDistance.toFixed(2)),
    isNight: night,
    appliedSurge: safeMultiplier,
  };
}

// ---------------- VEHICLE RULES ----------------

function autoFare(distanceKm, isNight) {
  const BASE = 26;
  const LIMIT = 1.5;
  const PER_KM = 17.14;

  let fare;

  if (distanceKm <= LIMIT) {
    fare = BASE;
  } else {
    fare = BASE + (distanceKm - LIMIT) * PER_KM;
  }

  if (isNight) fare *= 1.25;

  return Number(fare.toFixed(2));
}

function bikeFare(distanceKm) {
  const BASE = 20;
  const PER_KM = 8;

  return BASE + distanceKm * PER_KM;
}

function minidoorFare({
  distanceKm,
  isNight, // must pass actual rideStartTime
}) {
  const MIN_DISTANCE = 2; // km
  const MIN_FARE = 30; // per seat (first 2 km)
  const PER_KM_RATE = 16; // per km beyond 2 km

  let fare;

  if (distanceKm <= MIN_DISTANCE) {
    fare = MIN_FARE;
  } else {
    const extraDistance = distanceKm - MIN_DISTANCE;
    fare = MIN_FARE + extraDistance * PER_KM_RATE;
  }

  if (isNight) {
    fare *= 1.5; // 50% minidoor night
  }

  return Number(fare.toFixed(2));
}

function cabFare(distanceKm) {
  const BASE = 50;
  const PER_KM = 15;

  return BASE + distanceKm * PER_KM;
}
