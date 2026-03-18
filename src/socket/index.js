// /src/socket/index.js

import { Server } from "socket.io";
import registerDriverHandlers from "./driver.socket.js";
import registerRideHandlers from "./ride.socket.js";

let io;
export const onlineDrivers = new Map(); // driverId -> socketId
export const onlineCustomers = new Map(); // customerId -> socketId

export const initSocket = (server) => {
  io = new Server(server, {
    cors: {
      origin: "*", // change in production
      methods: ["GET", "POST"],
    },
  });

  io.on("connection", (socket) => {
    console.log("\n🟢 SOCKET CONNECTED:", socket.id);

    registerDriverHandlers(socket);
    registerRideHandlers(socket);

    socket.on("disconnect", () => {
      handleDisconnect(socket);
      console.log("🔴 SOCKET DISCONNECTED:", socket.id);
    });
  });
};

export const getIO = () => {
  if (!io) {
    throw new Error("Socket.io not initialized");
  }
  return io;
};

function handleDisconnect(socket) {
  for (const [driverId, sockId] of onlineDrivers.entries()) {
    if (sockId === socket.id) {
      onlineDrivers.delete(driverId);
      console.log("Driver disconnected:", driverId);
    }
  }

  for (const [customerId, sockId] of onlineCustomers.entries()) {
    if (sockId === socket.id) {
      onlineCustomers.delete(customerId);
      console.log("Customer disconnected:", customerId);
    }
  }
}
