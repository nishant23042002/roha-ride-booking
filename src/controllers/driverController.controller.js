// /src/controllers/driver.controller.js

import mongoose from "mongoose";
import { vehicleRules } from "../config/vehicleRules.js";
import Driver from "../models/Driver.js";
import DriverWallet from "../models/DriverWallet.js";
import User from "../models/User.js";
import { banner, driverLog } from "../utils/rideLogger.js";

export const registerDriver = async (req, res) => {
  let session;

  try {
    session = await mongoose.startSession();
    const { userId, vehicleType, vehicleNumber, licenseNumber } = req.body;
    banner("DRIVER REGISTRATION REQUEST");

    driverLog("REQUEST_RECEIVED", "New driver registration attempt", {
      userId,
      vehicleType,
    });
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

    driverLog("VEHICLE_VALIDATION", "Vehicle type validated", {
      vehicleType,
      maxPassengers: rule.maxPassengers,
    });

    // -----------------------------
    // 3️⃣ Check user exists
    // -----------------------------
    const user = await User.findById(userId);

    if (!user) {
      return res.status(404).json({
        message: "User not found",
      });
    }

    driverLog("USER_VALIDATED", "User verified for driver registration", {
      userId,
    });

    // -----------------------------
    // 4️⃣ Prevent duplicate driver
    // -----------------------------
    const existingDriver = await Driver.findOne({ user: userId });

    if (existingDriver) {
      driverLog("REGISTRATION_BLOCKED", "User already registered as driver", {
        userId,
      });
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
      driverLog("REGISTRATION_BLOCKED", "Vehicle already registered", {
        vehicleNumber: normalizedVehicleNumber,
      });
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
      driverLog("REGISTRATION_BLOCKED", "License already registered", {
        licenseNumber: normalizedLicense,
      });

      return res.status(400).json({
        message: "License already registered",
      });
    }

    // -----------------------------
    // 7️⃣ Start Transaction
    // -----------------------------
    banner("DRIVER REGISTRATION TRANSACTION");
    session.startTransaction();

    const driver = await Driver.create(
      [
        {
          user: userId,
          vehicleType,
          vehicleCapacity: rule.maxPassengers,
          vehicleNumber: normalizedVehicleNumber,
          licenseNumber: normalizedLicense,
          driverState: "offline",
        },
      ],
      { session },
    );

    driverLog("DRIVER_CREATED", "Driver profile created", {
      driverId: driver[0]._id,
      vehicleType,
      capacity: rule.maxPassengers,
    });

    const wallet = await DriverWallet.create(
      [
        {
          driver: driver[0]._id,
          balance: 0,
        },
      ],
      { session },
    );

    driverLog("WALLET_CREATED", "Driver wallet initialized", {
      walletId: wallet[0]._id,
      balance: wallet[0].balance,
    });

    // -----------------------------
    // 8️⃣ Commit Transaction
    // -----------------------------
    await session.commitTransaction();
    session.endSession();
    banner("DRIVER REGISTRATION SUCCESS");

    driverLog("REGISTRATION_COMPLETED", "Driver successfully onboarded", {
      driverId: driver[0]._id,
    });

    return res.status(201).json({
      success: true,
      message: "Driver registered successfully",
      data: {
        driver: driver[0],
        wallet: wallet[0],
      },
    });
  } catch (error) {
    if (session) {
      await session.abortTransaction();
      session.endSession();
    }

    console.log("\n❌ DRIVER REGISTRATION FAILED");
    console.log(error);

    return res.status(500).json({
      success: false,
      message: "Driver registration failed",
      error: error.message,
    });
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
    driverLog("LOCATION_UPDATED", "Driver location updated manually", {
      driverId,
      latitude,
      longitude,
    });
    await driver.save();

    res.status(200).json({ message: "Location updated" });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

export const getAllDrivers = async (req, res) => {
  try {
    const drivers = await Driver.find().populate();
    driverLog("ADMIN_FETCH", "Admin fetched driver list", {
      totalDrivers: drivers.length,
    });
    
    res.status(200).json({
      count: drivers.length,
      drivers,
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};
