import Ride from "../../models/Ride.js";
import Driver from "../../models/Driver.js";
import mongoose from "mongoose";
import { changeDriverState } from "../driver/driverState.service.js";
import { rideLog, banner } from "../../utils/rideLogger.js";

export async function cancelRideByCustomerService({ rideId, reason }) {
  const session = await mongoose.startSession();

  try {
    session.startTransaction();

    const ride = await Ride.findById(rideId).session(session);
    if (!ride) throw new Error("Ride not found");

    if (ride.status === "cancelled") return ride;

    if (!["requested", "accepted", "arrived"].includes(ride.status)) {
      throw new Error("Ride cannot be cancelled");
    }

    ride.status = "cancelled";
    ride.cancelledBy = "customer";
    ride.cancelReason = reason || "No reason provided";

    await ride.save({ session });

    banner("RIDE CANCELLED");

    rideLog(ride._id, "CUSTOMER_CANCELLED", "Cancelled by customer", {
      reason: ride.cancelReason,
    });

    // reset driver
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

    await session.commitTransaction();

    return ride;
  } catch (err) {
    await session.abortTransaction();
    throw err;
  } finally {
    session.endSession();
  }
}
