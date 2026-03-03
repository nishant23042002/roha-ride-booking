// /src/test.js
import { io } from "socket.io-client";

const socket = io("http://localhost:5000");

const DRIVER_ID = "69a63341a2b26dbedac87ed0";

socket.on("connect", () => {
  console.log("Connected:", socket.id);
  socket.emit("register-driver", DRIVER_ID);
});

socket.on("new-ride", async (ride) => {
  console.log("New ride received:", ride._id);

  // simulate driver clicking accept
  socket.emit("accept-ride", {
    rideId: ride._id,
    driverId: DRIVER_ID,
  });
});

socket.on("ride-accepted-success", (ride) => {
  console.log("Ride accepted:", ride._id);

  setTimeout(() => {
    socket.emit("arrive-ride", {
      rideId: ride._id,
      driverId: DRIVER_ID,
    });
  }, 2000);
});

socket.on("ride-arrived", (ride) => {
  console.log("Arrived at pickup");

  setTimeout(() => {
    socket.emit("start-ride", {
      rideId: ride._id,
      driverId: DRIVER_ID,
    });
  }, 2000);
});

socket.on("ride-started", (ride) => {
  console.log("Ride started");

  setTimeout(() => {
    socket.emit("complete-ride", {
      rideId: ride._id,
      driverId: DRIVER_ID,
    });
  }, 5000);
});

socket.on("ride-error", (msg) => {
  console.log("Error:", msg);
});

socket.on("ride-taken", (rideId) => {
  console.log("Ride taken by someone else:", rideId);
});

socket.on("tier-upgraded", (data) => {
  console.log("🔥 TIER UPGRADED!");
  console.log("New Tier:", data.newTier);
  console.log("New Commission:", data.commissionPercent + "%");
});
