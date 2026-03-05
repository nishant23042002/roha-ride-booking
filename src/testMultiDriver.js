// /src/testMultiDriver.js

import { io } from "socket.io-client";

const SERVER = "http://localhost:5000";

// Simulated drivers
const drivers = [
  { id: "69a93cbb6bb747ffe94fb298", lat: 19.0752, lng: 72.8768 },
  { id: "69a93d796bb747ffe94fb2ae", lat: 19.0754, lng: 72.8769 },
  { id: "69a93ddd6bb747ffe94fb2c4", lat: 19.0756, lng: 72.877 },
  { id: "69a93e306bb747ffe94fb2d6", lat: 19.0758, lng: 72.8772 },
  { id: "69a93e7d6bb747ffe94fb2e8", lat: 19.076, lng: 72.8774 },
];

drivers.forEach((driver) => {
  const socket = io(SERVER);

  socket.on("connect", () => {
    console.log(`Driver connected: ${driver.id}`);

    socket.emit("register-driver", driver.id);

    // heartbeat
    setInterval(() => {
      socket.emit("driver-heartbeat", driver.id);
    }, 10000);

    // location updates
    setInterval(() => {
      socket.emit("driver-location-update", {
        driverId: driver.id,
        lat: driver.lat,
        lng: driver.lng,
      });
    }, 3000);
  });

  socket.on("new-ride", (ride) => {
    console.log(`🚕 DRIVER ${driver.id} → received ride ${ride._id}`);

    // random delay
    setTimeout(() => {
      socket.emit("accept-ride", {
        rideId: ride._id,
        driverId: driver.id,
      });
    }, Math.random() * 2000);
  });
  socket.on("ride-error", (msg) => {
    console.log(`❌ ${driver.id} error:`, msg);
  });

  socket.on("ride-taken", (rideId) => {
    console.log(`⚠️ ${driver.id} lost ride:`, rideId);
  });
});
