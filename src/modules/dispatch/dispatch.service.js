import Ride from "../../models/Ride.js";
import { findBestDrivers } from "../../services/dispatch/dispatchEngine.js";
import { getIO, onlineDrivers } from "../../socket/index.js";

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

  const context = {
    attempt: 0,
    notifiedDrivers: new Set(),
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
    for (const entry of drivers) {
      const driverId = entry.driver._id.toString();

      // ❌ Skip already notified
      if (context.notifiedDrivers.has(driverId)) {
        console.log("⏭️ Skipping (already notified):", driverId);
        continue;
      }

      // ❌ Skip offline
      if (!onlineDrivers.has(driverId)) {
        console.log("❌ Driver offline:", driverId);
        continue;
      }

      const socketId = onlineDrivers.get(driverId);

      console.log(
        `📡 Sending ride to driver ${driverId} | ETA=${entry.etaMinutes}`,
      );

      io.to(socketId).emit("new-ride", {
        ...(ride.toObject ? ride.toObject() : ride),
        dispatchAttempt: context.attempt + 1,
      });

      context.notifiedDrivers.add(driverId);
      sent++;

      if (sent >= batchSize) break;
    }

    if (sent === 0) {
      console.log("⚠️ No drivers notified in this attempt");
    }

    console.log("✅ Drivers notified this round:", sent);

    context.attempt++;

    console.log(`⏳ Waiting ${RETRY_DELAY / 1000}s before next attempt...`);

    const latestRide = await Ride.findById(rideId);

    if (!latestRide || latestRide.status !== "requested") {
      console.log("🛑 Not scheduling next retry (ride already handled)");
      return;
    }

    setTimeout(() => runDispatch(rideId, context), RETRY_DELAY);
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
