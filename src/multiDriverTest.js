import { io } from "socket.io-client";

const SERVER_URL = "http://127.0.0.1:5000";

const DRIVER_IDS = [
  "69aa2faa533f56d3c03a51c5",
  "69aa3ea187d08041a30facbe",
  "69aa3e5a62b90992de87d183",
  "69aa3dc704e15420009c3f91",
  "69aa3e04646cdafc63e2a685",
  "69c0ce9f33bcabb2239bfd50",
  "69c0cedb33bcabb2239bfd5f",
  "69c0cefc33bcabb2239bfd6c",
  "69c0d003c3d790155f5f3429",
  "69c0d0332a8fed0f15a1498d",
];

const BASE = { lat: 18.4384, lng: 73.131 };

// =============================
// 🎲 HELPERS
// =============================
function behavior() {
  const r = Math.random();
  if (r < 0.4) return "AGGRESSIVE";
  if (r < 0.8) return "NORMAL";
  return "LAZY";
}

function createMovement() {
  let lat = BASE.lat;
  let lng = BASE.lng;

  return () => {
    const delta = 0.0001;
    lat += (Math.random() - 0.5) * delta;
    lng += (Math.random() - 0.5) * delta;
    return { lat, lng };
  };
}

// =============================
// 🚗 DRIVER SIM
// =============================
class DriverSim {
  constructor(id) {
    this.id = id;
    this.socket = null;
    this.behavior = behavior();
    this.move = createMovement();

    this.currentRide = null;
    this.isOnline = false;
  }

  log(msg) {
    console.log(`[${this.id}] ${msg}`);
  }

  // =============================
  // 🚀 START
  // =============================
  start() {
    this.socket = io(SERVER_URL, { transports: ["websocket"] });

    this.socket.on("connect", () => {
      this.log(`🟢 CONNECTED (${this.behavior})`);

      this.socket.emit("register-driver", this.id);

      setTimeout(() => {
        this.goOnline();
      }, 300);

      this.startHeartbeat();
      this.startGPS();
    });

    this.socket.on("disconnect", () => {
      this.isOnline = false;
      this.log("🔴 DISCONNECTED");
    });

    this.socket.on("reconnect", () => {
      this.log("🟢 RECONNECTED");
      this.goOnline();
    });

    this.socket.on("new-ride", (ride) => {
      this.currentRide = ride._id;
      this.log(`📡 RIDE RECEIVED ${ride._id}`);
      this.decide(ride);
    });

    this.startChaos();
  }

  goOnline() {
    this.socket.emit("driver-go-online", this.id);
    this.isOnline = true;
    this.log("🟢 ONLINE");
  }

  // =============================
  // 🧠 DECISION ENGINE
  // =============================
  decide(ride) {
    let delay = 1000 + Math.random() * 2000;

    if (this.behavior === "AGGRESSIVE") delay = 400;

    setTimeout(() => {
      if (!this.socket.connected) return;

      if (this.behavior === "LAZY" && Math.random() < 0.7) {
        this.log("😴 IGNORED");
        return;
      }

      const acceptChance =
        this.behavior === "AGGRESSIVE"
          ? 0.85
          : this.behavior === "NORMAL"
            ? 0.5
            : 0.2;

      if (Math.random() < acceptChance) {
        this.log("✅ ACCEPT");

        this.socket.emit("accept-ride", {
          rideId: ride._id,
          driverId: this.id,
        });

        // 💥 CRITICAL CHAOS: POST ACCEPT DISCONNECT
        if (Math.random() < 0.3) {
          setTimeout(() => {
            this.log("💥 POST-ACCEPT DISCONNECT");
            this.socket.disconnect();
          }, 16000);
        }

        // 🚗 simulate lifecycle
        this.simulateRideFlow(ride._id);
      } else {
        this.log("🚫 REJECT");

        this.socket.emit("cancel-ride-by-driver", {
          rideId: ride._id,
          driverId: this.id,
          reason: "chaos_reject",
        });
      }
    }, delay);
  }

  // =============================
  // 🚗 RIDE FLOW
  // =============================
  simulateRideFlow(rideId) {
    // ARRIVE
    setTimeout(() => {
      if (!this.socket.connected) return;

      this.log("📍 ARRIVED");

      this.socket.emit("arrive-ride", {
        rideId,
        driverId: this.id,
      });
    }, 4000);

    // START RIDE
    setTimeout(() => {
      if (!this.socket.connected) return;

      this.log("🚦 START RIDE");

      this.socket.emit("start-ride", {
        rideId,
        driverId: this.id,
      });

      // 💥 MID RIDE DISCONNECT
      if (Math.random() < 0.25) {
        setTimeout(() => {
          this.log("🔥 MID-RIDE DISCONNECT");
          this.socket.disconnect();
        }, 5000);
      }
    }, 7000);

    // COMPLETE
    setTimeout(() => {
      if (!this.socket.connected) return;

      this.log("🏁 COMPLETE");

      this.socket.emit("complete-ride", {
        rideId,
        driverId: this.id,
      });

      this.currentRide = null;
    }, 12000);
  }

  // =============================
  // 💓 HEARTBEAT
  // =============================
  startHeartbeat() {
    setInterval(() => {
      if (this.socket.connected) {
        this.socket.emit("driver-heartbeat", this.id);
      }
    }, 4000);
  }

  // =============================
  // 📍 GPS
  // =============================
  startGPS() {
    setInterval(() => {
      if (!this.socket.connected) return;

      const { lat, lng } = this.move();

      this.socket.emit("driver-location-update", {
        driverId: this.id,
        lat,
        lng,
      });
    }, 3000);
  }

  
  // =============================
  // 💣 CHAOS ENGINE
  // =============================
  startChaos() {
    setInterval(() => {
      const r = Math.random();

      // 🔴 disconnect storm
      if (r < 0.08 && this.socket.connected) {
        this.log("💥 RANDOM DISCONNECT");
        this.socket.disconnect();
      }

      // 🟢 reconnect
      if (r > 0.92 && !this.socket.connected) {
        this.log("🔌 RANDOM RECONNECT");
        this.socket.connect();
      }
    }, 8000);
  }
}

// =============================
// 🚀 START TEST
// =============================
console.log("🚀 CHAOS MULTI-DRIVER TEST START");

const drivers = DRIVER_IDS.map((id) => new DriverSim(id));
drivers.forEach((d) => d.start());
