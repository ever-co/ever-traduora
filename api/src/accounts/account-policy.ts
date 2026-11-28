import { HttpStatus } from '@nestjs/common';
import { config } from '../config';
import { AccountException } from '../errors';
import { AcceptedVersions, currentLegalDocuments, isCurrentAcceptance, LegalDocuments } from './legal-documents';

/**
 * What an account must have done before the app works for it (DESIGN §3.8), read on every request by the
 * `AccessGuard`: a confirmed e-mail (TR_REQUIRE_VERIFIED_EMAIL, on in SaaS mode by default) and, in SaaS mode, the
 * current terms of service and privacy policy accepted. Routes that declare `whilePending` (sign-in and account
 * routes, `users/me`, verify and resend) work before that. A single-tenant install asks for neither, as before.
 */

/** Whether a person must confirm their e-mail before using anything but their account. */
export const requiresVerifiedEmail = (): boolean => config.accounts.requireVerifiedEmail ?? config.saasEnabled;

/** The documents a person must accept, in SaaS mode; `undefined` elsewhere (nothing to accept). */
export const requiredLegalDocuments = (): LegalDocuments | undefined => (config.saasEnabled ? currentLegalDocuments() : undefined);

/** Whether the person must still accept the documents in force (SaaS mode, none or older versions accepted). */
export const mustAcceptTerms = (accepted: AcceptedVersions): boolean => config.saasEnabled && !isCurrentAcceptance(accepted);

export type PendingAccountStep = 'email_not_verified' | 'terms_not_accepted';

/** The first thing the person must still do, `undefined` when the account is ready. */
export function pendingAccountStep(user: AcceptedVersions & { emailVerified?: boolean }): PendingAccountStep | undefined {
  if (requiresVerifiedEmail() && user.emailVerified !== true) {
    return 'email_not_verified';
  }
  if (mustAcceptTerms(user)) {
    return 'terms_not_accepted';
  }
  return undefined;
}

const PENDING_MESSAGES: Record<PendingAccountStep, string> = {
  email_not_verified: 'Please confirm your email address first, with the link we sent to it',
  terms_not_accepted: 'Please accept the current terms of service and privacy policy first',
};

/** The 403 of a pending step, with its code. */
export const pendingAccountException = (step: PendingAccountStep): AccountException =>
  new AccountException(HttpStatus.FORBIDDEN, step, PENDING_MESSAGES[step]);

/**
 * Checks the versions a sign-up or an acceptance sends against the documents in force: 400 `terms_not_accepted` when
 * they are missing or not current (the page showed older ones). Answers what to record; nothing outside SaaS mode.
 */
export function acceptedTerms(sent: AcceptedVersions): { termsVersion: string; privacyVersion: string } | undefined {
  const required = requiredLegalDocuments();
  if (!config.saasEnabled) {
    return undefined;
  }
  if (!required || !isCurrentAcceptance(sent, required)) {
    throw new AccountException(
      HttpStatus.BAD_REQUEST,
      'terms_not_accepted',
      'Please accept the current terms of service and privacy policy to continue',
    );
  }
  return { termsVersion: required.terms.version, privacyVersion: required.privacy.version };
}
