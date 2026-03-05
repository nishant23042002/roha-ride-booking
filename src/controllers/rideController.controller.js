import Ride from "../models/Ride.js";
import Driver from "../models/Driver.js";
import { getIO, onlineDrivers } from "../socket/index.js";
import { calculateETA } from "../utils/eta.js";
import { calculateFare } from "../services/pricingEngine.js";
import { vehicleRules } from "../config/vehicleRules.js";
import User from "../models/User.js";
import mongoose from "mongoose";

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

    console.log(`🟡REQUEST_RIDE_START`);
    console.log(`[REQUEST] customer=${customerId}`);
    console.log(
      `[REQUEST] vehicle=${vehicleType} passengers=${passengerCount} type=${rideType}`,
    );
    console.log(
      `[REQUEST] pickup=(${pickupLatitude},${pickupLongitude}) drop=(${dropLatitude},${dropLongitude})`,
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
    console.log(`[${ride._id}] RIDE_CREATED`);
    console.log(`[${ride._id}] EST_DISTANCE=${fareResult.distanceKm}km`);
    console.log(`[${ride._id}] EST_FARE=${fareResult.finalFare}`);

    // 6️⃣ Find nearby drivers
    const HEARTBEAT_LIMIT = 30000;

    const drivers = await Driver.find({
      vehicleType,
      isAvailable: true,
      vehicleCapacity: { $gte: passengerCount },

      lastHeartbeat: {
        $gte: new Date(Date.now() - HEARTBEAT_LIMIT),
      },

      currentLocation: {
        $near: {
          $geometry: {
            type: "Point",
            coordinates: [pickupLongitude, pickupLatitude],
          },
          $maxDistance: 5000,
        },
      },
    }).limit(5); // dispatch to top 5 drivers

    if (!drivers.length) {
      return res.status(404).json({
        message: "No drivers available nearby",
      });
    }

    const io = getIO();
    
    console.log(`[${ride._id}] DISPATCH_START drivers=${drivers.length}`);
    // 7️⃣ Dispatch ride to multiple drivers
    for (const driver of drivers) {
      console.log(`[${ride._id}] DISPATCH_DRIVER driver=${driver._id}`);
      const socketId = onlineDrivers.get(driver._id.toString());

      if (socketId) {
        io.to(socketId).emit("new-ride", ride);
      }
    }


    res.status(201).json({
      message: "Ride requested successfully",
      ride,
      notifiedDrivers: drivers.length,
    });
  } catch (error) {
    console.error("REQUEST RIDE ERROR:", error);
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

    // 🔥 ALWAYS update driver availability if driver exists
    if (ride.driver) {
      const driver = await Driver.findById(ride.driver);

      if (driver.vehicleType === "minidoor") {
        if (status === "completed" || status === "cancelled") {
          driver.currentSeatLoad -= ride.passengerCount;
          if (driver.currentSeatLoad < 0) driver.currentSeatLoad = 0;

          driver.isAvailable = driver.currentSeatLoad < driver.vehicleCapacity;

          if (driver.currentSeatLoad === 0) {
            driver.activeRide = null;
          }

          await driver.save();
        }
      } else {
        if (status === "accepted" || status === "ongoing") {
          driver.isAvailable = false;
        }

        if (status === "completed" || status === "cancelled") {
          driver.isAvailable = true;
          driver.activeRide = null;
        }

        await driver.save();
      }
    }

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

    res.status(200).json({
      count: rides.length,
      rides,
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};
