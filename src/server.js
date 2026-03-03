// /src/server.js

import dotenv from "dotenv";
import http from "http";
import connectDB from "./config/db.js";
import app from "./app.js";
import { initSocket } from "./socket/index.js";

dotenv.config();

const PORT = process.env.PORT || 5000;

// Create HTTP server
const server = http.createServer(app);

// Initialize Socket.io
initSocket(server);

// Connect database
connectDB();

// Start server (IMPORTANT → server.listen NOT app.listen)
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
