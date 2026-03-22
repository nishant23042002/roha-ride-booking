// /src/services/ride/completeRideService.js

import Ride from "../../models/Ride.js";
import Driver from "../../models/Driver.js";
import mongoose from "mongoose";
import { calculateAutoFare } from "../../pricing/engine/priceEngine.js";
import { driverTiers } from "../../config/driverTier.js";
import { creditDriverWallet } from "../driver/walletService.js";
import { changeDriverState } from "../driver/driverState.service.js";
import { rideLog, banner } from "../../utils/rideLogger.js";
import { clearDispatch } from "../../modules/dispatch/dispatch.redis.js";

export async function completeRideService({ rideId, driverId }) {
  const session = await mongoose.startSession();

  try {
    session.startTransaction();

    // -----------------------------
    // 1️⃣ Validate Ride
    // -----------------------------
    const ride = await Ride.findOne({
      _id: rideId,
      driver: driverId,
      status: "ongoing",
    }).session(session);

    if (!ride) {
      throw new Error("Invalid ride state");
    }

    // -----------------------------
    // 2️⃣ Validate Driver
    // -----------------------------
    const driver = await Driver.findById(driverId).session(session);
    if (!driver) throw new Error("Driver missing");

    // -----------------------------
    // 3️⃣ Calculate Fare
    // -----------------------------
    const fareResult = calculateAutoFare({
      vehicleType: driver.vehicleType,
      pickupLat: ride.pickupLocation.coordinates[1],
      pickupLon: ride.pickupLocation.coordinates[0],
      dropLat: ride.dropLocation.coordinates[1],
      dropLon: ride.dropLocation.coordinates[0],
      passengerCount: ride.passengerCount,
      rideType: ride.rideType,
      rideStartTime: ride.rideStartTime,
    });

    let waitingMinutes = 0;
    let waitingCharge = 0;

    if (
      driver.vehicleType === "auto" &&
      ride.arrivalTime &&
      ride.rideStartTime
    ) {
      const diffMs =
        new Date(ride.rideStartTime).getTime() -
        new Date(ride.arrivalTime).getTime();

      waitingMinutes = Math.max(0, diffMs / (1000 * 60));
      waitingMinutes = Math.ceil(waitingMinutes);

      const FREE_MINUTES = 2;

      if (waitingMinutes > FREE_MINUTES) {
        const chargeableMinutes = waitingMinutes - FREE_MINUTES;

        const PER_KM_RATE = 17.14;
        const WAITING_RATE_PER_MIN = PER_KM_RATE * 0.1;

        waitingCharge = chargeableMinutes * WAITING_RATE_PER_MIN;

        ride.waitingMinutes = waitingMinutes;
        ride.waitingCharge = Number(waitingCharge.toFixed(2));
      }
    }

    banner("FARE CALCULATION");

    // -----------------------------
    // 4️⃣ Final Ride Data
    // -----------------------------
    ride.status = "completed";
    ride.rideEndTime = new Date();
    ride.rideDistanceKm = fareResult.distanceKm;

    const finalFare = fareResult.finalFare + waitingCharge;

    ride.fare = Number(finalFare.toFixed(2));

    const durationMinutes =
      (Date.now() - new Date(ride.rideStartTime).getTime()) / (1000 * 60);

    ride.rideDurationMinutes = Number(durationMinutes.toFixed(2));

    // -----------------------------
    // 5️⃣ Commission
    // -----------------------------
    const tier =
      driverTiers
        .slice()
        .reverse()
        .find((t) => (driver.totalTrips || 0) >= t.minRides) || driverTiers[0];

    const commissionPercent = Math.max(tier.commission, 12);
    const commission = (ride.fare * commissionPercent) / 100;

    const driverEarning = ride.fare - commission;

    ride.platformCommission = Number(commission.toFixed(2));
    ride.driverEarning = Number(driverEarning.toFixed(2));

    await ride.save({ session });

    // -----------------------------
    // 6️⃣ Driver Stats
    // -----------------------------
    driver.totalTrips += 1;
    driver.totalEarnings += ride.driverEarning;
    driver.totalDistanceKm += ride.rideDistanceKm;

    // -----------------------------
    // 7️⃣ Wallet Credit
    // -----------------------------
    await creditDriverWallet({
      driverId,
      amount: ride.driverEarning,
      reason: "ride_earning",
      rideId: ride._id,
      session,
    });

    // -----------------------------
    // 8️⃣ Reset Driver
    // -----------------------------
    driver.currentRide = null;
    driver.driverState = "searching";
    driver.isOnline = true; // ensure available

    await changeDriverState({
      driverId,
      newState: "searching",
      session,
    });

    await driver.save({ session });

    
    await session.commitTransaction();
    await clearDispatch(rideId.toString()).catch(() => {});
    banner("RIDE COMPLETED");

    rideLog(ride._id, "TRIP_FINISHED", "Ride completed successfully", {
      fare: ride.fare,
      driverEarning: ride.driverEarning,
      platformCommission: ride.platformCommission,
    });

    return ride;
  } catch (error) {
    await session.abortTransaction();
    throw error;
  } finally {
    session.endSession();
  }
}
