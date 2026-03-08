// /src/test.js
import { io } from "socket.io-client";
import { calculateETA } from "./utils/eta.js";
import { haversineDistance } from "./utils/gpsUtils.js";
import { banner, logState } from "./utils/rideLogger.js";

const socket = io("http://localhost:5000");

const DRIVER_ID = "69aa2faa533f56d3c03a51c5";

const WAITING_TIME_BEFORE_START = 1000;

const idleRoute = [
  { lat: 18.4343, lng: 73.1318 },
  { lat: 18.4347, lng: 73.1321 },
  { lat: 18.4341, lng: 73.1324 },
];

const pickupRoute = [
  { lat: 18.4352, lng: 73.1312 },
  { lat: 18.4357, lng: 73.1316 },
  { lat: 18.4361, lng: 73.1321 },
  { lat: 18.4365, lng: 73.1326 },
];
const rideRoute = [
  { lat: 18.4365, lng: 73.1326 },
  { lat: 18.4359, lng: 73.133 },
  { lat: 18.4351, lng: 73.1334 },
  { lat: 18.4344, lng: 73.1338 },
];

let step = 0;
let gpsInterval = null;

let state = "IDLE";

function updateState(newState) {
  logState(state, newState);
  state = newState;
}

//simulate GPS movement
function startGPS(route) {
  if (gpsInterval) clearInterval(gpsInterval);

  step = 0;

  gpsInterval = setInterval(() => {
    const point = route[step];

    socket.emit("driver-location-update", {
      driverId: DRIVER_ID,
      lat: point.lat,
      lng: point.lng,
      vehicleType: "auto"
    });

    console.log(
      `📍 GPS → (${point.lat.toFixed(5)}, ${point.lng.toFixed(5)}) | STATE: ${state}`,
    );

    step++;

    if (step >= route.length) {
      step = 0;
    }
  }, 3000);
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

  startGPS(idleRoute);
});

socket.on("new-ride", async (ride) => {
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

  socket.emit("accept-ride", {
    rideId: ride._id,
    driverId: DRIVER_ID,
  });
});

socket.on("ride-accepted-success", (ride) => {
  banner("RIDE ACCEPTED");

  console.log("🆔 Ride:", ride._id);

  updateState("TO_PICKUP");

  console.log("🧭 Navigating to pickup location");

  startGPS(pickupRoute);

  const arrivalTime = (pickupRoute.length - 1) * 3000;

  console.log("⏳ Estimated arrival time:", arrivalTime / 1000, "seconds");

  setTimeout(() => {
    console.log("\n📍 Driver reached pickup location\n");

    socket.emit("arrive-ride", {
      rideId: ride._id,
      driverId: DRIVER_ID,
    });
  }, arrivalTime);
});

socket.on("ride-arrived", (ride) => {
  banner("DRIVER ARRIVED");

  updateState("ARRIVED");

  console.log("⏰ Waiting for passenger");

  console.log(
    "🕒 Waiting time simulation:",
    WAITING_TIME_BEFORE_START / 1000,
    "seconds",
  );

  setTimeout(() => {
    console.log("\n🚦 STARTING RIDE\n");

    socket.emit("start-ride", {
      rideId: ride._id,
      driverId: DRIVER_ID,
    });
  }, WAITING_TIME_BEFORE_START);
});

socket.on("ride-started", (ride) => {
  banner("RIDE STARTED");

  updateState("ON_TRIP");

  console.log("🗺 Driving towards destination");

  startGPS(rideRoute);

  const travelTime = rideRoute.length * 3000;

  console.log("⏳ Estimated trip duration:", travelTime / 1000, "seconds");

  setTimeout(() => {
    console.log("\n🏁 REACHED DESTINATION\n");

    socket.emit("complete-ride", {
      rideId: ride._id,
      driverId: DRIVER_ID,
    });
  }, rideRoute.length * 3000);
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

  startGPS(idleRoute);
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
