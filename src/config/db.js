import mongoose from "mongoose";

export const connectDB = async () => {
  try {
    await mongoose.connect(process.env.MONGO_URI);

    console.log("🟢 MongoDB Connected");

    mongoose.connection.on("connected", () => {
      console.log("🟢 MONGO EVENT: connected");
    });

    mongoose.connection.on("disconnected", () => {
      console.log("🔴 MONGO EVENT: disconnected");
    });

    mongoose.connection.on("error", (err) => {
      console.log("❌ MONGO ERROR:", err.message);
    });
  } catch (error) {
    console.log("❌ DB CONNECTION FAILED:", error.message);
    process.exit(1);
  }
};
