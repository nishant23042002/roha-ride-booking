// /src/socket/driver.socket.js

import Driver from "../models/Driver.js";
import Ride from "../models/Ride.js";
import { onlineDrivers, onlineCustomers, getIO } from "./index.js";
import { haversineDistance, smoothLocation } from "../utils/gpsUtils.js";
import { changeDriverState } from "../services/driverState.service.js";
import { banner, driverLog } from "../utils/rideLogger.js";

const activeDrivers = new Map();
const driverLastLocations = new Map();

setInterval(() => {
  const io = getIO();

  const drivers = Array.from(activeDrivers.values());

  if (drivers.length === 0) return;
  if (process.env.NODE_ENV === "development") {
    console.log("📡 Drivers:", drivers.length);
  }

  io.to("rider-map-room").emit("nearbyDrivers", drivers);
}, 1200);

export default function registerDriverHandlers(socket) {
  socket.on("register-driver", async (driverId) => {
    onlineDrivers.set(driverId, socket.id);

    await changeDriverState({
      driverId,
      newState: "searching",
    });

    await Driver.findByIdAndUpdate(driverId, {
      lastHeartbeat: new Date(),
    });

    banner("DRIVER CONNECTED");

    driverLog(
      driverId,
      "CONNECTED",
      "Driver socket registered and marked online",
      { socketId: socket.id },
    );
  });

  socket.on("driver-heartbeat", async (driverId) => {
    await Driver.findByIdAndUpdate(driverId, {
      lastHeartbeat: new Date(),
    });

    driverLog(driverId, "HEARTBEAT", "Driver connection alive");
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
          driverLog(
            driverId,
            "GPS_REJECTED",
            "Unrealistic GPS speed detected",
            { speed: speed.toFixed(2) + "km/h" },
          );
          return;
        }
      }

      const smoothed = smoothLocation(last, { lat, lng });

      driverLastLocations.set(driverId, {
        lat: smoothed.lat,
        lng: smoothed.lng,
        timestamp: Date.now(),
      });

      activeDrivers.set(driverId, {
        id: driverId,
        latitude: smoothed.lat,
        longitude: smoothed.lng,
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

      // Broadcast driver location to all connected rider apps

      driverLog(driverId, "GPS_UPDATE", "Driver location updated", {
        lat: smoothed.lat.toFixed(6),
        lng: smoothed.lng.toFixed(6),
      });

      if (!driver) return;

      // If driver has ride → stream location to passenger
      if (driver.currentRide) {
        const io = getIO();
        const ride = await Ride.findById(driver.currentRide);

        if (!ride) return;

        const customerSocketId = onlineCustomers.get(ride.customer.toString());

        if (customerSocketId) {
          driverLog(
            driverId,
            "LOCATION_STREAM",
            "Driver location streamed to passenger",
            { rideId: ride._id },
          );
          io.to(customerSocketId).emit("driver-location", {
            driverId,
            lat: smoothed.lat,
            lng: smoothed.lng,
            timestamp: Date.now(),
          });
        }
      }
    } catch (err) {
      console.log("\n❌ DRIVER LOCATION ERROR");
      console.log(err);
    }
  });

  socket.on("join-map-room", (data) => {
    console.log("🗺️ USER JOINED MAP ROOM:", socket.id, data);
    socket.join("rider-map-room");
  });

  socket.on("disconnect", async () => {
    for (const [driverId, sockId] of onlineDrivers.entries()) {
      if (sockId === socket.id) {
        await changeDriverState({
          driverId,
          newState: "offline",
        });

        onlineDrivers.delete(driverId);
        activeDrivers.delete(driverId);
        driverLastLocations.delete(driverId);

        banner("DRIVER DISCONNECTED");

        driverLog(
          driverId,
          "DISCONNECTED",
          "Driver socket disconnected and marked offline",
        );

        break;
      }
    }
  });
}
