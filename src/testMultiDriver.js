// /src/testMultiDriver.js

import { io } from "socket.io-client";
import readline from "readline";
import { banner } from "./utils/rideLogger.js";

const SERVER_URL = "http://127.0.0.1:5000";

// =============================
// 🧠 DRIVER CONFIG
// =============================
const drivers = [
  { id: "69aa2faa533f56d3c03a51c5", lat: 18.4343, lng: 73.1318 },
  { id: "69aa3ea187d08041a30facbe", lat: 18.4347, lng: 73.1321 },
  { id: "69aa3e5a62b90992de87d183", lat: 18.4341, lng: 73.1324 },
  { id: "69aa3e04646cdafc63e2a685", lat: 18.435, lng: 73.1312 },
  { id: "69aa3dc704e15420009c3f91", lat: 18.4353, lng: 73.1325 },
  { id: "69c0ce9f33bcabb2239bfd50", lat: 18.4353, lng: 73.1325 },
  { id: "69c0cedb33bcabb2239bfd5f", lat: 18.4353, lng: 73.1325 },
  { id: "69c0cefc33bcabb2239bfd6c", lat: 18.4353, lng: 73.1325 },
  { id: "69c0d003c3d790155f5f3429", lat: 18.4353, lng: 73.1325 },
  { id: "69c0d0332a8fed0f15a1498d", lat: 18.4353, lng: 73.1325 },
];

banner("MULTI DRIVER INTERACTIVE TEST");

const RACE_MODE = true; // 🔥 toggle this

// =============================
// 🧠 SOCKET STORAGE
// =============================
const sockets = new Map();
const activeRides = new Map();

// =============================
// 🎮 READLINE SETUP
// =============================
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

// =============================
// 🚗 CONNECT DRIVERS
// =============================
drivers.forEach((driver) => {
  const socket = io(SERVER_URL, {
    transports: ["websocket"],
  });

  sockets.set(driver.id, socket);

  socket.on("connect", () => {
    console.log(`\n🟢 DRIVER ONLINE → ${driver.id}`);

    socket.emit("register-driver", driver.id);

    // 💓 HEARTBEAT
    setInterval(() => {
      socket.emit("driver-heartbeat", driver.id);
    }, 5000);

    // 📍 GPS
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
  // 🚦 NEW RIDE EVENT
  // =============================
  socket.on("new-ride", (ride) => {
    console.log(`\n📩 DRIVER ${driver.id} RECEIVED RIDE → ${ride._id}`);

    activeRides.set(driver.id, ride._id);

    // =============================
    // 🔥 RACE CONDITION MODE
    // =============================
    if (RACE_MODE) {
      console.log(`⚡ RACE MODE → ${driver.id} attempting instant accept`);

      // 💥 MULTIPLE PARALLEL ACCEPTS
      for (let i = 0; i < 3; i++) {
        setTimeout(() => {
          socket.emit("accept-ride", {
            rideId: ride._id,
            driverId: driver.id,
          });
        }, 0);
      }

      return;
    }

    // 👉 Manual mode fallback
    if (!RACE_MODE) showControls();
  });

  // =============================
  // 🏆 WINNER
  // =============================
  socket.on("ride-accepted-success", (ride) => {
    console.log(`\n🏆 DRIVER ${driver.id} WON RIDE ${ride._id}`);
  });

  // =============================
  // ❌ LOST
  // =============================
  socket.on("ride-taken", (rideId) => {
    console.log(`❌ DRIVER ${driver.id} LOST → ${rideId}`);
  });

  socket.on("ride-error", (msg) => {
    console.log(`❌ DRIVER ${driver.id} ERROR → ${msg}`);
  });

  socket.on("ride-completed", (ride) => {
    console.log(`🏁 DRIVER ${driver.id} COMPLETED → ${ride._id}`);
  });
});

// =============================
// 🎮 DRIVER INDEX MAP
// =============================
const driverIndexMap = drivers.map((d, i) => ({
  index: i + 1,
  id: d.id,
}));

// =============================
// 🎮 SHOW CONTROL PANEL
// =============================
function showControls() {
  console.log(`
==============================
🎮 CONTROL PANEL
==============================

Drivers:
${driverIndexMap.map((d) => `${d.index}. ${d.id}`).join("\n")}

Actions:
1 → Accept
2 → Reject
3 → Arrive
4 → Start Ride
5 → Complete Ride

Format:
<driverIndex> <action>

Example:
1 1   → Driver 1 Accept
2 5   → Driver 2 Complete Ride

==============================
`);
}

// =============================
// 🎮 INPUT HANDLER
// =============================
rl.on("line", (input) => {
  const [driverIndex, action] = input.trim().split(" ").map(Number);

  const driver = driverIndexMap.find((d) => d.index === driverIndex);

  if (!driver) {
    console.log("❌ Invalid driver index");
    return;
  }

  const socket = sockets.get(driver.id);
  const rideId = activeRides.get(driver.id);

  if (!socket || !rideId) {
    console.log("❌ No active ride for this driver");
    return;
  }

  switch (action) {
    case 1:
      console.log(`✅ ACCEPT → ${driver.id}`);
      socket.emit("accept-ride", { rideId, driverId: driver.id });
      break;

    case 2:
      console.log(`🚫 REJECT → ${driver.id}`);
      socket.emit("cancel-ride-driver", { rideId, driverId: driver.id });
      break;

    case 3:
      console.log(`📍 ARRIVE → ${driver.id}`);
      socket.emit("arrive-ride", { rideId, driverId: driver.id });
      break;

    case 4:
      console.log(`🚦 START → ${driver.id}`);
      socket.emit("start-ride", { rideId, driverId: driver.id });
      break;

    case 5:
      console.log(`🏁 COMPLETE → ${driver.id}`);
      socket.emit("complete-ride", { rideId, driverId: driver.id });
      break;

    default:
      console.log("❌ Invalid action");
  }
});
