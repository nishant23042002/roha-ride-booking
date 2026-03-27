import IORedis from "ioredis";

const connection = new IORedis({
  host: "127.0.0.1",
  port: 6379,
  maxRetriesPerRequest: null, // 🔥 REQUIRED for BullMQ
});

connection.on("connect", () => {
  console.log("🟢 BullMQ Redis Connected");
});

connection.on("error", (err) => {
  console.log("❌ BullMQ Redis Error:", err.message);
});

export default connection;