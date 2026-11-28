import { Reflector } from '@nestjs/core';
import { config } from '../config';
import { BillingThrottle, BillingThrottleGuard, billingThrottleKey } from './billing-throttle.guard';

class Routes {
  @BillingThrottle(2)
  checkout() {
    return undefined;
  }

  open() {
    return undefined;
  }
}

describe('BillingThrottleGuard', () => {
  const context = (handler: keyof Routes, organizationId: string, header = jest.fn()) =>
    ({
      getType: () => 'http',
      getHandler: () => Routes.prototype[handler],
      switchToHttp: () => ({ getRequest: () => ({ params: { organizationId } }), getResponse: () => ({ header }) }),
    }) as any;

  /** The throttler storage's contract: a count per key, blocked past the limit */
  const storage = () => {
    const counts = new Map<string, number>();
    return {
      increment: jest.fn(async (key: string, ttl: number, limit: number) => {
        const totalHits = (counts.get(key) ?? 0) + 1;
        counts.set(key, totalHits);
        return { totalHits, timeToExpire: ttl, isBlocked: totalHits > limit, timeToBlockExpire: 60 };
      }),
    };
  };

  it('counts per route and organization, whatever the case of its id', () => {
    expect(billingThrottleKey('checkout', 'ABCDEF12-0000-4000-8000-00000000AAAA')).toBe('billing:checkout:abcdef12-0000-4000-8000-00000000aaaa');
  });

  it('lets the limit through, then answers 429 with Retry-After, the same organization in any case', async () => {
    const store = storage();
    const guard = new BillingThrottleGuard(store as any, new Reflector());
    const header = jest.fn();
    expect(await guard.canActivate(context('checkout', 'abc'))).toBe(true);
    expect(await guard.canActivate(context('checkout', 'ABC'))).toBe(true);
    await expect(guard.canActivate(context('checkout', 'Abc', header))).rejects.toMatchObject({ status: 429 });
    expect(header).toHaveBeenCalledWith('Retry-After', '60');
    expect(store.increment).toHaveBeenCalledWith('billing:checkout:abc', config.billing.throttle.ttl, 2, config.billing.throttle.ttl, 'billing');
    // Another organization keeps its own count
    expect(await guard.canActivate(context('checkout', 'def'))).toBe(true);
  });

  it('counts nothing on a route without a billing limit', async () => {
    const store = storage();
    expect(await new BillingThrottleGuard(store as any, new Reflector()).canActivate(context('open', 'abc'))).toBe(true);
    expect(store.increment).not.toHaveBeenCalled();
  });
});
