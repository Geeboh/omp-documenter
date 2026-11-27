export class RedisCache {
  constructor(private readonly redis: RedisClient) {}

  async get<T>(key: string): Promise<T | null> {
    const value = await this.redis.get(key);
    return value === null ? null : JSON.parse(value) as T;
  }

  async set<T>(key: string, value: T, ttlSeconds = 300): Promise<void> {
    await this.redis.set(key, JSON.stringify(value), { EX: ttlSeconds });
  }

  async getStaleWhileRevalidate<T>(key: string, loader: () => Promise<T>) {
    const cached = await this.get<T>(key);
    if (cached !== null) return cached;
    const fresh = await loader();
    await this.set(key, fresh);
    return fresh;
  }

  async invalidate(key: string) {
    await this.redis.del(key);
  }
}

declare interface RedisClient {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, options: { EX: number }): Promise<void>;
  del(key: string): Promise<void>;
}
