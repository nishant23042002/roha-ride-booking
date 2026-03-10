// /src/test.js
import { io } from "socket.io-client";
import { calculateETA } from "./utils/eta.js";
import { haversineDistance } from "./utils/gpsUtils.js";
import { banner, logState } from "./utils/rideLogger.js";
import axios from "axios";
import polyline from "@mapbox/polyline";

const socket = io("http://localhost:5000");

const DRIVER_ID = "69aa2faa533f56d3c03a51c5";

const idleRoute = [
  { lat: 18.4343, lng: 73.1318 },
  { lat: 18.4347, lng: 73.1321 },
  { lat: 18.4341, lng: 73.1324 },
];

async function getRoute(start, end) {
  const url = `https://maps.googleapis.com/maps/api/directions/json?origin=${start.lat},${start.lng}&destination=${end.lat},${end.lng}&key=AIzaSyD8F89IMJWc8Sn18ueBxUozeVqut2vG-pM`;

  const res = await axios.get(url);

  const points = res.data.routes[0].overview_polyline.points;

  const decoded = polyline.decode(points);

  return decoded.map((p) => ({
    lat: p[0],
    lng: p[1],
  }));
}

let step = 0;
let gpsInterval = null;
let currentLocation = idleRoute[0];
let state = "IDLE";

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
    const SPEED = 0.35
    progress += SPEED // movement speed

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

async function startIdleRoaming() {
  const roamPoint = {
    lat: currentLocation.lat + (Math.random() - 0.5) * 0.002,
    lng: currentLocation.lng + (Math.random() - 0.5) * 0.002,
  };

  const roamRoute = await getRoute(currentLocation, roamPoint);

  startGPS(roamRoute, roamPoint, () => {
    if (state === "SEARCHING") {
      startIdleRoaming();
    }
  });
}


socket.on("connect", () => {
  console.log("\n===============================");
  banner("DRIVER SIMULATOR STARTED");
  console.log("Socket:", socket.id);
  console.log("===============================\n");

  socket.emit("register-driver", DRIVER_ID);

  updateState("ONLINE");

  socket.emit("driver-go-online", DRIVER_ID);

  updateState("SEARCHING");

  setInterval(() => {
    socket.emit("driver-heartbeat", DRIVER_ID);
    console.log("💓 Heartbeat sent");
  }, 10000);

  console.log("\n🛰 Driver roaming in idle mode\n");

  startIdleRoaming();
});

socket.on("new-ride", async (ride) => {
  if (gpsInterval) clearInterval(gpsInterval);
  banner("NEW RIDE REQUEST RECEIVED");

  console.log("🆔 Ride ID:", ride._id);
  console.log("👤 Customer:", ride.customer);
  console.log("🚘 Vehicle:", ride.vehicleType);
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

  console.log("\n⚡ Accepting ride...\n");

  setTimeout(() => {
    socket.emit("accept-ride", {
      rideId: ride._id,
      driverId: DRIVER_ID,
    });
  }, 4000);
});

socket.on("ride-accepted-success", async (ride) => {
  banner("RIDE ACCEPTED");

  updateState("TO_PICKUP");

  console.log("🧭 Navigating to pickup location");

  const pickup = {
    lat: ride.pickupLocation.coordinates[1],
    lng: ride.pickupLocation.coordinates[0],
  };

  const dynamicRoute = await getRoute(currentLocation, pickup);

  startGPS(dynamicRoute, pickup, () => {
    console.log("\n📍 Driver reached pickup location\n");

    socket.emit("arrive-ride", {
      rideId: ride._id,
      driverId: DRIVER_ID,
    });
  });
});

socket.on("ride-arrived", (ride) => {
  if (gpsInterval) clearInterval(gpsInterval);

  banner("DRIVER ARRIVED");

  updateState("ARRIVED");

  console.log("⏰ Waiting for passenger");

  setTimeout(() => {
    console.log("\n🚦 STARTING RIDE\n");

    socket.emit("start-ride", {
      rideId: ride._id,
      driverId: DRIVER_ID,
    });
  }, 6000);
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
    console.log("\n🏁 REACHED DESTINATION\n");

    socket.emit("complete-ride", {
      rideId: ride._id,
      driverId: DRIVER_ID,
    });
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

  updateState("SEARCHING");

  console.log("\n🚗 Driver returning to idle roaming\n");

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
