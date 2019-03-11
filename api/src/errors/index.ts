import { HttpException, HttpStatus } from '@nestjs/common';
import { createHttpExceptionBody } from '@nestjs/common/utils/http-exception-body.util';

export class TooManyRequestsException extends HttpException {
  constructor(message?: string | object | any, error: string = 'TooManyRequests') {
    super(createHttpExceptionBody(message, error, HttpStatus.TOO_MANY_REQUESTS), HttpStatus.TOO_MANY_REQUESTS);
  }
}
export class ConflictException extends HttpException {
  constructor(message?: string | object | any, error: string = 'AlreadyExists') {
    super(createHttpExceptionBody(message, error, HttpStatus.CONFLICT), HttpStatus.CONFLICT);
  }
}

export class PaymentRequiredException extends HttpException {
  constructor(message?: string | object | any, error: string = 'PaymentRequired') {
    super(createHttpExceptionBody(message, error, HttpStatus.PAYMENT_REQUIRED), HttpStatus.PAYMENT_REQUIRED);
  }
}
