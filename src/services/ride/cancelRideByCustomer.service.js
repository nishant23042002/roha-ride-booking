import Ride from "../../models/Ride.js";
import Driver from "../../models/Driver.js";
import mongoose from "mongoose";
import { changeDriverState } from "../driver/driverState.service.js";
import { rideLog, banner } from "../../utils/rideLogger.js";
import { clearDispatch } from "../../modules/dispatch/dispatch.redis.js";

export async function cancelRideByCustomerService({ rideId, reason }) {
  const session = await mongoose.startSession();

  try {
    session.startTransaction();

    const ride = await Ride.findById(rideId).session(session);
    if (!ride) throw new Error("Ride not found");

    // =====================================================
    // ✅ IDEMPOTENT SAFE EXIT
    // =====================================================
    if (ride.status === "cancelled") {
      await session.commitTransaction();
      return ride;
    }

    if (!["requested", "accepted", "arrived"].includes(ride.status)) {
      throw new Error("Ride cannot be cancelled");
    }

    // =====================================================
    // 🔥 UPDATE RIDE
    // =====================================================
    ride.status = "cancelled";
    ride.cancelledBy = "customer";
    ride.cancelReason = reason || "No reason provided";

    await ride.save({ session });

    banner("RIDE CANCELLED");

    rideLog(ride._id, "CUSTOMER_CANCELLED", "Cancelled by customer", {
      reason: ride.cancelReason,
    });

    // =====================================================
    // 🔄 RESET DRIVER (if exists)
    // =====================================================
    if (ride.driver) {
      const driver = await Driver.findById(ride.driver).session(session);

      if (driver) {
        driver.currentRide = null;

        await changeDriverState({
          driverId: driver._id,
          newState: "searching",
          session,
        });

        await driver.save({ session });
      }
    }

    // =====================================================
    // ✅ COMMIT FIRST
    // =====================================================
    await session.commitTransaction();

    // =====================================================
    // 🔥 CLEAR REDIS (SAFE)
    // =====================================================
    await clearDispatch(rideId.toString()).catch(() => {});
    
    return ride;
  } catch (err) {
    await session.abortTransaction();
    throw err;
  } finally {
    session.endSession();
  }
}
