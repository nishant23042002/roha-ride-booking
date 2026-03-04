// /src/socket/driver.socket.js

import Driver from "../models/Driver.js";
import { onlineDrivers } from "./index.js";

export default function registerDriverHandlers(socket) {
  socket.on("register-driver", async (driverId) => {
    onlineDrivers.set(driverId, socket.id);
    await Driver.findByIdAndUpdate(driverId, {
      lastHeartbeat: new Date(),
    });
    console.log("Driver registered:", driverId);
  });

  socket.on("driver-heartbeat", async (driverId) => {
    await Driver.findByIdAndUpdate(driverId, {
      lastHeartbeat: new Date(),
    });
  });
}
