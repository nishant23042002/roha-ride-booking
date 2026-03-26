// /src/modules/dispatch/dispatch.service.js

import Ride from "../../models/Ride.js";
import { findBestDrivers } from "../../services/dispatch/dispatchEngine.js";
import { getIO, onlineDrivers } from "../../socket/index.js";
import { isDriverLocked } from "../lock/lock.redis.js";
import {
  getDispatch,
  getRotation,
  initDispatch,
  markDriverNotified,
} from "./dispatch.redis.js";

// 🧠 Config
const BATCHES = [2, 3, 5, 8]; // more attempts
const RETRY_DELAYS = [8000, 12000, 15000, 20000];
const activeDispatches = new Set();
const dispatchTimers = new Map();

function scheduleNextDispatch(rideId, context, delay) {
  const timer = setTimeout(() => {
    dispatchTimers.delete(rideId);
    runDispatch(rideId, context);
  }, delay);

  dispatchTimers.set(rideId, timer);
}

// =====================================================
// 🚀 ENTRY POINT
// =====================================================
export async function startDispatch(rideId) {
  if (activeDispatches.has(rideId)) {
    console.log("⚠️ Dispatch already running → skipping duplicate start");
    return;
  }

  activeDispatches.add(rideId);
  console.log("🧠 ACTIVE DISPATCHES:", [...activeDispatches.keys()]);

  console.log("\n==============================");
  console.log("🚀 DISPATCH STARTED");
  console.log("Ride:", rideId);
  console.log("==============================\n");

  try {
    const ride = await Ride.findById(rideId);

    if (ride.status !== "requested") {
      console.log("🛑 Ride already handled → stopping dispatch");
      activeDispatches.delete(rideId);
      return;
    }

    if (ride && ["completed", "cancelled"].includes(ride.status)) {
      console.log("🧹 Clearing stale recovery flag");
      ride.recovery = null;
      await ride.save();
    }

    if (ride.recovery) {
      console.log("🧠 Starting dispatch in recovery mode");
    }

    const rideKey = rideId.toString();

    await initDispatch(rideKey);

    const context = {
      attempt: 0,
      lastNotifiedAt: new Map(),
      rejectedCache: new Set(), // 🔥 ADD THIS
    };

    await runDispatch(rideId, context);
  } catch (error) {
    console.log("Dispatch error: ", error.message);
  }
}

