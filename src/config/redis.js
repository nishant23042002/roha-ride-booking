import { createClient } from "redis";
import dotenv from "dotenv";

dotenv.config();

const redis = createClient({
  url: process.env.REDIS_URL,

  socket: {
    reconnectStrategy: (retries) => {
      if (retries > 10) return new Error("Redis retry limit reached");
      return Math.min(retries * 100, 3000);
    },
  },
});

redis.on("error", (err) => {
  console.log("❌ Redis Error:", err.message);
});

redis.on("reconnecting", () => {
  console.log("🔄 Redis reconnecting...");
});

redis.on("connect", () => {
  console.log("🟢 Redis Connected");
});

await redis.connect();

export default redis;
