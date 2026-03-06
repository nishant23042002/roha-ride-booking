// /src/test.js
import { io } from "socket.io-client";

const socket = io("http://localhost:5000");

const DRIVER_ID = "69aa40d151fc30d47b82e4dc";

const WAITING_TIME_BEFORE_START = 1000;

const idleRoute = [
  { lat: 19.0752, lng: 72.8768 },
  { lat: 19.0754, lng: 72.8769 },
  { lat: 19.0756, lng: 72.877 },
  { lat: 19.0754, lng: 72.8769 },
];

const pickupRoute = [
  { lat: 19.0752, lng: 72.8768 },
  { lat: 19.0755, lng: 72.877 },
  { lat: 19.0757, lng: 72.8773 },
  { lat: 19.0759, lng: 72.8775 },
  { lat: 19.076, lng: 72.8777 }, // pickup
];
const rideRoute = [
  { lat: 19.076, lng: 72.8777 },
  { lat: 19.0765, lng: 72.878 },
  { lat: 19.077, lng: 72.8783 },
  { lat: 19.0775, lng: 72.8787 },
  { lat: 19.078, lng: 72.879 }, // drop
];

let step = 0;
let gpsInterval = null;
let state = "IDLE";

function logState(newState) {
  console.log(`\n🔄 STATE → ${newState}\n`);
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
    });

    console.log(
      `📍 GPS_UPDATE → lat=${point.lat} lng=${point.lng} | state=${state}`,
    );
    step++;

    if (step >= route.length) {
      step = 0;
    }
  }, 3000);
}

socket.on("connect", () => {
  console.log("\n===============================");
  console.log("🚗 DRIVER CONNECTED");
  console.log("Socket:", socket.id);
  console.log("===============================\n");

  socket.emit("register-driver", DRIVER_ID);

  logState("ONLINE");

  socket.emit("driver-go-online", DRIVER_ID);

  logState("SEARCHING");

  setInterval(() => {
    socket.emit("driver-heartbeat", DRIVER_ID);
  }, 10000);

  console.log("🚗 Driver roaming (idle mode)");

  startGPS(idleRoute);
});

socket.on("new-ride", async (ride) => {
  console.log("\n===============================");
  console.log("🚕 NEW RIDE REQUEST RECEIVED");
  console.log("Ride ID:", ride._id);
  console.log("===============================\n");

  logState("REQUESTED");

  socket.emit("accept-ride", {
    rideId: ride._id,
    driverId: DRIVER_ID,
  });
});

socket.on("ride-accepted-success", (ride) => {
  console.log("\n===============================");
  console.log("✅ RIDE ACCEPTED");
  console.log("Ride:", ride._id);
  console.log("===============================\n");

  logState("TO_PICKUP");

  console.log("🚗 Navigating to pickup location");

  startGPS(pickupRoute);

  const arrivalTime = (pickupRoute.length - 1) * 3000;

  setTimeout(() => {
    console.log("\n📍 ARRIVED AT PICKUP\n");

    socket.emit("arrive-ride", {
      rideId: ride._id,
      driverId: DRIVER_ID,
    });
  }, arrivalTime);
});

socket.on("ride-arrived", (ride) => {
  logState("ARRIVED");

  console.log("⏰ Waiting for passenger");

  console.log(
    `⏳ Simulated waiting: ${WAITING_TIME_BEFORE_START / 60000} minutes`,
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
  console.log("\n===============================");
  console.log("🚗 RIDE STARTED");
  console.log("===============================\n");

  logState("ON_TRIP");

  console.log("🚗 Driving to destination");

  startGPS(rideRoute);

  setTimeout(() => {
    console.log("\n🏁 REACHED DESTINATION\n");

    socket.emit("complete-ride", {
      rideId: ride._id,
      driverId: DRIVER_ID,
    });
  }, rideRoute.length * 3000);
});

socket.on("ride-completed", (ride) => {
  console.log("\n===============================");
  console.log("✅ RIDE COMPLETED");
  console.log("===============================\n");

  console.log("💰 Fare:", ride.fare);
  console.log("🕒 Waiting Minutes:", ride.waitingMinutes);
  console.log("💵 Waiting Charge:", ride.waitingCharge);

  logState("SEARCHING");

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
