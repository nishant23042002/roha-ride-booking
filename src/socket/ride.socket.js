// /src/socket/ride.socket.js

import Ride from "../models/Ride.js";
import { getIO, onlineDrivers, onlineCustomers } from "./index.js";
import Driver from "../models/Driver.js";
import mongoose from "mongoose";
import { driverTiers } from "../config/driverTier.js";
import { calculateFare } from "../services/pricing/priceEngine.js";
import { withRetry } from "../utils/withRetry.js";
import { creditDriverWallet } from "../services/walletService.js";
import { changeDriverState } from "../services/driverState.service.js";
import { banner } from "../utils/rideLogger.js";
import { rideLog } from "../utils/rideLogger.js";

export default function registerRideHandlers(socket) {
  socket.on("register-customer", (customerId) => {
    onlineCustomers.set(customerId, socket.id);

    socket.data.userId = customerId;
    socket.data.role = "customer";

    socket.join(`customer:${customerId}`);

    console.log("CUSTOMER_CONNECTED", { customerId });
  });

  socket.on("accept-ride", async ({ rideId, driverId }) => {
    try {
      const result = await withRetry(async () => {
        const session = await mongoose.startSession();
        session.startTransaction();

        try {
          rideLog(
            rideId,
            "DRIVER_ACCEPT_ATTEMPT",
            "Driver attempting to claim ride",
            { driverId },
          );
          // -----------------------------
          // Fetch Driver
          // -----------------------------

          const driver = await Driver.findById(driverId).session(session);

          if (!driver) {
            throw new Error("Driver not found");
          }

          if (driver.driverState !== "requested") {
            throw new Error("Driver not available");
          }

          if (driver.currentRide?.toString() !== rideId) {
            throw new Error("Driver ride mismatch");
          }

          const HEARTBEAT_LIMIT = 30000;

          if (
            !driver.lastHeartbeat ||
            Date.now() - new Date(driver.lastHeartbeat).getTime() >
              HEARTBEAT_LIMIT
          ) {
            throw new Error("Driver connection unstable");
          }

          // -----------------------------
          // Claim Ride (atomic)
          // -----------------------------

          const ride = await Ride.findOneAndUpdate(
            {
              _id: rideId,
              status: "requested",
              driver: null,
            },
            {
              $set: {
                status: "accepted",
                driver: driverId,
              },
            },
            {
              returnDocument: "after",
              session,
            },
          );

          if (!ride) {
            rideLog(
              rideId,
              "ACCEPT_REJECTED",
              "Ride already taken by another driver",
              { driverId },
            );
            throw new Error("Ride already accepted");
          }

          // -----------------------------
          // Seat Allocation (shared vehicle)
          // -----------------------------

          if (driver.vehicleType === "minidoor") {
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

            rideLog(
              rideId,
              "SEAT_ALLOCATED",
              "Seat allocated for shared vehicle",
              {
                passengerCount: ride.passengerCount,
                newSeatLoad: updatedDriver.currentSeatLoad,
              },
            );
          }

          // -----------------------------
          // Driver State Update
          // -----------------------------

          await changeDriverState({
            driverId,
            newState: "to_pickup",
            rideId,
            session,
          });

          await session.commitTransaction();
          session.endSession();

          banner("RIDE CLAIMED");

          rideLog(
            rideId,
            "ACCEPT_SUCCESS",
            "Driver successfully claimed ride",
            { driverId },
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
      socket.emit("ride-accepted-success", ride);

      const room = `ride:${ride._id}`;

      socket.join(room);

      const customerSocketId = onlineCustomers.get(ride.customer.toString());

      if (customerSocketId) {
        const customerSocket = io.sockets.sockets.get(customerSocketId);

        customerSocket?.join(room);

        io.to(customerSocketId).emit("ride-accepted", ride);
      }

      // notify other drivers ride taken
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
      const result = await withRetry(async () => {
        const session = await mongoose.startSession();
        session.startTransaction();

        try {
          banner("DRIVER ARRIVING");

          rideLog(
            rideId,
            "ARRIVAL_ATTEMPT",
            "Driver reporting arrival at pickup",
            { driverId },
          );

          const ride = await Ride.findOne({
            _id: rideId,
            driver: driverId,
            status: "accepted",
          }).session(session);

          if (!ride) {
            throw new Error("Invalid arrival");
          }

          const driver = await Driver.findById(driverId).session(session);

          if (!driver) {
            throw new Error("Driver not found");
          }

          if (driver.currentRide?.toString() !== rideId) {
            throw new Error("Driver ride mismatch");
          }

          // -----------------------------
          // Update Ride
          // -----------------------------

          ride.status = "arrived";
          ride.arrivalTime = new Date();

          await ride.save({ session });

          // -----------------------------
          // Driver State Change
          // -----------------------------

          await changeDriverState({
            driverId,
            newState: "arrived",
            session,
          });

          await session.commitTransaction();
          session.endSession();

          rideLog(rideId, "DRIVER_ARRIVED", "Driver reached pickup location", {
            driverId,
          });

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
        io.to(customerSocketId).emit("ride-arrived", ride);
      }

      socket.emit("ride-arrived", ride);
    } catch (error) {
      socket.emit("ride-error", error.message);
    }
  });

  socket.on("start-ride", async ({ rideId, driverId }) => {
    try {
      const result = await withRetry(async () => {
        const session = await mongoose.startSession();
        session.startTransaction();

        try {
          banner("RIDE STARTING");

          rideLog(
            rideId,
            "START_RIDE_ATTEMPT",
            "Driver attempting to start ride",
            { driverId },
          );

          const ride = await Ride.findOne({
            _id: rideId,
            driver: driverId,
            status: "arrived",
          }).session(session);

          if (!ride) {
            throw new Error("Cannot start ride");
          }

          const driver = await Driver.findById(driverId).session(session);

          if (!driver) {
            throw new Error("Driver not found");
          }

          if (driver.currentRide?.toString() !== rideId) {
            throw new Error("Driver ride mismatch");
          }

          // -----------------------------
          // Update Ride
          // -----------------------------
          ride.status = "ongoing";
          ride.rideStartTime = new Date();

          await ride.save({ session });

          // -----------------------------
          // Driver State Change
          // -----------------------------
          await changeDriverState({
            driverId,
            newState: "on_trip",
            session,
          });

          await session.commitTransaction();
          session.endSession();

          rideLog(rideId, "RIDE_STARTED", "Ride has officially started", {
            driverId,
          });

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
        io.to(customerSocketId).emit("ride-started", ride);
      }

      socket.emit("ride-started", ride);
    } catch (error) {
      socket.emit("ride-error", error.message);
    }
  });

  socket.on("complete-ride", async ({ rideId, driverId }) => {
    try {
      const result = await withRetry(async () => {
        const session = await mongoose.startSession();
        session.startTransaction();

        try {
          const ride = await Ride.findOne({
            _id: rideId,
            driver: driverId,
            status: "ongoing",
          }).session(session);

          if (!ride) {
            throw new Error("Invalid ride state");
          }

          const driver = await Driver.findById(driverId).session(session);
          if (!driver) throw new Error("Driver missing");

          // -----------------------------
          // Calculate Fare
          // -----------------------------
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

            const FREE_MINUTES = 2;

            if (waitingMinutes > FREE_MINUTES) {
              const chargeableMinutes = waitingMinutes - FREE_MINUTES;

              const PER_KM_RATE = 17.14;
              const WAITING_RATE_PER_MIN = PER_KM_RATE * 0.1;

              waitingCharge = chargeableMinutes * WAITING_RATE_PER_MIN;

              ride.waitingMinutes = waitingMinutes;
              ride.waitingCharge = Number(waitingCharge.toFixed(2));
            }
          }

          banner("FARE CALCULATION");

          rideLog(
            rideId,
            "FARE_BREAKDOWN",
            "Fare calculated after trip completion",
            {
              distanceKm: fareResult.distanceKm,
              baseFare: fareResult.finalFare,
              waitingCharge,
            },
          );

          // -----------------------------
          // Final Ride Stats
          // -----------------------------
          ride.status = "completed";
          ride.rideEndTime = new Date();
          ride.rideDistanceKm = fareResult.distanceKm;

          const finalFare = fareResult.finalFare + waitingCharge;

          ride.fare = Number(finalFare.toFixed(2));

          const durationMinutes =
            (Date.now() - new Date(ride.rideStartTime).getTime()) / (1000 * 60);

          ride.rideDurationMinutes = Number(durationMinutes.toFixed(2));

          // -----------------------------
          // Commission Calculation
          // -----------------------------
          const tier =
            driverTiers
              .slice()
              .reverse()
              .find((t) => (driver.totalTrips || 0) >= t.minRides) ||
            driverTiers[0];

          const commissionPercent = Math.max(tier.commission, 12);
          const commission = (ride.fare * commissionPercent) / 100;

          const driverEarning = ride.fare - commission;

          ride.platformCommission = Number(commission.toFixed(2));
          ride.driverEarning = Number(driverEarning.toFixed(2));

          await ride.save({ session });

          // -----------------------------
          // Driver Stats Update
          // -----------------------------
          driver.totalTrips += 1;
          driver.totalEarnings += ride.driverEarning;
          driver.totalDistanceKm += ride.rideDistanceKm;

          // -----------------------------
          // Wallet Credit
          // -----------------------------
          await creditDriverWallet({
            driverId,
            amount: ride.driverEarning,
            reason: "ride_earning",
            rideId: ride._id,
            session,
          });

          // -----------------------------
          // Shared vehicle seat logic
          // -----------------------------
          if (driver.vehicleType === "minidoor") {
            driver.currentSeatLoad -= ride.passengerCount;

            if (driver.currentSeatLoad < 0) {
              driver.currentSeatLoad = 0;
            }
          }

          // -----------------------------
          // Reset Ride Reference
          // -----------------------------
          driver.currentRide = null;

          // -----------------------------
          // Reset Driver State
          // -----------------------------
          await changeDriverState({
            driverId,
            newState: "searching",
            session,
          });

          await driver.save({ session });

          await session.commitTransaction();
          session.endSession();

          banner("RIDE COMPLETED");

          rideLog(ride._id, "TRIP_FINISHED", "Ride completed successfully", {
            fare: ride.fare,
            driverEarning: ride.driverEarning,
            platformCommission: ride.platformCommission,
            distanceKm: ride.rideDistanceKm,
            durationMin: ride.rideDurationMinutes,
          });

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

  socket.on("join-ride-room", ({ rideId }) => {
    socket.join(`ride:${rideId}`);
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

          banner("RIDE CANCELLED");

          rideLog(
            ride._id,
            "CUSTOMER_CANCELLED",
            "Ride cancelled by customer",
            {
              reason: ride.cancelReason,
            },
          );

          await ride.save({ session });

          // If driver already assigned
          if (ride.driver) {
            const driver = await Driver.findById(ride.driver).session(session);

            if (!driver) throw new Error("Driver not found");

            if (driver.vehicleType === "minidoor") {
              driver.currentSeatLoad -= ride.passengerCount;

              if (driver.currentSeatLoad < 0) {
                driver.currentSeatLoad = 0;
              }
            }

            // reset ride reference
            driver.currentRide = null;

            // return driver to searching state
            await changeDriverState({
              driverId: driver._id,
              newState: "searching",
              session,
            });

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

      const io = getIO();
      const customerSocketId = onlineCustomers.get(ride.customer.toString());

      if (customerSocketId) {
        io.to(customerSocketId).emit("ride-cancelled", ride);
      }
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

          if (!ride) {
            throw new Error("Cannot cancel this ride");
          }

          ride.status = "cancelled";
          ride.cancelledBy = "driver";
          ride.cancelReason = reason || "Driver cancelled";

          await ride.save({ session });

          const driver = await Driver.findById(driverId).session(session);

          if (!driver) throw new Error("Driver not found");

          banner("RIDE CANCELLED");

          rideLog(ride._id, "DRIVER_CANCELLED", "Ride cancelled by driver", {
            driverId,
            reason: ride.cancelReason,
          });

          if (driver.vehicleType === "minidoor") {
            driver.currentSeatLoad -= ride.passengerCount;

            if (driver.currentSeatLoad < 0) {
              driver.currentSeatLoad = 0;
            }
          }

          driver.currentRide = null;

          await changeDriverState({
            driverId,
            newState: "searching",
            session,
          });

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

      const io = getIO();
      const customerSocketId = onlineCustomers.get(ride.customer.toString());

      if (customerSocketId) {
        io.to(customerSocketId).emit("ride-cancelled", ride);
      }
    } catch (error) {
      socket.emit("ride-error", error.message);
    }
  });
}
