export const log = (level, message, meta = {}) => {
  const time = new Date().toISOString();

  console.log(
    JSON.stringify({
      time,
      level,
      message,
      ...meta,
    }),
  );
};

// helpers
export const info = (msg, meta) => log("INFO", msg, meta);
export const error = (msg, meta) => log("ERROR", msg, meta);
export const warn = (msg, meta) => log("WARN", msg, meta);
