import { cancelRideByDriverService } from "../services/ride/cancelRideByDriver.service.js";
import { cancelRideByCustomerService } from "../services/ride/cancelRideByCustomer.service.js";
import { getIO, onlineCustomers } from "../socket/index.js";

// -----------------------------
// CUSTOMER CANCEL
// -----------------------------
export const cancelRideByCustomer = async (req, res) => {
  try {
    const { rideId, reason } = req.body;

    if (!rideId) {
      return res.status(400).json({ message: "rideId required" });
    }

    const ride = await cancelRideByCustomerService({
      rideId,
      reason,
    });

    // 🔥 SOCKET BROADCAST
    const io = getIO();

    // 🔥 ROOM BROADCAST (BEST)
    io.to(`ride:${ride._id}`).emit("ride-cancelled", ride);

    const customerSocketId = onlineCustomers.get(ride.customer.toString());

    if (customerSocketId) {
      io.to(customerSocketId).emit("ride-cancelled", ride);
    }

    return res.status(200).json({
      success: true,
      ride,
    });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
};

// -----------------------------
// DRIVER CANCEL
// -----------------------------
export const cancelRideByDriver = async (req, res) => {
  try {
    const { rideId, driverId, reason } = req.body;

    if (!rideId || !driverId) {
      return res.status(400).json({
        message: "rideId and driverId required",
      });
    }

    const ride = await cancelRideByDriverService({
      rideId,
      driverId,
      reason,
    });

    const io = getIO();

    // 🔥 ROOM BROADCAST (BEST)
    io.to(`ride:${ride._id}`).emit("ride-cancelled", ride);

    const customerSocketId = onlineCustomers.get(ride.customer.toString());

    if (customerSocketId) {
      io.to(customerSocketId).emit("ride-cancelled", ride);
    }

    return res.status(200).json({
      success: true,
      ride,
    });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
};
