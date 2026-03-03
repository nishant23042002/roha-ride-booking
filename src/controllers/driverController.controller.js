import Driver from "../models/Driver.js";
import User from "../models/User.js";

// Register as Driver
export const registerDriver = async (req, res) => {
  try {
    const { userId, vehicleType, vehicleNumber, licenseNumber } = req.body;

    const user = await User.findById(userId);

    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    const existingDriver = await Driver.findOne({ user: userId });

    if (existingDriver) {
      return res.status(400).json({ message: "Driver already registered" });
    }

    const rule = vehicleRules[vehicleType];

    if (!rule) {
      return res.status(400).json({ message: "Invalid vehicle type" });
    }

    const driver = await Driver.create({
      user: userId,
      vehicleType,
      vehicleCapacity: rule.maxPassengers,
      vehicleNumber,
      licenseNumber,
      isAvailable: false
    });

    res.status(201).json({
      message: "Driver registered successfully",
      driver,
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
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
