// /src/socket/handler/cancelRideByDriverHandler.js

import { cancelRideByDriverService } from "../../services/ride/cancelRideByDriver.service.js";
import { withRetry } from "../../utils/withRetry.js";
import { getIO, onlineCustomers } from "../index.js";

export default async function cancelRideByDriverHandler(socket, data) {
  try {
    const ride = await withRetry(() => cancelRideByDriverService(data));

    socket.emit("ride-cancelled-success", ride);

    const io = getIO();
    const customerSocketId = onlineCustomers.get(ride.customer.toString());

    if (customerSocketId) {
      io.to(customerSocketId).emit("ride-cancelled", ride);
    }
  } catch (err) {
    socket.emit("ride-error", err.message);
  }
}
