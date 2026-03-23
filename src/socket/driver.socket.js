// /src/socket/driver.socket.js

import Driver from "../models/Driver.js";
import Ride from "../models/Ride.js";
import { onlineDrivers, getIO } from "./index.js";
import { haversineDistance, smoothLocation } from "../utils/gpsUtils.js";
import { disconnectTimers } from "./index.js";
import { throttledLog } from "../core/logger/logger.js";
import { rateLimit } from "../core/rateLimiter.js";
import {
  updateDriverLocation,
  removeDriver,
} from "../modules/geo/geo.redis.js";
import {
  getDriverState,
  removeDriverState,
  setDriverState,
} from "../modules/driverState/driverState.redis.js";
import {
  updateHeartbeat,
  removeHeartbeat,
} from "../modules/driverState/driverHeartbeat.redis.js";

const GPS_CONFIG = {
  searching: {
    minDistanceKm: 0.05, // 30m
    minTimeMs: 8000,
  },
  to_pickup: {
    minDistanceKm: 0.02,
    minTimeMs: 3000,
  },
  on_trip: {
    minDistanceKm: 0.04,
    minTimeMs: 5000,
  },
};
const DB_UPDATE_INTERVAL = 10000; // 10 sec

// =============================
// 🧠 MEMORY STORES
// =============================
const activeDrivers = new Map();
const driverLastLocations = new Map();
const driverLastDBUpdate = new Map();

// =============================
// 📡 BROADCAST TO MAP (THROTTLED)
// =============================
setInterval(() => {
  const io = getIO();
  if (!io) return;

  const drivers = Array.from(activeDrivers.values()).slice(0, 50);
  if (!drivers.length) return;

  io.to("rider-map-room").emit("nearbyDrivers", drivers);
}, 1500);

