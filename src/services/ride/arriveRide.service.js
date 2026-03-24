import Ride from "../../models/Ride.js";
import Driver from "../../models/Driver.js";
import mongoose from "mongoose";
import { changeDriverState } from "../driver/driverState.service.js";
import { rideLog } from "../../utils/rideLogger.js";
import { throttledLog } from "../../core/logger/logger.js";
import { getIO, onlineCustomers } from "../../socket/index.js";
import { cancelRecovery } from "../../modules/recovery/recovery.manager.js";

export async function arriveRideService({ rideId, driverId }) {
  const session = await mongoose.startSession();

  try {
    session.startTransaction();

    throttledLog(
      `arrive-${driverId}`,
      3000,
      `📍 DRIVER ARRIVING → ${driverId}`,
    );

    rideLog(rideId, "ARRIVAL_ATTEMPT", "Driver reporting arrival", {
      driverId,
    });

    // -----------------------------
    // Validate Ride
    // -----------------------------
    const ride = await Ride.findOne({
      _id: rideId,
      driver: driverId,
      status: "accepted",
    }).session(session);

    if (!ride) {
      throw new Error("Invalid arrival");
    }

    // -----------------------------
    // Validate Driver
    // -----------------------------
    const driver = await Driver.findById(driverId).session(session);

    if (!driver) {
      throw new Error("Driver not found");
    }

    if (driver.currentRide?.toString() !== rideId) {
      throw new Error("Driver ride mismatch");
    }

    // -----------------------------
    // Update Ride
    // -----------------------------
    ride.status = "arrived";
    ride.arrivalTime = new Date();

    await ride.save({ session });

    // -----------------------------
    // Update Driver State
    // -----------------------------
    await changeDriverState({
      driverId,
      newState: "arrived",
    });

    await session.commitTransaction();

    // =============================
    // 🔥 CRITICAL: CANCEL RECOVERY
    // =============================
    cancelRecovery(driverId);

    // =============================
    // 📣 NOTIFY CUSTOMER
    // =============================
    const io = getIO();
    const socketId = onlineCustomers.get(ride.customer.toString());

    if (io && socketId) {
      io.to(socketId).emit("driver-arrived", {
        rideId,
      });
    }

    rideLog(rideId, "DRIVER_ARRIVED", "Driver reached pickup", {
      driverId,
    });

    return ride;
  } catch (error) {
    await session.abortTransaction();
    throw error;
  } finally {
    session.endSession();
  }
}
