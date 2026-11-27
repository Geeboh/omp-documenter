# Operations

The production operations runbook covers queue worker heartbeats, lease expiry, and
dead-letter jobs. Use the CLI migrate command during a planned restart.

Run CLI doctor before restart when health checks fail. Capture queue depth and worker
logs before changing concurrency.
