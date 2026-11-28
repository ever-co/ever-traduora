import { Logger } from '@nestjs/common';
import { ThrottlerStorage, ThrottlerStorageService } from '@nestjs/throttler';
import { ThrottlerStorageRedisService } from '@nest-lab/throttler-storage-redis';
import Redis from 'ioredis';
import { config } from '../config';
import { KeyScopedMemoryStorage, SharedThrottlerStorage, THROTTLE_KEY_PREFIX, throttlerModuleOptions } from './shared-throttler-storage';

describe('SharedThrottlerStorage', () => {
  const record = { totalHits: 1, timeToExpire: 60, isBlocked: false, timeToBlockExpire: 0 };
  let local: KeyScopedMemoryStorage;

  beforeEach(() => {
    local = new KeyScopedMemoryStorage();
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

  it('keeps nothing for a limit that is off (a window of 0), and never blocks it', async () => {
    const shared = { increment: jest.fn() } as unknown as ThrottlerStorage;
    const memory = jest.spyOn(local, 'increment');
    const storage = new SharedThrottlerStorage(shared, local);
    for (let i = 0; i < 3; i++) {
      expect((await storage.increment('k2', 0, 0, 0, 'default')).isBlocked).toBe(false);
    }
    expect(shared.increment).not.toHaveBeenCalled();
    expect(memory).not.toHaveBeenCalled();
  });

  it('counts in memory without Redis', async () => {
    const storage = new SharedThrottlerStorage(undefined, local);
    const first = await storage.increment('k3', 60000, 1, 60000, 'default');
    const second = await storage.increment('k3', 60000, 1, 60000, 'default');
    expect([first.isBlocked, second.isBlocked]).toEqual([false, true]);
  });

  it('asks Redis again only after a pause once it failed, so requests keep their speed meanwhile', async () => {
    const shared = { increment: jest.fn().mockRejectedValueOnce(new Error('down')).mockResolvedValue(record) } as unknown as ThrottlerStorage;
    const storage = new SharedThrottlerStorage(shared, local, 20, 50);
    await storage.increment('k4', 60000, 10, 60000, 'default');
    await storage.increment('k4', 60000, 10, 60000, 'default');
    expect(shared.increment).toHaveBeenCalledTimes(1);
    await new Promise(resolve => setTimeout(resolve, 60));
    expect(await storage.increment('k4', 60000, 10, 60000, 'default')).toBe(record);
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

describe('KeyScopedMemoryStorage', () => {
  afterEach(() => jest.useRealTimers());

  /**
   * Address A is blocked at t=0 and resumes at t=1100; B made one request at t=500. B's hit expires at t=1500 only if
   * A's resumption leaves B's timer alone.
   */
  const scenario = async (storage: ThrottlerStorage): Promise<boolean> => {
    jest.useFakeTimers({ now: 0 });
    await storage.increment('A', 1000, 1, 1000, 'signup');
    await storage.increment('A', 1000, 1, 1000, 'signup');
    jest.setSystemTime(500);
    await storage.increment('B', 1000, 1, 1000, 'signup');
    jest.advanceTimersByTime(600);
    await storage.increment('A', 1000, 1, 1000, 'signup');
    jest.advanceTimersByTime(500);
    return (await storage.increment('B', 1000, 1, 1000, 'signup')).isBlocked;
  };

  it("keeps each key's expiry timers apart, so one key's resumption cannot block another (review of #679)", async () => {
    const plain = new ThrottlerStorageService();
    // @nestjs/throttler 6.5.0 alone: A's resumption cleared B's timer, and B is refused for a request long past
    expect(await scenario(plain)).toBe(true);
    plain.onApplicationShutdown();
    const scoped = new KeyScopedMemoryStorage();
    expect(await scenario(scoped)).toBe(false);
    scoped.onApplicationShutdown();
  });
});

describe('throttlerModuleOptions', () => {
  it('counts in memory (per key) without Redis, and in Redis with a client', () => {
    const throttlers = [{ ttl: config.throttle.global.ttl, limit: config.throttle.global.limit }];
    const memory = throttlerModuleOptions(null) as { throttlers: unknown; storage: unknown };
    expect(memory.throttlers).toEqual(throttlers);
    expect(memory.storage).toBeInstanceOf(SharedThrottlerStorage);
    expect((memory.storage as any).shared).toBeUndefined();
    const redis = new Redis({ lazyConnect: true });
    const options = throttlerModuleOptions(redis) as { throttlers: unknown; storage: unknown };
    expect(options.throttlers).toEqual(throttlers);
    expect((options.storage as any).shared).toBeInstanceOf(ThrottlerStorageRedisService);
    // The client the API made: the storage uses it, and leaves it to the API to close
    expect((options.storage as any).shared.redis).toBe(redis);
    redis.disconnect();
  });
});
