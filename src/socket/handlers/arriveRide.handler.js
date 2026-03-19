// /src/socket/handlers/arriveRideHandler.js

import { arriveRideService } from "../../services/ride/arriveRide.service.js";
import { withRetry } from "../../utils/withRetry.js";
import { getIO, onlineCustomers } from "../index.js";

export default async function arriveRideHandler(socket, { rideId, driverId }) {
  try {
    const ride = await withRetry(() => arriveRideService({ rideId, driverId }));

    const  io = getIO();

    const customerSocketId = onlineCustomers.get(ride.customer.toString());

    if (customerSocketId) {
      io.to(customerSocketId).emit("ride-arrived", ride);
    } 

    socket.emit("ride-arrived", ride);
  } catch (err) {
    console.log("❌ ARRIVE RIDE ERROR:", err.message);
    socket.emit("ride-error", err.message);
  }
}
