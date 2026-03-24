// /src/test.js
import { io } from "socket.io-client";
import { calculateETA } from "./utils/eta.js";
import { haversineDistance } from "./utils/gpsUtils.js";
import { banner, logState } from "./utils/rideLogger.js";
import axios from "axios";
import polyline from "@mapbox/polyline";
import readline from "readline";

// =====================================================
// 🧠 DEBUG LOGGER (UPGRADED)
// =====================================================
function debug(label, data = {}) {
  console.log(`\n🧠 [${label}]`);
  console.log("⏱", new Date().toISOString());
  console.log("📊 State:", state);
  console.log("🌐 Online:", isOnline);

  if (currentRide) {
    console.log("🚕 Ride:", currentRide._id);
  } else {
    console.log("🚕 Ride: NONE");
  }

  Object.entries(data).forEach(([k, v]) => {
    console.log(`👉 ${k}:`, v);
  });
}

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

console.log("🚀 TEST SCRIPT STARTED");

const socket = io("http://127.0.0.1:5000", {
  transports: ["websocket"],
});

const DRIVER_ID = "69aa2faa533f56d3c03a51c5";

const idleRoute = [
  { lat: 18.4384, lng: 73.131 },
  { lat: 18.439, lng: 73.1321 },
  { lat: 18.44, lng: 73.133 },
];

let currentRide = null;
let currentLocation = idleRoute[0];
let heartbeatInterval = null;
let gpsInterval = null;
let state = "IDLE";
let isOnline = false;
let lastSent = 0;
let hasConnectedOnce = false;

function showMenu() {
  console.log(`
==============================
🚗 DRIVER CONTROL PANEL
==============================
1. Go Online
2. Accept Ride
3. Cancel Ride (Driver)
4. Arrive
5. Start Ride
6. Complete Ride
7. Cancel Ride (Customer)
==============================
`);
}

// =====================================================
// 🎯 CLI HANDLER (UPGRADED)
// =====================================================

rl.on("line", (input) => {
  const command = input.trim();

  console.log(`\n⚡ ACTION → ${command}`);

  debug("CLI_ACTION", {
    command,
    state,
    hasRide: !!currentRide,
  });

  switch (command) {
    case "1":
      if (!isOnline) {
        socket.emit("driver-go-online", DRIVER_ID);

        console.log("🟢 Driver ONLINE");
        isOnline = true;

        updateState("SEARCHING");

        startIdleRoaming(); // restart GPS
      } else {
        socket.emit("driver-go-offline", DRIVER_ID);

        console.log("🔴 Driver OFFLINE");
        isOnline = false;

        clearInterval(gpsInterval);
        clearInterval(heartbeatInterval);
      }
      break;

    case "2":
      if (!currentRide) return console.log("❌ No ride available");
      socket.emit("accept-ride", {
        rideId: currentRide._id,
        driverId: DRIVER_ID,
      });
      break;

    case "3":
      if (state === "REQUESTED") {
        console.log("🚫 Rejecting ride request");

        socket.emit("cancel-ride-by-driver", {
          rideId: currentRide._id,
          driverId: DRIVER_ID,
          reason: "Rejected before accept",
        });

        updateState("SEARCHING"); // 🔥 ADD THIS
      }
      break;

    case "4":
      if (!currentRide) return console.log("❌ No active ride");
      socket.emit("arrive-ride", {
        rideId: currentRide._id,
        driverId: DRIVER_ID,
      });
      break;

    case "5":
      if (!currentRide) return console.log("❌ No active ride");
      if (state !== "ARRIVED") {
        return console.log("❌ Not arrived yet");
      }
      socket.emit("start-ride", {
        rideId: currentRide._id,
        driverId: DRIVER_ID,
      });
      break;

    case "6":
      if (!currentRide) return console.log("❌ No active ride");
      if (state !== "ON_TRIP") {
        return console.log("❌ Not started");
      }
      socket.emit("complete-ride", {
        rideId: currentRide._id,
        driverId: DRIVER_ID,
      });
      break;

    case "7":
      if (!currentRide) return console.log("❌ No active ride");
      socket.emit("cancel-ride-by-customer", {
        rideId: currentRide._id,
        reason: "Customer cancelled via CLI",
      });
      break;

    default:
      console.log("❓ Unknown command");
  }

  showMenu();
});

// ---------------- ROUTE ----------------
async function getRoute(start, end) {
  try {
    const url = `https://maps.googleapis.com/maps/api/directions/json?origin=${start.lat},${start.lng}&destination=${end.lat},${end.lng}&key=YOUR_KEY`;

    const res = await axios.get(url);

    if (!res.data.routes.length) {
      console.log("❌ No routes from Google API");
      return idleRoute; // fallback
    }

    const points = res.data.routes[0].overview_polyline.points;
    const decoded = polyline.decode(points);

    return decoded.map((p) => ({
      lat: p[0],
      lng: p[1],
    }));
  } catch (err) {
    console.log("❌ ROUTE ERROR:", err.message);

    return idleRoute; // fallback
  }
}

