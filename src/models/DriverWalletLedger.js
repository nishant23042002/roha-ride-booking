import mongoose from "mongoose";

const driverWalletLedgerSchema = new mongoose.Schema(
  {
    driver: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Driver",
      required: true,
    },

    wallet: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "DriverWallet",
      required: true,
    },

    type: {
      type: String,
      enum: ["credit", "debit"],
      required: true,
    },

    amount: {
      type: Number,
      required: true,
    },

    reason: {
      type: String,
      enum: ["ride_earning", "platform_commission", "payout", "adjustment"],
    },

    ride: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Ride",
    },

    balanceAfter: {
      type: Number,
    },
  },
  { timestamps: true },
);

const DriverWalletLedger = mongoose.model(
  "DriverWalletLedger",
  driverWalletLedgerSchema,
);

export default DriverWalletLedger;
