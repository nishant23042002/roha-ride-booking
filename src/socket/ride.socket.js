// /src/socket/ride.socket.js

import { onlineCustomers } from "./index.js";
import { throttledLog } from "../core/logger/logger.js";
import acceptRideHandler from "./handlers/acceptRide.handler.js";
import arriveRideHandler from "./handlers/arriveRide.handler.js";
import startRideHandler from "./handlers/startRide.handler.js";
import completeRideHandler from "./handlers/completeRide.handler.js";
import cancelRideByCustomerHandler from "./handlers/cancelRideByCustomer.handler.js";
import cancelRideByDriverHandler from "./handlers/cancelRideByDriver.handler.js";
import { rateLimit } from "../core/rateLimiter.js";

export default function registerRideHandlers(socket) {
  socket.on("register-customer", (customerId) => {
    onlineCustomers.set(customerId, socket.id);

    socket.data.userId = customerId;
    socket.data.role = "customer";

    socket.join(`customer:${customerId}`);

    throttledLog(
      `customer-connect-${customerId}`,
      5000,
      "👤 CUSTOMER_CONNECTED",
      { customerId },
    );
  });

  // =============================
  // ACCEPT RIDE
  // =============================
  socket.on("accept-ride", (data) => {
    if (!rateLimit(`accept-${socket.data.userId}`, 5, 3000)) return;
    acceptRideHandler(socket, data);
  });

  // =============================
  // ARRIVE
  // =============================
  socket.on("arrive-ride", (data) => {
    if (!rateLimit(`arrive-${socket.data.userId}`, 5, 3000)) return;
    arriveRideHandler(socket, data);
  });

  // =============================
  // START
  // =============================
  socket.on("start-ride", (data) => {
    if (!rateLimit(`start-${socket.data.userId}`, 5, 3000)) return;
    startRideHandler(socket, data);
  });

  // =============================
  // COMPLETE
  // =============================
  socket.on("complete-ride", (data) => {
    if (!rateLimit(`complete-${socket.data.userId}`, 5, 3000)) return;
    completeRideHandler(socket, data);
  });

  //JOIN RIDE ROOM
  socket.on("join-ride-room", ({ rideId }) => {
    socket.join(`ride:${rideId}`);
  });

  // =============================
  // CUSTOMER CANCEL
  // =============================
  socket.on("cancel-ride-by-customer", (data) => {
    if (!rateLimit(`cancel-customer-${socket.data.userId}`, 5, 3000)) return;
    cancelRideByCustomerHandler(socket, data);
  });

  // =============================
  // DRIVER CANCEL (SMART CANCEL)
  // =============================
  socket.on("cancel-ride-by-driver", (data) => {
    if (!rateLimit(`cancel-driver-${socket.data.userId}`, 5, 3000)) return;
    cancelRideByDriverHandler(socket, data);
  });
}
