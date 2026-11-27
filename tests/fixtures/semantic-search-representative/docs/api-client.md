# API client

The API client joins a base URL to an endpoint and sends JSON with explicit headers.

Each API request carries an idempotency key when a caller may retry it.

Set a request timeout for every call. Retry only idempotent requests with bounded
backoff and jitter. A 429 response includes a server retry hint when available.
