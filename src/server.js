// /src/server.js

import dotenv from "dotenv";
import http from "http";
import app from "./app.js";
import { initSocket } from "./socket/index.js";
import { connectDB } from "./config/db.js";

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
