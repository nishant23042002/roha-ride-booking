// /src/services/changeDriverState.js

import Driver from "../models/Driver.js";

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

  console.log(`[DRIVER_STATE] driver=${driverId} → ${newState}`);

  return driver;
}
