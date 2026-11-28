import { Logger } from '@nestjs/common';
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
 * The rate limits' counts in Redis (Valkey) when REDIS_HOST is set, so the replicas share them (DESIGN §3.8), through
 * `@nest-lab/throttler-storage-redis`. Without an answer from Redis within a second, or on an error, this replica counts
 * in memory instead for 30 seconds, then asks Redis again (and says so in the log each time): the API keeps answering
 * at its usual speed, with per-replica limits until Redis is back. A limit that is off (a window of 0, the global
 * default outside SaaS mode) is counted in memory only.
 */
export class SharedThrottlerStorage implements ThrottlerStorage {
  private readonly logger = new Logger('ThrottlerStorage');
  private sharedAgainAt = 0;

  constructor(
    private readonly shared: ThrottlerStorage,
    private readonly local: ThrottlerStorageService = new ThrottlerStorageService(),
    private readonly timeoutMs = SHARED_TIMEOUT_MS,
    private readonly retryAfterMs = RETRY_AFTER_MS,
  ) {}

  async increment(key: string, ttl: number, limit: number, blockDuration: number, throttlerName: string): Promise<ThrottlerStorageRecord> {
    if (!(ttl > 0)) {
      return this.local.increment(key, ttl, limit, blockDuration, throttlerName);
    }
    const block = blockDuration > 0 ? blockDuration : ttl;
    if (Date.now() < this.sharedAgainAt) {
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

/** The throttler's options: the global limit (TR_THROTTLE_*), counted in Redis when there is a client. */
export function throttlerModuleOptions(redis: Redis | null | undefined): ThrottlerModuleOptions {
  return {
    throttlers: [{ ttl: config.throttle.global.ttl, limit: config.throttle.global.limit }],
    ...(redis ? { storage: new SharedThrottlerStorage(new ThrottlerStorageRedisService(redis)) } : {}),
  };
}
