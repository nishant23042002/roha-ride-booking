import DriverWallet from "../models/DriverWallet.js";
import DriverWalletLedger from "../models/DriverWalletLedger.js";

export async function creditDriverWallet({
  driverId,
  amount,
  reason,
  rideId,
  session,
}) {
  const wallet = await DriverWallet.findOne({ driver: driverId }).session(
    session,
  );

  if (!wallet) throw new Error("Driver wallet missing");

  wallet.balance = Number((wallet.balance + amount).toFixed(2));

  await wallet.save({ session });

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
