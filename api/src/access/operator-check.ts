import { User } from '../entity/user.entity';
import { normalizeEmail } from '../ever-platform/env';

/**
 * The operator check of an `operator` route, provided by the Ever Platform instance module when it is loaded, and by
 * the operator console module (core code does not import either). Without one there is no operator route, and the
 * access guard opens none.
 */
export const OPERATOR_CHECK = 'traduora:access:operator-check';

export interface OperatorCheck {
  isOperator(caller: unknown): boolean;
}

/**
 * Whether `user` operates this installation: a user (never an API client; the JWT strategy hands a `User` entity to the
 * request) whose e-mail is in `adminEmails` (normalized; `TR_EVER_ADMIN_EMAILS`, else `TR_ADMIN_EMAIL`) and confirmed. An
 * unconfirmed account never qualifies: anyone could sign up with a listed address that has no account yet.
 */
export function isOperatorAccount(user: unknown, adminEmails: ReadonlyArray<string>): boolean {
  if (!(user instanceof User) || typeof user.email !== 'string' || user.emailVerified !== true) {
    return false;
  }
  const email = normalizeEmail(user.email);
  return email.length > 0 && adminEmails.includes(email);
}
