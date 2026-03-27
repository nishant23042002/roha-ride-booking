import Ride from "../../models/Ride.js";
import Driver from "../../models/Driver.js";
import { rideLog, banner } from "../../utils/rideLogger.js";
import { throttledLog } from "../../core/logger/logger.js";
import {
  getDriverState,
  setDriverState,
} from "../../modules/driverState/driverState.redis.js";
import { isRedisHealthy } from "../../config/redis.js";
import { getIO, onlineCustomers } from "../../socket/index.js";
import { cancelRecovery } from "../../modules/recovery/recovery.manager.js";
import {
  getMetrics,
  trackAccept,
} from "../../modules/driverMetrics/driverMetrics.redis.js";
import { updateDriverScore } from "../../modules/driverScore/driveScore.redis.js";
import {
  acquireRideDriverLock,
  verifyLockOwnership,
  releaseLockIfOwner,
} from "../../modules/lock/lock.redis.js";
import { assignDriverToRide } from "../../modules/ride/ride.redis.js";

export async function acceptRideService({ rideId, driverId }) {
  const requestStart = Date.now();
  let locked = false;

  try {
    throttledLog(
      `accept-attempt-${driverId}`,
      3000,
      `🚕 DRIVER TRY ACCEPT → ${driverId}`,
    );

    // =====================================================
    // 🔍 DRIVER VALIDATION
    // =====================================================
    const driver = await Driver.findById(driverId);

    if (!driver) throw new Error("Driver not found");

    const HEARTBEAT_LIMIT = 30000;

    if (
      !driver.lastHeartbeat ||
      Date.now() - new Date(driver.lastHeartbeat).getTime() > HEARTBEAT_LIMIT
    ) {
      throw new Error("Driver connection unstable");
    }

    let state = await getDriverState(driverId);
    if (!state) state = driver.driverState;

    if (state === "to_pickup" || state === "on_trip") {
      throw new Error("Driver already on ride");
    }

    if (state !== null && state !== "searching") {
      throw new Error("Driver not available");
    }

    // =====================================================
    // 🔒 REDIS LOCK
    // =====================================================
    if (isRedisHealthy()) {
      locked = await acquireRideDriverLock(rideId, driverId);

      if (!locked) {
        throw new Error("Ride already taken by another driver");
      }

      const isOwner = await verifyLockOwnership(rideId, driverId);

      if (!isOwner) {
        throw new Error("Lock ownership mismatch");
      }
    }

    // =====================================================
    // 🛟 DB CLAIM
    // =====================================================
    const ride = await Ride.findOneAndUpdate(
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
      throw new Error("Ride already accepted");
    }

    // 🔥 ADD THIS (CRITICAL)
    await assignDriverToRide(rideId.toString(), driverId);

    // =====================================================
    // 🚗 UPDATE DRIVER
    // =====================================================
    await Driver.findByIdAndUpdate(driverId, {
      $set: {
        driverState: "to_pickup",
        currentRide: rideId,
      },
    });

    await setDriverState(driverId, "to_pickup").catch(() => {});

    // =====================================================
    // 📊 METRICS
    // =====================================================
    const responseTime = Date.now() - requestStart;
    await trackAccept(driverId, responseTime);

    const metrics = await getMetrics(driverId);
    const score =
      (metrics.accepts || 0) * 10 -
      (metrics.rejects || 0) * 5 -
      (metrics.cancels || 0) * 8 -
      (metrics.avgResponseTime || 0) * 0.01;

    await updateDriverScore(driverId, score);
    // =====================================================
    // 🔥 CANCEL RECOVERY
    // =====================================================
    cancelRecovery(driverId);

    // =====================================================
    // 📣 NOTIFY CUSTOMER
    // =====================================================
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
  } catch (err) {
    console.log("❌ ACCEPT ERROR:", err.message);
    throw err;
  } finally {
    // =====================================================
    // 🔓 RELEASE LOCK (SUCCESS PATH)
    // =====================================================
    if (locked) {
      await releaseLockIfOwner(rideId, driverId).catch(() => {});
    }
  }
}
