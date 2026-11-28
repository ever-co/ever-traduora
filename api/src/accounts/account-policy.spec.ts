import { config } from '../config';
import { AccountException } from '../errors';
import {
  acceptedTerms,
  mustAcceptTerms,
  pendingAccountException,
  pendingAccountStep,
  requiredLegalDocuments,
  requiresVerifiedEmail,
} from './account-policy';
import { currentLegalDocuments } from './legal-documents';

describe('account policy (DESIGN §3.8)', () => {
  const saved = { saas: config.saasEnabled, requireVerifiedEmail: config.accounts.requireVerifiedEmail };
  const current = () => {
    const documents = currentLegalDocuments();
    return { termsVersion: documents.terms.version, privacyVersion: documents.privacy.version };
  };

  afterEach(() => {
    config.saasEnabled = saved.saas;
    config.accounts.requireVerifiedEmail = saved.requireVerifiedEmail;
  });

  it('requires a confirmed e-mail in SaaS mode unless TR_REQUIRE_VERIFIED_EMAIL says otherwise', () => {
    config.accounts.requireVerifiedEmail = undefined;
    config.saasEnabled = false;
    expect(requiresVerifiedEmail()).toBe(false);
    config.saasEnabled = true;
    expect(requiresVerifiedEmail()).toBe(true);
    config.accounts.requireVerifiedEmail = false;
    expect(requiresVerifiedEmail()).toBe(false);
    config.saasEnabled = false;
    config.accounts.requireVerifiedEmail = true;
    expect(requiresVerifiedEmail()).toBe(true);
  });

  it('asks for the terms in SaaS mode only', () => {
    config.saasEnabled = false;
    expect(requiredLegalDocuments()).toBeUndefined();
    expect(mustAcceptTerms({})).toBe(false);
    config.saasEnabled = true;
    expect(requiredLegalDocuments()).toEqual(currentLegalDocuments());
    expect(mustAcceptTerms({})).toBe(true);
    expect(mustAcceptTerms(current())).toBe(false);
  });

  it('answers the first step still pending: the e-mail, then the terms', () => {
    config.saasEnabled = true;
    config.accounts.requireVerifiedEmail = undefined;
    expect(pendingAccountStep({ emailVerified: false })).toBe('email_not_verified');
    expect(pendingAccountStep({ emailVerified: true })).toBe('terms_not_accepted');
    expect(pendingAccountStep({ emailVerified: true, ...current() })).toBeUndefined();
    config.saasEnabled = false;
    expect(pendingAccountStep({ emailVerified: false })).toBeUndefined();
  });

  it('turns a pending step into a 403 with its code', () => {
    const exception = pendingAccountException('email_not_verified');
    expect(exception).toBeInstanceOf(AccountException);
    expect([exception.getStatus(), exception.code]).toEqual([403, 'email_not_verified']);
  });

  it('checks the versions a sign-up sends: the ones in force in SaaS mode, nothing elsewhere', () => {
    config.saasEnabled = false;
    expect(acceptedTerms({})).toBeUndefined();
    config.saasEnabled = true;
    expect(acceptedTerms(current())).toEqual(current());
    for (const sent of [{}, { ...current(), termsVersion: '0.0.1' }, { termsVersion: current().termsVersion }]) {
      try {
        acceptedTerms(sent);
        fail('accepted outdated or missing terms');
      } catch (error) {
        expect([error.getStatus(), error.code]).toEqual([400, 'terms_not_accepted']);
      }
    }
  });
});
