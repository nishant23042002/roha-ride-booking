// /src/modules/dispatch/dispatch.service.js

import Ride from "../../models/Ride.js";
import { addDispatchJob } from "../../queues/dispatch.queue.js";
import { findBestDrivers } from "../../services/dispatch/dispatchEngine.js";
import { getIO, onlineDrivers } from "../../socket/index.js";
import { getDriverState } from "../driverState/driverState.redis.js";
import { createRideState, getRideState } from "../ride/ride.redis.js";
import {
  getDispatch,
  initDispatch,
  markDriverNotified,
} from "./dispatch.redis.js";

// 🧠 Config
const BATCHES = [2, 3, 5, 8]; // more attempts
const DISPATCH_MODE = process.env.DISPATCH_MODE || "CLI";
// =====================================================
// 🚀 ENTRY POINT
// =====================================================
export async function startDispatch(rideId) {
  console.log("\n🚀 START DISPATCH:", rideId);
  console.log("⚙️ MODE:", DISPATCH_MODE);

  const ride = await Ride.findById(rideId);

  if (!ride) {
    console.log("❌ Ride not found in runDispatch");
    return;
  }

  if (!ride || ride.status !== "requested") return;

  await createRideState(ride);
  await initDispatch(rideId.toString());

  const context = { attempt: 0, lastNotifiedAt: {} };

  if (DISPATCH_MODE === "WORKER") {
    console.log("📥 Sending to queue...");
    await addDispatchJob({ rideId, context });
  } else {
    console.log("🧪 Running CLI mode...");
    await runDispatch(rideId, context);
  }
}

// =====================================================
// 🔁 MAIN DISPATCH LOOP
// =====================================================
export async function runDispatch(rideId, context) {
  try {
    const io = getIO();

    console.log("\n------------------------------");
    console.log(`🔁 Dispatch Attempt ${context.attempt + 1}`);
    console.log("------------------------------");

    // ✅ Mongo ONLY for static data (NOT control)
    const ride = await Ride.findById(rideId).select(
      "pickupLocation dropLocation recovery fare customer passengerCount",
    );

    // ✅ Redis is PRIMARY now
    const redisRide = await getRideState(rideId.toString());

    console.log("🧠 [REDIS CONTROL]:", {
      status: redisRide?.status,
      driverId: redisRide?.driverId,
    });

    if (!redisRide) {
      console.log("⚠️ Redis missing ride → fallback to Mongo");

      const fallbackRide = await Ride.findById(rideId);

      if (!fallbackRide || fallbackRide.status !== "requested") {
        console.log("🛑 Fallback Mongo stop:", fallbackRide?.status);
        return;
      }
    } else if (redisRide.status !== "SEARCHING") {
      console.log("🛑 Redis says stop dispatch:", redisRide.status);
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
    const { drivers } = await findBestDrivers({
      pickupLat: ride.pickupLocation.coordinates[1],
      pickupLng: ride.pickupLocation.coordinates[0],
      rideId: rideId.toString(),
    });

    const driverIds = drivers.map((d) => d.id);

    console.log("🚗 Found drivers:", driverIds);
    console.log("📊 Ranked drivers:", drivers);

    console.log("🚗 Found drivers:", driverIds);

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

    const eligibleDrivers = [];

    for (const driverId of driverIds) {
      console.log("\n🔍 Checking driver:", driverId);

      const driverState = await getDriverState(driverId);

      if (driverState !== "searching" && !isRecovery) {
        console.log("❌ Skip (not available in Redis):", driverId);
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
      let socketId = null;

      if (DISPATCH_MODE === "CLI") {
        socketId = onlineDrivers.get(driverId);

        if (!socketId && !isRecovery) {
          console.log("❌ Skip (no socket - CLI only):", driverId);
          continue;
        }
      }

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

      if (DISPATCH_MODE === "CLI" && io && socketId) {
        io.to(socketId).emit("new-ride", {
          ...(ride.toObject ? ride.toObject() : ride),
          dispatchAttempt: context.attempt + 1,
          isRecovery,
        });
      } else if (DISPATCH_MODE === "WORKER") {
        console.log("📨 Worker selected driver (no socket emit):", driverId);
      }

      await markDriverNotified(rideKey, driverId);

      context.lastNotifiedAt[driverId] = Date.now();

      sent++;
      if (sent >= batchSize) break;
    }

    console.log("✅ Drivers notified:", sent);

    const latestRedisRide = await getRideState(rideId.toString());

    if (!latestRedisRide || latestRedisRide.status !== "SEARCHING") {
      console.log("🛑 Stop dispatch (Redis):", latestRedisRide?.status);
      return;
    }

    context.attempt++;

    if (DISPATCH_MODE === "WORKER") {
      console.log("🔁 Requeueing job...");
      await addDispatchJob({ rideId, context });
    } else {
      console.log("🔁 CLI retry...");
      setTimeout(() => {
        runDispatch(rideId, context);
      }, 8000);
    }

    if (DISPATCH_MODE === "WORKER") {
      console.log("🔁 Job requeued (WORKER)");
    } else {
      console.log("🔁 Retry scheduled (CLI)");
    }
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
