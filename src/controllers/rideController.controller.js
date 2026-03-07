// src/controller/rideController.controller.js

import Ride from "../models/Ride.js";
import Driver from "../models/Driver.js";
import { getIO, onlineDrivers } from "../socket/index.js";
import { calculateETA } from "../utils/eta.js";
import { calculateFare } from "../services/pricing/priceEngine.js";
import { vehicleRules } from "../config/vehicleRules.js";
import User from "../models/User.js";
import mongoose from "mongoose";
import { changeDriverState } from "../services/driverState.service.js";
import { rideLog } from "../utils/rideLogger.js";
import { banner } from "../utils/rideLogger.js";
import { findBestDrivers } from "../services/dispatch/dispatchEngine.js";

// 🔴 Create Ride Request
export const requestRide = async (req, res) => {
  try {
    const {
      customerId,
      pickupLongitude,
      pickupLatitude,
      dropLongitude,
      dropLatitude,
      vehicleType,
      demandMultiplier,
      passengerCount = 1,
      rideType = "private",
    } = req.body;

    // 1️⃣ Validate required fields
    if (
      pickupLongitude === undefined ||
      pickupLatitude === undefined ||
      dropLongitude === undefined ||
      dropLatitude === undefined ||
      !vehicleType
    ) {
      return res.status(400).json({
        message: "Missing required fields",
      });
    }

    if (!mongoose.Types.ObjectId.isValid(customerId)) {
      return res.status(400).json({
        message: "Invalid customer id",
      });
    }

    banner("NEW RIDE REQUEST");

    console.log("👤 CUSTOMER:", customerId);

    console.log(
      `🚘 VEHICLE=${vehicleType} | PASSENGERS=${passengerCount} | TYPE=${rideType}`,
    );

    console.log(
      `📍 PICKUP=(${pickupLatitude}, ${pickupLongitude}) → DROP=(${dropLatitude}, ${dropLongitude})`,
    );

    // 2️⃣ Validate customer
    const customer = await User.findById(customerId);
    if (!customer) {
      return res.status(404).json({
        message: "Customer not found",
      });
    }

    if (!vehicleType) {
      return res.status(400).json({
        message: "Vehicle type is required",
      });
    }

    const rule = vehicleRules[vehicleType];

    if (!rule) {
      return res.status(400).json({
        message: "Invalid vehicle type",
      });
    }

    if (passengerCount < 1 || passengerCount > rule.maxPassengers) {
      return res.status(400).json({
        message: `Maximum ${rule.maxPassengers} passengers allowed for ${vehicleType}`,
      });
    }

    const fareResult = calculateFare({
      vehicleType,
      pickupLat: pickupLatitude,
      pickupLon: pickupLongitude,
      dropLat: dropLatitude,
      dropLon: dropLongitude,
      demandMultiplier,
      passengerCount,
      rideType,
    });

    const estimatedETA = calculateETA(fareResult.distanceKm, vehicleType);

    const ride = await Ride.create({
      customer: customerId,
      vehicleType,
      passengerCount,
      rideType,
      pickupLocation: {
        type: "Point",
        coordinates: [pickupLongitude, pickupLatitude],
      },
      dropLocation: {
        type: "Point",
        coordinates: [dropLongitude, dropLatitude],
      },
      estimatedETA,
      estimatedDistanceKm: fareResult.distanceKm,
      estimatedFare: fareResult.finalFare,
    });
    banner("RIDE CREATED");

    rideLog(ride._id, "RIDE_CREATED", "Ride document created successfully", {
      vehicleType,
      passengerCount,
      rideType,
    });

    rideLog(ride._id, "ESTIMATION", "Estimated trip details calculated", {
      distanceKm: fareResult.distanceKm,
      estimatedFare: fareResult.finalFare,
      etaMinutes: estimatedETA,
    });

    // 6️⃣ Find nearby drivers
    const HEARTBEAT_LIMIT = 30000;
    banner("SEARCHING NEARBY DRIVERS");

    // const drivers = await Driver.find({
    //   vehicleType,

    //   // ✅ new state machine condition
    //   driverState: "searching",

    //   vehicleCapacity: { $gte: passengerCount },

    //   lastHeartbeat: {
    //     $gte: new Date(Date.now() - HEARTBEAT_LIMIT),
    //   },

    //   currentLocation: {
    //     $near: {
    //       $geometry: {
    //         type: "Point",
    //         coordinates: [pickupLongitude, pickupLatitude],
    //       },
    //       $maxDistance: 5000,
    //     },
    //   },
    // }).limit(5);
    const { drivers: rankedDrivers, radius } = await findBestDrivers({
      pickupLat: pickupLatitude,
      pickupLng: pickupLongitude,
      vehicleType,
      passengerCount,
      heartbeatLimit: HEARTBEAT_LIMIT,
    });

    console.log(`DISPATCH SEARCH RADIUS: ${radius} meters`);

    rideLog(ride._id, "DRIVER_SEARCH_RESULT", "Nearby drivers found", {
      driversFound: rankedDrivers.length,
      searchRadius: `${radius}m `,
    });

    if (!rankedDrivers.length) {
      banner("NO DRIVERS AVAILABLE");

      rideLog(
        "N/A",
        "DISPATCH_FAILED",
        "No drivers found near pickup location",
        {
          vehicleType,
          pickupLat: pickupLatitude,
          pickupLng: pickupLongitude,
        },
      );

      return res.status(404).json({
        message: "No drivers available nearby",
      });
    }

    const io = getIO();

    banner("DISPATCHING RIDE");

    // 7️⃣ Dispatch ride to multiple drivers
    // for (const driver of rankedDrivers) {
    //   rideLog(ride._id, "DISPATCH_DRIVER", "Ride request sent to driver", {
    //     driverId: driver._id,
    //   });

    //   await changeDriverState({
    //     driverId: driver._id,
    //     newState: "requested",
    //     rideId: ride._id,
    //   });
    //   const socketId = onlineDrivers.get(driver._id.toString());

    //   if (socketId) {
    //     io.to(socketId).emit("new-ride", ride);
    //   }
    // }

    const TOP_DRIVERS = 5;

    const driversToDispatch = rankedDrivers.slice(0, TOP_DRIVERS);

    for (const entry of driversToDispatch) {
      const driver = entry.driver;

      console.log(`Dispatching driver ${driver._id} ETA=${entry.etaMinutes}`);

      await changeDriverState({
        driverId: driver._id,
        newState: "requested",
        rideId: ride._id,
      });

      const socketId = onlineDrivers.get(driver._id.toString());

      if (socketId) {
        io.to(socketId).emit("new-ride", ride);
      }
    }

    res.status(201).json({
      message: "Ride requested successfully",
      ride,
      notifiedDrivers: rankedDrivers.length,
    });
  } catch (error) {
    console.log("\n❌ RIDE REQUEST ERROR");
    console.log(error);
    res.status(500).json({ message: error.message });
  }
};

