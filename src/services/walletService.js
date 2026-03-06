import DriverWallet from "../models/DriverWallet.js";
import DriverWalletLedger from "../models/DriverWalletLedger.js";

export async function creditDriverWallet({
  driverId,
  amount,
  reason,
  rideId,
  session,
}) {
  const wallet = await DriverWallet.findOneAndUpdate(
    { driver: driverId },
    {
      $inc: { balance: amount },
    },
    {
      returnDocument: "after",
      session,
    },
  );
  if (!wallet) throw new Error("Driver wallet missing");

  await DriverWalletLedger.create(
    [
      {
        driver: driverId,
        wallet: wallet._id,
        type: "credit",
        amount,
        reason,
        ride: rideId,
        balanceAfter: wallet.balance,
      },
    ],
    { session },
  );
}
