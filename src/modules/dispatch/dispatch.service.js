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

// =====================================================
// 🚀 ENTRY POINT
// =====================================================
export async function startDispatch(rideId) {
  console.log("\n==============================");
  console.log("🚀 DISPATCH STARTED");
  console.log("Ride:", rideId);
  console.log("==============================\n");
  const rideKey = rideId.toString();

  await initDispatch(rideKey);

  const context = {
    attempt: 0,
    lastNotifiedAt: new Map(),
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

    // =====================================================
    // 🔥 MINIMAL DB READ (ONLY RIDE)
    // =====================================================
    const ride = await Ride.findById(rideId);

    if (!ride) {
      console.log("❌ Ride not found → stopping dispatch");
      return;
    }

    if (ride.status !== "requested") {
      console.log(`🛑 Ride already handled → status=${ride.status}`);
      return;
    }

    const MAX_ATTEMPTS = BATCHES.length + 2; // extra retries

    if (context.attempt >= MAX_ATTEMPTS) {
      await cancelRide(ride);
      return;
    }

    const batchSize = BATCHES[Math.min(context.attempt, BATCHES.length - 1)];
    console.log("📦 Batch size:", batchSize);

    // =====================================================
    // 🔍 FIND DRIVERS
    // =====================================================
    const { driverIds } = await findBestDrivers({
      pickupLat: ride.pickupLocation.coordinates[1],
      pickupLng: ride.pickupLocation.coordinates[0],
      rideId: rideId.toString(), // 🔥 CRITICAL FIX
    });

    console.log("📊 Total drivers found:", driverIds.length);

    const io = getIO();
    if (!io) {
      console.log("⚠️ IO not ready → retrying...");
      return setTimeout(() => runDispatch(rideId, context), 2000);
    }

    let sent = 0;

    console.log("🧠 Eligible drivers (before filtering):", driverIds.length);

    // =====================================================
    // 📡 DISPATCH TO DRIVERS
    // =====================================================
    const rideKey = rideId.toString();

    // 🔁 Rotation (refresh every 2 attempts only)
    const rotationMap =
      context.attempt % 2 === 0 ? await getRotation(rideKey) : {};

    // =====================================================
    // 📡 DISPATCH LOOP (REDIS-FIRST, RACE SAFE)
    // =====================================================
    let state = await getDispatch(rideKey);

    for (const driverId of driverIds) {
      // 🔥 ALWAYS re-check Redis state (race safety)
      state = await getDispatch(rideKey);

      if (state.acceptedDriver) {
        console.log(
          "🛑 Dispatch stopped → driver accepted:",
          state.acceptedDriver,
        );
        return;
      }

      // =====================================================
      // ❌ SKIP OFFLINE SOCKET (TEMP - can move to Redis later)
      // =====================================================
      if (!onlineDrivers.has(driverId)) continue;

      // =====================================================
      // 🔄 DRIVER ROTATION (ANTI-SPAM)
      // =====================================================
      const lastRotation = rotationMap[driverId];

      const ROTATION_COOLDOWN = 15000;

      if (lastRotation) {
        if (Date.now() - Number(lastRotation) < ROTATION_COOLDOWN) {
          console.log(`🔄 Rotation skip: ${driverId}`);
          continue;
        }
      }

      // =====================================================
      // ❌ REJECTION LOGIC (2 CHANCES SYSTEM)
      // =====================================================
      const rejectData = state.rejectedDrivers[driverId];

      if (rejectData) {
        let parsed;

        try {
          parsed = JSON.parse(rejectData);
        } catch {
          parsed = null;
        }

        if (parsed) {
          const { time, count } = parsed;

          // ❌ HARD BLOCK AFTER 2 REJECTIONS
          const BLOCK_TIME = 30000; // 30 sec

          if (count >= 2) {
            if (Date.now() - time < BLOCK_TIME) {
              console.log(`🚫 Temp blocked (2 rejects): ${driverId}`);
              continue;
            } else {
              console.log(`♻️ Resetting reject penalty: ${driverId}`);

              // 🔥 CRITICAL FIX → RESET IN REDIS
              const redis = (await import("../../config/redis.js")).default;

              await redis.hSet(
                `dispatch:${rideKey}:rejected`,
                driverId,
                JSON.stringify({
                  count: 0,
                  time: Date.now(),
                }),
              );

              // also update local state
              delete state.rejectedDrivers[driverId];
            }
          }

          // ⏳ SMALL TOWN COOLDOWN (SHORT)
          const COOLDOWN = 8000; // 8 sec

          if (Date.now() - time < COOLDOWN) {
            console.log(`⏳ Cooldown (${count}/2): ${driverId}`);
            continue;
          }
        }
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
        console.log(`🚫 Max notify reached: ${driverId}`);
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
      const socketId = onlineDrivers.get(driverId);
      if (!socketId) continue;

      console.log(`📡 Dispatch → ${driverId}`);

      io.to(socketId).emit("new-ride", {
        ...(ride.toObject ? ride.toObject() : ride),
        dispatchAttempt: context.attempt + 1,
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

    if (!latestRide || latestRide.status !== "requested") {
      console.log("🛑 Not scheduling next retry (ride already handled)");
      return;
    }

    // ====================================================
    // 🔥 SMART DELAY LOGIC
    // =====================================================

    const nextDelay =
      sent === 0
        ? 15000 // no drivers → slow retry
        : RETRY_DELAYS[Math.min(context.attempt, RETRY_DELAYS.length - 1)];

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
