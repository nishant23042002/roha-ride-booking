import { io } from "socket.io-client";

const socket = io("http://localhost:5000");

const CUSTOMER_ID = "69a5678915baca003e367be0";

socket.on("connect", () => {
  console.log("Customer connected:", socket.id);
  socket.emit("register-customer", CUSTOMER_ID);
});

socket.emit("cancel-ride-by-customer", {
  rideId: "69a5fd109e072967453d8fed",
  reason: "Changed my mind",
});

socket.on("ride-cancelled-success", (ride) => {
  console.log("Ride cancelled successfully:", ride.status);
});

socket.on("ride-error", (msg) => {
  console.log("Error:", msg);
});
