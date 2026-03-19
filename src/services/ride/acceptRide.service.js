import Ride from "../../models/Ride.js";
import Driver from "../../models/Driver.js";
import mongoose from "mongoose";
import { rideLog } from "../../utils/rideLogger.js";
import { banner } from "../../utils/rideLogger.js";
import { throttledLog } from "../../core/logger/logger.js";

export async function acceptRideService({ rideId, driverId }) {
  const session = await mongoose.startSession();

  try {
    session.startTransaction();
    throttledLog(
      `accept-attempt-${driverId}`,
      3000,
      `🚕 DRIVER TRY ACCEPT → ${driverId}`,
    );

    // 🔍 Pre-check driver (no lock yet)
    const existingDriver = await Driver.findById(driverId);

    if (!existingDriver) {
      throw new Error("Driver not found");
    }

    const HEARTBEAT_LIMIT = 30000;

    if (
      !existingDriver.lastHeartbeat ||
      Date.now() - new Date(existingDriver.lastHeartbeat).getTime() >
        HEARTBEAT_LIMIT
    ) {
      throw new Error("Driver connection unstable");
    }

    // -----------------------------
    // 1️⃣ LOCK DRIVER FIRST 🔥
    // -----------------------------
    const driver = await Driver.findOneAndUpdate(
      {
        _id: driverId,
        driverState: "searching", // 🔥 lock driver
        currentRide: null, // 🔥 ensure free
      },
      {
        $set: {
          driverState: "to_pickup",
          currentRide: rideId,
        },
      },
      {
        returnDocument: "after",
        session,
      },
    );

    if (!driver) {
      throw new Error("Driver not available or already busy");
    }

    // -----------------------------
    // Lock Ride (atomic)
    // -----------------------------

    const ride = await Ride.findOneAndUpdate(
      {
        _id: rideId,
        status: "requested",
        driver: null,
      },
      {
        $set: {
          status: "accepted",
          driver: driverId,
        },
      },
      {
        returnDocument: "after",
        session,
      },
    );

    if (!ride) {
      rideLog(
        rideId,
        "ACCEPT_REJECTED",
        "Ride already taken by another driver",
        { driverId },
      );
      throw new Error("Ride already accepted");
    }

    // -----------------------------
    // Seat Allocation (shared vehicle)
    // -----------------------------

    if (driver.vehicleType === "minidoor") {
      const updatedDriver = await Driver.findOneAndUpdate(
        {
          _id: driverId,
          currentSeatLoad: {
            $lte: driver.vehicleCapacity - ride.passengerCount,
          },
        },
        {
          $inc: { currentSeatLoad: ride.passengerCount },
        },
        { returnDocument: "after", session },
      );

      if (!updatedDriver) {
        throw new Error("Not enough seats available");
      }

      rideLog(rideId, "SEAT_ALLOCATED", "Seat allocated for shared vehicle", {
        passengerCount: ride.passengerCount,
        newSeatLoad: updatedDriver.currentSeatLoad,
      });
    }

    banner("RIDE CLAIMED");

    rideLog(rideId, "ACCEPT_SUCCESS", "Driver successfully claimed ride", {
      driverId,
    });

    await session.commitTransaction();

    return ride.toObject();
  } catch (error) {
    await session.abortTransaction();

    // 🔥 CRITICAL ROLLBACK
    await Driver.findByIdAndUpdate(driverId, {
      $set: {
        driverState: "searching",
        currentRide: null,
      },
    });
    throw error;
  } finally {
    session.endSession();
  }
}