// =====================================================
// 🔁 MAIN DISPATCH LOOP
// =====================================================
async function runDispatch(rideId, context) {
  if (!activeDispatches.has(rideId)) {
    console.log("🛑 Dispatch not active → skipping");
    return;
  }

  try {
    console.log("\n------------------------------");
    console.log(`🔁 Dispatch Attempt ${context.attempt + 1}`);
    console.log("------------------------------");

    const ride = await Ride.findById(rideId);

    if (!ride) return;
    if (ride.status !== "requested") {
      console.log("🛑 Dispatch stopped:", ride.status);
      return;
    }

    const isRecovery = !!ride.recovery;
    const maxAttempts = isRecovery ? 2 : BATCHES.length + 2;

    if (context.attempt >= maxAttempts) {
      return cancelRide(ride);
    }

    let batchSize = BATCHES[Math.min(context.attempt, BATCHES.length - 1)];
    if (isRecovery) batchSize = Math.max(batchSize, 5);

    console.log("📦 Batch size:", batchSize);

    // =============================
    // 🚀 FIND DRIVERS
    // =============================
    const { driverIds } = await findBestDrivers({
      pickupLat: ride.pickupLocation.coordinates[1],
      pickupLng: ride.pickupLocation.coordinates[0],
      rideId: rideId.toString(),
    });

    console.log("🚗 Found drivers:", driverIds);

    const io = getIO();
    if (!io) return;

    const rideKey = rideId.toString();

    // =============================
    // 🔥 FETCH STATE (DOUBLE READ)
    // =============================
    let state = await getDispatch(rideKey);

    if (!state) {
      console.log("⚠️ State null → retrying...");
      await new Promise((r) => setTimeout(r, 50));
      state = await getDispatch(rideKey);
    }

    console.log("🧠 REDIS STATE (initial):", state);

    // =============================
    // 🔥 BUILD REJECTED MAP
    // =============================
    const rejectedMap = state?.rejectedDrivers || {};

    const eligibleDrivers = [];

    for (const driverId of driverIds) {
      console.log("\n🔍 Checking driver:", driverId);

      const socketId = onlineDrivers.get(driverId);

      if (!socketId && !isRecovery) {
        console.log("❌ Skip (offline)");
        continue;
      }

      // ✅ HARD REJECT BLOCK
      if (state?.rejectedDrivers?.[driverId]) {
        console.log("🚫 BLOCKED (REJECTED):", driverId);
        continue;
      }

      // ✅ NO DUPLICATE NOTIFY
      if (state?.notifiedDrivers?.[driverId]) {
        console.log("⛔ SKIP (ALREADY NOTIFIED):", driverId);
        continue;
      }

      eligibleDrivers.push(driverId);
    }
    console.log("🧠 Eligible drivers FINAL:", eligibleDrivers);

    if (!eligibleDrivers.length) {
      console.log("🛑 Immediate cancel → no drivers available");
      return cancelRide(ride);
    }

    let sent = 0;

    for (const driverId of eligibleDrivers) {
      const socketId = onlineDrivers.get(driverId);
      if (!socketId) continue;

      // =============================
      // 🔥 FINAL SAFETY CHECK (CRITICAL FIX)
      // =============================
      const latestState = await getDispatch(rideKey);
      const latestReject = latestState?.rejectedDrivers?.[driverId];

      if (latestReject) {
        console.log("🛑 FINAL BLOCK (REJECTED):", driverId);
        continue;
      }

      console.log("📡 Dispatch →", driverId);

      io.to(socketId).emit("new-ride", {
        ...(ride.toObject ? ride.toObject() : ride),
        dispatchAttempt: context.attempt + 1,
        isRecovery,
      });

      await markDriverNotified(rideKey, driverId);

      context.lastNotifiedAt.set(driverId, Date.now());

      sent++;
      if (sent >= batchSize) break;
    }

    console.log("✅ Drivers notified:", sent);

    context.attempt++;

    const latestRide = await Ride.findById(rideId);
    if (!latestRide || latestRide.status !== "requested") return;

    const nextDelay =
      sent === 0
        ? 10000
        : RETRY_DELAYS[Math.min(context.attempt, RETRY_DELAYS.length - 1)];

    console.log(`⏳ Next retry in ${nextDelay / 1000}s`);

    scheduleNextDispatch(rideId, context, nextDelay);
  } catch (err) {
    console.log("❌ DISPATCH LOOP ERROR:", err.message);
  }
}
// =====================================================
// ❌ CANCEL RIDE
// =====================================================
async function cancelRide(ride) {
  try {
    console.log("\n==============================");
    console.log("⚠️ INITIATING SMART CANCEL FLOW");
    console.log("==============================");

    // =====================================================
    // 1️⃣ FINAL SAFETY CHECK
    // =====================================================
    const freshRide = await Ride.findById(ride._id);

    if (!freshRide || freshRide.status !== "requested") {
      console.log("🛑 Cancel aborted → ride already handled");
      return;
    }

    // =====================================================
    // 2️⃣ GRACE PERIOD (LAST CHANCE)
    // =====================================================
    console.log("⏳ Giving final 5s grace before cancel...");
    await new Promise((res) => setTimeout(res, 5000));

    const recheckRide = await Ride.findById(ride._id);

    if (!recheckRide || recheckRide.status !== "requested") {
      console.log("🛑 Ride accepted during grace → abort cancel");
      return;
    }

    // =====================================================
    // 3️⃣ UPDATE DB (FINAL STATE)
    // =====================================================
    recheckRide.status = "cancelled";
    recheckRide.cancelledBy = "system";
    recheckRide.cancelReason = "No drivers available nearby";

    await recheckRide.save();

    console.log("❌ Ride marked as CANCELLED");
    // 🔥 STOP ANY FUTURE DISPATCH LOOPS
    const timer = dispatchTimers.get(ride._id.toString());

    if (timer) {
      clearTimeout(timer);
      dispatchTimers.delete(ride._id.toString());
      console.log("🛑 Dispatch timer cleared");
    }

    // =====================================================
    // 4️⃣ CLEAR REDIS DISPATCH
    // =====================================================
    const { clearDispatch } = await import("./dispatch.redis.js");

    await clearDispatch(ride._id.toString()).catch(() => {});

    console.log("🧹 Redis dispatch cleared");

    // =====================================================
    // 5️⃣ NOTIFY CUSTOMER
    // =====================================================
    const { getIO, onlineCustomers } = await import("../../socket/index.js");

    const io = getIO();

    if (io) {
      const customerSocket = onlineCustomers.get(
        recheckRide.customer.toString(),
      );

      if (customerSocket) {
        io.to(customerSocket).emit("ride-cancelled", {
          rideId: recheckRide._id,
          reason: "No drivers available nearby",
          retry: true,
          retryAfter: 10, // 🔥 UX improvement
        });

        console.log("📡 Customer notified");
      }
    }

    console.log("📊 CANCEL LOG:", {
      rideId: recheckRide._id.toString(),
      time: new Date().toISOString(),
    });

    // =====================================================
    // 6️⃣ OPTIONAL: RETRY SUGGESTION LOGIC
    // =====================================================
    console.log("💡 Suggesting retry to user (small-town logic)");

    // =====================================================
    // 7️⃣ LOGGING (IMPORTANT FOR ANALYTICS)
    // =====================================================
    console.log("📊 CANCEL SUMMARY:", {
      rideId: recheckRide._id.toString(),
      reason: recheckRide.cancelReason,
      time: new Date().toISOString(),
    });
    activeDispatches.delete(ride._id.toString());
    console.log("\n==============================");
    console.log("🚦 DISPATCH ENDED (CANCELLED)");
    console.log("==============================\n");
  } catch (err) {
    console.log("❌ CANCEL ERROR:", err.message);
  }
}
