// /src/server.js

import dotenv from "dotenv";
import http from "http";
import app from "./app.js";
import { initSocket } from "./socket/index.js";
import mongoose from "mongoose";

dotenv.config();

const PORT = process.env.PORT || 5000;

process.on("uncaughtException", (err) => {
  console.log("💥 UNCAUGHT EXCEPTION:", err.message);
});

process.on("unhandledRejection", (err) => {
  console.log("💥 UNHANDLED REJECTION:", err.message);
});

const startServer = async () => {
  try {
    // ✅ 1. CONNECT DB FIRST
    await mongoose.connect(process.env.MONGO_URI);

    console.log("🟢 MongoDB Connected");

    mongoose.connection.on("connected", () => {
      console.log("🟢 MONGO EVENT: connected");
    });

    mongoose.connection.on("disconnected", () => {
      console.log("🔴 MONGO EVENT: disconnected");
    });

    mongoose.connection.on("error", (err) => {
      console.log("❌ MONGO EVENT ERROR:", err.message);
    });

    // ✅ 2. CREATE SERVER
    const server = http.createServer(app);

    // ✅ 3. INIT SOCKET AFTER DB
    initSocket(server);

    // ✅ 4. START SERVER
    server.listen(PORT, "0.0.0.0", () => {
      console.log(`🚀 Server running on port ${PORT}`);
    });
  } catch (error) {
    console.log("❌ SERVER START ERROR:", error.message);
  }
};

startServer();
