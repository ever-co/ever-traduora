import { ThrottlerStorageService } from '@nestjs/throttler';
import { TooManyRequestsException } from '../errors';
import { AttemptLimiter, HOUR_MS } from './attempt-limiter';

describe('AttemptLimiter', () => {
  let storage: ThrottlerStorageService;

  beforeEach(() => (storage = new ThrottlerStorageService()));
  afterEach(() => storage.onApplicationShutdown());

  it('lets `limit` attempts per subject through within the window, then 429, each subject and kind on its own', async () => {
    const limiter = new AttemptLimiter(storage);
    await limiter.count('verification-email', 'u1', 2, HOUR_MS);
    await limiter.count('verification-email', 'u1', 2, HOUR_MS);
    await expect(limiter.count('verification-email', 'u1', 2, HOUR_MS)).rejects.toBeInstanceOf(TooManyRequestsException);
    await expect(limiter.count('verification-email', 'u2', 2, HOUR_MS)).resolves.toBeUndefined();
    await expect(limiter.count('signup', 'u1', 2, HOUR_MS)).resolves.toBeUndefined();
  });

  it('counts nothing with a limit of 0', async () => {
    const increment = jest.spyOn(storage, 'increment');
    await new AttemptLimiter(storage).count('signup', '203.0.113.1', 0, HOUR_MS);
    expect(increment).not.toHaveBeenCalled();
  });
});