// ---------------- STATE ----------------
function updateState(newState) {
  logState(state, newState);
  state = newState;
}

//simulate GPS movement
function startGPS(route, target = null, onArrive = null) {
  if (gpsInterval) clearInterval(gpsInterval);

  let segmentIndex = 0;
  let progress = 0;

  gpsInterval = setInterval(() => {
    if (segmentIndex >= route.length - 1) {
      clearInterval(gpsInterval);
      if (onArrive) onArrive();
      return;
    }

    const start = route[segmentIndex];
    const end = route[segmentIndex + 1];
    const SPEED = 0.015 + Math.random() * 0.01;
    progress += SPEED;

    const lat = start.lat + (end.lat - start.lat) * progress;
    const lng = start.lng + (end.lng - start.lng) * progress;

    currentLocation = { lat, lng };

    if (Date.now() - lastSent > 3000) {
      if (!isOnline) return;

      socket.emit("driver-location-update", {
        driverId: DRIVER_ID,
        lat,
        lng,
        vehicleType: "auto",
      });
      lastSent = Date.now();
    }

    if (target) {
      const distance = haversineDistance(lat, lng, target.lat, target.lng);

      if (distance < 0.02) {
        // 20 meters

        clearInterval(gpsInterval);

        if (onArrive) onArrive();

        return;
      }
    }

    if (progress >= 1) {
      progress = 0;
      segmentIndex++;
    }
  }, 1000);
}

const BASE_LOCATION = idleRoute[0];

async function startIdleRoaming() {
  if (gpsInterval) return; // 🚨 prevent duplicate loops

  const roamPoint = {
    lat: BASE_LOCATION.lat + (Math.random() - 0.5) * 0.003,
    lng: BASE_LOCATION.lng + (Math.random() - 0.5) * 0.003,
  };

  const roamRoute = idleRoute;

  startGPS(roamRoute, roamPoint, () => {
    if (state === "SEARCHING") {
      startIdleRoaming();
    }
  });
}

// =====================================================
// 🚕 Socket Events
// =====================================================
socket.on("connect", () => {
  banner("SOCKET CONNECT");

  debug("SOCKET_CONNECT", {
    socketId: socket.id,
    reconnect: hasConnectedOnce,
  });

  if (hasConnectedOnce) {
    console.log("🔁 RECONNECTED");
  } else {
    console.log("🟢 FIRST CONNECT");
    hasConnectedOnce = true;
  }
  console.log("===============================\n");

  socket.emit("register-driver", DRIVER_ID);
  isOnline = true;
  updateState("SEARCHING");

  if (!heartbeatInterval) {
    heartbeatInterval = setInterval(() => {
      socket.emit("driver-heartbeat", DRIVER_ID);
      console.log(`💓 HB → ${state}`);
    }, 5000);
  }

  setTimeout(() => {
    if (isOnline) {
      startIdleRoaming();
    }
  }, 1000);
});

// =====================================================
// 🚕 RIDE FLOW EVENTS
// =====================================================
socket.on("new-ride", async (ride) => {
  if (gpsInterval) clearInterval(gpsInterval);
  banner("NEW RIDE");

  currentRide = ride;

  debug("NEW_RIDE", {
    rideId: ride._id,
    fare: ride.estimatedFare,
    customerCount: ride.passengerCount,
  });

  const pickup = ride.pickupLocation.coordinates;
  const drop = ride.dropLocation.coordinates;

  const distance = haversineDistance(pickup[1], pickup[0], drop[1], drop[0]);

  console.log("📏 Estimated Distance:", distance.toFixed(2), "km");

  const eta = calculateETA(distance);
  console.log("⏳ Estimated Travel Time:", eta, "minutes");

  console.log("💰 Estimated Fare:", ride.estimatedFare);

  updateState("REQUESTED");

  console.log("\n⏳ Waiting for driver action...\n");

  //ACCEPT RIDE
  console.log("\n👉 Press 2 to ACCEPT or 3 to REJECT\n");

  showMenu();
});

socket.on("ride-accepted-success", async (ride) => {
  banner("RIDE ACCEPTED");

  currentRide = ride;

  debug("ACCEPT_SUCCESS", {
    rideId: ride._id,
  });

  updateState("TO_PICKUP");
  const pickup = {
    lat: ride.pickupLocation.coordinates[1],
    lng: ride.pickupLocation.coordinates[0],
  };

  const dynamicRoute = await getRoute(currentLocation, pickup);

  startGPS(dynamicRoute, pickup, () => {
    console.log("\n📍 Reached pickup location\n");

    console.log("👉 Press 4 to ARRIVE\n");
  });
});

