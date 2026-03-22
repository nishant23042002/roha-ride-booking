// /src/modules/dispatch/dispatch.service.js

import Ride from "../../models/Ride.js";
import { findBestDrivers } from "../../services/dispatch/dispatchEngine.js";
import { getIO, onlineDrivers } from "../../socket/index.js";
import { dispatchState } from "./dispatch.store.js";

// 🧠 Config
const BATCHES = [3, 5, 8];
const RETRY_DELAY = 10000; // 10 sec

// =====================================================
// 🚀 ENTRY POINT
// =====================================================
export async function startDispatch(rideId) {
  console.log("\n==============================");
  console.log("🚀 DISPATCH STARTED");
  console.log("Ride:", rideId);
  console.log("==============================\n");
  const rideKey = rideId.toString();

  dispatchState.init(rideKey);

  const context = {
    attempt: 0,
    notifiedDrivers: new Set(),
    lastNotifiedAt: new Map(),
    lastEventAt: Date.now(), // 🔥 ADD THIS
  };

  await runDispatch(rideId, context);
}

// =====================================================
// 🔁 MAIN DISPATCH LOOP
// =====================================================
async function runDispatch(rideId, context) {
  try {
    console.log("\n------------------------------");
    console.log(`🔁 Dispatch Attempt ${context.attempt + 1}`);
    console.log("------------------------------");

    const ride = await Ride.findById(rideId);

    if (!ride) {
      console.log("❌ Ride not found → stopping dispatch");
      return;
    }

    if (ride.status !== "requested") {
      console.log(`🛑 Ride already handled → status=${ride.status}`);
      return;
    }

    if (context.attempt >= BATCHES.length) {
      console.log("❌ Max attempts reached → cancelling ride");
      await cancelRide(ride);
      return;
    }

    const batchSize = BATCHES[context.attempt];

    console.log("📦 Batch size:", batchSize);

    // =====================================================
    // 🔍 FIND DRIVERS
    // =====================================================
    const { drivers } = await findBestDrivers({
      pickupLat: ride.pickupLocation.coordinates[1],
      pickupLng: ride.pickupLocation.coordinates[0],
      vehicleType: ride.vehicleType,
      passengerCount: ride.passengerCount,
      heartbeatLimit: 30000,
    });

    console.log("📊 Total drivers found:", drivers.length);

    const io = getIO();

    let sent = 0;

    console.log("🧠 Eligible drivers (before filtering):", drivers.length);

    // =====================================================
    // 📡 DISPATCH TO DRIVERS
    // =====================================================
    const rideKey = rideId.toString();
    const state = dispatchState.get(rideKey);

    if (state?.acceptedDriver) {
      console.log(
        "🛑 Dispatch stopped → driver accepted:",
        state.acceptedDriver,
      );
      return;
    }

    for (const entry of drivers) {
      const driverId = entry.driver._id.toString();

      const latestState = dispatchState.get(rideKey);

      // 🔥 Always re-check latest rejection state
      const lastRejected = latestState?.rejectedDrivers?.get?.(driverId);
      const REJECTION_COOLDOWN = 20000;

      if (lastRejected && Date.now() - lastRejected < REJECTION_COOLDOWN) {
        console.log("⏳ Recently rejected (cooldown):", driverId);
        continue;
      }

      // 🔥 Notify cooldown
      const lastTime = context.lastNotifiedAt.get(driverId);
      if (lastTime && Date.now() - lastTime < 8000) {
        console.log("⏳ Notify cooldown:", driverId);
        continue;
      }

      if (!onlineDrivers.has(driverId)) continue;

      const socketId = onlineDrivers.get(driverId);

      console.log(`📡 Smart Dispatch → ${driverId}`);

      io.to(socketId).emit("new-ride", {
        ...(ride.toObject ? ride.toObject() : ride),
        dispatchAttempt: context.attempt + 1,
      });

      context.lastNotifiedAt.set(driverId, Date.now());

      sent++;

      if (sent >= batchSize) break;
    }

    if (sent === 0) {
      console.log("⚠️ No drivers notified in this attempt");
    }

    console.log("✅ Drivers notified this round:", sent);

    context.attempt++;

    const latestRide = await Ride.findById(rideId);

    if (!latestRide || latestRide.status !== "requested") {
      console.log("🛑 Not scheduling next retry (ride already handled)");
      return;
    }

    const latestState = dispatchState.get(rideKey);

    // 🔥 If all drivers are in cooldown, delay retry more
    const hasActiveDriver = drivers.some((entry) => {
      const driverId = entry.driver._id.toString();
      const lastRejected = latestState?.rejectedDrivers?.get(driverId);

      if (!lastRejected) return true;

      return Date.now() - lastRejected > 20000;
    });

    const nextDelay = hasActiveDriver ? RETRY_DELAY : 15000;

    console.log(`⏳ Next retry in ${nextDelay / 1000}s`);

    const scheduledAt = Date.now();

    setTimeout(async () => {
      const latestState = dispatchState.get(rideKey);

      // 🔥 If new event happened → restart immediately
      if (latestState?.lastEventAt && latestState.lastEventAt > scheduledAt) {
        console.log(
          "⚡ Dispatch interrupted by new event → restarting immediately",
        );
        return runDispatch(rideId, context);
      }

      runDispatch(rideId, context);
    }, nextDelay);
  } catch (err) {
    console.log("❌ DISPATCH LOOP ERROR:", err.message);
  }
}

// =====================================================
// ❌ CANCEL RIDE
// =====================================================
async function cancelRide(ride) {
  try {
    ride.status = "cancelled";
    ride.cancelledBy = "system";
    ride.cancelReason = "No drivers accepted";

    await ride.save();

    console.log("❌ Ride cancelled due to no drivers");
  } catch (err) {
    console.log("❌ CANCEL ERROR:", err.message);
  }
}
