import express from "express";
import {
  registerDriver,
  updateLocation,
  getAllDrivers,
} from "../controllers/driverController.controller.js";

const router = express.Router();

router.post("/register", registerDriver);

router.post("/update-location", updateLocation);
router.get("/", getAllDrivers);

export default router;
