import express from "express";
import {
  requestRide,
  updateRideStatus,
  getAllRides,
  getRideById,
} from "../controllers/rideController.controller.js";
import {
  cancelRideByCustomer,
  cancelRideByDriver,
} from "../controllers/cancelRide.controller.js";
import { estimateFare } from "../pricing/pricing.controller.js";

const router = express.Router();

router.post("/request", requestRide);
router.post("/status", updateRideStatus);
router.get("/:rideId", getRideById);

// CUSTOMER
router.post("/cancel/customer", cancelRideByCustomer);
router.post("/estimate", estimateFare);

// DRIVER
router.post("/cancel/driver", cancelRideByDriver);
router.get("/", getAllRides);

export default router;
