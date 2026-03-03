import { io } from "socket.io-client";

const DRIVER_ID = "69a5f0691987c2dffc957cfb";

const socket = io("http://localhost:5000");

socket.on("connect", () => {
  console.log("Driver 1 connected:", socket.id);
  socket.emit("register-driver", DRIVER_ID);
});

socket.on("new-ride", (ride) => {
  console.log("Driver 1 received ride:", ride._id);

  socket.emit("accept-ride", {
    rideId: ride._id,
    driverId: DRIVER_ID,
  });
});

socket.on("ride-error", (msg) => {
  console.log("Driver 1 error:", msg);
});

socket.on("ride-taken", (rideId) => {
  console.log("Driver 1 lost ride:", rideId);
});
