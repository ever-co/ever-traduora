import { Logger, OnApplicationShutdown } from '@nestjs/common';
import { ThrottlerModuleOptions, ThrottlerStorage, ThrottlerStorageService } from '@nestjs/throttler';
import { ThrottlerStorageRedisService } from '@nest-lab/throttler-storage-redis';
import type Redis from 'ioredis';
import { config } from '../config';

type ThrottlerStorageRecord = Awaited<ReturnType<ThrottlerStorage['increment']>>;

/** How long a count may take in Redis before this replica counts on its own, ms. */
const SHARED_TIMEOUT_MS = 1000;

/** After Redis failed, this replica counts on its own for this long before asking Redis again, ms. */
const RETRY_AFTER_MS = 30_000;

/** The prefix of the throttler's keys, as the Redis database may be shared (REDIS_DB). */
export const THROTTLE_KEY_PREFIX = 'traduora:throttle:';

/**
 * The in-memory storage of `@nestjs/throttler`, with the expiry timers of each key apart. Its 6.5.0 storage keeps the
 * timers per throttler name and clears all of them when one blocked key resumes, so every other key of that name
 * (another address, another account) would stop losing its old hits and be refused later for requests long past
 * (review of #679). Each key gets a name of its own here; the counts are the same.
 */
export class KeyScopedMemoryStorage implements ThrottlerStorage, OnApplicationShutdown {
  constructor(private readonly memory: ThrottlerStorageService = new ThrottlerStorageService()) {}

  increment(key: string, ttl: number, limit: number, blockDuration: number, throttlerName: string): Promise<ThrottlerStorageRecord> {
    return this.memory.increment(key, ttl, limit, blockDuration, `${throttlerName}:${key}`);
  }

  onApplicationShutdown(): void {
    this.memory.onApplicationShutdown();
  }
}

/** The answer for a limit that is off (a window of 0): never blocked, nothing kept. */
const OFF: ThrottlerStorageRecord = { totalHits: 1, timeToExpire: 0, isBlocked: false, timeToBlockExpire: 0 };

/**
 * The rate limits' counts in Redis (Valkey) when REDIS_HOST is set, so the replicas share them (DESIGN §3.8), through
 * `@nest-lab/throttler-storage-redis`. Without an answer from Redis within a second, or on an error, this replica counts
 * in memory instead for 30 seconds, then asks Redis again (and says so in the log each time): the API keeps answering
 * at its usual speed, with per-replica limits until Redis is back. Without Redis, every count is in memory (each key
 * with its own timers). A limit that is off (a window of 0, the global default outside SaaS mode) keeps nothing.
 */
export class SharedThrottlerStorage implements ThrottlerStorage, OnApplicationShutdown {
  private readonly logger = new Logger('ThrottlerStorage');
  private sharedAgainAt = 0;

  constructor(
    private readonly shared: ThrottlerStorage | undefined,
    private readonly local: ThrottlerStorage & OnApplicationShutdown = new KeyScopedMemoryStorage(),
    private readonly timeoutMs = SHARED_TIMEOUT_MS,
    private readonly retryAfterMs = RETRY_AFTER_MS,
  ) {}

  async increment(key: string, ttl: number, limit: number, blockDuration: number, throttlerName: string): Promise<ThrottlerStorageRecord> {
    if (!(ttl > 0)) {
      return OFF;
    }
    const block = blockDuration > 0 ? blockDuration : ttl;
    if (!this.shared || Date.now() < this.sharedAgainAt) {
      return this.local.increment(key, ttl, limit, block, throttlerName);
    }
    try {
      return await this.withinTimeout(this.shared.increment(`${THROTTLE_KEY_PREFIX}${key}`, ttl, limit, block, throttlerName));
    } catch (error) {
      this.sharedAgainAt = Date.now() + this.retryAfterMs;
      this.logger.warn(`Redis did not count (${error?.message ?? 'error'}): this replica counts its own requests for ${this.retryAfterMs / 1000} s`);
      return this.local.increment(key, ttl, limit, block, throttlerName);
    }
  }

  onApplicationShutdown(): void {
    this.local.onApplicationShutdown();
  }

  private withinTimeout<T>(work: Promise<T>): Promise<T> {
    let timer: NodeJS.Timeout;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`no answer within ${this.timeoutMs} ms`)), this.timeoutMs);
    });
    return Promise.race([work, timeout]).finally(() => clearTimeout(timer));
  }
}

/** The throttler's options: the global limit (TR_THROTTLE_*), counted in Redis when there is a client, else in memory. */
export function throttlerModuleOptions(redis: Redis | null | undefined): ThrottlerModuleOptions {
  return {
    throttlers: [{ ttl: config.throttle.global.ttl, limit: config.throttle.global.limit }],
    storage: new SharedThrottlerStorage(redis ? new ThrottlerStorageRedisService(redis) : undefined),
  };
}
