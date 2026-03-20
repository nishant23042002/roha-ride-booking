import express from "express";
import { driverSync,customerSync } from "../controllers/sync.controller.js";

const router = express.Router();

router.get("/driver/:driverId", driverSync);
router.get("/customer/:customerId", customerSync);

export default router;
