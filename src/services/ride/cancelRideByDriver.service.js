import Ride from "../../models/Ride.js";
import Driver from "../../models/Driver.js";
import mongoose from "mongoose";
import { changeDriverState } from "../driverState.service.js";
import { rideLog, banner } from "../../utils/rideLogger.js";

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
      ride.rejectedDrivers = [...(ride.rejectedDrivers || []), driverId];

      await ride.save({ session });

      await changeDriverState({
        driverId,
        newState: "searching",
        session,
      });

      await session.commitTransaction();

      return ride;
    }

    // =============================
    // 🔥 CASE 2: REAL CANCEL
    // =============================
    if (!["accepted", "arrived"].includes(ride.status)) {
      throw new Error("Cannot cancel this ride");
    }

    ride.status = "cancelled";
    ride.cancelledBy = "driver";
    ride.cancelReason = reason || "Driver cancelled";

    await ride.save({ session });

    banner("RIDE CANCELLED");

    rideLog(ride._id, "DRIVER_CANCELLED", "Cancelled by driver", {
      driverId,
      reason: ride.cancelReason,
    });

    // seat fix
    if (driver.vehicleType === "minidoor") {
      driver.currentSeatLoad -= ride.passengerCount;
      if (driver.currentSeatLoad < 0) driver.currentSeatLoad = 0;
    }

    driver.currentRide = null;

    await changeDriverState({
      driverId,
      newState: "searching",
      session,
    });

    await driver.save({ session });

    await session.commitTransaction();

    return ride;
  } catch (err) {
    await session.abortTransaction();
    throw err;
  } finally {
    session.endSession();
  }
}
