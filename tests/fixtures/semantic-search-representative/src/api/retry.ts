export async function retryRequest<T>(
  operation: () => Promise<T>,
  policy: { maxAttempts?: number; baseDelayMs?: number; jitterRatio?: number } = {}
): Promise<T> {
  const maxAttempts = policy.maxAttempts ?? 3;
  const baseDelayMs = policy.baseDelayMs ?? 100;
  const jitterRatio = policy.jitterRatio ?? 0.2;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      if (attempt === maxAttempts || !isRetryable(error)) throw error;
      const backoff = baseDelayMs * 2 ** (attempt - 1);
      const jitter = backoff * jitterRatio * Math.random();
      await new Promise(resolve => setTimeout(resolve, backoff + jitter));
    }
  }

  throw new Error('retry loop ended without a result');
}

function isRetryable(error: unknown) {
  return error instanceof Error && /429|503|timeout/i.test(error.message);
}
