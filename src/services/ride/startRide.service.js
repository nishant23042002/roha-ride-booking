// /src/services/ride/startRideService.js

import Ride from "../../models/Ride.js";
import Driver from "../../models/Driver.js";
import mongoose from "mongoose";
import { changeDriverState } from "../driver/driverState.service.js";
import { rideLog, banner } from "../../utils/rideLogger.js";
import { throttledLog } from "../../core/logger/logger.js";
import { setDriverState } from "../../modules/driverState/driverState.redis.js";
import { getIO, onlineCustomers } from "../../socket/index.js";
import { cancelRecovery } from "../../modules/recovery/recovery.manager.js";
import { releaseLockIfOwner } from "../../modules/lock/lock.redis.js";

export async function startRideService({ rideId, driverId }) {
  const session = await mongoose.startSession();

  try {
    session.startTransaction();

    const existingRide = await Ride.findById(rideId).session(session);

    if (!existingRide) {
      throw new Error("Ride not found");
    }

    if (existingRide.driver?.toString() !== driverId) {
      throw new Error("Not your ride");
    }

    banner("RIDE STARTING");

    throttledLog(`start-${driverId}`, 3000, `🚦 START RIDE → ${driverId}`);

    // -----------------------------
    // 1️⃣ ATOMIC UPDATE (CORE)
    // -----------------------------
    const ride = await Ride.findOneAndUpdate(
      {
        _id: rideId,
        driver: driverId,
        status: "arrived",
        rideStartTime: null, // 🔥 prevents double start
      },
      {
        $set: {
          status: "ongoing",
          rideStartTime: new Date(),
        },
      },
      {
        returnDocument: "after",
        session,
      },
    );

    if (!ride) {
      // check if already started
      const existingRide = await Ride.findById(rideId).session(session);
      if (!existingRide) {
        throw new Error("Ride not found");
      }

      if (existingRide.driver?.toString() !== driverId) {
        throw new Error("Not your ride");
      }

      if (existingRide?.rideStartTime) {
        console.log("⚠️ DUPLICATE START BLOCKED:", rideId);

        await session.commitTransaction(); // ✅ still commit
        return existingRide;
      }

      throw new Error("Cannot start ride");
    }

    // -----------------------------
    // 2️⃣ Validate Driver
    // -----------------------------
    const driver = await Driver.findById(driverId).session(session);

    if (!driver) {
      throw new Error("Driver not found");
    }

    if (driver.currentRide?.toString() !== rideId) {
      throw new Error("Driver ride mismatch");
    }

    // -----------------------------
    // 4️⃣ Update Driver State
    // -----------------------------
    await changeDriverState({
      driverId,
      newState: "on_trip",
    });

    await session.commitTransaction();
    // =============================
    // 🔥 CRITICAL: CANCEL RECOVERY
    // =============================
    cancelRecovery(driverId);
    
    // =============================
    // 🔄 REDIS SYNC (SAFE)
    // =============================
    await setDriverState(driverId, "on_trip").catch(() => {});
    
    // =============================
    // 📣 NOTIFY CUSTOMER
    // =============================
    const io = getIO();
    const socketId = onlineCustomers.get(ride.customer.toString());
    
    if (io && socketId) {
      io.to(socketId).emit("ride-started", {
        rideId,
      });
    }
    
    rideLog(rideId, "RIDE_STARTED", "Ride has officially started", {
      driverId,
    });
    
    return ride;
  } catch (error) {
    await session.abortTransaction();
    await releaseLockIfOwner(rideId, driverId).catch(() => {});
    throw error;
  } finally {
    session.endSession();
  }
}
