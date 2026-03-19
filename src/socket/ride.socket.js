// /src/socket/ride.socket.js

import { onlineCustomers } from "./index.js";
import { throttledLog } from "../core/logger/logger.js";
import acceptRideHandler from "./handlers/acceptRide.handler.js";
import arriveRideHandler from "./handlers/arriveRide.handler.js";
import startRideHandler from "./handlers/startRide.handler.js";
import completeRideHandler from "./handlers/completeRide.handler.js";
import cancelRideByCustomerHandler from "./handlers/cancelRideByCustomer.handler.js";
import cancelRideByDriverHandler from "./handlers/cancelRideByDriver.handler.js";

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

  //ACCEPT RIDE
  socket.on("accept-ride", (data) => acceptRideHandler(socket, data));

  //ARRIVE RIDE
  socket.on("arrive-ride", (data) => arriveRideHandler(socket, data));

  //START RIDE
  socket.on("start-ride", (data) => startRideHandler(socket, data));

  //COMPLETE RIDE
  socket.on("complete-ride", (data) => completeRideHandler(socket, data));

  //JOIN RIDE ROOM
  socket.on("join-ride-room", ({ rideId }) => {
    socket.join(`ride:${rideId}`);
  });

  //CUSTOMER CANCELLATION
  socket.on("cancel-ride-by-customer", (data) =>
    cancelRideByCustomerHandler(socket, data),
  );

  //DRIVER CANCELLATION
  socket.on("cancel-ride-by-driver", (data) =>
    cancelRideByDriverHandler(socket, data),
  );
}
