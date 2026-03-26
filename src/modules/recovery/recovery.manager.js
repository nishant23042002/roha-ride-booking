import Ride from "../../models/Ride.js";
import { startDispatch } from "../dispatch/dispatch.service.js";
import { getIO, onlineCustomers } from "../../socket/index.js";
import Driver from "../../models/Driver.js";
import { clearDispatch } from "../dispatch/dispatch.redis.js";

export const activeRecovery = new Map(); // driverId -> timeout

// =====================================================
// 🚀 SCHEDULE RECOVERY
// =====================================================
export function scheduleRecovery({ driverId, rideId, etaMinutes }) {
  // ❌ prevent duplicate recovery
  if (activeRecovery.has(driverId)) {
    console.log("⚠️ Recovery already scheduled for driver:", driverId);
    return;
  }

  // 🧠 dynamic recovery time
  let recoveryTime = etaMinutes * 2 * 60 * 1000;

  // safety bounds
  recoveryTime = Math.max(recoveryTime, 30000); // min 30s
  recoveryTime = Math.min(recoveryTime, 120000); // max 2min

  console.log(
    `🧠 Recovery scheduled → driver=${driverId} time=${recoveryTime / 1000}s`,
  );

  const timer = setTimeout(async () => {
    try {
      const ride = await Ride.findById(rideId);
      if (!ride) return;

      // 🧠 DRIVER RECONNECTED SAFETY
      const driver = await Driver.findById(driverId);

      if (driver?.isOnline && driver?.currentRide?.toString() === rideId) {
        console.log("⚠️ Recovery skipped → driver already back online");
        return;
      }

      // =============================
      // 🛑 VALIDATION
      // =============================

      // ❌ already handled
      if (!["accepted", "arrived", "ongoing"].includes(ride.status)) {
        console.log("⚠️ Recovery skipped → invalid ride state:", ride.status);
        return;
      }

      // ❌ driver already replaced
      if (ride.driver && ride.driver.toString() !== driverId) {
        console.log("⚠️ Recovery skipped → driver already replaced");
        return;
      }

      // =============================
      // 🧠 LIMIT RECOVERY ATTEMPTS
      // =============================
      const attempts = ride.recovery?.attempts || 0;
      const originalDriverId = ride.driver;

      if (attempts >= 3) {
        console.log("❌ Recovery limit reached → cancelling ride");

        ride.status = "cancelled";
        ride.cancelledBy = "system";
        ride.cancelReason = "Driver unavailable";

        if (originalDriverId) {
          await Driver.findByIdAndUpdate(originalDriverId, {
            currentRide: null,
            driverState: driver?.isOnline ? "searching" : "offline",
          }).catch(() => {});
        }

        await ride.save();
        notifyCustomerCancel(ride);
        return;
      }

      // =============================
      // 🔁 RESET RIDE
      // =============================
      if (originalDriverId) {
        await Driver.findByIdAndUpdate(originalDriverId, {
          currentRide: null,
          driverState: driver?.isOnline ? "searching" : "offline",
        }).catch(() => {});
      }

      ride.driver = null;
      ride.status = "requested";

      ride.recovery = {
        triggeredAt: new Date(),
        attempts: attempts + 1,
        originalDriverId: driverId,
      };

      await ride.save();

      // =============================
      // 📣 NOTIFY CUSTOMER
      // =============================
      notifyCustomerRecovery(ride);

      // =============================
      // 🚀 RESTART DISPATCH
      // =============================
      console.log("⚠️ Driver lost → reassigning ride");

      // 1️⃣ CLEAR OLD DISPATCH STATE
      await clearDispatch(rideId);

      // 2️⃣ RESTART DISPATCH
      startDispatch(rideId).catch((err) => {
        console.error("❌ DISPATCH ERROR:", err.message);
      });

      console.log("🚀 Dispatch restarted after recovery");
    } catch (err) {
      console.log("❌ Recovery error:", err.message);
    } finally {
      activeRecovery.delete(driverId);
    }
  }, recoveryTime);

  activeRecovery.set(driverId, timer);
}

// =====================================================
// ❌ CANCEL RECOVERY (ON RECONNECT)
// =====================================================
export function cancelRecovery(driverId) {
  if (activeRecovery.has(driverId)) {
    clearTimeout(activeRecovery.get(driverId));
    activeRecovery.delete(driverId);

    console.log("🔁 Recovery cancelled (driver reconnected)");
  }
}

// =====================================================
// 📣 CUSTOMER NOTIFICATIONS
// =====================================================
function notifyCustomerRecovery(ride) {
  const io = getIO();
  const socketId = onlineCustomers.get(ride.customer.toString());

  if (io && socketId) {
    io.to(socketId).emit("driver-lost", {
      rideId: ride._id,
      message: "Driver disconnected. Finding a new driver...",
    });
  }
}

function notifyCustomerCancel(ride) {
  const io = getIO();
  const socketId = onlineCustomers.get(ride.customer.toString());

  if (io && socketId) {
    io.to(socketId).emit("ride-cancelled", {
      rideId: ride._id,
      reason: ride.cancelReason,
    });
  }
}
