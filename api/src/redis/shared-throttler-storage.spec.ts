import { Logger } from '@nestjs/common';
import { ThrottlerStorage, ThrottlerStorageService } from '@nestjs/throttler';
import { ThrottlerStorageRedisService } from '@nest-lab/throttler-storage-redis';
import Redis from 'ioredis';
import { config } from '../config';
import { SharedThrottlerStorage, THROTTLE_KEY_PREFIX, throttlerModuleOptions } from './shared-throttler-storage';

describe('SharedThrottlerStorage', () => {
  const record = { totalHits: 1, timeToExpire: 60, isBlocked: false, timeToBlockExpire: 0 };
  let local: ThrottlerStorageService;

  beforeEach(() => {
    local = new ThrottlerStorageService();
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });
  afterEach(() => {
    local.onApplicationShutdown();
    jest.restoreAllMocks();
  });

  it('counts in Redis under its own prefix, with the block of the window when none is given', async () => {
    const shared = { increment: jest.fn().mockResolvedValue(record) } as ThrottlerStorage;
    const storage = new SharedThrottlerStorage(shared, local);
    expect(await storage.increment('k1', 60000, 10, 0, 'default')).toBe(record);
    expect(shared.increment).toHaveBeenCalledWith(`${THROTTLE_KEY_PREFIX}k1`, 60000, 10, 60000, 'default');
  });

  it('counts a limit that is off (a window of 0) in memory only', async () => {
    const shared = { increment: jest.fn() } as unknown as ThrottlerStorage;
    const result = await new SharedThrottlerStorage(shared, local).increment('k2', 0, 0, 0, 'default');
    expect(shared.increment).not.toHaveBeenCalled();
    expect(result.isBlocked).toBe(false);
  });

  it('asks Redis again only after a pause once it failed, so requests keep their speed meanwhile', async () => {
    const shared = { increment: jest.fn().mockRejectedValueOnce(new Error('down')).mockResolvedValue(record) } as unknown as ThrottlerStorage;
    const storage = new SharedThrottlerStorage(shared, local, 20, 50);
    await storage.increment('k3', 60000, 10, 60000, 'default');
    await storage.increment('k3', 60000, 10, 60000, 'default');
    expect(shared.increment).toHaveBeenCalledTimes(1);
    await new Promise(resolve => setTimeout(resolve, 60));
    expect(await storage.increment('k3', 60000, 10, 60000, 'default')).toBe(record);
    expect(shared.increment).toHaveBeenCalledTimes(2);
  });

  it('counts in memory while Redis fails or does not answer, so the API keeps answering', async () => {
    const failing = { increment: jest.fn().mockRejectedValue(new Error('ECONNREFUSED')) } as ThrottlerStorage;
    const silent = { increment: jest.fn(() => new Promise(() => undefined)) } as unknown as ThrottlerStorage;
    for (const shared of [failing, silent]) {
      const storage = new SharedThrottlerStorage(shared, local, 20);
      const first = await storage.increment(`k-${shared === failing}`, 60000, 1, 60000, 'default');
      const second = await storage.increment(`k-${shared === failing}`, 60000, 1, 60000, 'default');
      expect([first.isBlocked, second.isBlocked]).toEqual([false, true]);
    }
  });
});

describe('throttlerModuleOptions', () => {
  it('keeps the counts in memory without Redis, and in Redis with a client', () => {
    const throttlers = [{ ttl: config.throttle.global.ttl, limit: config.throttle.global.limit }];
    expect(throttlerModuleOptions(null)).toEqual({ throttlers });
    const redis = new Redis({ lazyConnect: true });
    const options = throttlerModuleOptions(redis) as { throttlers: unknown; storage: unknown };
    expect(options.throttlers).toEqual(throttlers);
    expect(options.storage).toBeInstanceOf(SharedThrottlerStorage);
    expect((options.storage as any).shared).toBeInstanceOf(ThrottlerStorageRedisService);
    // The client the API made: the storage uses it, and leaves it to the API to close
    expect((options.storage as any).shared.redis).toBe(redis);
    redis.disconnect();
  });
});
