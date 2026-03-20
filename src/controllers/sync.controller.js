import Driver from "../models/Driver.js";
import Ride from "../models/Ride.js";

// 🔥 DRIVER SYNC
export const driverSync = async (req, res) => {
  try {
    const { driverId } = req.params;

    const driver = await Driver.findById(driverId).lean();

    if (!driver) {
      return res.status(404).json({ message: "Driver not found" });
    }

    let ride = null;

    if (driver.currentRide) {
      ride = await Ride.findById(driver.currentRide).lean();
    }

    return res.status(200).json({
      success: true,
      driverState: driver.driverState,
      isOnline: driver.isOnline,
      ride,
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// 🔥 CUSTOMER SYNC
export const customerSync = async (req, res) => {
  try {
    const { customerId } = req.params;

    const ride = await Ride.findOne({
      customer: customerId,
      status: { $in: ["requested", "accepted", "arrived", "ongoing"] },
    }).lean();

    return res.status(200).json({
      success: true,
      ride,
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};
