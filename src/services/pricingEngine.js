// /src/services/pricingEnging.js

import { calculateDistance } from "../utils/distance.js";
import { vehicleRules } from "../config/vehicleRules.js";

const ROAD_MULTIPLIER = 1.3;

// Surge guardrails
const MAX_SURGE = 2.5;
const MIN_SURGE = 1;

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

  const hour = requestTime.getHours();
  const isNight = hour >= 0 && hour < 5;

  let baseFare;

  switch (vehicleType) {
    case "auto":
      baseFare = autoFare(roadDistance, isNight);
      break;

    case "bike":
      baseFare = bikeFare(roadDistance);
      break;

    case "cab":
    case "taxi":
    case "car":
    case "suv":
      baseFare = cabFare(roadDistance);
      break;

    case "shared_auto":
      baseFare = autoFare(roadDistance, isNight);
      break;

    case "shared_cab":
      baseFare = cabFare(roadDistance);
      break;

    default:
      throw new Error("Vehicle not configured");
  }

  let passengerAdjustedFare = baseFare;

  if (rideType === "shared") {
    passengerAdjustedFare = baseFare * passengerCount;
  }

  // 2️⃣ Safe Surge Application
  const safeMultiplier = Math.min(
    Math.max(demandMultiplier, MIN_SURGE),
    MAX_SURGE,
  );

  const finalFare = passengerAdjustedFare * safeMultiplier;

  return {
    finalFare: Number(finalFare.toFixed(2)),
    distanceKm: Number(roadDistance.toFixed(2)),
    isNight,
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

  return fare;
}

function bikeFare(distanceKm) {
  const BASE = 20;
  const PER_KM = 8;

  return BASE + distanceKm * PER_KM;
}

function cabFare(distanceKm) {
  const BASE = 50;
  const PER_KM = 15;

  return BASE + distanceKm * PER_KM;
}
