import Ride from "../../models/Ride.js";
import Driver from "../../models/Driver.js";
import mongoose from "mongoose";
import { changeDriverState } from "../driver/driverState.service.js";
import { rideLog, banner } from "../../utils/rideLogger.js";
import { clearDispatch } from "../../modules/dispatch/dispatch.redis.js";
import { getIO, onlineDrivers } from "../../socket/index.js";
import { cancelRecovery } from "../../modules/recovery/recovery.manager.js";

export async function cancelRideByCustomerService({ rideId, reason }) {
  const session = await mongoose.startSession();

  try {
    session.startTransaction();

    const ride = await Ride.findById(rideId).session(session);
    if (!ride) throw new Error("Ride not found");

    // ✅ idempotent
    if (ride.status === "cancelled") {
      await session.commitTransaction();
      return ride;
    }

    if (!["requested", "accepted", "arrived"].includes(ride.status)) {
      throw new Error("Ride cannot be cancelled");
    }

    const driverId = ride.driver?.toString();

    // =============================
    // 🔥 UPDATE RIDE
    // =============================
    ride.status = "cancelled";
    ride.cancelledBy = "customer";
    ride.cancelReason = reason || "No reason provided";

    await ride.save({ session });

    // =============================
    // 🔄 RESET DRIVER
    // =============================
    if (driverId) {
      const driver = await Driver.findById(driverId).session(session);

      if (driver) {
        driver.currentRide = null;

        await changeDriverState({
          driverId,
          newState: "searching",
          session,
        });

        await driver.save({ session });
      }
    }

    await session.commitTransaction();

    banner("RIDE CANCELLED");

    rideLog(ride._id, "CUSTOMER_CANCELLED", "Cancelled by customer", {
      reason: ride.cancelReason,
    });

    // =============================
    // 🔥 CLEAR DISPATCH + RECOVERY
    // =============================
    await clearDispatch(rideId.toString()).catch(() => {});
    if (driverId) cancelRecovery(driverId);

    // =============================
    // 📣 NOTIFY DRIVER
    // =============================
    if (driverId) {
      const io = getIO();
      const socketId = onlineDrivers.get(driverId);

      if (io && socketId) {
        io.to(socketId).emit("ride-cancelled", {
          rideId,
          reason: ride.cancelReason,
        });
      }
    }

    return ride;
  } catch (err) {
    await session.abortTransaction();
    throw err;
  } finally {
    session.endSession();
  }
}
