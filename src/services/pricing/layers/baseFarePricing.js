import { vehicleRules } from "../../../config/vehicleRules.js";

export function applyBaseFare(ctx) {
  const rule = vehicleRules[ctx.vehicleType];

  if (!rule) {
    throw new Error("Unsupported vehicle type");
  }

  const distance = ctx.distanceKm;

  let fare;

  switch (ctx.vehicleType) {
    case "auto":
      fare = autoFare(distance);
      break;

    case "bike":
      fare = bikeFare(distance);
      break;

    case "minidoor":
      fare = minidoorFare(distance);
      break;

    default:
      throw new Error("Vehicle not configured");
  }

  ctx.baseFare = fare;
  ctx.fare = fare;
}

function autoFare(distanceKm) {
  const BASE = 26;
  const LIMIT = 1.5;
  const PER_KM = 17.14;

  if (distanceKm <= LIMIT) {
    return BASE;
  }

  return BASE + (distanceKm - LIMIT) * PER_KM;
}

function bikeFare(distanceKm) {
  const BASE = 20;
  const PER_KM = 8;

  return BASE + distanceKm * PER_KM;
}

function minidoorFare(distanceKm) {
  const MIN_DISTANCE = 2;
  const MIN_FARE = 30;
  const PER_KM_RATE = 16;

  if (distanceKm <= MIN_DISTANCE) {
    return MIN_FARE;
  }

  return MIN_FARE + (distanceKm - MIN_DISTANCE) * PER_KM_RATE;
}
