import { createStripeClient, isTestModeKey, stripeKeyMode } from './stripe-client';

describe('the Stripe key', () => {
  it('takes test-mode secret and restricted keys', () => {
    expect(stripeKeyMode('sk_test_abc123', false)).toBe('test');
    expect(stripeKeyMode('rk_test_abc123', false)).toBe('test');
    expect(isTestModeKey('sk_test_abc123')).toBe(true);
    expect(isTestModeKey('sk_live_abc123')).toBe(false);
  });

  it('refuses a live key unless live mode was turned on, without repeating the key', () => {
    let message = '';
    try {
      stripeKeyMode('sk_live_secretvalue42', false);
    } catch (error) {
      message = error.message;
    }
    expect(message).toMatch(/TR_STRIPE_LIVE_MODE/);
    expect(message).not.toContain('secretvalue42');
    expect(stripeKeyMode('sk_live_secretvalue42', true)).toBe('live');
  });

  it('refuses what is no secret key (a publishable key, a webhook secret, garbage)', () => {
    for (const key of ['pk_test_abc', 'whsec_abc', 'sk_test_', 'test', 'sk_test_abc def']) {
      expect(() => stripeKeyMode(key, true)).toThrow(/not a Stripe secret key/);
    }
  });

  it('makes no client without a key (billing off), and refuses to make one with a live key', () => {
    expect(createStripeClient({ stripeSecretKey: '', stripeLiveMode: false })).toBeNull();
    expect(() => createStripeClient({ stripeSecretKey: 'sk_live_abc', stripeLiveMode: false })).toThrow();
    expect(createStripeClient({ stripeSecretKey: 'sk_test_abc', stripeLiveMode: false })).not.toBeNull();
  });
});
