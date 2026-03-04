// /src/test.js
import { io } from "socket.io-client";

const socket = io("http://localhost:5000");

const DRIVER_ID = "69a777a18d2865cc4eadf38c";

const WAITING_TIME_BEFORE_START = 60000;

socket.on("connect", () => {
  console.log("Connected:", socket.id);
  socket.emit("register-driver", DRIVER_ID);

  setInterval(() => {
    socket.emit("driver-heartbeat", DRIVER_ID);
  }, 10000);
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

  console.log(
    `⏳ Simulating waiting time: ${WAITING_TIME_BEFORE_START / 60000} minutes`,
  );

  setTimeout(() => {
    socket.emit("start-ride", {
      rideId: ride._id,
      driverId: DRIVER_ID,
    });
  }, WAITING_TIME_BEFORE_START);
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

socket.on("ride-completed", (ride) => {
  console.log("✅ Ride Completed");
  console.log("Fare:", ride.fare);
  console.log("Waiting Minutes:", ride.waitingMinutes);
  console.log("Waiting Charge:", ride.waitingCharge);
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
