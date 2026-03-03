// /src/socket/ride.socket.js

import Ride from "../models/Ride.js";
import { getIO, onlineDrivers, onlineCustomers } from "./index.js";
import Driver from "../models/Driver.js";
import mongoose from "mongoose";
import { driverTiers } from "../config/driverTier.js";
import { calculateFare } from "../services/pricingEngine.js";

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
    const session = await mongoose.startSession();
    console.log("🟡 TX START | Ride:", rideId);

    try {
      session.startTransaction();
      const io = getIO();

      const ride = await Ride.findOneAndUpdate({
        _id: rideId,
        driver: driverId,
        status: "ongoing",
      }).session(session);

      if (!ride) {
        console.log("❌ Ride not found or invalid state");
        throw new Error("Invalid ride state");
      }

      console.log("✅ Ride found");

      // Fetch driver
      const driver = await Driver.findById(driverId).session(session);
      if (!driver) {
        console.log("❌ Driver not found");
        throw new Error("Driver missing");
      }

      console.log("✅ Driver found");

      // 🔥 Calculate fare
      const fareResult = calculateFare({
        vehicleType: driver.vehicleType,
        pickupLat: ride.pickupLocation.coordinates[1],
        pickupLon: ride.pickupLocation.coordinates[0],
        dropLat: ride.dropLocation.coordinates[1],
        dropLon: ride.dropLocation.coordinates[0],
        passengerCount: ride.passengerCount,
        rideType: ride.rideType
      });

      console.log("💰 Fare calculated:", fareResult);

      ride.status = "completed";
      ride.rideEndTime = new Date();
      ride.rideDistanceKm = fareResult.distanceKm;
      ride.fare = fareResult.finalFare;

      const durationMinutes =
        (Date.now() - new Date(ride.rideStartTime).getTime()) / (1000 * 60);

      ride.rideDurationMinutes = Number(durationMinutes.toFixed(2));

      // 🏆 Tier logic
      const tier = driverTiers
        .slice()
        .reverse()
        .find((t) => (driver.totalTrips || 0) >= t.minRides);

      const commissionPercent = Math.max(tier.commission, 12);
      const commission = (ride.fare * commissionPercent) / 100;
      const driverEarning = ride.fare - commission;

      ride.platformCommission = Number(commission.toFixed(2));
      ride.driverEarning = Number(driverEarning.toFixed(2));

      console.log("📊 Commission:", commissionPercent, "%");

      await ride.save({ session });

      console.log("✅ Ride saved inside TX");

      // 5️⃣ Update driver stats inside transaction
      driver.totalTrips += 1;
      driver.totalEarnings += ride.driverEarning;
      driver.totalDistanceKm += ride.rideDistanceKm;
      driver.walletBalance += ride.driverEarning;
      driver.isAvailable = true;
      driver.activeRide = null;

      // 🔼 Tier upgrade check
      const newTier = driverTiers
        .slice()
        .reverse()
        .find((t) => (driver.totalTrips || 0) >= t.minRides);

      let tierUpgraded = false;

      if (driver.tierLevel !== newTier.level) {
        driver.tierLevel = newTier.level;
        driver.tierName = newTier.name;
        tierUpgraded = true;
        console.log("🏆 Tier upgraded to:", newTier.name);
      }

      await driver.save({ session });

      console.log("✅ Driver updated inside TX");

      // 6️⃣ COMMIT (ALWAYS)
      await session.commitTransaction();
      session.endSession();

      console.log("🟢 TX COMMITTED SUCCESSFULLY");

      // 7️⃣ Emit AFTER commit
      const customerSocketId = onlineCustomers.get(ride.customer.toString());

      if (customerSocketId) {
        io.to(customerSocketId).emit("ride-completed", ride);
      }

      socket.emit("ride-completed", ride);

      if (tierUpgraded) {
        const driverSocketId = onlineDrivers.get(driverId.toString());
        if (driverSocketId) {
          io.to(driverSocketId).emit("tier-upgraded", {
            newTier: newTier.name,
            commissionPercent,
          });
        }
      }

      console.log(`Ride ${ride._id} completed safely | Fare ₹${ride.fare} | Driver Rs. ${ride.driverEarning}`);
    } catch (error) {
      await session.abortTransaction();
      session.endSession();

      console.error("Transaction Error:", error);
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
