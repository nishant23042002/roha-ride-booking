const buckets = new Map();

export function rateLimit(key, limit = 10, windowMs = 20000) {
  const now = Date.now();
  const entry = buckets.get(key) || { count: 0, ts: now };

  if (now - entry.ts > windowMs) {
    entry.count = 0;
    entry.ts = now;
  }

  entry.count += 1;
  buckets.set(key, entry);

  return entry.count <= limit;
}
