// /src/socket/index.js

import { Server } from "socket.io";
import registerDriverHandlers from "./driver.socket.js";
import registerRideHandlers from "./ride.socket.js";
import Driver from "../models/Driver.js";

let io;
export const onlineDrivers = new Map(); // driverId -> socketId
export const onlineCustomers = new Map(); // customerId -> socketId
export const disconnectTimers = new Map(); // userId -> timeout
const DISCONNECT_GRACE = 30000; // 30 sec

export const initSocket = (server) => {
  io = new Server(server, {
    cors: {
      origin: "*", // change in production
      methods: ["GET", "POST"],
    },
  });

  io.on("connection", (socket) => {
    console.log("\n🟢 SOCKET CONNECTED:", socket.id);

    // 🔥 Attach identity (important)
    socket.data.userId = null;
    socket.data.role = null;

    console.log("📡 Active drivers:", onlineDrivers.size);
    console.log("📡 Active customers:", onlineCustomers.size);

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
    console.log("⚠️ IO not ready yet");
    return null;
  }
  return io;
};

// function handleDisconnect(socket) {
//   for (const [driverId, sockId] of onlineDrivers.entries()) {
//     if (sockId === socket.id) {
//       onlineDrivers.delete(driverId);
//       console.log("Driver disconnected:", driverId);
//     }
//   }

//   for (const [customerId, sockId] of onlineCustomers.entries()) {
//     if (sockId === socket.id) {
//       onlineCustomers.delete(customerId);
//       console.log("Customer disconnected:", customerId);
//     }
//   }
// }

function handleDisconnect(socket) {
  const { userId, role } = socket.data;

  if (!userId || !role) return;

  console.log(`⏳ ${role} disconnected (grace period):`, userId);

  const timer = setTimeout(async () => {
    if (role === "driver") {
      onlineDrivers.delete(userId);

      console.log("❌ Driver marked offline:", userId);

      // 🔥 OPTIONAL: update DB
      await Driver.findByIdAndUpdate(userId, {
        isOnline: false,
        driverState: "offline",
      });

      console.log("❌ Driver offline:", userId);
    }

    if (role === "customer") {
      onlineCustomers.delete(userId);
      console.log("❌ Customer removed:", userId);
    }

    disconnectTimers.delete(userId);
  }, DISCONNECT_GRACE);

  disconnectTimers.set(userId, timer);
}
