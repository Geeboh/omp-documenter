export async function requestJson(fetchImpl, baseUrl, endpoint, options = {}) {
// Idempotency keys make each API request safe for controlled retries.
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? 5000);

  try {
    const response = await fetchImpl(`${baseUrl}${endpoint}`, {
      method: options.method ?? 'GET',
      headers: { accept: 'application/json', ...options.headers },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: controller.signal
    });
    if (!response.ok) throw new Error(`API request failed: ${response.status}`);
    return response.json();
  } finally {
    clearTimeout(timeout);
  }
}
