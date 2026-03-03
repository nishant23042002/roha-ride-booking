// /src/socket/ride.socket.js

import Ride from "../models/Ride.js";
import { getIO, onlineDrivers, onlineCustomers } from "./index.js";
import Driver from "../models/Driver.js";
import { calculateDistance } from "../utils/distance.js";
import { pricing } from "../config/pricing.js";

export default function registerRideHandlers(socket) {
  socket.on("register-customer", (customerId) => {
    onlineCustomers.set(customerId, socket.id);
    console.log("Customer registered:", customerId);
  });

  socket.on("accept-ride", async ({ rideId, driverId }) => {
    try {
      // 1️⃣ Check driver availability
      const driver = await Driver.findOne({
        _id: driverId,
        isAvailable: true,
        activeRide: null,
      });

      if (!driver) {
        return socket.emit("ride-error", "Driver not available");
      }

      // 2️⃣ Atomic ride claim
      const ride = await Ride.findOneAndUpdate(
        { _id: rideId, status: "requested" },
        {
          $set: {
            status: "accepted",
            driver: driverId,
          },
        },
        { returnDocument: "after" },
      );

      if (!ride) {
        return socket.emit("ride-error", "Ride already taken");
      }

      // 3️⃣ Mark driver unavailable
      await Driver.findByIdAndUpdate(driverId, {
        isAvailable: false,
        activeRide: ride._id,
      });

      const io = getIO();

      // Notify customer
      const customerSocketId = onlineCustomers.get(ride.customer.toString());

      if (customerSocketId) {
        io.to(customerSocketId).emit("ride-accepted", ride);
      }

      // Notify other drivers
      for (const [id, sockId] of onlineDrivers.entries()) {
        if (id !== driverId) {
          io.to(sockId).emit("ride-taken", rideId);
        }
      }

      // 6️⃣ Notify accepting driver success
      socket.emit("ride-accepted-success", ride);

      console.log("Ride accepted by:", driverId);
    } catch (error) {
      socket.emit("ride-error", "Server error");
    }
  });

  socket.on("arrive-ride", async ({ rideId, driverId }) => {
    try {
      const ride = await Ride.findOneAndUpdate(
        { _id: rideId, driver: driverId, status: "accepted" },
        { $set: { status: "arrived" } },
        { returnDocument: "after" },
      );

      if (!ride) return socket.emit("ride-error", "Invalid arrival");

      const io = getIO();
      const customerSocketId = onlineCustomers.get(ride.customer.toString());

      if (customerSocketId) {
        io.to(customerSocketId).emit("ride-arrived", ride);
      }

      // ALSO notify driver
      socket.emit("ride-arrived", ride);

      console.log("Driver arrived at pickup:", rideId);
    } catch (error) {
      socket.emit("ride-error", "Arrival failed");
    }
  });

  socket.on("start-ride", async ({ rideId, driverId }) => {
    try {
      const ride = await Ride.findOneAndUpdate(
        { _id: rideId, driver: driverId, status: "arrived" },
        {
          $set: {
            status: "ongoing",
            rideStartTime: new Date(),
          },
        },
        { returnDocument: "after" },
      );

      if (!ride) return socket.emit("ride-error", "Cannot start ride");

      const io = getIO();
      const customerSocketId = onlineCustomers.get(ride.customer.toString());

      if (customerSocketId) {
        io.to(customerSocketId).emit("ride-started", ride);
      }

      // notify driver
      socket.emit("ride-started", ride);

      console.log("Ride started:", rideId);
    } catch (error) {
      socket.emit("ride-error", "Start failed");
    }
  });

  socket.on("complete-ride", async ({ rideId, driverId }) => {
    try {
      const ride = await Ride.findOneAndUpdate(
        { _id: rideId, driver: driverId, status: "ongoing" },
        {
          $set: {
            status: "completed",
            rideEndTime: new Date(),
          },
        },
        { returnDocument: "after" },
      );

      if (!ride) return socket.emit("ride-error", "Cannot complete ride");

      // 🔢 Calculate Distance
      const [pickupLon, pickupLat] = ride.pickupLocation.coordinates;
      const [dropLon, dropLat] = ride.dropLocation.coordinates;

      const distance = calculateDistance(
        pickupLat,
        pickupLon,
        dropLat,
        dropLon,
      );

      // Calculate duration
      const start = new Date(ride.rideStartTime);
      const end = new Date();
      const durationMinutes = (end - start) / (1000 * 60);

      // Store values
      ride.rideDistanceKm = Number(distance.toFixed(2));
      ride.rideDurationMinutes = Number(durationMinutes.toFixed(2));

      // Get driver vehicle type
      const driver = await Driver.findById(driverId);

      const vehiclePricing = pricing[driver.vehicleType];

      const fare = vehiclePricing.baseFare + distance * vehiclePricing.perKm;

      // Round to 2 decimals
      ride.fare = Number(fare.toFixed(2));

      await ride.save();

      // 🔓 Unlock driver
      await Driver.findByIdAndUpdate(driverId, {
        isAvailable: true,
        activeRide: null,
      });

      const io = getIO();
      const customerSocketId = onlineCustomers.get(ride.customer.toString());

      if (customerSocketId) {
        io.to(customerSocketId).emit("ride-completed", ride);
      }

      // notify driver
      socket.emit("ride-completed", ride);
      console.log("RIDE FAIR: ", ride.fare);

      console.log("Ride completed:", rideId);
    } catch (error) {
      socket.emit("ride-error", "Completion failed");
    }
  });
  //CUSTOMER CANCELLATION
  socket.on("cancel-ride-by-customer", async ({ rideId, reason }) => {
    try {
      const ride = await Ride.findById(rideId);

      if (!ride) {
        return socket.emit("ride-error", "Ride not found");
      }

      // 🔐 Strict State Check
      const allowedStates = ["requested", "accepted", "arrived"];

      if (!allowedStates.includes(ride.status)) {
        return socket.emit("ride-error", "Cannot cancel at this stage");
      }

      ride.status = "cancelled";
      ride.cancelledBy = "customer";
      ride.cancelReason = reason || "No reason provided";

      await ride.save();

      // 🔓 Unlock driver if exists
      if (ride.driver) {
        await Driver.findByIdAndUpdate(ride.driver, {
          isAvailable: true,
          activeRide: null,
        });
      }

      const io = getIO();

      // Notify driver
      if (ride.driver) {
        const driverSocketId = onlineDrivers.get(ride.driver.toString());

        if (driverSocketId) {
          io.to(driverSocketId).emit("ride-cancelled", ride);
        }
      }

      socket.emit("ride-cancelled-success", ride);

      console.log("Ride cancelled by customer:", rideId);
    } catch (error) {
      socket.emit("ride-error", "Cancellation failed");
    }
  });

  //DRIVER CANCELLATION
  socket.on("cancel-ride-by-driver", async ({ rideId, driverId, reason }) => {
    try {
      const ride = await Ride.findOne({
        _id: rideId,
        driver: driverId,
      });

      if (!ride) {
        return socket.emit("ride-error", "Ride not found");
      }

      const allowedStates = ["accepted", "arrived"];

      if (!allowedStates.includes(ride.status)) {
        return socket.emit("ride-error", "Driver cannot cancel at this stage");
      }

      ride.status = "cancelled";
      ride.cancelledBy = "driver";
      ride.cancelReason = reason || "Driver cancelled";

      await ride.save();

      // 🔓 Unlock driver
      await Driver.findByIdAndUpdate(driverId, {
        isAvailable: true,
        activeRide: null,
      });

      const io = getIO();

      // Notify customer
      const customerSocketId = onlineCustomers.get(ride.customer.toString());

      if (customerSocketId) {
        io.to(customerSocketId).emit("ride-cancelled", ride);
      }

      socket.emit("ride-cancelled-success", ride);

      console.log("Ride cancelled by driver:", rideId);
    } catch (error) {
      socket.emit("ride-error", "Cancellation failed");
    }
  });
}
