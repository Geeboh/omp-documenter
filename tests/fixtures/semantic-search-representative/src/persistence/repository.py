"""SQLite persistence repository owns database transaction migration rollback."""

class UserRepository:
    def __init__(self, connection):
        self.connection = connection

    def migrate(self):
        self.connection.execute(
            "CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, email TEXT NOT NULL)"
        )

    def save(self, user):
        with self.connection:
            self.connection.execute(
                "INSERT OR REPLACE INTO users (id, email) VALUES (?, ?)",
                (user["id"], user["email"]),
            )

    def find(self, user_id):
        return self.connection.execute(
            "SELECT id, email FROM users WHERE id = ?", (user_id,)
        ).fetchone()

    def rollback(self):
        self.connection.rollback()
