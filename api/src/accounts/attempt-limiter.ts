import { Injectable } from '@nestjs/common';
import { InjectThrottlerStorage, ThrottlerStorage } from '@nestjs/throttler';
import { createHash } from 'node:crypto';
import { TooManyRequestsException } from '../errors';

export const HOUR_MS = 60 * 60 * 1000;

/**
 * Counts attempts of one kind per subject (an account, an address) in the throttler's storage, which is shared by
 * every replica when it is Redis (DESIGN §3.8): sign-ups per address, confirmation emails per account.
 */
@Injectable()
export class AttemptLimiter {
  constructor(@InjectThrottlerStorage() private readonly storage: ThrottlerStorage) {}

  /** Counts one attempt; 429 once more than `limit` were counted within `windowMs`. A limit of 0 or less is off. */
  async count(kind: string, subject: string, limit: number, windowMs: number): Promise<void> {
    if (!(limit > 0) || !(windowMs > 0)) {
      return;
    }
    const key = createHash('sha256').update(`${kind}:${subject}`).digest('hex');
    const { isBlocked } = await this.storage.increment(key, windowMs, limit, windowMs, kind);
    if (isBlocked) {
      throw new TooManyRequestsException('You have made too many requests. Please try again later.');
    }
  }
}
