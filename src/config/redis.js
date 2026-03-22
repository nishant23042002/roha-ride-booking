import { createClient } from "redis";
import dotenv from "dotenv";

dotenv.config();

const redis = createClient({
 url: `redis://default:${process.env.REDIS_PASSWORD}@${process.env.REDIS_HOST}:${process.env.REDIS_PORT}`,
});

redis.on("error", (err) => {
  console.log("❌ Redis Error:", err.message);
});

redis.on("connect", () => {
  console.log("🟢 Redis Connected");
});

await redis.connect();

export default redis;
