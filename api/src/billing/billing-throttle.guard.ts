import { applyDecorators, CanActivate, ExecutionContext, Injectable, SetMetadata, UseGuards } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { InjectThrottlerStorage, ThrottlerStorage } from '@nestjs/throttler';
import { config } from '../config';
import { TooManyRequestsException } from '../errors';

const BILLING_THROTTLE = 'traduora:billing-throttle';

/**
 * The key of a billing route's count: the route and the organization, its id in lower case (PostgreSQL reads a uuid in
 * any case, so `ABC…` and `abc…` are one organization and must be one count).
 */
export function billingThrottleKey(handler: string, organizationId: unknown): string {
  return `billing:${handler}:${String(organizationId ?? '').toLowerCase()}`;
}

/**
 * Requests per organization to one billing route, counted only once the route's access rule let the caller through: a
 * route guard runs after the global ones (`AccessGuard` among them), so a refused caller never uses an organization's
 * count. Kept in the throttler's own storage (shared through Redis when there is one, see `throttlerModuleOptions`). The
 * global limit per address still applies before it, as on every route.
 */
@Injectable()
export class BillingThrottleGuard implements CanActivate {
  constructor(
    @InjectThrottlerStorage() private readonly storage: ThrottlerStorage,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const limit = this.reflector.get<number | undefined>(BILLING_THROTTLE, context.getHandler());
    if (!limit || context.getType() !== 'http') {
      return true;
    }
    const http = context.switchToHttp();
    const request = http.getRequest();
    const ttl = config.billing.throttle.ttl;
    const key = billingThrottleKey(context.getHandler().name, request.params?.organizationId);
    const { isBlocked, timeToBlockExpire } = await this.storage.increment(key, ttl, limit, ttl, 'billing');
    if (isBlocked) {
      http.getResponse().header?.('Retry-After', String(timeToBlockExpire));
      throw new TooManyRequestsException('You have made too many requests. Please try again later.');
    }
    return true;
  }
}

/** At most `limit` requests a minute per organization to this route, counted after its access rule */
export const BillingThrottle = (limit: number) => applyDecorators(SetMetadata(BILLING_THROTTLE, limit), UseGuards(BillingThrottleGuard));
