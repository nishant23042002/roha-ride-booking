import { io } from "socket.io-client";
import readline from "readline";
import { banner } from "./utils/rideLogger.js";

const SERVER_URL = "http://127.0.0.1:5000";

// =====================================================
// 🧠 DRIVER CONFIG (KEEP YOUR REAL IDS)
// =====================================================
const drivers = [
  { id: "69aa2faa533f56d3c03a51c5", lat: 18.4343, lng: 73.1318 },
  { id: "69aa3ea187d08041a30facbe", lat: 18.4347, lng: 73.1321 },
  { id: "69aa3e5a62b90992de87d183", lat: 18.4341, lng: 73.1324 },
];

// =====================================================
// ⚙️ MODES
// =====================================================
const MODE = {
  RACE: false, // multiple accept attempts
  STRESS: true, // auto behavior
};

// =====================================================
// 🧠 STATE STORE
// =====================================================
const sockets = new Map();
const driverState = new Map(); // driverId → state
const activeRide = new Map(); // driverId → rideId

// =====================================================
// 🎮 CLI
// =====================================================
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

banner("🚀 MULTI DRIVER TEST (PRO)");

// =====================================================
// 🧠 DEBUG LOGGER
// =====================================================
function debug(driverId, label, extra = {}) {
  console.log(`\n🧠 [${label}]`);
  console.log("👤 Driver:", driverId);
  console.log("📊 State:", driverState.get(driverId));
  console.log("🚕 Ride:", activeRide.get(driverId) || "NONE");

  Object.entries(extra).forEach(([k, v]) => {
    console.log(`👉 ${k}:`, v);
  });
}

// =====================================================
// 🚗 CONNECT ALL DRIVERS
// =====================================================
drivers.forEach((driver) => {
  const socket = io(SERVER_URL, { transports: ["websocket"] });

  sockets.set(driver.id, socket);
  driverState.set(driver.id, "IDLE");

  socket.on("connect", () => {
    console.log(`\n🟢 CONNECTED → ${driver.id}`);

    socket.emit("register-driver", driver.id);

    driverState.set(driver.id, "SEARCHING");

    // 💓 HEARTBEAT
    setInterval(() => {
      socket.emit("driver-heartbeat", driver.id);
      console.log(`💓 ${driver.id} → ${driverState.get(driver.id)}`);
    }, 5000);

    // 📍 GPS LOOP
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

  // =====================================================
  // 🚦 NEW RIDE
  // =====================================================
  socket.on("new-ride", (ride) => {
    console.log(`\n📩 ${driver.id} → NEW RIDE ${ride._id}`);

    activeRide.set(driver.id, ride._id);
    driverState.set(driver.id, "REQUESTED");

    debug(driver.id, "NEW_RIDE");

    // =============================
    // ⚡ RACE MODE
    // =============================
    if (MODE.RACE) {
      for (let i = 0; i < 3; i++) {
        socket.emit("accept-ride", {
          rideId: ride._id,
          driverId: driver.id,
        });
      }
      return;
    }

    // =============================
    // 🔥 STRESS MODE (SMART)
    // =============================
    if (MODE.STRESS) {
      const delay = Math.random() * 2000;

      setTimeout(() => {
        console.log(`⚡ ${driver.id} trying accept after ${delay}ms`);

        socket.emit("accept-ride", {
          rideId: ride._id,
          driverId: driver.id,
        });
      }, delay);
    }
  });

  // =====================================================
  // 🏆 ACCEPT SUCCESS
  // =====================================================
  socket.on("ride-accepted-success", (ride) => {
    console.log(`🏆 WINNER → ${driver.id}`);

    driverState.set(driver.id, "TO_PICKUP");
    activeRide.set(driver.id, ride._id);

    debug(driver.id, "ACCEPT_SUCCESS");

    // 🔥 STRESS AUTO FLOW
    if (MODE.STRESS) {
      setTimeout(() => {
        socket.emit("arrive-ride", {
          rideId: ride._id,
          driverId: driver.id,
        });
      }, 2000);
    }
  });

  socket.on("ride-taken", (rideId) => {
    console.log(`❌ LOST → ${driver.id}`);
    driverState.set(driver.id, "SEARCHING");
    activeRide.delete(driver.id);
  });

  // =====================================================
  // 📍 ARRIVED
  // =====================================================
  socket.on("ride-arrived", (ride) => {
    driverState.set(driver.id, "ARRIVED");

    debug(driver.id, "ARRIVED");

    if (MODE.STRESS) {
      setTimeout(() => {
        socket.emit("start-ride", {
          rideId: ride._id,
          driverId: driver.id,
        });
      }, 1500);
    }
  });

  // =====================================================
  // 🚦 STARTED
  // =====================================================
  socket.on("ride-started", (ride) => {
    driverState.set(driver.id, "ON_TRIP");

    debug(driver.id, "STARTED");

    if (MODE.STRESS) {
      setTimeout(() => {
        socket.emit("complete-ride", {
          rideId: ride._id,
          driverId: driver.id,
        });
      }, 3000);
    }
  });

  // =====================================================
  // 🏁 COMPLETED
  // =====================================================
  socket.on("ride-completed", (ride) => {
    console.log(`🏁 COMPLETED → ${driver.id}`);

    driverState.set(driver.id, "SEARCHING");
    activeRide.delete(driver.id);

    debug(driver.id, "COMPLETED");
  });

  // =====================================================
  // 🔁 RECOVERY
  // =====================================================
  socket.on("ride-restored", (data) => {
    console.log(`🔁 RESTORED → ${driver.id}`);

    activeRide.set(driver.id, data.ride._id);

    const map = {
      accepted: "TO_PICKUP",
      arrived: "ARRIVED",
      ongoing: "ON_TRIP",
    };

    driverState.set(driver.id, map[data.status] || "SEARCHING");

    debug(driver.id, "RECOVERY", { status: data.status });
  });

  socket.on("driver-lost", () => {
    console.log(`⚠️ LOST DRIVER → ${driver.id}`);

    driverState.set(driver.id, "SEARCHING");
    activeRide.delete(driver.id);
  });

  socket.on("disconnect", () => {
    console.log(`🔴 DISCONNECTED → ${driver.id}`);
  });
});

// =====================================================
// 🎮 CLI CONTROL PANEL
// =====================================================
function showControls() {
  console.log(`
==============================
🎮 MULTI DRIVER CONTROL
==============================

Commands:
accept <driverId>
arrive <driverId>
start <driverId>
complete <driverId>
disconnect <driverId>

Example:
accept 69aa2faa533f56d3c03a51c5

==============================
`);
}

showControls();

// =====================================================
// 🎮 CLI INPUT
// =====================================================
rl.on("line", (input) => {
  const [action, driverId] = input.trim().split(" ");

  const socket = sockets.get(driverId);
  const rideId = activeRide.get(driverId);

  if (!socket) return console.log("❌ Driver not found");
  if (!rideId) return console.log("❌ No active ride");

  debug(driverId, "CLI_ACTION", { action });

  switch (action) {
    case "accept":
      socket.emit("accept-ride", { rideId, driverId });
      break;

    case "arrive":
      socket.emit("arrive-ride", { rideId, driverId });
      break;

    case "start":
      socket.emit("start-ride", { rideId, driverId });
      break;

    case "complete":
      socket.emit("complete-ride", { rideId, driverId });
      break;

    case "disconnect":
      socket.disconnect();
      break;

    default:
      console.log("❌ Invalid command");
  }
});
