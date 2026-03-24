// /src/services/ride/acceptRideService.js

import Ride from "../../models/Ride.js";
import Driver from "../../models/Driver.js";
import { rideLog, banner } from "../../utils/rideLogger.js";
import { throttledLog } from "../../core/logger/logger.js";
import { setAccepted } from "../../modules/dispatch/dispatch.redis.js";
import {
  getDriverState,
  setDriverState,
} from "../../modules/driverState/driverState.redis.js";
import { isRedisHealthy } from "../../config/redis.js";
import { getIO,onlineCustomers } from "../../socket/index.js";
import { cancelRecovery } from "../../modules/recovery/recovery.manager.js";

export async function acceptRideService({ rideId, driverId }) {
  throttledLog(
    `accept-attempt-${driverId}`,
    3000,
    `🚕 DRIVER TRY ACCEPT → ${driverId}`,
  );

  // =====================================================
  // 🔍 2️⃣ DRIVER VALIDATION
  // =====================================================
  const driver = await Driver.findById(driverId);

  if (!driver) {
    throw new Error("Driver not found");
  }

  const HEARTBEAT_LIMIT = 30000;

  if (
    !driver.lastHeartbeat ||
    Date.now() - new Date(driver.lastHeartbeat).getTime() > HEARTBEAT_LIMIT
  ) {
    throw new Error("Driver connection unstable");
  }

  let state = await getDriverState(driverId);

  if (!state) {
    state = driver.driverState; // Mongo fallback
  }

  if (state === "to_pickup" || state === "on_trip") {
    throw new Error("Driver already on ride");
  }

  if (state !== null && state !== "searching") {
    throw new Error("Driver not available");
  }

  // =====================================================
  // 🔥 1️⃣ REDIS LOCK CHECK (FAST EXIT)
  // =====================================================
  let locked = false;

  // =============================
  // 🔥 PRIMARY: REDIS LOCK
  // =============================
  if (isRedisHealthy()) {
    locked = await setAccepted(rideId, driverId);
  }

  // =============================
  // 🛟 FALLBACK: DB LOCK
  // =============================
  let ride;

  if (!locked) {
    console.log("🛟 FALLBACK → ATOMIC DB LOCK");

    // 🔥 atomic claim
    ride = await Ride.findOneAndUpdate(
      {
        _id: rideId,
        status: "requested",
      },
      {
        $set: {
          status: "accepted",
          driver: driverId,
          recovery: null,
        },
      },
      { returnDocument: "after" },
    );

    if (!ride) {
      throw new Error("Ride already taken");
    }
  } else {
    // =====================================================
    // NORMAL FLOW AFTER REDIS LOCK
    // =====================================================
    ride = await Ride.findOneAndUpdate(
      {
        _id: rideId,
        status: "requested",
      },
      {
        $set: {
          status: "accepted",
          driver: driverId,
          recovery: null, // 🔥 CLEAR RECOVERY
        },
      },
      { returnDocument: "after" },
    );

    if (!ride) {
      throw new Error("Ride already accepted");
    }
  }

  // =====================================================
  // 🚗 5️⃣ UPDATE DRIVER
  // =====================================================
  await Driver.findByIdAndUpdate(driverId, {
    $set: {
      driverState: "to_pickup",
      currentRide: rideId,
    },
  });

  await setDriverState(driverId, "to_pickup").catch(() => {});

  // =============================
  // 🔥 CANCEL RECOVERY
  // =============================
  cancelRecovery(driverId);

  // =============================
  // 📣 NOTIFY CUSTOMER
  // =============================
  const io = getIO();
  const socketId = onlineCustomers.get(ride.customer.toString());

  if (io && socketId) {
    io.to(socketId).emit("ride-accepted", {
      rideId,
      driverId,
    });
  }

  // =====================================================
  // ✅ SUCCESS
  // =====================================================
  banner("RIDE CLAIMED");

  rideLog(rideId, "ACCEPT_SUCCESS", "Driver successfully claimed ride", {
    driverId,
  });

  return ride.toObject();
}
