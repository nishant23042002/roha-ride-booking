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
      enum: ["customer", "driver", null],
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

    vehicleCapacity: { type: Number },

    fare: {
      type: Number,
      default: 0,
    },

    rideStartTime: {
      type: Date,
    },

    rideStartTime: {
      type: Date,
    },

    rideDistanceKm: {
      type: Number,
      default: 0,
    },

    rideDurationMinutes: {
      type: Number,
      default: 0,
    },
  },
  { timestamps: true },
);

rideSchema.index({ pickupLocation: "2dsphere" });

const Ride = mongoose.model("Ride", rideSchema);

export default Ride;
