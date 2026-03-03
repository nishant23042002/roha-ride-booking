import { io } from "socket.io-client";

const DRIVER_ID = "69a5f0691987c2dffc957cfb";

const socket = io("http://localhost:5000");

socket.on("connect", () => {
  console.log("Driver 2 connected:", socket.id);
  socket.emit("register-driver", DRIVER_ID);
});

socket.on("new-ride", (ride) => {
  const delay = Math.floor(Math.random() * 1000);

  setTimeout(() => {
    socket.emit("accept-ride", {
      rideId: ride._id,
      driverId: DRIVER_ID,
    });
  }, delay);
});

socket.on("ride-error", (msg) => {
  console.log("Driver 2 error:", msg);
});

socket.on("ride-taken", (rideId) => {
  console.log("Driver 2 lost ride:", rideId);
});
