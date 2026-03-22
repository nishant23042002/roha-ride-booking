import { calculateAutoFare } from "./engine/priceEngine.js";
import { calculateETA } from "../utils/eta.js";

export const estimateFare = async (req, res) => {
  try {
    const {
      pickupLat,
      pickupLon,
      dropLat,
      dropLon,
      distanceKm,
      durationMinutes,
      rideType,
      passengerCount,
    } = req.body;

    const fare = calculateAutoFare({
      pickupLat,
      pickupLon,
      dropLat,
      dropLon,
      distanceKm,
      durationMinutes,
      rideType,
      passengerCount,
    });

    const eta = calculateETA(fare.distanceKm, "auto");

    res.json({ fare, eta });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};
