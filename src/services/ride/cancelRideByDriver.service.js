import Ride from "../../models/Ride.js";
import Driver from "../../models/Driver.js";
import mongoose from "mongoose";
import { changeDriverState } from "../driver/driverState.service.js";
import { rideLog, banner } from "../../utils/rideLogger.js";
import {
  addRejected,
  clearDispatch,
} from "../../modules/dispatch/dispatch.redis.js";
import { getIO, onlineCustomers } from "../../socket/index.js";
import { cancelRecovery } from "../../modules/recovery/recovery.manager.js";

export async function cancelRideByDriverService({ rideId, driverId, reason }) {
  const session = await mongoose.startSession();

  try {
    session.startTransaction();

    const ride = await Ride.findById(rideId).session(session);
    if (!ride) throw new Error("Ride not found");

    if (ride.status === "cancelled") return ride;

    const driver = await Driver.findById(driverId).session(session);
    if (!driver) throw new Error("Driver not found");

    // =============================
    // 🔥 SOFT CANCEL (REQUESTED)
    // =============================
    if (ride.status === "requested") {
      ride.driver = null;

      const rejectedSet = new Set(ride.rejectedDrivers || []);
      rejectedSet.add(driverId);
      ride.rejectedDrivers = [...rejectedSet];

      await ride.save({ session });

      await changeDriverState({
        driverId,
        newState: "searching",
        session,
      });

      await session.commitTransaction();

      await addRejected(rideId.toString(), driverId).catch(() => {});

      return ride;
    }

    // =============================
    // ❌ BLOCK ACCEPTED CANCEL (RULE)
    // =============================
    if (ride.status === "accepted") {
      throw new Error("❌ Cannot cancel after accepting ride");
    }

    // =============================
    // 🔥 HARD CANCEL
    // =============================
    ride.status = "cancelled";
    ride.cancelledBy = "driver";
    ride.cancelReason = reason || "Driver cancelled";

    await ride.save({ session });

    driver.currentRide = null;

    await changeDriverState({
      driverId,
      newState: "searching",
      session,
    });

    await driver.save({ session });

    await session.commitTransaction();

    banner("RIDE CANCELLED");

    rideLog(ride._id, "DRIVER_CANCELLED", "Cancelled by driver", {
      driverId,
      reason: ride.cancelReason,
    });

    // =============================
    // 🔥 CLEANUP
    // =============================
    await clearDispatch(rideId.toString()).catch(() => {});
    cancelRecovery(driverId);

    // =============================
    // 📣 NOTIFY CUSTOMER
    // =============================
    const io = getIO();
    const socketId = onlineCustomers.get(ride.customer.toString());

    if (io && socketId) {
      io.to(socketId).emit("driver-cancelled", {
        rideId,
        reason: ride.cancelReason,
      });
    }

    console.log("❌ Driver cancelled ride:", driverId);

    return ride;
  } catch (err) {
    await session.abortTransaction();
    throw err;
  } finally {
    session.endSession();
  }
}
