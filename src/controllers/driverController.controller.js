// /src/controllers/driver.controller.js

import mongoose from "mongoose";
import { vehicleRules } from "../config/vehicleRules.js";
import Driver from "../models/Driver.js";
import DriverWallet from "../models/DriverWallet.js";
import User from "../models/User.js";

export const registerDriver = async (req, res) => {
  const session = await mongoose.startSession();

  try {
    const { userId, vehicleType, vehicleNumber, licenseNumber } = req.body;

    // -----------------------------
    // 1️⃣ Basic validation
    // -----------------------------
    if (!userId || !vehicleType || !vehicleNumber || !licenseNumber) {
      return res.status(400).json({
        message: "Missing required fields",
      });
    }

    const normalizedVehicleNumber = vehicleNumber.trim().toUpperCase();
    const normalizedLicense = licenseNumber.trim().toUpperCase();

    // -----------------------------
    // 2️⃣ Validate vehicle type
    // -----------------------------
    const rule = vehicleRules[vehicleType];

    if (!rule) {
      return res.status(400).json({
        message: "Invalid vehicle type",
      });
    }

    // -----------------------------
    // 3️⃣ Check user exists
    // -----------------------------
    const user = await User.findById(userId);

    if (!user) {
      return res.status(404).json({
        message: "User not found",
      });
    }

    // -----------------------------
    // 4️⃣ Prevent duplicate driver
    // -----------------------------
    const existingDriver = await Driver.findOne({ user: userId });

    if (existingDriver) {
      return res.status(400).json({
        message: "User already registered as driver",
      });
    }

    // -----------------------------
    // 5️⃣ Prevent vehicle reuse
    // -----------------------------
    const vehicleExists = await Driver.findOne({
      vehicleNumber: normalizedVehicleNumber,
    });

    if (vehicleExists) {
      return res.status(400).json({
        message: "Vehicle already registered",
      });
    }

    // -----------------------------
    // 6️⃣ Prevent license reuse
    // -----------------------------
    const licenseExists = await Driver.findOne({
      licenseNumber: normalizedLicense,
    });

    if (licenseExists) {
      return res.status(400).json({
        message: "License already registered",
      });
    }

    // -----------------------------
    // 7️⃣ Start Transaction
    // -----------------------------
    session.startTransaction();

    const driver = await Driver.create(
      [
        {
          user: userId,
          vehicleType,
          vehicleCapacity: rule.maxPassengers,
          vehicleNumber: normalizedVehicleNumber,
          licenseNumber: normalizedLicense,
          isAvailable: false,
        },
      ],
      { session },
    );

    const wallet = await DriverWallet.create(
      [
        {
          driver: driver[0]._id,
          balance: 0,
        },
      ],
      { session },
    );

    // -----------------------------
    // 8️⃣ Commit Transaction
    // -----------------------------
    await session.commitTransaction();
    session.endSession();

    return res.status(201).json({
      success: true,
      message: "Driver registered successfully",
      data: {
        driver: driver[0],
        wallet: wallet[0],
      },
    });
  } catch (error) {
    await session.abortTransaction();
    session.endSession();

    console.error("Driver registration failed:", error);

    return res.status(500).json({
      success: false,
      message: "Driver registration failed",
      error: error.message,
    });
  }
};
// Toggle Availability
export const toggleAvailability = async (req, res) => {
  try {
    const { driverId } = req.body;

    const driver = await Driver.findById(driverId);

    if (!driver) {
      return res.status(404).json({ message: "Driver not found" });
    }

    driver.isAvailable = !driver.isAvailable;
    await driver.save();

    res.status(200).json({
      message: "Availability updated",
      isAvailable: driver.isAvailable,
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// Update Driver Location
export const updateLocation = async (req, res) => {
  try {
    const { driverId, longitude, latitude } = req.body;

    const driver = await Driver.findById(driverId);

    if (!driver) {
      return res.status(404).json({ message: "Driver not found" });
    }

    driver.currentLocation.coordinates = [longitude, latitude];
    await driver.save();

    res.status(200).json({ message: "Location updated" });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

export const getAllDrivers = async (req, res) => {
  try {
    const drivers = await Driver.find().populate();

    res.status(200).json({
      count: drivers.length,
      drivers,
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};