// 🔴 Update Ride Status
export const updateRideStatus = async (req, res) => {
  try {
    const { rideId, status } = req.body;

    const ride = await Ride.findById(rideId);
    if (!ride) return res.status(404).json({ message: "Ride not found" });

    // 🚨 Prevent going ongoing without driver
    if ((status === "ongoing" || status === "completed") && !ride.driver) {
      return res.status(400).json({
        message: "Ride has no assigned driver",
      });
    }

    // 🔐 Strict transitions
    const allowedTransitions = {
      requested: ["accepted", "cancelled"],
      accepted: ["ongoing", "cancelled"],
      ongoing: ["completed"],
      completed: [],
      cancelled: [],
    };

    if (!allowedTransitions[ride.status].includes(status)) {
      return res.status(400).json({
        message: `Invalid transition from ${ride.status} to ${status}`,
      });
    }

    ride.status = status;
    await ride.save();

    rideLog(rideId, "STATUS_UPDATE", "Ride status updated", {
      newStatus: status,
    });

    console.log("Ride driver:", ride.driver);

    res.status(200).json({
      message: "Ride updated successfully",
      ride,
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

export const getAllRides = async (req, res) => {
  try {
    const rides = await Ride.find().populate("driver").populate("customer");
    console.log(`📊 ADMIN FETCHED ALL RIDES | total=${rides.length}`);

    res.status(200).json({
      count: rides.length,
      rides,
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};
