// /src/config/redis.js

import { createClient } from "redis";
import dotenv from "dotenv";

dotenv.config();

let redisHealthy = false;
let lastErrorLogged = 0;

export const isRedisHealthy = () => redisHealthy;

const redis = createClient({
  url: process.env.REDIS_URL,

  socket: {
    reconnectStrategy: (retries) => {
      if (retries > 10) {
        console.log("⚠️ Redis retry limit reached, backing off...");
        return 5000; // retry every 5s instead of stopping
      }
      return Math.min(retries * 200, 3000);
    },
  },
});

redis.on("connect", () => {
  console.log("🟢 Redis Connected");
  redisHealthy = true;
});

redis.on("error", (err) => {
  const now = Date.now();

  if (now - lastErrorLogged > 3000) {
    console.log("❌ Redis Error:", err.message);
    lastErrorLogged = now;
  }

  redisHealthy = false;
});

redis.on("reconnecting", () => {
  console.log("🔄 Redis reconnecting...");
  redisHealthy = false;
});

redis.connect().catch((err) => {
  console.log("❌ Redis initial connection failed:", err.message);
});

export default redis;
