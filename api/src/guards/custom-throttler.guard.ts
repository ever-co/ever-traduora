import { Injectable } from '@nestjs/common';
import { ThrottlerGuard, ThrottlerLimitDetail } from '@nestjs/throttler';
import { ExecutionContext } from '@nestjs/common';
import { TooManyRequestsException } from '../errors';
import { addressBucket } from '../utils/client-address';

@Injectable()
export class CustomThrottlerGuard extends ThrottlerGuard {
  /** The client's address (behind TR_TRUST_PROXY), an IPv6 address by its /64 (`addressBucket`) */
  protected async getTracker(req: Record<string, any>): Promise<string> {
    return addressBucket(req.ip);
  }

  protected async throwThrottlingException(context: ExecutionContext, throttlerLimitDetail: ThrottlerLimitDetail): Promise<void> {
    throw new TooManyRequestsException('You have made too many requests. Please try again later.');
  } // Custom error message
}
