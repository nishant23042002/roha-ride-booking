// /src/socket/ride.socket.js

import Ride from "../models/Ride.js";
import { getIO, onlineDrivers, onlineCustomers } from "./index.js";
import Driver from "../models/Driver.js";
import mongoose from "mongoose";
import { driverTiers } from "../config/driverTier.js";
import { calculateFare } from "../services/pricingEngine.js";
import { withRetry } from "../utils/withRetry.js";
import { creditDriverWallet } from "../services/walletService.js";

export default function registerRideHandlers(socket) {
  socket.on("register-customer", (customerId) => {
    onlineCustomers.set(customerId, socket.id);
    console.log("Customer registered:", customerId);
  });

  socket.on("accept-ride", async ({ rideId, driverId }) => {
    try {
      // 1️⃣ Fetch driver FIRST (outside transaction)
      const driverCheck = await Driver.findById(driverId);

      if (!driverCheck || !driverCheck.isAvailable) {
        throw new Error("Driver not available");
      }

      const HEARTBEAT_LIMIT = 30000;

      if (
        !driverCheck.lastHeartbeat ||
        Date.now() - new Date(driverCheck.lastHeartbeat).getTime() >
          HEARTBEAT_LIMIT
      ) {
        throw new Error("Driver connection unstable");
      }

      const ride = await withRetry(async () => {
        const session = await mongoose.startSession();
        session.startTransaction();

        try {
          console.log(`[${rideId}] ACCEPT_ATTEMPT driver=${driverId}`);

          // 1️⃣ Atomically claim ride (prevents double driver accept)
          const ride = await Ride.findOneAndUpdate(
            { _id: rideId, status: "requested" },
            {
              $set: {
                status: "accepted",
                driver: driverId,
              },
            },
            { returnDocument: "after", session },
          );

          if (!ride) {
            console.log(`[${rideId}] ACCEPT_REJECTED driver=${driverId}`);
            throw new Error("Ride already accepted");
          }

          // 2️⃣ Fetch driver inside transaction
          const driver = await Driver.findById(driverId).session(session);

          if (!driver || !driver.isAvailable) {
            throw new Error("Driver not available");
          }

          // const HEARTBEAT_LIMIT = 30000; // 30 seconds

          // if (
          //   !driver.lastHeartbeat ||
          //   Date.now() - new Date(driver.lastHeartbeat).getTime() >
          //     HEARTBEAT_LIMIT
          // ) {
          //   throw new Error("Driver connection unstable");
          // }

          // 3️⃣ Handle vehicle logic
          if (driver.vehicleType === "minidoor") {
            // Atomic seat allocation
            const updatedDriver = await Driver.findOneAndUpdate(
              {
                _id: driverId,
                currentSeatLoad: {
                  $lte: driver.vehicleCapacity - ride.passengerCount,
                },
              },
              {
                $inc: { currentSeatLoad: ride.passengerCount },
              },
              { new: true, session },
            );

            if (!updatedDriver) {
              throw new Error("Not enough seats available");
            }

            // If full after increment → mark unavailable
            if (
              updatedDriver.currentSeatLoad >= updatedDriver.vehicleCapacity
            ) {
              updatedDriver.isAvailable = false;
            }

            await updatedDriver.save({ session });

            console.log(
              "🪑 Seat Allocated | New Seat Load:",
              updatedDriver.currentSeatLoad,
            );
          } else {
            // Private vehicle protection
            if (driver.activeRide) {
              throw new Error("Driver already busy");
            }

            driver.isAvailable = false;
            driver.activeRide = ride._id;

            await driver.save({ session });
          }

          // 4️⃣ Commit transaction
          await session.commitTransaction();
          session.endSession();

          console.log(`[${rideId}] ACCEPT_SUCCESS driver=${driverId}`);
          return ride;
        } catch (error) {
          await session.abortTransaction();
          session.endSession();
          throw error;
        }
      });
      // 5️⃣ Emit AFTER commit
      socket.emit("ride-accepted-success", ride);

      const io = getIO();
      const customerSocketId = onlineCustomers.get(ride.customer.toString());

      if (customerSocketId) {
        io.to(customerSocketId).emit("ride-accepted", ride);
      }

      // Notify other drivers ride taken
      for (const [id, sockId] of onlineDrivers.entries()) {
        if (id !== driverId) {
          io.to(sockId).emit("ride-taken", rideId);
        }
      }
    } catch (error) {
      socket.emit("ride-error", error.message);
    }
  });

  socket.on("arrive-ride", async ({ rideId, driverId }) => {
    try {
      const ride = await Ride.findOneAndUpdate(
        { _id: rideId, driver: driverId, status: "accepted" },
        { $set: { status: "arrived", arrivalTime: new Date() } },
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

      console.log(`[${rideId}] DRIVER_ARRIVED driver=${driverId}`);
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

      console.log(`[${rideId}] RIDE_STARTED driver=${driverId}`);
    } catch (error) {
      socket.emit("ride-error", "Start failed");
    }
  });

  socket.on("complete-ride", async ({ rideId, driverId }) => {
    try {
      const result = await withRetry(async () => {
        const session = await mongoose.startSession();
        console.log(`[${rideId}] TX_START`);
        session.startTransaction();

        try {
          const ride = await Ride.findOneAndUpdate(
            {
              _id: rideId,
              driver: driverId,
              status: "ongoing",
            },
            {},
            { returnDocument: "after", session },
          );

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
            rideType: ride.rideType,
            rideStartTime: ride.rideStartTime,
          });

          let waitingMinutes = 0;
          let waitingCharge = 0;

          if (
            driver.vehicleType === "auto" &&
            ride.arrivalTime &&
            ride.rideStartTime
          ) {
            const diffMs =
              new Date(ride.rideStartTime).getTime() -
              new Date(ride.arrivalTime).getTime();

            waitingMinutes = Math.max(0, diffMs / (1000 * 60));
            waitingMinutes = Math.ceil(waitingMinutes);

            console.log(`[${rideId}] WAITING_MINUTES=${waitingMinutes}`);

            const FREE_MINUTES = 2;

            if (waitingMinutes > FREE_MINUTES) {
              const chargeableMinutes = waitingMinutes - FREE_MINUTES;

              const PER_KM_RATE = 17.14;
              const WAITING_RATE_PER_MIN = PER_KM_RATE * 0.1; // 10%

              waitingCharge = chargeableMinutes * WAITING_RATE_PER_MIN;

              ride.waitingMinutes = waitingMinutes;
              ride.waitingCharge = Number(waitingCharge.toFixed(2));

              console.log(
                `[${rideId}] WAITING_CHARGEABLE_MINUTES=${chargeableMinutes}`,
              );
              console.log(`[${rideId}] WAITING_CHARGE=${waitingCharge}`);
            } else {
              console.log("⏳ Within free waiting period");
            }
          }

          console.log(
            `[${rideId}] FARE_CALCULATED distance=${fareResult.distanceKm} base=${fareResult.finalFare}`,
          );

          ride.status = "completed";
          ride.rideEndTime = new Date();
          ride.rideDistanceKm = fareResult.distanceKm;
          ride.fare = Number((fareResult.finalFare + waitingCharge).toFixed(2));
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

          console.log(
            `[${rideId}] WALLET_CREDIT driver=${driverId} amount=${ride.driverEarning}`,
          );
          await creditDriverWallet({
            driverId,
            amount: ride.driverEarning,
            reason: "ride_earning",
            rideId: ride._id,
            session,
          });

          if (driver.vehicleType === "minidoor") {
            console.log("🪑 Before Complete SeatLoad:", driver.currentSeatLoad);
            driver.currentSeatLoad -= ride.passengerCount;
            console.log("🪑 After Complete SeatLoad:", driver.currentSeatLoad);
            if (driver.currentSeatLoad < 0) {
              driver.currentSeatLoad = 0;
            }

            if (driver.currentSeatLoad < driver.vehicleCapacity) {
              driver.isAvailable = true;
            }

            if (driver.currentSeatLoad === 0) {
              driver.activeRide = null;
            }
          } else {
            driver.isAvailable = true;
            driver.activeRide = null;
          }
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
          console.log(
            `[${ride._id}] RIDE_COMPLETED fare=${ride.fare} driverEarning=${ride.driverEarning}`,
          );
          return { ride };
        } catch (error) {
          await session.abortTransaction();
          session.endSession();
          throw error;
        }
      });
      const { ride } = result;
      const io = getIO();
      const customerSocketId = onlineCustomers.get(ride.customer.toString());

      if (customerSocketId) {
        io.to(customerSocketId).emit("ride-completed", ride);
      }

      socket.emit("ride-completed", ride);
    } catch (error) {
      socket.emit("ride-error", error.message);
    }
  });

  //CUSTOMER CANCELLATION
  socket.on("cancel-ride-by-customer", async ({ rideId, reason }) => {
    try {
      const ride = await withRetry(async () => {
        const session = await mongoose.startSession();

        try {
          session.startTransaction();

          const ride = await Ride.findOne({
            _id: rideId,
            status: { $in: ["requested", "accepted", "arrived"] },
          }).session(session);

          if (!ride) {
            throw new Error("Ride cannot be cancelled");
          }

          ride.status = "cancelled";
          ride.cancelledBy = "customer";
          ride.cancelReason = reason || "No reason provided";

          await ride.save({ session });

          if (ride.driver) {
            const driver = await Driver.findById(ride.driver).session(session);

            if (!driver) throw new Error("Driver not found");

            if (driver.vehicleType === "minidoor") {
              driver.currentSeatLoad -= ride.passengerCount;
              if (driver.currentSeatLoad < 0) driver.currentSeatLoad = 0;

              driver.isAvailable =
                driver.currentSeatLoad < driver.vehicleCapacity;

              if (driver.currentSeatLoad === 0) {
                driver.activeRide = null;
              }
            } else {
              driver.isAvailable = true;
              driver.activeRide = null;
            }

            await driver.save({ session });
          }

          await session.commitTransaction();
          session.endSession();

          return ride;
        } catch (error) {
          await session.abortTransaction();
          session.endSession();
          throw error;
        }
      });

      socket.emit("ride-cancelled-success", ride);
    } catch (error) {
      socket.emit("ride-error", error.message);
    }
  });

  //DRIVER CANCELLATION
  socket.on("cancel-ride-by-driver", async ({ rideId, driverId, reason }) => {
    try {
      const ride = await withRetry(async () => {
        const session = await mongoose.startSession();
        try {
          session.startTransaction();

          const ride = await Ride.findOne({
            _id: rideId,
            driver: driverId,
            status: { $in: ["accepted", "arrived"] },
          }).session(session);

          if (!ride) throw new Error("Cannot cancel this ride");

          ride.status = "cancelled";
          ride.cancelledBy = "driver";
          ride.cancelReason = reason || "Driver cancelled";

          await ride.save({ session });

          const driver = await Driver.findById(driverId).session(session);

          if (!driver) throw new Error("Driver not found");

          if (driver.vehicleType === "minidoor") {
            driver.currentSeatLoad -= ride.passengerCount;
            if (driver.currentSeatLoad < 0) driver.currentSeatLoad = 0;

            driver.isAvailable =
              driver.currentSeatLoad < driver.vehicleCapacity;

            if (driver.currentSeatLoad === 0) {
              driver.activeRide = null;
            }
          } else {
            driver.isAvailable = true;
            driver.activeRide = null;
          }

          await driver.save({ session });

          await session.commitTransaction();
          session.endSession();

          return ride;
        } catch (error) {
          await session.abortTransaction();
          session.endSession();
          throw error;
        }
      });

      socket.emit("ride-cancelled-success", ride);
    } catch (error) {
      socket.emit("ride-error", error.message);
    }
  });
}
