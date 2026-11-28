import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { InjectThrottlerStorage, ThrottlerStorage } from '@nestjs/throttler';
import { createHash } from 'node:crypto';
import { config } from '../config';
import { TooManyRequestsException } from '../errors';

const HOUR_MS = 60 * 60 * 1000;

/**
 * SaaS mode: at most TR_SIGNUPS_PER_HOUR (10) sign-ups per address and hour (DESIGN §3.8), on the routes that only make
 * accounts (`POST /auth/signup`, `POST /auth/everid/signup-confirm`). Every attempt counts, a refused one too. The
 * address is the visitor's own behind a proxy once TR_TRUST_PROXY is set. Off on a single-tenant install and with 0.
 */
@Injectable()
export class SignupThrottlerGuard implements CanActivate {
  constructor(@InjectThrottlerStorage() private readonly storage: ThrottlerStorage) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const limit = config.throttle.signupsPerHour;
    if (!config.saasEnabled || !(limit > 0)) {
      return true;
    }
    const request = context.switchToHttp().getRequest();
    const key = createHash('sha256').update(`signup:${request.ip}`).digest('hex');
    const { isBlocked } = await this.storage.increment(key, HOUR_MS, limit, HOUR_MS, 'signup');
    if (isBlocked) {
      throw new TooManyRequestsException('You have made too many requests. Please try again later.');
    }
    return true;
  }
}
