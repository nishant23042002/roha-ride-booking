// /src/app.js

import express from "express";
import cors from "cors";

import authRoutes from "./routes/authRoutes.route.js";
import driverRoutes from "./routes/driverRoutes.route.js";
import rideRoutes from "./routes/rideRoutes.route.js";

const app = express();

app.use(cors());
app.use(express.json());

app.get("/", (req, res) => {
  res.send("Roha Ride API Running 🚕");
});

app.use("/api/auth", authRoutes);
app.use("/api/driver", driverRoutes);
app.use("/api/ride", rideRoutes);

export default app;
