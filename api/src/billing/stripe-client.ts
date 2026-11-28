import Stripe = require('stripe');

/** The Stripe client of the billing module, `null` while billing is off (no `TR_STRIPE_SECRET_KEY`). */
export const STRIPE_CLIENT = 'TRADUORA_STRIPE_CLIENT';

/** What the billing module calls of Stripe: a test replaces it with a fake of the same shape. */
export type StripeClient = Pick<Stripe, 'checkout' | 'billingPortal' | 'customers' | 'subscriptions' | 'prices' | 'invoices' | 'webhooks'>;

export type StripeKeyMode = 'test' | 'live';

/**
 * The mode of a Stripe secret or restricted key, refusing a live one unless live mode was turned on on purpose
 * (`TR_STRIPE_LIVE_MODE=true`, a claimed change at go-live) and anything that is no Stripe secret key at all. The error
 * never repeats the key.
 */
export function stripeKeyMode(key: string, liveModeAllowed: boolean): StripeKeyMode {
  if (/^(sk|rk)_test_[A-Za-z0-9]+$/.test(key)) {
    return 'test';
  }
  if (/^(sk|rk)_live_[A-Za-z0-9]+$/.test(key)) {
    if (!liveModeAllowed) {
      throw new Error('TR_STRIPE_SECRET_KEY is a live-mode key, and TR_STRIPE_LIVE_MODE is not true: billing runs in test mode only until go-live.');
    }
    return 'live';
  }
  throw new Error('TR_STRIPE_SECRET_KEY is not a Stripe secret key (sk_test_… or rk_test_…).');
}

export interface StripeSettings {
  stripeSecretKey: string;
  stripeLiveMode: boolean;
}

/** The Stripe client for the configured key, or `null` when billing is off. Throws on a key it must not use. */
export function createStripeClient(settings: StripeSettings): StripeClient | null {
  if (!settings.stripeSecretKey) {
    return null;
  }
  stripeKeyMode(settings.stripeSecretKey, settings.stripeLiveMode);
  return new Stripe(settings.stripeSecretKey, {
    maxNetworkRetries: 2,
    timeout: 20_000,
    appInfo: { name: 'Ever Traduora', url: 'https://traduora.co' },
  });
}

/**
 * The billing module's client: none outside SaaS mode (billing is off there whatever the key), else the configured
 * key's (refused at start when it is live without `TR_STRIPE_LIVE_MODE`, or no secret key at all).
 */
export function stripeClientFor(settings: { saasEnabled: boolean; billing: StripeSettings }): StripeClient | null {
  return settings.saasEnabled ? createStripeClient(settings.billing) : null;
}

/** Whether the client's key is a test-mode one: events of the other mode are not for this installation. */
export function isTestModeKey(key: string): boolean {
  return /^(sk|rk)_test_/.test(key);
}
