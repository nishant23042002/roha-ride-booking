// /src/socket/driver.socket.js

import Driver from "../models/Driver.js";
import Ride from "../models/Ride.js";
import { onlineDrivers, getIO } from "./index.js";
import { haversineDistance, smoothLocation } from "../utils/gpsUtils.js";
import { changeDriverState } from "../services/driverState.service.js";
import { banner, driverLog } from "../utils/rideLogger.js";
import { throttledLog } from "../core/logger/logger.js";

const activeDrivers = new Map();
const driverLastLocations = new Map();

setInterval(() => {
  const io = getIO();

  const drivers = Array.from(activeDrivers.values());
  if (!drivers.length) return;

  io.to("rider-map-room").emit("nearbyDrivers", drivers);
}, 1200);

export default function registerDriverHandlers(socket) {
  socket.on("register-driver", async (driverId) => {
    onlineDrivers.set(driverId, socket.id);

    socket.data.userId = driverId;
    socket.data.role = "driver";

    socket.join(`driver:${driverId}`);

    await changeDriverState({
      driverId,
      newState: "searching",
    });

    await Driver.findByIdAndUpdate(driverId, {
      lastHeartbeat: new Date(),
    });

    banner("DRIVER CONNECTED");

    console.log("DRIVER_CONNECTED", { driverId, socketId: socket.id });
  });

  socket.on("driver-heartbeat", async (driverId) => {
    await Driver.findByIdAndUpdate(driverId, {
      lastHeartbeat: new Date(),
    });

    throttledLog(`heartbeat-${driverId}`, 5000, `💓 HEARTBEAT → ${driverId}`);
  });

  socket.on("driver-location-update", async ({ driverId, lat, lng }) => {
    try {
      if (!driverId || lat === undefined || lng === undefined) return;
      const last = driverLastLocations.get(driverId);

      // Prevent unrealistic GPS jumps
      if (last) {
        const distance = haversineDistance(last.lat, last.lng, lat, lng);

        const timeDiff = (Date.now() - last.timestamp) / 1000;

        const speed = distance / (timeDiff / 3600); // km/h

        if (speed > 150) {
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

      throttledLog(`gps-${driverId}`, 5000, "📍 GPS_UPDATE", {
        driverId,
        lat: smoothed.lat,
        lng: smoothed.lng,
      });

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

      // Broadcast driver location to all connected rider app

      if (!driver) return;

      // If driver has ride → stream location to passenger
      if (driver.currentRide) {
        const io = getIO();
        const ride = await Ride.findById(driver.currentRide);

        if (!ride) return;

        // const customerSocketId = onlineCustomers.get(ride.customer.toString());
        const room = `ride:${ride._id}`;

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

  socket.on("join-map-room", (data) => {
    throttledLog(`map-room-${socket.id}`, 5000, "MAP_ROOM_JOIN", {
      socketId: socket.id,
      data,
    });
    socket.join("rider-map-room");
  });

  // socket.on("disconnect", async () => {
  //   for (const [driverId, sockId] of onlineDrivers.entries()) {
  //     if (sockId === socket.id) {
  //       await changeDriverState({
  //         driverId,
  //         newState: "offline",
  //       });

  //       onlineDrivers.delete(driverId);
  //       activeDrivers.delete(driverId);
  //       driverLastLocations.delete(driverId);

  //       banner("DRIVER DISCONNECTED");

  //       driverLog(
  //         driverId,
  //         "DISCONNECTED",
  //         "Driver socket disconnected and marked offline",
  //       );

  //       break;
  //     }
  //   }
  // });
}
