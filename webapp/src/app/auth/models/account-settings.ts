/** A legal document a person accepts in SaaS mode: its version and where to read it. */
export interface LegalDocument {
  version: string;
  url: string;
}

export interface LegalDocuments {
  terms: LegalDocument;
  privacy: LegalDocument;
}

/** What `GET /auth/providers` says about the installation, besides its sign-in providers. */
export interface InstallationSettings {
  /** SaaS mode (TR_SAAS_ENABLED): organizations are shown */
  saas: boolean;
  /** Cloudflare Turnstile on sign-up and forgot-password, when it is on */
  turnstileSiteKey?: string;
  /** SaaS mode: the terms of service and privacy policy a sign-up accepts */
  legal?: LegalDocuments;
}

/** What an account must still do before the app works for it (`pending` of `GET /users/me`, or a 403 code). */
export type PendingAccountStep = 'email_not_verified' | 'terms_not_accepted';

/** The page that finishes each step. */
export const PENDING_STEP_PAGES: Record<PendingAccountStep, string> = {
  email_not_verified: '/check-inbox',
  terms_not_accepted: '/accept-terms',
};

export const isPendingAccountStep = (value: unknown): value is PendingAccountStep => value === 'email_not_verified' || value === 'terms_not_accepted';

/** The versions a sign-up or an acceptance sends back. */
export const acceptedVersions = (legal: LegalDocuments | undefined): { termsVersion?: string; privacyVersion?: string } =>
  legal ? { termsVersion: legal.terms.version, privacyVersion: legal.privacy.version } : {};
