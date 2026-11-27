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

/**
 * An answer of the optional Ever Platform routes (anonymous usage statistics) that the webapp acts on: its own status
 * and a stable `code`, such as `stats_disabled` or `cloud_managed`. Carries no value of a report and no key.
 */
export class EverPlatformException extends HttpException {
  constructor(
    status: HttpStatus,
    readonly code: string,
    message: string,
  ) {
    super(message, status);
  }
}

/**
 * An answer about organizations that the webapp acts on: its own status and a stable `code`, such as
 * `organization_suspended`, `saas_disabled`, `slug_taken` or `owner_required`.
 */
export class OrganizationException extends HttpException {
  constructor(
    status: HttpStatus,
    readonly code: string,
    message: string,
  ) {
    super(message, status);
  }
}

/** A route without an access rule (`@Access`), or with one the guard does not know: 403 `access_undeclared`. */
export class AccessUndeclaredException extends HttpException {
  readonly code = 'access_undeclared';

  constructor() {
    super('This route declares no access rule', HttpStatus.FORBIDDEN);
  }
}
