// /src/socket/handlers/acceptRideHandler.js

import { acceptRideService } from "../../services/ride/acceptRide.service.js";
import { getIO, onlineCustomers, onlineDrivers } from "../index.js";

export default async function acceptRideHandler(socket, { rideId, driverId }) {
  try {
    const ride = await acceptRideService({ rideId, driverId });

    const io = getIO();

    socket.emit("ride-accepted-success", ride);

    const room = `ride:${ride._id}`;
    socket.join(room);

    const customerSocketId = onlineCustomers.get(ride.customer.toString());

    if (customerSocketId) {
      io.to(customerSocketId).emit("ride-accepted", ride);
    }

    for (const [id, sockId] of onlineDrivers.entries()) {
      if (id !== driverId) {
        io.to(sockId).emit("ride-taken", rideId);
      }
    }
  } catch (err) {
    if (err.message.includes("already taken")) {
      socket.emit("ride-taken", rideId);
      return; // 🔥 prevent duplicate logs
    }

    console.log("❌ ACCEPT RIDE ERROR:", err.message);
    socket.emit("ride-error", err.message);
  }
}
