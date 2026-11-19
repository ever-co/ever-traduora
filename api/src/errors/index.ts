import { BadRequestException, HttpException, HttpStatus } from '@nestjs/common';

export class TooManyRequestsException extends HttpException {
  constructor(message?: string | object | any, error: string = 'TooManyRequests') {
    super(HttpException.createBody(message, error, HttpStatus.TOO_MANY_REQUESTS), HttpStatus.TOO_MANY_REQUESTS);
  }
}
export class ConflictException extends HttpException {
  constructor(message?: string | object | any, error: string = 'AlreadyExists') {
    super(HttpException.createBody(message, error, HttpStatus.CONFLICT), HttpStatus.CONFLICT);
  }
}

/**
 * A password that anyone knows, such as the former default admin password. A BadRequest with its own error code, so
 * that clients can tell it from other invalid input.
 */
export class PublishedPasswordException extends HttpException {
  constructor(message: string = 'this password is publicly known, please choose a different one') {
    super(HttpException.createBody(message, 'PublishedPassword', HttpStatus.BAD_REQUEST), HttpStatus.BAD_REQUEST);
  }
}

/**
 * An export the chosen format cannot hold, such as a term that is also the parent of other terms in a nested format or a
 * term starting with "@" in ARB. A BadRequest whose message the client gets as is: it names the terms to rename, which
 * the user may not find otherwise in a large project. Other 400s answer with a fixed message.
 */
export class FormatCannotHoldTermsException extends BadRequestException {
  constructor(message: string) {
    super(message);
  }
}

/**
 * An import file the parser cannot read. A BadRequest whose message the client gets as is: it carries the parser's
 * detail, such as the line of a CSV row with an unquoted comma, which the user needs to fix the file.
 */
export class MalformedImportException extends BadRequestException {
  constructor(message: string) {
    super(message);
  }
}

/**
 * An error of the OpenID Connect sign-in flow (e.g. Ever ID) that the webapp acts on: answered with its own status and
 * a stable `code`, plus optional `details` (e.g. what a sign-up confirmation screen shows). Never carries a token.
 */
export class AuthProviderException extends HttpException {
  constructor(
    status: HttpStatus,
    readonly code: string,
    message: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message, status);
  }
}

export class PaymentRequiredException extends HttpException {
  constructor(message?: string | object | any, error: string = 'PaymentRequired') {
    super(HttpException.createBody(message, error, HttpStatus.PAYMENT_REQUIRED), HttpStatus.PAYMENT_REQUIRED);
  }
}
