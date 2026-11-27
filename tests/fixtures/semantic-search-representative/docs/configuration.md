# Configuration

Configuration comes from environment variables. Set API_BASE_URL, DATABASE_URL, and
REDIS_URL before starting a service. Keep request timeout and worker concurrency in
one settings object so local and production values stay visible.

Database configuration supplies persistence services with explicit connection values.
