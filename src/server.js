// /src/server.js

import dotenv from "dotenv";
import http from "http";
import app from "./app.js";
import { initSocket } from "./socket/index.js";
import { connectDB } from "./config/db.js";
import Driver from "./models/Driver.js";
import redis from "./config/redis.js";

dotenv.config();

const PORT = process.env.PORT || 5000;
// 🔥 GLOBAL ERROR HANDLING
process.on("uncaughtException", (err) => {
  console.log("💥 UNCAUGHT EXCEPTION:", err.message);
  process.exit(1);
});

process.on("unhandledRejection", (err) => {
  console.log("💥 UNHANDLED REJECTION:", err.message);
  process.exit(1);
});

const startServer = async () => {
  await connectDB();

  const server = http.createServer(app);

  initSocket(server);

  await redis.set("test-key", "yatrigo-working");
  const val = await redis.get("test-key");
  console.log("✅ Redis Test:", val);

  setInterval(async () => {
    try {
      const threshold = new Date(Date.now() - 30000);

      const result = await Driver.updateMany(
        {
          lastHeartbeat: { $lt: threshold },
          isOnline: true,
          driverState: { $nin: ["on_trip", "arrived"] },
        },
        {
          $set: {
            isOnline: false,
            driverState: "offline",
          },
        },
      );

      if (result.modifiedCount > 0) {
        console.log(`🧹 Cleaned ${result.modifiedCount} inactive drivers`);
      }
    } catch (err) {
      console.log("❌ HEARTBEAT CLEANER ERROR:", err.message);
    }
  }, 20000);

  server.listen(PORT, "0.0.0.0", () => {
    console.log(`🚀 Server running on port ${PORT}`);
  });

  // 🔥 GRACEFUL SHUTDOWN
  process.on("SIGINT", () => {
    console.log("🛑 Shutting down...");
    server.close(() => {
      console.log("💤 Server closed");
      process.exit(0);
    });
  });
};

startServer();
