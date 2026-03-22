// /src/socket/driver.socket.js

import Driver from "../models/Driver.js";
import Ride from "../models/Ride.js";
import { onlineDrivers, getIO } from "./index.js";
import { haversineDistance, smoothLocation } from "../utils/gpsUtils.js";
import { disconnectTimers } from "./index.js";
import { throttledLog } from "../core/logger/logger.js";
import { rateLimit } from "../core/rateLimiter.js";

const activeDrivers = new Map();
const driverLastLocations = new Map();

// Broadcast drivers to map (throttled)
setInterval(() => {
  const io = getIO();
  if(!io) return;

  const drivers = Array.from(activeDrivers.values());
  if (!drivers.length) return;

  io.to("rider-map-room").emit("nearbyDrivers", drivers);
}, 1500);

export default function registerDriverHandlers(socket) {
  socket.on("register-driver", async (driverId) => {
    const io = getIO();
    if(!io) return

    // 🔥 Kill old socket
    if (onlineDrivers.has(driverId)) {
      const oldId = onlineDrivers.get(driverId);

      if (oldId !== socket.id) {
        const old = io.sockets.sockets.get(oldId);
        if (old) old.disconnect(true);
      }
    }

    // 🔥 Cancel disconnect timer
    if (disconnectTimers.has(driverId)) {
      clearTimeout(disconnectTimers.get(driverId));
      disconnectTimers.delete(driverId);
    }

    onlineDrivers.set(driverId, socket.id);

    socket.data.userId = driverId;
    socket.data.role = "driver";

    socket.join(`driver:${driverId}`);

    console.log("✅ DRIVER REGISTERED:", driverId);
    console.log("📡 Active drivers:", onlineDrivers.size);

    // 🔥 Fetch driver
    const driver = await Driver.findById(driverId);

    if (!driver) return;

    // ==================================================
    // 🚨 CRITICAL FIX — VALIDATE currentRide
    // ==================================================
    if (driver.currentRide) {
      const ride = await Ride.findById(driver.currentRide);

      if (!ride || ["completed", "cancelled"].includes(ride.status)) {
        // ❌ stale ride → CLEAN IT
        console.log("🧹 Cleaning stale currentRide:", driver.currentRide);

        driver.currentRide = null;
        driver.driverState = "searching";

        await driver.save();
      } else {
        // ✅ valid ride → RESUME
        console.log("🔁 Resuming ride:", ride._id);

        socket.join(`ride:${ride._id}`);

        socket.emit("resume-ride", {
          rideId: ride._id,
          state: driver.driverState,
        });
      }
    }

    // 🔥 Mark online AFTER cleanup
    await Driver.findByIdAndUpdate(driverId, {
      isOnline: true,
      lastHeartbeat: new Date(),
    });
  });

  socket.on("driver-heartbeat", async (driverId) => {
    if (!rateLimit(`hb-${driverId}`, 5, 5000)) return;

    await Driver.findByIdAndUpdate(driverId, {
      lastHeartbeat: new Date(),
    });

    throttledLog(`heartbeat-${driverId}`, 5000, `💓 HEARTBEAT → ${driverId}`);
  });

  socket.on("driver-location-update", async ({ driverId, lat, lng }) => {
    try {
      if (!rateLimit(`gps-${driverId}`, 20, 5000)) return;
      if (!driverId || lat == null || lng == null) return;

      const last = driverLastLocations.get(driverId);

      // Prevent unrealistic GPS jumps
      if (last) {
        const distance = haversineDistance(last.lat, last.lng, lat, lng);

        const timeDiff = (Date.now() - last.timestamp) / 1000;

        const speed = distance / (timeDiff / 3600); // km/h

        if (speed > 200 || distance > 1) {
          throttledLog(
            `gps-reject-${driverId}`,
            5000,
            `❌ GPS_REJECTED → ${driverId}`,
          );
          return;
        }
      }

      const smoothed = smoothLocation(last, { lat, lng });

      const now = Date.now();

      throttledLog(`gps-${driverId}`, 5000, "📍 GPS_UPDATE");

      driverLastLocations.set(driverId, {
        lat: smoothed.lat,
        lng: smoothed.lng,
        timestamp: now,
      });

      let heading = 0;

      if (last) {
        const dx = smoothed.lng - last.lng;
        const dy = smoothed.lat - last.lat;

        heading = (Math.atan2(dx, dy) * 180) / Math.PI;
        heading = (heading + 360) % 360;
      }

      activeDrivers.set(driverId, {
        id: driverId,
        latitude: smoothed.lat,
        longitude: smoothed.lng,
        heading,
      });
      let driver = null;

      try {
        driver = await Driver.findByIdAndUpdate(
          driverId,
          {
            currentLocation: {
              type: "Point",
              coordinates: [smoothed.lng, smoothed.lat],
            },
            lastHeartbeat: new Date(),
          },
          { returnDocument: "after" },
        );
      } catch (err) {
        console.log("❌ DB UPDATE FAILED:", err.message);
        return; // 🚨 STOP further execution
      }

      if (!driver) return;

      // If driver has ride → stream location to passenger
      if (driver.currentRide) {
        const io = getIO();
        if(!io) return;
        const ride = await Ride.findById(driver.currentRide);

        if (!ride) return;

        // const customerSocketId = onlineCustomers.get(ride.customer.toString());
        const room = `ride:${driver.currentRide}`;

        io.to(room).emit("driver-location-update", {
          driverId,
          lat: smoothed.lat,
          lng: smoothed.lng,
          timestamp: Date.now(),
        });
      }
    } catch (err) {
      console.log("\n❌ DRIVER LOCATION ERROR");
      console.log(err);
    }
  });

  socket.on("driver-go-online", async (driverId) => {
    try {
      await Driver.findByIdAndUpdate(driverId, {
        isOnline: true,
        driverState: "searching",
        lastHeartbeat: new Date(),
      });

      activeDrivers.delete(driverId);
      driverLastLocations.delete(driverId);

      console.log("🟢 DRIVER ONLINE:", driverId);
    } catch (err) {
      console.log("❌ GO ONLINE ERROR:", err.message);
    }
  });

  socket.on("driver-go-offline", async (driverId) => {
    try {
      await Driver.findByIdAndUpdate(driverId, {
        isOnline: false,
        driverState: "offline",
        currentRide: null,
      });

      activeDrivers.delete(driverId);
      driverLastLocations.delete(driverId);

      onlineDrivers.delete(driverId);

      console.log("🔴 DRIVER OFFLINE:", driverId);
    } catch (err) {
      console.log("❌ GO OFFLINE ERROR:", err.message);
    }
  });

  socket.on("join-map-room", (data) => {
    throttledLog(`map-room-${socket.id}`, 5000, "MAP_ROOM_JOIN");
    socket.join("rider-map-room");
  });
}
