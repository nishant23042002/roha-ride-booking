export function rideLog(rideId, step, message, extra = {}) {
  const time = new Date().toISOString();

  const extras = Object.entries(extra)
    .map(([k, v]) => `${k}=${v}`)
    .join(" ");

  console.log(
    `\n🚕 RIDE ${rideId} | ${step}\n🕒 ${time}\n${message} ${extras}\n`,
  );
}

export function banner(title) {
  console.log("\n==================================================");
  console.log(`🚦 ${title}`);
  console.log("==================================================\n");
}

export function logState(prevState, newState) {
  console.log(`🔄 DRIVER STATE: ${prevState} → ${newState}`);
}

export function driverLog(driverId, step, message, extra = {}) {
  const extras = Object.entries(extra)
    .map(([k, v]) => `${k}=${v}`)
    .join(" ");

  console.log(`\n🚗 DRIVER ${driverId} | ${step}\n${message} ${extras}\n`);
}
