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

/**
 * An answer about the caller's own account that the web app acts on (DESIGN §3.8): its own status and a stable `code`,
 * such as `email_not_verified` (403, confirm the e-mail first), `terms_not_accepted` (accept the current terms first) or
 * `turnstile_failed` (the bot check did not pass).
 */
export class AccountException extends HttpException {
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

/**
 * A change past the limits of the organization's plan (DESIGN §3.6): 402 `plan_limit_reached`, with the `resource`
 * (`seats` or `strings`) and its `limit`, so the web app can say "Your plan allows N members. Upgrade to add more."
 * What is `used` now and the effective `plan` come only with `usage`, for a caller who may read the organization's
 * usage (owner, admin): the total covers projects an editor, an API key or an invitee cannot see.
 */
export class PlanLimitException extends HttpException {
  readonly code = 'plan_limit_reached';
  readonly used?: number;
  readonly plan?: string;

  constructor(
    readonly resource: 'seats' | 'strings',
    readonly limit: number,
    usage?: { used: number; plan: string },
  ) {
    super(`Your plan allows ${limit} ${resource === 'seats' ? 'members' : 'strings'}. Upgrade to add more.`, HttpStatus.PAYMENT_REQUIRED);
    this.used = usage?.used;
    this.plan = usage?.plan;
  }
}
