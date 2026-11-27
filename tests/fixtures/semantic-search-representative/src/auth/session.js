export function createSessionStore(clock = () => Date.now()) {
  const sessions = new Map();

  return {
    issue(userId, ttlSeconds = 3600) {
      const sessionId = `${userId}:${clock()}`;
      sessions.set(sessionId, {
        userId,
        expiresAt: clock() + ttlSeconds * 1000,
        refreshCount: 0
      });
      return sessionId;
    },

    refresh(sessionId, ttlSeconds = 3600) {
      const session = sessions.get(sessionId);
      if (!session || session.expiresAt <= clock()) return null;
      session.expiresAt = clock() + ttlSeconds * 1000;
      session.refreshCount += 1;
      return { ...session };
    },

    revoke(sessionId) {
      return sessions.delete(sessionId);
    }
  };
}
