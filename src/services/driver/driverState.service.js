// /src/services/changeDriverState.js

import Driver from "../../models/Driver.js";
import { setDriverState } from "../../modules/driverState/driverState.redis.js";

export async function changeDriverState({
  driverId,
  newState,
  rideId = null,
  session = null,
}) {
  const update = {
    driverState: newState,
  };

  // =============================
  // 🎯 STATE → ONLINE SYNC
  // =============================
  if (newState === "offline") {
    update.isOnline = false;
    update.currentRide = null;
  } else {
    update.isOnline = true;
  }

  // =============================
  // 🚕 RIDE SYNC
  // =============================
  if (rideId !== null) {
    update.currentRide = rideId;
  }

  if (newState === "searching") {
    update.currentRide = null;
  }

  const driver = await Driver.findByIdAndUpdate(
    driverId,
    { $set: update },
    {
      returnDocument: "after",
      session,
    },
  );

  if (!driver) {
    throw new Error("Driver not found");
  }

  // 🔥 Redis sync (non-blocking safe)
  if (!session) {
    try {
      await setDriverState(driverId.toString(), newState);
    } catch (err) {
      console.log("⚠️ Redis state update failed:", err.message);
    }
  }

  console.log(`[DRIVER_STATE] driver=${driverId} → ${newState}`);

  return driver;
}
