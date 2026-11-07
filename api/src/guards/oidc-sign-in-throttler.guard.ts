import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { InjectThrottlerStorage, ThrottlerStorage } from '@nestjs/throttler';
import { createHash } from 'crypto';
import { config } from '../config';
import { TooManyRequestsException } from '../errors';

/**
 * Applies the auth rate limit (TR_AUTH_THROTTLE_*) to sign-ins with an OpenID Connect provider (e.g. Ever ID) on a
 * route that Google sign-ins share. Google sign-ins (no `provider`, or 'google') pass untouched, as before.
 */
@Injectable()
export class OidcSignInThrottlerGuard implements CanActivate {
  constructor(@InjectThrottlerStorage() private readonly storage: ThrottlerStorage) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const provider = request.body?.provider;
    const { limit, ttl } = config.throttle.auth;
    if (!provider || provider === 'google' || !limit || !ttl) {
      return true;
    }
    const key = createHash('sha256').update(`oidc-sign-in:${request.ip}`).digest('hex');
    const { isBlocked } = await this.storage.increment(key, ttl, limit, ttl, 'oidc-sign-in');
    if (isBlocked) {
      throw new TooManyRequestsException('You have made too many requests. Please try again later.');
    }
    return true;
  }
}
