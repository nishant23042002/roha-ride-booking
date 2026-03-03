import mongoose from "mongoose";

const driverSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },

    activeRide: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Ride",
      default: null,
    },

    vehicleType: {
      type: String,
      enum: ["bike", "auto", "car", "cab", "taxi"],
      required: true,
    },

    vehicleNumber: {
      type: String,
      required: true,
    },

    licenseNumber: {
      type: String,
      required: true,
    },

    isAvailable: {
      type: Boolean,
      default: false,
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
  },
  { timestamps: true },
);

driverSchema.index({ currentLocation: "2dsphere" });

const Driver = mongoose.model("Driver", driverSchema);

export default Driver;
