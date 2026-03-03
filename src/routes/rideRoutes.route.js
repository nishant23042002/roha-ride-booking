import express from "express";
import {
  requestRide,
  updateRideStatus,
  getAllRides,
} from "../controllers/rideController.controller.js";

const router = express.Router();

router.post("/request", requestRide);
router.post("/status", updateRideStatus);
router.get("/", getAllRides);

export default router;
