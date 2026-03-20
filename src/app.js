// /src/app.js

import express from "express";
import cors from "cors";

import authRoutes from "./routes/authRoutes.route.js";
import driverRoutes from "./routes/driverRoutes.route.js";
import rideRoutes from "./routes/rideRoutes.route.js";
import syncRoutes from "./routes/sync.routes.js"

const app = express();

app.use(
  cors({
    origin: true, // allow all (dev)
    credentials: true,
    methods: ["GET", "POST"],
  }),
);
app.use(express.json());

// 🔥 REQUEST LOGGER (VERY IMPORTANT)
app.use((req, res, next) => {
  console.log(`📡 ${req.method} ${req.url}`);
  next();
});

app.get("/", (req, res) => {
  res.send("Roha Ride API Running 🚕");
});

app.use("/api/auth", authRoutes);
app.use("/api/driver", driverRoutes);
app.use("/api/ride", rideRoutes);
app.use("/api/sync", syncRoutes)

// 🔥 GLOBAL ERROR HANDLER
app.use((err, req, res, next) => {
  console.log("❌ GLOBAL ERROR:", err.message);

  res.status(500).json({
    message: err.message || "Internal Server Error",
  });
});

export default app;
