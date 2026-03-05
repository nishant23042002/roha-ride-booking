import mongoose from "mongoose";

const driverWalletSchema = new mongoose.Schema(
  {
    driver: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Driver",
      required: true,
    },

    balance: {
      type: Number,
      default: 0,
    },
  },
  { timestamps: true },
);

driverWalletSchema.index({ driver: 1 }, { unique: true });

const DriverWallet = mongoose.model("DriverWallet", driverWalletSchema);

export default DriverWallet;
