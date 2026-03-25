// /src/modules/dispatch/dispatch.service.js

import Ride from "../../models/Ride.js";
import { findBestDrivers } from "../../services/dispatch/dispatchEngine.js";
import { getIO, onlineDrivers } from "../../socket/index.js";
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
    };

    await runDispatch(rideId, context);
  } catch (error) {
    console.log("Dispatch error: ", error.message);
  } finally {
    activeDispatches.delete(rideId);
  }
}

// =====================================================
// 🔁 MAIN DISPATCH LOOP
// =====================================================
async function runDispatch(rideId, context) {
  try {
    console.log("\n------------------------------");
    console.log(`🔁 Dispatch Attempt ${context.attempt + 1}`);
    console.log("------------------------------");

    // =====================================================
    // 🔥 MINIMAL DB READ (ONLY RIDE)
    // =====================================================
    const ride = await Ride.findById(rideId);

    if (!ride) {
      console.log("❌ Ride not found → stopping dispatch");
      return;
    }

    // ✅ ONLY THIS MATTERS
    if (ride.status !== "requested") {
      console.log("🛑 Dispatch stopped → ride already handled:", ride.status);
      return;
    }

    // =============================
    // 🧠 RECOVERY MODE
    // =============================
    const isRecovery = !!ride.recovery;
    const recoveryAttempts = ride.recovery?.attempts || 0;

    if (isRecovery) {
      console.log("🧠 RECOVERY MODE (attempt:", recoveryAttempts, ")");
    }

    // =============================
    // LIMIT ATTEMPTS
    // =============================
    let maxAttempts = BATCHES.length + 2;

    if (isRecovery) {
      maxAttempts = 2; // fast failure
    }

    if (context.attempt >= maxAttempts) {
      return cancelRide(ride);
    }

    // =============================
    // BATCH SIZE
    // =============================
    let batchSize = BATCHES[Math.min(context.attempt, BATCHES.length - 1)];

    if (isRecovery) {
      batchSize = Math.max(batchSize, 5);
    }

    // ✅ RECOVERY MODE → AGGRESSIVE BROADCAST
    if (ride.recovery) {
      batchSize = Math.max(batchSize, 5);
    }

    console.log("📦 Batch size:", batchSize);

    // =====================================================
    // 🔍 FIND DRIVERS
    // =====================================================
    const { driverIds } = await findBestDrivers({
      pickupLat: ride.pickupLocation.coordinates[1],
      pickupLng: ride.pickupLocation.coordinates[0],
      rideId: rideId.toString(), // 🔥 CRITICAL FIX
    });

    if (!driverIds.length) {
      console.log("❌ No drivers found");
    }

    console.log("📊 Total drivers found:", driverIds.length);
    console.log("📡 Dispatch Context:", {
      rideId,
      isRecovery,
    });

    const io = getIO();
    if (!io) {
      console.log("⚠️ IO not ready → retrying...");
      return setTimeout(() => runDispatch(rideId, context), 2000);
    }

    const rideKey = rideId.toString();

    // 🔁 Rotation (refresh every 2 attempts only)
    const rotationMap =
      context.attempt % 2 === 0 ? await getRotation(rideKey) : {};

    console.log("🧠 Eligible drivers (before filtering):", driverIds.length);

    // =====================================================
    // 📡 DISPATCH LOOP (REDIS-FIRST, RACE SAFE)
    // =====================================================
    let state = await getDispatch(rideKey);
    let sent = 0;

    for (const driverId of driverIds) {
      // 🔥 ALWAYS re-check Redis state (race safety)
      state = await getDispatch(rideKey);

      // =============================
      // SKIP OFFLINE
      // =============================
      const socketId = onlineDrivers.get(driverId);

      // skip only if NO socket AND NOT recovery
      if (!socketId && !isRecovery) continue;

      // =============================
      // ❌ PREVENT SAME DRIVER AFTER RECOVERY
      // =============================
      const originalDriverId = ride.recovery?.originalDriverId;

      if (isRecovery && driverId === originalDriverId) {
        continue;
      }

      // =============================
      // ROTATION
      // =============================
      const lastRotation = rotationMap[driverId];
      if (lastRotation && Date.now() - Number(lastRotation) < 15000) {
        continue;
      }

      // =============================
      // REJECTION LOGIC
      // =============================
      const rejectData = state.rejectedDrivers[driverId];

      if (rejectData) {
        try {
          const { time, count } = JSON.parse(rejectData);

          if (count >= 2 && Date.now() - time < 30000) continue;
          if (Date.now() - time < 8000) continue;
        } catch {}
      }

      // =====================================================
      // ⏳ NOTIFY COOLDOWN (ANTI-SPAM)
      // =====================================================
      const lastTime = context.lastNotifiedAt.get(driverId);

      if (lastTime && Date.now() - lastTime < 8000) {
        console.log("⏳ Notify cooldown:", driverId);
        continue;
      }

      const notifiedCount = parseInt(state.notifiedDrivers?.[driverId] || "0");

      // 🚫 HARD LIMIT (ANTI-SPAM)
      if (notifiedCount >= 2) {
        console.log(`⚠️ Skip (notify limit this round): ${driverId}`);
        continue;
      }

      if (notifiedCount > 0 && lastRotation) {
        const timeGap = Date.now() - Number(lastRotation);

        if (timeGap < 8000) {
          console.log(`🔄 Smart rotation skip: ${driverId}`);
          continue;
        }
      }

      // =====================================================
      // 📡 SEND RIDE REQUEST
      // =====================================================
      console.log(`📡 Dispatch → ${driverId}`);

      if (!socketId) {
        console.log(`⚠️ Driver ${driverId} offline → skipping emit`);
        continue;
      }

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

    if (sent === 0) {
      console.log("⚠️ No drivers notified in this attempt");
    }

    console.log("✅ Drivers notified this round:", sent);

    context.attempt++;

    // =====================================================
    // 🔄 CHECK AGAIN BEFORE NEXT RETRY
    // =====================================================
    const latestRide = await Ride.findById(rideId);

    if (!latestRide) return;

    if (latestRide.status !== "requested") {
      console.log("🛑 Not scheduling next retry (ride already handled)");
      return;
    }

    // ====================================================
    // 🔥 SMART DELAY LOGIC
    // =====================================================

    let nextDelay =
      sent === 0
        ? 15000
        : RETRY_DELAYS[Math.min(context.attempt, RETRY_DELAYS.length - 1)];

    // ✅ RECOVERY MODE → FASTER RETRY
    if (isRecovery) {
      nextDelay = 5000;
    }
    console.log(`⏳ Next retry in ${nextDelay / 1000}s`);

    setTimeout(() => {
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

    console.log("\n==============================");
    console.log("🚦 DISPATCH ENDED (CANCELLED)");
    console.log("==============================\n");
  } catch (err) {
    console.log("❌ CANCEL ERROR:", err.message);
  }
}
