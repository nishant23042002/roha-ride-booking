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

  if (rideId !== null) {
    update.currentRide = rideId;
  }

  if (newState === "searching" || newState === "offline") {
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

  // 🔥 ADD THIS BLOCK
  if (!session) {
    await setDriverState(driverId.toString(), newState);
  }

  console.log(`[DRIVER_STATE] driver=${driverId} → ${newState}`);

  return driver;
}
