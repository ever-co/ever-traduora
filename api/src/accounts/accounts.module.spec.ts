import { Logger } from '@nestjs/common';
import { config } from '../config';
import { AccountsBootCheck } from './accounts.module';

describe('AccountsBootCheck', () => {
  const saved = { saas: config.saasEnabled, trustProxy: config.http.trustProxy, terms: { ...config.accounts.terms } };
  let error: jest.SpyInstance;

  beforeEach(() => (error = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined)));
  afterEach(() => {
    config.saasEnabled = saved.saas;
    config.http.trustProxy = saved.trustProxy;
    Object.assign(config.accounts.terms, saved.terms);
    jest.restoreAllMocks();
  });

  it('logs an error in SaaS mode without TR_TRUST_PROXY, and still starts', () => {
    config.saasEnabled = true;
    config.http.trustProxy = undefined;
    expect(() => new AccountsBootCheck().onApplicationBootstrap()).not.toThrow();
    expect(error).toHaveBeenCalledTimes(1);
    expect(error.mock.calls[0][0]).toContain('TR_TRUST_PROXY');

    config.http.trustProxy = 1;
    new AccountsBootCheck().onApplicationBootstrap();
    expect(error).toHaveBeenCalledTimes(1);
  });

  it('says nothing on a single-tenant install', () => {
    config.saasEnabled = false;
    config.http.trustProxy = undefined;
    new AccountsBootCheck().onApplicationBootstrap();
    expect(error).not.toHaveBeenCalled();
  });
});

describe('AccountsBootCheck, legal versions', () => {
  const saved = {
    saas: config.saasEnabled,
    trustProxy: config.http.trustProxy,
    terms: { ...config.accounts.terms },
    privacy: { ...config.accounts.privacy },
  };

  afterEach(() => {
    config.saasEnabled = saved.saas;
    config.http.trustProxy = saved.trustProxy;
    Object.assign(config.accounts.terms, saved.terms);
    Object.assign(config.accounts.privacy, saved.privacy);
  });

  it('refuses to start in SaaS mode with a version longer than a sign-up may send back (64 characters)', () => {
    config.saasEnabled = true;
    config.http.trustProxy = 1;
    config.accounts.terms.version = 'v'.repeat(64);
    expect(() => new AccountsBootCheck().onApplicationBootstrap()).not.toThrow();
    config.accounts.terms.version = 'v'.repeat(65);
    expect(() => new AccountsBootCheck().onApplicationBootstrap()).toThrow(/TR_TERMS_VERSION is longer than 64/);
    config.accounts.terms.version = undefined;
    config.accounts.privacy.version = 'p'.repeat(65);
    expect(() => new AccountsBootCheck().onApplicationBootstrap()).toThrow(/TR_PRIVACY_VERSION is longer than 64/);
  });
});