// =============================
// 🚀 MAIN HANDLER
// =============================
export default function registerDriverHandlers(socket) {
  // =============================
  // 🟢 REGISTER
  // =============================
  socket.on("register-driver", async (driverId) => {
    const io = getIO();
    if (!io) return;

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

    // ✅ ALWAYS SYNC REDIS STATE
    await setDriverState(driverId, driver.driverState || "searching");
    await updateHeartbeat(driverId);

    // =============================
    // 🧹 CLEAN STALE RIDE
    // =============================
    if (driver.currentRide) {
      const ride = await Ride.findById(driver.currentRide);

      if (!ride || ["completed", "cancelled"].includes(ride.status)) {
        // ❌ stale ride → CLEAN IT
        console.log("🧹 Cleaning stale currentRide:", driver.currentRide);

        driver.currentRide = null;
        driver.driverState = "searching";

        await driver.save();

        await setDriverState(driverId, "searching");
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

  // =============================
  // 💓 HEARTBEAT
  // =============================
  socket.on("driver-heartbeat", async (driverId) => {
    if (!rateLimit(`hb-${driverId}`, 5, 5000)) return;

    await updateHeartbeat(driverId);

    throttledLog(`heartbeat-${driverId}`, 5000, `💓 HEARTBEAT → ${driverId}`);
  });

  // =============================
  // 📍 LOCATION UPDATE (OPTIMIZED)
  // =============================
  socket.on("driver-location-update", async ({ driverId, lat, lng }) => {
    try {
      if (!rateLimit(`gps-${driverId}`, 20, 5000)) return;
      if (!driverId || lat == null || lng == null) return;

      const last = driverLastLocations.get(driverId);
      const now = Date.now();

      // =============================
      // 🚫 GPS VALIDATION
      // =============================
      if (last) {
        const distance = haversineDistance(last.lat, last.lng, lat, lng);
        const timeDiff = (now - last.timestamp) / 1000;

        if (timeDiff > 0) {
          const speed = distance / (timeDiff / 3600);

          if (speed > 120) {
            console.log("❌ GPS spoof detected:", driverId);
            return;
          }
        }
      }
      const smoothed = smoothLocation(last, { lat, lng });

      await updateHeartbeat(driverId)
      throttledLog(`gps-${driverId}`, 5000, "📍 GPS_UPDATE");

      // =============================
      // 🧠 REDIS UPDATE DECISION
      // =============================
      const driverState = (await getDriverState(driverId)) || "searching";

      const config = GPS_CONFIG[driverState] || GPS_CONFIG.searching;
      let shouldUpdateRedis = false;

      if (!last) {
        shouldUpdateRedis = true;
      } else {
        const distance = haversineDistance(
          last.lat,
          last.lng,
          smoothed.lat,
          smoothed.lng,
        );

        const timeDiff = now - last.timestamp;

        if (
          distance > config.minDistanceKm ||
          (timeDiff > config.minTimeMs && distance > config.minDistanceKm * 0.5)
        ) {
          shouldUpdateRedis = true;
        }
      }

      // =============================
      // 📍 UPDATE REDIS (SMART)
      // =============================
      if (shouldUpdateRedis) {
        updateDriverLocation(driverId, smoothed.lat, smoothed.lng).catch(
          (err) => {
            console.log("❌ GEO UPDATE FAIL:", err.message);
          },
        );
        console.log("📍 GEO Updated:", driverId);
      }

      // =============================
      // 🧠 UPDATE LOCAL CACHE (AFTER)
      // =============================
      driverLastLocations.set(driverId, {
        lat: smoothed.lat,
        lng: smoothed.lng,
        timestamp: Date.now(),
      });

      // =============================
      // 🧭 HEADING CALCULATION
      // =============================
      let heading = 0;

      if (last) {
        const dx = smoothed.lng - last.lng;
        const dy = smoothed.lat - last.lat;

        heading = (Math.atan2(dx, dy) * 180) / Math.PI;
        heading = (heading + 360) % 360;
      }

      // =============================
      // 📡 MAP DATA
      // =============================
      activeDrivers.set(driverId, {
        id: driverId,
        latitude: smoothed.lat,
        longitude: smoothed.lng,
        heading,
      });

      // =============================
      // 💾 DB UPDATE
      // =============================
      const lastDbUpdate = driverLastDBUpdate.get(driverId);

      if (!lastDbUpdate || Date.now() - lastDbUpdate > DB_UPDATE_INTERVAL) {
        await Driver.findByIdAndUpdate(driverId, {
          currentLocation: {
            type: "Point",
            coordinates: [smoothed.lng, smoothed.lat],
          },
          lastHeartbeat: new Date(),
        }).catch(() => {});

        driverLastDBUpdate.set(driverId, Date.now());
      }
    } catch (err) {
      console.log("\n❌ DRIVER LOCATION ERROR");
      console.log(err);
    }
  });

  // =============================
  // 🟢 ONLINE
  // =============================
  socket.on("driver-go-online", async (driverId) => {
    try {
      await Driver.findByIdAndUpdate(driverId, {
        isOnline: true,
        driverState: "searching",
        lastHeartbeat: new Date(),
      });

      await updateHeartbeat(driverId)
      await setDriverState(driverId, "searching");

      console.log("🟢 DRIVER ONLINE:", driverId);
    } catch (err) {
      console.log("❌ GO ONLINE ERROR:", err.message);
    }
  });

  // =============================
  // 🔴 OFFLINE
  // =============================
  socket.on("driver-go-offline", async (driverId) => {
    try {
      await Driver.findByIdAndUpdate(driverId, {
        isOnline: false,
        driverState: "offline",
        currentRide: null,
      });

      await removeHeartbeat(driverId)
      activeDrivers.delete(driverId);
      driverLastLocations.delete(driverId);

      driverLastDBUpdate.delete(driverId);

      onlineDrivers.delete(driverId);
      await removeDriverState(driverId);
      await removeDriver(driverId);

      console.log("🔴 DRIVER OFFLINE:", driverId);
    } catch (err) {
      console.log("❌ GO OFFLINE ERROR:", err.message);
    }
  });

  // =============================
  // 🗺️ MAP ROOM
  // =============================
  socket.on("join-map-room", () => {
    throttledLog(`map-room-${socket.id}`, 5000, "MAP_ROOM_JOIN");
    socket.join("rider-map-room");
  });
}
