// /src/socket/index.js

import { Server } from "socket.io";
import registerDriverHandlers from "./driver.socket.js";
import registerRideHandlers from "./ride.socket.js";
import Driver from "../models/Driver.js";
import { scheduleRecovery } from "../modules/recovery/recovery.manager.js";
import Ride from "../models/Ride.js";
import { removeDriverState } from "../modules/driverState/driverState.redis.js";
import { changeDriverState } from "../services/driver/driverState.service.js";

let io;
export const onlineDrivers = new Map(); // driverId -> socketId
export const onlineCustomers = new Map(); // customerId -> socketId
export const disconnectTimers = new Map(); // userId -> timeout
const DISCONNECT_GRACE = 15000; // 15 sec

export const initSocket = (server) => {
  io = new Server(server, {
    cors: {
      origin: "*", // change in production
      methods: ["GET", "POST"],
    },
  });

  io.on("connection", (socket) => {
    console.log("\n🟢 SOCKET CONNECTED:", socket.id);

    // 🔥 Attach identity (important)
    socket.data.userId = null;
    socket.data.role = null;

    console.log("📡 Active drivers:", onlineDrivers.size);
    console.log("📡 Active customers:", onlineCustomers.size);

    registerDriverHandlers(socket);
    registerRideHandlers(socket);

    socket.on("disconnect", () => {
      handleDisconnect(socket);
      console.log("🔴 SOCKET DISCONNECTED:", socket.id);
    });
  });
};

export const getIO = () => {
  if (!io) {
    console.log("⚠️ IO not ready yet");
    return null;
  }
  return io;
};

// =====================================================
// 🔴 DISCONNECT HANDLER (PRODUCTION SAFE)
// =====================================================
function handleDisconnect(socket) {
  const { userId, role } = socket.data;

  if (!userId || !role) return;

  console.log(`⏳ ${role} disconnected (grace):`, userId);

  // ❌ Prevent duplicate timers
  if (disconnectTimers.has(userId)) {
    clearTimeout(disconnectTimers.get(userId));
  }

  const timer = setTimeout(async () => {
    try {
      // =============================
      // 🛑 DRIVER RECONNECTED CHECK
      // =============================
      const currentSocketId = onlineDrivers.get(userId);

      // 🔥 ONLY skip if SAME DRIVER reconnected with NEW socket
      if (currentSocketId && currentSocketId !== socket.id) {
        console.log(
          "⚠️ Driver reconnected with new socket, skipping disconnect",
        );
        return;
      }

      if (role === "driver") {
        onlineDrivers.delete(userId);

        console.log("🔴 Driver offline (grace expired):", userId);

        const driver = await Driver.findById(userId).catch(() => null);

        // =============================
        // 🔥 RECOVERY LOGIC (SMART)
        // =============================
        if (driver?.currentRide) {
          const ride = await Ride.findById(driver.currentRide).catch(
            () => null,
          );

          if (
            ride &&
            ["accepted", "arrived", "ongoing"].includes(ride.status)
          ) {
            console.log("🚨 RECOVERY TRIGGERED");
            console.log("👉 Ride:", ride._id.toString());
            console.log("👉 Status:", ride.status);

            // =============================
            // 🧠 SMART ETA CALCULATION
            // =============================
            let etaMinutes = ride.estimatedETA || 5;

            // safety bounds
            if (ride.status === "accepted") {
              etaMinutes = ride.estimatedETA || 4;
            } else if (ride.status === "arrived") {
              etaMinutes = 3; // driver already near
            } else if (ride.status === "ongoing") {
              etaMinutes = 5; // more time for reconnect
            }

            // =============================
            // ❌ PREVENT DUPLICATE RECOVERY
            // =============================
            if (!ride.recovery) {
              scheduleRecovery({
                driverId: userId,
                rideId: ride._id.toString(),
                etaMinutes,
              });
            } else {
              console.log("⚠️ Recovery already active, skipping");
            }
          }
        }

        // =============================
        // 🧠 FINAL STATE UPDATE (SOURCE OF TRUTH)
        // =============================
        await changeDriverState({
          driverId: userId,
          newState: "offline",
        });

        // =============================
        // ⏳ GEO TTL (DO NOT REMOVE IMMEDIATELY)
        // =============================
        console.log("⏳ GEO cleanup deferred (TTL will handle)");

        await removeDriverState(userId);
        console.log("❌ Driver offline:", userId);
      }

      if (role === "customer") {
        onlineCustomers.delete(userId);
        console.log("❌ Customer removed:", userId);
      }

      disconnectTimers.delete(userId);
    } catch (err) {
      console.log("❌ DISCONNECT ERROR:", err.message);
    }
  }, DISCONNECT_GRACE);

  disconnectTimers.set(userId, timer);
}
