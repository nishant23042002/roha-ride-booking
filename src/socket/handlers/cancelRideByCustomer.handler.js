// /src/socket/handler/cancelRideByCustomerHandler.js

import { cancelRideByCustomerService } from "../../services/ride/cancelRideByCustomer.service.js";
import { withRetry } from "../../utils/withRetry.js";
import { getIO, onlineCustomers } from "../index.js";

export default async function cancelRideByCustomerHandler(socket, data) {
  try {
    const ride = await withRetry(() => cancelRideByCustomerService(data));

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
