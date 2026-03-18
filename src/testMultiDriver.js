// /src/testMultiDriver.js

import { io } from "socket.io-client";
import { banner } from "./utils/rideLogger.js";

const socket = io("http://127.0.0.1:5000", {
  transports: ["websocket"],
});

const drivers = [
  { id: "69aa2faa533f56d3c03a51c5", lat: 18.4343, lng: 73.1318 },
  { id: "69aa3ea187d08041a30facbe", lat: 18.4347, lng: 73.1321 },
  { id: "69aa3e5a62b90992de87d183", lat: 18.4341, lng: 73.1324 },
  { id: "69aa3e04646cdafc63e2a685", lat: 18.435, lng: 73.1312 },
  { id: "69aa3dc704e15420009c3f91", lat: 18.4353, lng: 73.1325 },
];

banner("MULTI DRIVER SIMULATOR STARTED");

drivers.forEach((driver) => {
  let wonRide = false;

  socket.on("connect", () => {
    console.log("----------------------------------------------------");
    console.log(`🚗 DRIVER ONLINE`);
    console.log(`Driver ID : ${driver.id}`);
    console.log(`Socket ID : ${socket.id}`);
    console.log("----------------------------------------------------\n");

    socket.emit("register-driver", driver.id);

    console.log(`🟢 DRIVER ${driver.id} REGISTERED`);

    console.log(`🔍 DRIVER ${driver.id} SEARCHING FOR RIDES\n`);

    // heartbeat
    setInterval(() => {
      socket.emit("driver-heartbeat", driver.id);

      console.log(`💓 HEARTBEAT → ${driver.id}`);
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

      console.log(
        `📍 GPS_UPDATE | DRIVER ${driver.id} | (${driver.lat.toFixed(5)}, ${driver.lng.toFixed(5)})`,
      );
    }, 3000);
  });

  socket.on("new-ride", (ride) => {
    banner("NEW RIDE DISPATCHED");

    console.log(
      `📍 DRIVER LOCATION → (${driver.lat.toFixed(4)}, ${driver.lng.toFixed(4)})`,
    );
    console.log(`🚕 DRIVER ${driver.id} RECEIVED RIDE REQUEST`);
    console.log(`Ride ID : ${ride._id}`);
    console.log(`Vehicle : ${ride.vehicleType}`);
    console.log(`Passengers : ${ride.passengerCount}`);
    console.log(`Estimated Fare : ${ride.estimatedFare}`);
    console.log("");

    const delay = Math.random() * 2000;

    console.log(
      `⏳ DRIVER ${driver.id} THINKING... (${delay.toFixed(0)}ms delay)`,
    );

    setTimeout(() => {
      console.log(`⚡ DRIVER ${driver.id} TRY ACCEPT`);

      socket.emit("accept-ride", {
        rideId: ride._id,
        driverId: driver.id,
      });
    }, delay);
  });

  socket.on("ride-accepted-success", (ride) => {
    wonRide = true;
    console.log(`🏆 DRIVER ${driver.id} WON RIDE ${ride._id}`);

    // simulate reaching pickup
    setTimeout(() => {
      console.log(`📍 DRIVER ${driver.id} ARRIVED`);

      socket.emit("arrive-ride", {
        rideId: ride._id,
        driverId: driver.id,
      });
    }, 5000);
  });

  socket.on("ride-arrived", (ride) => {
    if (!wonRide) return;
    console.log(`🚦 DRIVER ${driver.id} STARTING RIDE`);

    setTimeout(() => {
      socket.emit("start-ride", {
        rideId: ride._id,
        driverId: driver.id,
      });
    }, 2000);
  });

  socket.on("ride-started", (ride) => {
    if (!wonRide) return;
    console.log(`🛣 DRIVER ${driver.id} ON TRIP`);

    setTimeout(() => {
      socket.emit("complete-ride", {
        rideId: ride._id,
        driverId: driver.id,
      });
    }, 10000);
  });

  socket.on("ride-completed", (ride) => {
    console.log(`🏁 RIDE COMPLETED BY DRIVER ${driver.id}`);

    console.log(`Fare: ${ride.fare}`);
    console.log(`Driver Earning: ${ride.driverEarning}`);
  });

  socket.on("ride-taken", (rideId) => {
    console.log(
      `⚠️ DRIVER ${driver.id} LOST RIDE ${rideId} (another driver accepted first)`,
    );
  });

  socket.on("ride-error", (msg) => {
    console.log(`❌ DRIVER ${driver.id} ACCEPT FAILED → ${msg}`);
  });
});
