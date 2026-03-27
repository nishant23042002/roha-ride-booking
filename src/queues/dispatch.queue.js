import { Queue } from "bullmq";
import connection from "../config/bullMQ.redis.js";

export const dispatchQueue = new Queue("dispatch-ride", {
  connection,
});

export async function addDispatchJob(data) {
  console.log("📥 Adding dispatch job →", data);

  await dispatchQueue.add(
    "dispatch",
    data, // ✅ pass full object
    {
      jobId: data.rideId.toString(),
      removeOnComplete: true,
    },
  );
}
