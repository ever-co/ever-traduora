import { ExecutionContext } from '@nestjs/common';
import { ThrottlerStorageService } from '@nestjs/throttler';
import { config } from '../config';
import { TooManyRequestsException } from '../errors';
import { SignupThrottlerGuard } from './signup-throttler.guard';

describe('SignupThrottlerGuard', () => {
  const saved = { saas: config.saasEnabled, limit: config.throttle.signupsPerHour };
  let storage: ThrottlerStorageService;
  const from = (ip: string) => ({ switchToHttp: () => ({ getRequest: () => ({ ip }) }) }) as unknown as ExecutionContext;

  beforeEach(() => {
    storage = new ThrottlerStorageService();
  });

  afterEach(() => {
    config.saasEnabled = saved.saas;
    config.throttle.signupsPerHour = saved.limit;
    storage.onApplicationShutdown();
  });

  it('lets TR_SIGNUPS_PER_HOUR sign-ups through per address and hour in SaaS mode, then 429', async () => {
    config.saasEnabled = true;
    config.throttle.signupsPerHour = 2;
    const guard = new SignupThrottlerGuard(storage);
    await expect(guard.canActivate(from('203.0.113.1'))).resolves.toBe(true);
    await expect(guard.canActivate(from('203.0.113.1'))).resolves.toBe(true);
    await expect(guard.canActivate(from('203.0.113.1'))).rejects.toBeInstanceOf(TooManyRequestsException);
    // Another address has its own count
    await expect(guard.canActivate(from('203.0.113.2'))).resolves.toBe(true);
  });

  it('limits nothing on a single-tenant install, nor with 0', async () => {
    const guard = new SignupThrottlerGuard(storage);
    config.saasEnabled = false;
    config.throttle.signupsPerHour = 1;
    for (let i = 0; i < 3; i++) {
      await expect(guard.canActivate(from('203.0.113.1'))).resolves.toBe(true);
    }
    config.saasEnabled = true;
    config.throttle.signupsPerHour = 0;
    for (let i = 0; i < 3; i++) {
      await expect(guard.canActivate(from('203.0.113.1'))).resolves.toBe(true);
    }
  });
});
