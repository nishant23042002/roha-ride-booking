// /src/test.js
import { io } from "socket.io-client";
import { calculateETA } from "./utils/eta.js";
import { haversineDistance } from "./utils/gpsUtils.js";
import { banner, logState } from "./utils/rideLogger.js";
import axios from "axios";
import polyline from "@mapbox/polyline";
import readline from "readline";

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

// ---------------- CLI HANDLER ----------------

rl.on("line", (input) => {
  const command = input.trim();

  if (!/^[1-8]$/.test(command)) {
    console.log("❓ Invalid input");
    showMenu();
    return;
  }
  switch (command) {
    case "1":
      if (!isOnline) {
        socket.emit("register-driver", DRIVER_ID); // 🔥 IMPORTANT
        socket.emit("driver-go-online", DRIVER_ID);

        console.log("🟢 Driver ONLINE");
        isOnline = true;

        updateState("SEARCHING");

        startIdleRoaming(); // restart GPS
      } else {
        socket.emit("driver-go-offline", DRIVER_ID);

        console.log("🔴 Driver OFFLINE");
        isOnline = false;

        if (gpsInterval) {
          clearInterval(gpsInterval);
          gpsInterval = null;
        }

        if (heartbeatInterval) {
          clearInterval(heartbeatInterval);
          heartbeatInterval = null;
        }
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
        return console.log("❌ Cannot start before arrival");
      }
      socket.emit("start-ride", {
        rideId: currentRide._id,
        driverId: DRIVER_ID,
      });
      break;

    case "6":
      if (!currentRide) return console.log("❌ No active ride");
      if (state !== "ON_TRIP") {
        return console.log("❌ Cannot complete before starting ride");
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

    socket.emit("driver-location-update", {
      driverId: DRIVER_ID,
      lat,
      lng,
      vehicleType: "auto",
    });

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

// ---------------- SOCKET EVENTS ----------------
socket.on("connect", () => {
  console.log("\n===============================");
  banner("DRIVER SIMULATOR STARTED");
  console.log("Socket:", socket.id);
  console.log("===============================\n");

  socket.emit("register-driver", DRIVER_ID);

  updateState("ONLINE");

  socket.emit("driver-go-online", DRIVER_ID);

  // ✅ STEP 2: wait a bit (important)
  setTimeout(() => {
    startIdleRoaming(); // GPS starts AFTER registration
  }, 1000);

  updateState("SEARCHING");

  if (!heartbeatInterval) {
    heartbeatInterval = setInterval(() => {
      socket.emit("driver-heartbeat", DRIVER_ID);
      console.log("💓 Heartbeat sent");
    }, 10000);
  }

  console.log("\n🛰 Driver roaming in idle mode\n");
});

socket.on("new-ride", async (ride) => {
  if (gpsInterval) clearInterval(gpsInterval);
  banner("NEW RIDE REQUEST RECEIVED");

  currentRide = ride;

  console.log("🆔 Ride ID:", ride._id);
  console.log("👤 Customer:", ride.customer);
  console.log("🚘 Vehicle:", ride.vehicleType || "N/A");
  console.log("👥 Passengers:", ride.passengerCount);
  console.log("📦 Ride Type:", ride.rideType);

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
  updateState("TO_PICKUP");

  console.log("🧭 Navigating to pickup location");

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
  startIdleRoaming();
});

socket.on("ride-cancelled", (ride) => {
  banner("RIDE CANCELLED");

  console.log("❌ Cancelled By:", ride.cancelledBy);
  console.log("📝 Reason:", ride.cancelReason);

  currentRide = null;

  updateState("SEARCHING");

  console.log("\n🚗 Back to searching...\n");

  startIdleRoaming();
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
