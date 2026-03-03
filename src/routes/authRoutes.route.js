import express from "express";
import { registerUser, loginUser, getAllUsers } from "../controllers/authController.controller.js";

const router = express.Router();

router.post("/register", registerUser);
router.post("/login", loginUser);
// GET all users
router.get("/", getAllUsers);

export default router;