socket.on("ride-arrived", (ride) => {
  if (gpsInterval) clearInterval(gpsInterval);

  banner("DRIVER ARRIVED");

  updateState("ARRIVED");

  console.log("⏰ Waiting for passenger");

  //START RIDE
  console.log("👉 Press 5 to START RIDE\n");
});

socket.on("ride-started", async (ride) => {
  if (gpsInterval) clearInterval(gpsInterval);
  banner("RIDE STARTED");

  updateState("ON_TRIP");

  console.log("🗺 Driving towards destination");

  const pickup = {
    lat: ride.pickupLocation.coordinates[1],
    lng: ride.pickupLocation.coordinates[0],
  };

  const drop = {
    lat: ride.dropLocation.coordinates[1],
    lng: ride.dropLocation.coordinates[0],
  };

  const tripRoute = await getRoute(pickup, drop);
  startGPS(tripRoute, drop, () => {
    console.log("\n🏁 Reached destination\n");

    console.log("👉 Press 6 to COMPLETE RIDE\n");
  });
});

socket.on("ride-completed", (ride) => {
  banner("RIDE COMPLETED");

  console.log("🆔 Ride:", ride._id);

  console.log("📏 Distance Travelled:", ride.rideDistanceKm, "km");

  console.log("💰 Total Fare:", ride.fare);

  console.log("👨‍✈️ Driver Earnings:", ride.driverEarning);

  console.log("🏢 Platform Commission:", ride.platformCommission);

  console.log("⏱ Waiting Minutes:", ride.waitingMinutes);

  console.log("💵 Waiting Charge:", ride.waitingCharge);

  currentRide = null;
  updateState("SEARCHING");

  console.log("\n🚗 Driver returning to idle roaming\n");

  console.log("\n🚗 Back to searching...\n");
  if (isOnline) {
    startIdleRoaming();
  }
});

// =====================================================
// 🔥 RECOVERY EVENTS (CRITICAL)
// =====================================================
socket.on("ride-restored", async (data) => {
  console.log("\n🔁 RESTORED RIDE RECEIVED");

  // ✅ DIRECTLY USE RIDE (NO API CALL)
  currentRide = data.ride;

  console.log("🆔 Ride:", currentRide._id);

  const mapped =
    data.status === "accepted"
      ? "TO_PICKUP"
      : data.status === "arrived"
        ? "ARRIVED"
        : data.status === "ongoing"
          ? "ON_TRIP"
          : "SEARCHING";

  updateState(mapped);

  console.log("🔄 State restored:", mapped);

  // =============================
  // 🔥 RESUME GPS BASED ON STATE
  // =============================

  if (mapped === "TO_PICKUP") {
    const pickup = {
      lat: currentRide.pickupLocation.coordinates[1],
      lng: currentRide.pickupLocation.coordinates[0],
    };

    const route = await getRoute(currentLocation, pickup);
    startGPS(route, pickup);
  }

  if (mapped === "ON_TRIP") {
    const drop = {
      lat: currentRide.dropLocation.coordinates[1],
      lng: currentRide.dropLocation.coordinates[0],
    };

    const route = await getRoute(currentLocation, drop);
    startGPS(route, drop);
  }
});

socket.on("driver-lost", (data) => {
  banner("DRIVER LOST");

  console.log("⚠️ Driver disconnected");
  console.log("🔄 Finding new driver...\n");

  currentRide = null;
  updateState("SEARCHING");

  if (isOnline) {
    startIdleRoaming();
  }
});

// =====================================================
// ❌ ERRORS / CANCELS
// =====================================================

socket.on("ride-cancelled", (ride) => {
  banner("RIDE CANCELLED");

  console.log("❌ Cancelled By:", ride.cancelledBy);
  console.log("📝 Reason:", ride.cancelReason);

  currentRide = null;

  updateState("SEARCHING");

  console.log("\n🚗 Back to searching...\n");

  if (isOnline) {
    startIdleRoaming();
  }
});

socket.on("ride-error", (msg) => {
  console.log("\n❌ RIDE ERROR:", msg, "\n");
});

socket.on("ride-taken", (rideId) => {
  console.log("\n⚠️ Ride already taken by another driver:", rideId, "\n");
});

socket.on("tier-upgraded", (data) => {
  console.log("\n🔥 DRIVER TIER UPGRADED");
  console.log("New Tier:", data.newTier);
  console.log("Commission:", data.commissionPercent + "%\n");
});

socket.on("disconnect", () => {
  console.log("🔴 DRIVER SOCKET DISCONNECTED");

  if (heartbeatInterval) {
    clearInterval(heartbeatInterval);
    heartbeatInterval = null;
  }
});
