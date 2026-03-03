import Ride from "../models/Ride.js";
import Driver from "../models/Driver.js";
import { getIO, onlineDrivers } from "../socket/index.js";
import { calculateDistance } from "../utils/distance.js";
import { pricing } from "../config/pricing.js";

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
    } = req.body;

    if (!vehicleType) {
      return res.status(400).json({
        message: "Vehicle type is required",
      });
    }

    const distance = calculateDistance(
      pickupLatitude,
      pickupLongitude,
      dropLatitude,
      dropLongitude,
    );

    // For estimate, assume default vehicle type (or nearest driver vehicle)

    const vehiclePricing = pricing[vehicleType];
    if (!vehiclePricing) {
      return res.status(400).json({
        message: "Invalid vehicle type",
      });
    }

    const estimatedFare =
      vehiclePricing.baseFare + distance * vehiclePricing.perKm;

    const ride = await Ride.create({
      customer: customerId,
      vehicleType,
      pickupLocation: {
        type: "Point",
        coordinates: [pickupLongitude, pickupLatitude],
      },
      dropLocation: {
        type: "Point",
        coordinates: [dropLongitude, dropLatitude],
      },
      estimatedDistanceKm: Number(distance.toFixed(2)),
      estimatedFare: Number(estimatedFare.toFixed(2)),
    });

    // 🔎 Find nearest available driver within 5km
    const nearestDriver = await Driver.find({
      isAvailable: true,
      activeRide: null,
      vehicleType,
      currentLocation: {
        $near: {
          $geometry: {
            type: "Point",
            coordinates: [pickupLongitude, pickupLatitude],
          },
          $maxDistance: 5000, // 5km
        },
      },
    });

    if (nearestDriver.length === 0) {
      return res.status(404).json({ message: "No drivers available nearby" });
    }

    const io = getIO();

    for (let driver of nearestDriver) {
      const socketId = onlineDrivers.get(driver._id.toString());

      if (socketId) {
        io.to(socketId).emit("new-ride", ride);
      }
    }

    res.status(201).json({
      message: "Ride requested successfully",
      ride,
      nearestDriver,
    });
  } catch (error) {
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
      if (status === "accepted" || status === "ongoing") {
        await Driver.findByIdAndUpdate(ride.driver, {
          isAvailable: false,
        });
      }

      if (status === "completed" || status === "cancelled") {
        await Driver.findByIdAndUpdate(ride.driver, {
          isAvailable: true,
          activeRide: null,
        });
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
