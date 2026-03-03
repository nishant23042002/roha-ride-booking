import express from "express";
import {
  registerDriver,
  toggleAvailability,
  updateLocation, getAllDrivers
} from "../controllers/driverController.controller.js";

const router = express.Router();

router.post("/register", registerDriver);
router.post("/toggle-availability", toggleAvailability);
router.post("/update-location", updateLocation);
router.get("/", getAllDrivers);


export default router;