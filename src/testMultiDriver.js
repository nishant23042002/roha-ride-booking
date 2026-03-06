// /src/testMultiDriver.js

import { io } from "socket.io-client";

const SERVER = "http://localhost:5000";

const drivers = [
  { id: "69aa2faa533f56d3c03a51c5", lat: 19.0754, lng: 72.8769 },
  { id: "69aa3ea187d08041a30facbe", lat: 19.0752, lng: 72.8769 },
  { id: "69aa3e5a62b90992de87d183", lat: 19.0756, lng: 72.877 },
  { id: "69aa3e04646cdafc63e2a685", lat: 19.0758, lng: 72.8772 },
  { id: "69aa3dc704e15420009c3f91", lat: 19.076, lng: 72.8774 },
];

drivers.forEach((driver) => {
  const socket = io(SERVER);

  socket.on("connect", () => {
    console.log(`🚗 DRIVER CONNECTED: ${driver.id}`);

    socket.emit("register-driver", driver.id);

    // move to searching state
    socket.emit("driver-go-online", driver.id);

    // heartbeat
    setInterval(() => {
      socket.emit("driver-heartbeat", driver.id);
    }, 10000);

    // GPS updates
    setInterval(() => {
      // simulate small movement
      driver.lat += (Math.random() - 0.5) * 0.0002;
      driver.lng += (Math.random() - 0.5) * 0.0002;

      socket.emit("driver-location-update", {
        driverId: driver.id,
        lat: driver.lat,
        lng: driver.lng,
      });
    }, 3000);
  });

  socket.on("new-ride", (ride) => {
    console.log(`🚕 DRIVER ${driver.id} RECEIVED RIDE ${ride._id}`);

    const delay = Math.random() * 2000;

    setTimeout(() => {
      console.log(`⚡ DRIVER ${driver.id} TRY ACCEPT`);

      socket.emit("accept-ride", {
        rideId: ride._id,
        driverId: driver.id,
      });
    }, delay);
  });

  socket.on("ride-accepted-success", (ride) => {
    console.log(`✅ DRIVER ${driver.id} WON RIDE ${ride._id}`);
  });

  socket.on("ride-error", (msg) => {
    console.log(`❌ DRIVER ${driver.id} ERROR: ${msg}`);
  });

  socket.on("ride-taken", (rideId) => {
    console.log(`⚠️ DRIVER ${driver.id} LOST RIDE ${rideId}`);
  });
});
