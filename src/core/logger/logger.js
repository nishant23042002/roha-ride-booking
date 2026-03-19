const logTracker = new Map();

export function throttledLog(key, interval = 5000, ...args) {
  const now = Date.now();
  const lastLog = logTracker.get(key) || 0;

  if (now - lastLog > interval) {
    console.log(...args);
    logTracker.set(key, now);
  }
}
