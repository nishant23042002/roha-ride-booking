// /src/testMultiDriver.js

import { io } from "socket.io-client";
import { banner } from "./utils/rideLogger.js";

const SERVER_URL = "http://127.0.0.1:5000";

const drivers = [
  { id: "69aa2faa533f56d3c03a51c5", lat: 18.4343, lng: 73.1318 },
  { id: "69aa3ea187d08041a30facbe", lat: 18.4347, lng: 73.1321 },
  { id: "69aa3e5a62b90992de87d183", lat: 18.4341, lng: 73.1324 },
  { id: "69aa3e04646cdafc63e2a685", lat: 18.435, lng: 73.1312 },
  { id: "69aa3dc704e15420009c3f91", lat: 18.4353, lng: 73.1325 },
];

banner("MULTI DRIVER SIMULATOR STARTED");

drivers.forEach((driver) => {
  const socket = io(SERVER_URL, {
    transports: ["websocket"],
  });

  let wonRide = false;

  socket.on("connect", () => {
    console.log("----------------------------------------------------");
    console.log(`🚗 DRIVER ONLINE`);
    console.log(`Driver ID : ${driver.id}`);
    console.log(`Socket ID : ${socket.id}`);
    console.log("----------------------------------------------------\n");

    socket.emit("register-driver", driver.id);

    // =============================
    // 💓 HEARTBEAT
    // =============================
    setInterval(() => {
      socket.emit("driver-heartbeat", driver.id);
    }, 5000);

    // =============================
    // 📍 GPS UPDATES
    // =============================
    setInterval(() => {
      driver.lat += (Math.random() - 0.5) * 0.0002;
      driver.lng += (Math.random() - 0.5) * 0.0002;

      socket.emit("driver-location-update", {
        driverId: driver.id,
        lat: driver.lat,
        lng: driver.lng,
      });
    }, 3000);
  });

  // =============================
  // 🚦 NEW RIDE
  // =============================
  socket.on("new-ride", (ride) => {
    banner(`DRIVER ${driver.id} RECEIVED RIDE`);

    const delay = 0;

    setTimeout(() => {
      socket.emit("accept-ride", {
        rideId: ride._id,
        driverId: driver.id,
      });
    }, delay);
  });

  // =============================
  // 🏆 WINNER
  // =============================
  socket.on("ride-accepted-success", (ride) => {
    wonRide = true;

    console.log(`🏆 DRIVER ${driver.id} WON RIDE`);

    setTimeout(() => {
      socket.emit("arrive-ride", {
        rideId: ride._id,
        driverId: driver.id,
      });
    }, 5000);
  });

  // =============================
  // 🚦 ARRIVED
  // =============================
  socket.on("ride-arrived", (ride) => {
    if (!wonRide) return;

    setTimeout(() => {
      socket.emit("start-ride", {
        rideId: ride._id,
        driverId: driver.id,
      });
    }, 2000);
  });

  // =============================
  // 🛣 STARTED
  // =============================
  socket.on("ride-started", (ride) => {
    if (!wonRide) return;

    setTimeout(() => {
      socket.emit("complete-ride", {
        rideId: ride._id,
        driverId: driver.id,
      });
    }, 10000);
  });

  // =============================
  // 🏁 COMPLETE
  // =============================
  socket.on("ride-completed", (ride) => {
    if (!wonRide) return;

    console.log(`🏁 DRIVER ${driver.id} COMPLETED RIDE`);
  });

  socket.on("disconnect", () => {
    console.log(`🔴 DRIVER ${driver.id} DISCONNECTED`);
  });

  // =============================
  // ❌ LOST RIDE
  // =============================
  socket.on("ride-taken", (rideId) => {
    console.log(`❌ DRIVER ${driver.id} LOST RIDE ${rideId}`);
  });

  socket.on("ride-error", (msg) => {
    console.log(`❌ DRIVER ${driver.id} ERROR → ${msg}`);
  });
});
