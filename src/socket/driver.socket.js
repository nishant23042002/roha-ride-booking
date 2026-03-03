// /src/socket/driver.socket.js

import { onlineDrivers } from "./index.js";

export default function registerDriverHandlers(socket) {
  socket.on("register-driver", (driverId) => {
    onlineDrivers.set(driverId, socket.id);
    console.log("Driver registered:", driverId);
  });

}
