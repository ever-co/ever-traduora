import { Injectable } from '@nestjs/common';
import { ThrottlerGuard, ThrottlerLimitDetail } from '@nestjs/throttler';
import { ExecutionContext } from '@nestjs/common';
import { TooManyRequestsException } from 'errors';

@Injectable()
export class CustomThrottlerGuard extends ThrottlerGuard {
  protected async throwThrottlingException(context: ExecutionContext, throttlerLimitDetail: ThrottlerLimitDetail): Promise<void> {
    throw new TooManyRequestsException('You have made too many requests. Please try again later.');
  } // Custom error message
}
