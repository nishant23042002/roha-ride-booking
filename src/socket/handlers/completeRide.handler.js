// /src/socket/handlers/completeRideHandler.js

import { completeRideService } from "../../services/ride/completeRide.service.js";
import { withRetry } from "../../utils/withRetry.js";
import { getIO, onlineCustomers } from "../index.js";

export default async function completeRideHandler(
  socket,
  { rideId, driverId },
) {
  try {
    const ride = await withRetry(() =>
      completeRideService({ rideId, driverId }),
    );

    const io = getIO();

    const customerSocketId = onlineCustomers.get(ride.customer.toString());

    if (customerSocketId) {
      io.to(customerSocketId).emit("ride-completed", ride);
    }

    socket.emit("ride-completed", ride);
  } catch (err) {
    console.log("❌ COMPLETE RIDE ERROR:", err.message);
    socket.emit("ride-error", err.message);
  }
}
