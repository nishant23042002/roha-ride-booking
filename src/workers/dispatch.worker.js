import mongoose from "mongoose";
import { Worker } from "bullmq";
import connection from "../config/bullMQ.redis.js";
import { runDispatch } from "../modules/dispatch/dispatch.service.js";

// ✅ CONNECT MONGO FIRST
await mongoose.connect(process.env.MONGO_URI);
console.log("🟢 Worker MongoDB Connected");

const worker = new Worker(
  "dispatch-ride",
  async (job) => {
    const { rideId, context } = job.data;

    console.log("\n🧠 WORKER:", rideId);
    console.log("📊 Context:", context);
    await runDispatch(rideId, context);
  },
  { connection },
);
worker.on("completed", (job) => {
  console.log("✅ Job completed:", job.id);
});

worker.on("failed", (job, err) => {
  console.log("❌ Job failed:", job.id, err.message);
});
