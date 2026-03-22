// src/controller/rideController.controller.js

import Ride from "../models/Ride.js";
import { calculateETA } from "../utils/eta.js";
import { calculateAutoFare } from "../pricing/engine/priceEngine.js";
import { vehicleRules } from "../config/vehicleRules.js";
import User from "../models/User.js";
import mongoose from "mongoose";
import { rideLog } from "../utils/rideLogger.js";
import { banner } from "../utils/rideLogger.js";
import { startDispatch } from "../modules/dispatch/dispatch.service.js";
import { findBestDrivers } from "../services/dispatch/dispatchEngine.js";

// =====================================================
// 🔴 CREATE RIDE
// =====================================================
export const requestRide = async (req, res) => {
  try {
    const {
      customerId,
      pickupLongitude,
      pickupLatitude,
      dropLongitude,
      dropLatitude,
      vehicleType,
      passengerCount = 1,
      rideType = "private",
    } = req.body;

    // =============================
    // ✅ VALIDATION
    // =============================
    if (
      pickupLongitude === undefined ||
      pickupLatitude === undefined ||
      dropLongitude === undefined ||
      dropLatitude === undefined ||
      !vehicleType
    ) {
      return res.status(400).json({ message: "Missing required fields" });
    }

    if (!mongoose.Types.ObjectId.isValid(customerId)) {
      return res.status(400).json({ message: "Invalid customer id" });
    }

    const customer = await User.findById(customerId);
    if (!customer) {
      return res.status(404).json({ message: "Customer not found" });
    }

    const rule = vehicleRules[vehicleType];
    if (!rule) {
      return res.status(400).json({ message: "Invalid vehicle type" });
    }

    if (passengerCount < 1 || passengerCount > rule.maxPassengers) {
      return res.status(400).json({
        message: `Maximum ${rule.maxPassengers} passengers allowed for ${vehicleType}`,
      });
    }

    banner("NEW RIDE REQUEST");

    // =============================
    // 💰 FARE + ETA
    // =============================
    const fareResult = calculateAutoFare({
      pickupLat: pickupLatitude,
      pickupLon: pickupLongitude,
      dropLat: dropLatitude,
      dropLon: dropLongitude,
      rideType,
      passengerCount,
    });

    console.log("📍 Ride Coordinates:", {
      pickupLatitude,
      pickupLongitude,
      dropLatitude,
      dropLongitude,
    });
    const estimatedETA = calculateETA(fareResult.distanceKm, vehicleType);

    // =============================
    // 🧾 CREATE RIDE
    // =============================
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
      status: "requested",
      pricingSnapshot: fareResult,
    });

    banner("RIDE CREATED");
    console.log("✅ RIDE CREATED:", ride._id);

    rideLog(ride._id, "RIDE_CREATED", "Ride created", {
      vehicleType,
      passengerCount,
    });

    const { drivers } = await findBestDrivers({
      pickupLat: pickupLatitude,
      pickupLng: pickupLongitude,
      vehicleType,
      passengerCount,
      heartbeatLimit: 30000,
    });

    if (!drivers.length) {
      console.log("❌ No drivers available nearby");

      return res.status(404).json({
        message: "No drivers available nearby",
      });
    }

    // =============================
    // 🚀 START DISPATCH ENGINE
    // =============================
    console.log("🚀 STARTING NEW DISPATCH ENGINE");

    startDispatch(ride._id);

    console.log("📤 RESPONSE SENT → ride created & dispatch started");

    res.status(201).json({
      message: "Ride requested successfully",
      ride,
    });
  } catch (error) {
    console.log("\n❌ RIDE REQUEST ERROR");
    console.log(error);
    res.status(500).json({ message: error.message });
  }
};

// =====================================================
// 🔄 UPDATE RIDE STATUS
// =====================================================
export const updateRideStatus = async (req, res) => {
  try {
    const { rideId, status } = req.body;

    const ride = await Ride.findById(rideId);
    if (!ride) {
      return res.status(404).json({ message: "Ride not found" });
    }

    if ((status === "ongoing" || status === "completed") && !ride.driver) {
      return res.status(400).json({
        message: "Ride has no assigned driver",
      });
    }

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

    res.status(200).json({
      message: "Ride updated successfully",
      ride,
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// =====================================================
// 📊 ADMIN - GET ALL RIDES
// =====================================================
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
