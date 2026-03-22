import Ride from "../../models/Ride.js";
import Driver from "../../models/Driver.js";
import mongoose from "mongoose";
import { changeDriverState } from "../driver/driverState.service.js";
import { rideLog, banner } from "../../utils/rideLogger.js";
import {
  addRejected,
  clearDispatch,
} from "../../modules/dispatch/dispatch.redis.js";

export async function cancelRideByDriverService({ rideId, driverId, reason }) {
  const session = await mongoose.startSession();

  try {
    session.startTransaction();

    const ride = await Ride.findById(rideId).session(session);
    if (!ride) throw new Error("Ride not found");

    // ✅ idempotent
    if (ride.status === "cancelled") return ride;

    const driver = await Driver.findById(driverId).session(session);
    if (!driver) throw new Error("Driver not found");

    // =============================
    // 🔥 CASE 1: REQUESTED → SOFT CANCEL (REJECT)
    // =============================
    if (ride.status === "requested") {
      ride.driver = null;

      // optional tracking
      const rejectedSet = new Set(ride.rejectedDrivers || []);
      rejectedSet.add(driverId);
      ride.rejectedDrivers = [...rejectedSet];

      await ride.save({ session });

      await changeDriverState({
        driverId,
        newState: "searching",
        session,
      });

      // ✅ COMMIT FIRST
      await session.commitTransaction();

      // ✅ REDIS UPDATE (SAFE)
      await addRejected(rideId.toString(), driverId).catch(() => {});

      console.log("🚫 Driver rejected (soft):", driverId);
      return ride;
    }

    // =====================================================
    // 🔥 CASE 2: ACCEPTED → HARD CANCEL (optional rule)
    // =====================================================
    if (ride.status === "accepted") {
      throw new Error("❌ Cannot cancel after accepting ride");
    }

    // =====================================================
    // 🔥 HARD CANCEL FLOW
    // =====================================================
    ride.status = "cancelled";
    ride.cancelledBy = "driver";
    ride.cancelReason = reason || "Driver cancelled";

    await ride.save({ session });

    banner("RIDE CANCELLED");

    rideLog(ride._id, "DRIVER_CANCELLED", "Cancelled by driver", {
      driverId,
      reason: ride.cancelReason,
    });

    driver.currentRide = null;

    await changeDriverState({
      driverId,
      newState: "searching",
      session,
    });

    await driver.save({ session });

    await session.commitTransaction();

    // ✅ CLEAR REDIS STATE
    await clearDispatch(rideId.toString()).catch(() => {});

    console.log("❌ Driver cancelled ride:", driverId);
    return ride;
  } catch (err) {
    await session.abortTransaction();
    throw err;
  } finally {
    session.endSession();
  }
}
