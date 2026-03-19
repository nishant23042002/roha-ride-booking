// /src/socket/handlers/startRideHandler.js

import { startRideService } from "../../services/ride/startRide.service.js";
import { withRetry } from "../../utils/withRetry.js";
import { getIO, onlineCustomers } from "../index.js";

export default async function startRideHandler(socket, { rideId, driverId }) {
  try {
    const ride = await withRetry(() => startRideService({ rideId, driverId }));

    const io = getIO();

    const customerSocketId = onlineCustomers.get(ride.customer.toString());

    if (customerSocketId) {
      io.to(customerSocketId).emit("ride-started", ride);
    }

    socket.emit("ride-started", ride);
  } catch (err) {
    console.log("❌ START RIDE ERROR:", err.message);
    socket.emit("ride-error", err.message);
  }
}
