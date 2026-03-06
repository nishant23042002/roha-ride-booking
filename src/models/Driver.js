import mongoose from "mongoose";

const driverSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },

    driverState: {
      type: String,
      enum: [
        "offline",
        "online",
        "searching",
        "requested",
        "to_pickup",
        "arrived",
        "on_trip",
      ],
      default: "offline",
    },

    currentRide: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Ride",
      default: null,
    },

    vehicleType: {
      type: String,
      enum: ["bike", "auto", "minidoor"],
      required: true,
    },

    vehicleCapacity: {
      type: Number,
      default: 1,
    },

    currentSeatLoad: {
      type: Number,
      default: 0,
    },

    vehicleNumber: {
      type: String,
      required: true,
      unique: true,
    },

    licenseNumber: {
      type: String,
      required: true,
      unique: true,
    },

    tierLevel: {
      type: Number,
      default: 1,
    },

    tierName: {
      type: String,
      default: "Bronze",
    },

    totalTrips: {
      type: Number,
      default: 0,
    },

    totalEarnings: {
      type: Number,
      default: 0,
    },

    totalDistanceKm: {
      type: Number,
      default: 0,
    },

    walletBalance: {
      type: Number,
      default: 0,
    },

    currentLocation: {
      type: {
        type: String,
        enum: ["Point"],
        default: "Point",
      },
      coordinates: {
        type: [Number], // [longitude, latitude]
        default: [0, 0],
      },
    },

    lastHeartbeat: {
      type: Date,
      default: Date.now,
    },
  },
  {
    timestamps: true,
    optimisticConcurrency: true,
  },
);

driverSchema.index({ currentLocation: "2dsphere" });

const Driver = mongoose.model("Driver", driverSchema);

export default Driver;
