export async function withRetry(operation, retries = 3) {
  let lastError;

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;

      if (
        error.hasErrorLabel?.("TransientTransactionError") ||
        error.hasErrorLabel?.("UnknownTransactionCommitResult")
      ) {
        console.log(`🔁 Retry attempt ${attempt}`);
        continue;
      }

      throw error;
    }
  }

  throw lastError;
}