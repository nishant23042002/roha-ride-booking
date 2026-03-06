// /src/socket/driver.socket.js

import Driver from "../models/Driver.js";
import Ride from "../models/Ride.js";
import { onlineDrivers, onlineCustomers, getIO } from "./index.js";
import { haversineDistance, smoothLocation } from "../utils/gpsUtils.js";
import { changeDriverState } from "../services/driverState.service.js";

const driverLastLocations = new Map();

export default function registerDriverHandlers(socket) {
  socket.on("register-driver", async (driverId) => {
    onlineDrivers.set(driverId, socket.id);

    await changeDriverState({
      driverId,
      newState: "online",
    });

    await Driver.findByIdAndUpdate(driverId, {
      lastHeartbeat: new Date(),
    });

    console.log(`[DRIVER ${driverId}] CONNECTED`);
  });

  socket.on("driver-heartbeat", async (driverId) => {
    await Driver.findByIdAndUpdate(driverId, {
      lastHeartbeat: new Date(),
    });
  });

  socket.on("driver-go-online", async (driverId) => {
    await changeDriverState({
      driverId,
      newState: "searching",
    });

    console.log(`[DRIVER ${driverId}] READY_FOR_RIDES`);
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
          console.log(`[DRIVER ${driverId}] GPS_REJECTED unrealistic_speed`);
          return;
        }
      }

      const smoothed = smoothLocation(last, { lat, lng });

      driverLastLocations.set(driverId, {
        lat: smoothed.lat,
        lng: smoothed.lng,
        timestamp: Date.now(),
      });

      console.log(
        `[DRIVER ${driverId}] GPS_UPDATE lat=${smoothed.lat} lng=${smoothed.lng}`,
      );

      const driver = await Driver.findByIdAndUpdate(
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

      if (!driver) return;

      const io = getIO();

      // If driver has ride → stream location to passenger
      if (driver.currentRide) {
        const ride = await Ride.findById(driver.currentRide);

        if (!ride) return;

        const customerSocketId = onlineCustomers.get(ride.customer.toString());

        if (customerSocketId) {
          io.to(customerSocketId).emit("driver-location", {
            driverId,
            lat: smoothed.lat,
            lng: smoothed.lng,
            timestamp: Date.now(),
          });
        }
      }
    } catch (err) {
      console.log("Location update error", err);
    }
  });

  socket.on("disconnect", async () => {
    for (const [driverId, sockId] of onlineDrivers.entries()) {
      if (sockId === socket.id) {
        await changeDriverState({
          driverId,
          newState: "offline",
        });

        onlineDrivers.delete(driverId);

        console.log(`[DRIVER ${driverId}] DISCONNECTED`);

        break;
      }
    }
  });
}
