// /src/test.js
import { io } from "socket.io-client";

const socket = io("http://localhost:5000");

const DRIVER_ID = "69a777a18d2865cc4eadf38c";

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

    console.log("📍 Driver moved to:", point, "| state: ", state);

    step++;

    if (step >= route.length) {
      step = 0;
    }
  }, 3000);
}

socket.on("connect", () => {
  console.log("Driver Connected:", socket.id);
  socket.emit("register-driver", DRIVER_ID);

  setInterval(() => {
    socket.emit("driver-heartbeat", DRIVER_ID);
  }, 10000);

  console.log("🚗 Driving roaming idel");

  startGPS(idleRoute);
});

socket.on("new-ride", async (ride) => {
  console.log("🚕 New ride received:", ride._id);

  state = "TO_PICKUP";

  // simulate driver clicking accept
  socket.emit("accept-ride", {
    rideId: ride._id,
    driverId: DRIVER_ID,
  });
});

socket.on("ride-accepted-success", (ride) => {
  console.log("✅ Ride accepted:", ride._id);

  console.log("🚗 Driving to pickup");

  startGPS(pickupRoute);

  const Arrival_TIME = (pickupRoute.length - 1) * 3000;
  setTimeout(() => {
    socket.emit("arrive-ride", {
      rideId: ride._id,
      driverId: DRIVER_ID,
    });
  }, Arrival_TIME);
});

socket.on("ride-arrived", (ride) => {
  console.log("📍 Driver arrived at pickup");

  state = "WAITING";
  console.log("⏰ waiting for passenger");
  console.log(
    `⏳ Simulating waiting time: ${WAITING_TIME_BEFORE_START / 60000} minutes`,
  );

  setTimeout(() => {
    socket.emit("start-ride", {
      rideId: ride._id,
      driverId: DRIVER_ID,
    });
  }, WAITING_TIME_BEFORE_START);
});

socket.on("ride-started", (ride) => {
  console.log("Ride started");

  state = "IN_RIDE";

  startGPS(rideRoute);

  console.log("🚗 Driving to destination");

  setTimeout(() => {
    socket.emit("complete-ride", {
      rideId: ride._id,
      driverId: DRIVER_ID,
    });
  }, rideRoute.length * 3000);
});

socket.on("ride-completed", (ride) => {
  console.log("✅ Ride Completed");

  console.log("Fare:", ride.fare);
  console.log("Waiting Minutes:", ride.waitingMinutes);
  console.log("Waiting Charge:", ride.waitingCharge);

  state = "IDLE";

  startGPS(idleRoute);
});

socket.on("ride-error", (msg) => {
  console.log("Error:", msg);
});

socket.on("ride-taken", (rideId) => {
  console.log("Ride taken by someone else:", rideId);
});

socket.on("tier-upgraded", (data) => {
  console.log("🔥 TIER UPGRADED!");
  console.log("New Tier:", data.newTier);
  console.log("New Commission:", data.commissionPercent + "%");
});
