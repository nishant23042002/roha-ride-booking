import Ride from "../models/Ride.js";
import Driver from "../models/Driver.js";
import { getIO, onlineDrivers } from "../socket/index.js";
import { calculateETA } from "../utils/eta.js";
import { calculateFare } from "../services/pricingEngine.js";
import { vehicleRules } from "../config/vehicleRules.js";

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

    console.log("🟡 REQUEST RIDE");
    console.log("Vehicle:", vehicleType);
    console.log("Passengers:", passengerCount);
    console.log("RideType:", rideType);

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
    console.log("✅ Ride Created:", ride._id);
    console.log("Passenger count:", passengerCount);
    console.log("Vehicle type:", vehicleType);

    // 🔎 Find nearest available driver within 5km
    let nearestDriver;

    if (vehicleType === "minidoor") {
      nearestDriver = await Driver.find({
        vehicleType: "minidoor",
        isAvailable: true,

        currentLocation: {
          $near: {
            $geometry: {
              type: "Point",
              coordinates: [pickupLongitude, pickupLatitude],
            },
            $maxDistance: 5000,
          },
        },
      });
    } else {
      nearestDriver = await Driver.find({
        isAvailable: true,
        activeRide: null,
        vehicleCapacity: { $gte: passengerCount },
        vehicleType,
        currentLocation: {
          $near: {
            $geometry: {
              type: "Point",
              coordinates: [pickupLongitude, pickupLatitude],
            },
            $maxDistance: 5000,
          },
        },
      });
    }
    if (!nearestDriver.length) {
      console.log("❌ No driver found");
      return res.status(404).json({ message: "No drivers available nearby" });
    }
    const driver = nearestDriver[0];
    console.log("🚗 Driver Found:", driver._id);
    const io = getIO();

    const socketId = onlineDrivers.get(driver._id.toString());
    if (socketId) {
      io.to(socketId).emit("new-ride", ride);
    }

    res.status(201).json({
      message: "Ride requested successfully",
      ride,
      nearestDriver,
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
