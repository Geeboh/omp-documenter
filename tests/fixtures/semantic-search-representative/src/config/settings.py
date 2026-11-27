from dataclasses import dataclass
import os
# Configuration reads environment variables for database persistence.


@dataclass(frozen=True)
class Settings:
    api_base_url: str
    database_url: str
    redis_url: str
    request_timeout: float = 5.0
    worker_concurrency: int = 4

    @classmethod
    def from_environment(cls):
        return cls(
            api_base_url=os.environ["API_BASE_URL"],
            database_url=os.environ["DATABASE_URL"],
            redis_url=os.environ["REDIS_URL"],
            request_timeout=float(os.getenv("REQUEST_TIMEOUT", "5")),
            worker_concurrency=int(os.getenv("WORKER_CONCURRENCY", "4")),
        )
