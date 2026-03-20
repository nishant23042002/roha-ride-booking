import mongoose from "mongoose";

const rideSchema = new mongoose.Schema(
  {
    customer: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },

    driver: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Driver",
      default: null,
    },

    pickupLocation: {
      type: {
        type: String,
        enum: ["Point"],
        default: "Point",
      },
      coordinates: {
        type: [Number], // [longitude, latitude]
        required: true,
      },
    },

    dropLocation: {
      type: {
        type: String,
        enum: ["Point"],
        default: "Point",
      },
      coordinates: {
        type: [Number],
        required: true,
      },
    },

    status: {
      type: String,
      enum: [
        "requested",
        "accepted",
        "arrived",
        "ongoing",
        "completed",
        "cancelled",
      ],
      default: "requested",
    },

    cancelledBy: {
      type: String,
      enum: ["customer", "driver", "system"],
      default: null,
    },

    cancelReason: {
      type: String,
      default: null,
    },

    passengerCount: {
      type: Number,
      default: 1,
    },

    rideType: {
      type: String,
      enum: ["private", "shared"],
      default: "private",
    },

    vehicleCapacity: { type: Number },

    isShared: {
      type: Boolean,
      default: false,
    },

    estimatedETA: { type: Number, default: 0 },

    estimatedFare: {
      type: Number,
      default: 0,
    },
    estimatedDistanceKm: {
      type: Number,
      default: 0,
    },

    fare: {
      type: Number,
      default: 0,
    },

    rideStartTime: {
      type: Date,
    },

    arrivalTime: {
      type: Date,
    },

    waitingMinutes: {
      type: Number,
      default: 0,
    },

    waitingCharge: {
      type: Number,
      default: 0,
    },

    rideDistanceKm: {
      type: Number,
      default: 0,
    },

    rideDurationMinutes: {
      type: Number,
      default: 0,
    },

    platformCommission: {
      type: Number,
      default: 0,
    },

    driverEarning: {
      type: Number,
      default: 0,
    },

    paymentMethod: {
      type: String,
      enum: ["cash", "online"],
      default: "cash",
    },
  },
  { timestamps: true, optimisticConcurrency: true },
);

rideSchema.index({ pickupLocation: "2dsphere" });
rideSchema.index({ status: 1, driver: 1 });

const Ride = mongoose.model("Ride", rideSchema);

export default Ride;
