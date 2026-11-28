import Stripe = require('stripe');

/**
 * A stand-in for the Stripe client of the billing module (`STRIPE_CLIENT`) in e2e tests: Checkout, the portal, prices,
 * customers and subscriptions are kept in memory, and each call is recorded. Webhook signatures are Stripe's own
 * (`Stripe.webhooks`), so a test signs its events with `generateTestHeaderString` exactly as Stripe would.
 */

export const FAKE_STRIPE_KEY = 'sk_test_e2efake';
export const FAKE_WEBHOOK_SECRET = 'whsec_e2e_traduora_billing';

export const SEAT_KEY = (interval: 'monthly' | 'annual') => `seat_ever_traduora_cloud_small_business_${interval}`;
export const PLAN_KEY = (plan: string, interval: 'monthly' | 'annual') => `ever_traduora_cloud_${plan}_${interval}`;

/** The amounts of the shared account's test prices, in cents */
export const AMOUNTS: Record<string, number> = {
  ever_traduora_cloud_small_business_monthly: 4900,
  ever_traduora_cloud_small_business_annual: 40800,
  ever_traduora_cloud_enterprise_monthly: 49900,
  ever_traduora_cloud_enterprise_annual: 418800,
  seat_ever_traduora_cloud_small_business_monthly: 500,
  seat_ever_traduora_cloud_small_business_annual: 6000,
};

const priceOf = (lookupKey: string) => ({
  id: `price_${lookupKey}`,
  object: 'price',
  lookup_key: lookupKey,
  active: true,
  unit_amount: AMOUNTS[lookupKey] ?? null,
  currency: 'usd',
});

export interface FakeSubscriptionSpec {
  id: string;
  customer: string;
  status?: string;
  plan?: string;
  interval?: 'monthly' | 'annual';
  extraSeats?: number;
  /** Lookup keys of other items, e.g. another product's price */
  otherKeys?: string[];
  trialEnd?: number | null;
  periodEnd?: number;
}

/** A subscription object as Stripe answers it, with the items' prices expanded */
export function subscriptionObject(spec: FakeSubscriptionSpec): any {
  const interval = spec.interval ?? 'monthly';
  const periodEnd = spec.periodEnd ?? Math.floor(Date.now() / 1000) + 30 * 24 * 3600;
  const keys = [...(spec.plan === undefined ? [] : [PLAN_KEY(spec.plan, interval)]), ...(spec.otherKeys ?? [])];
  const items = keys.map((key, index) => ({ id: `si_${spec.id}_${index}`, price: priceOf(key), quantity: 1, current_period_end: periodEnd }));
  if (spec.extraSeats) {
    items.push({ id: `si_${spec.id}_seat`, price: priceOf(SEAT_KEY(interval)), quantity: spec.extraSeats, current_period_end: periodEnd });
  }
  return {
    id: spec.id,
    object: 'subscription',
    customer: spec.customer,
    status: spec.status ?? 'active',
    trial_end: spec.trialEnd ?? null,
    livemode: false,
    metadata: {},
    items: { object: 'list', data: items },
  };
}

let sequence = 0;
const nextId = (prefix: string) => `${prefix}_${++sequence}${Math.random().toString(36).slice(2, 8)}`;

export class FakeStripe {
  readonly webhooks = Stripe.webhooks;
  readonly calls: Array<{ method: string; args: any[] }> = [];
  readonly subscriptionsById = new Map<string, any>();
  readonly sessionsById = new Map<string, any>();
  /** Lookup keys that `prices.list` does not find, to test a missing price */
  readonly missingPrices = new Set<string>();
  /** The paid invoice of a subscription (`invoices.list` with `status: paid`), with the amount it took */
  readonly paidInvoices = new Map<string, { id: string; amount_paid: number; currency: string }>();

  private record(method: string, ...args: any[]) {
    this.calls.push({ method, args });
  }

  callsTo(method: string) {
    return this.calls.filter(call => call.method === method);
  }

  reset() {
    this.calls.length = 0;
  }

  /** Sets what `subscriptions.retrieve` answers for this subscription */
  putSubscription(spec: FakeSubscriptionSpec): any {
    const subscription = subscriptionObject(spec);
    this.subscriptionsById.set(spec.id, subscription);
    return subscription;
  }

  readonly customers = {
    create: async (params: any, options?: any) => {
      this.record('customers.create', params, options);
      return {
        id: `cus_${String(options?.idempotencyKey ?? nextId('x'))
          .replace(/[^A-Za-z0-9]/g, '')
          .slice(-24)}`,
        object: 'customer',
      };
    },
  };

  readonly prices = {
    list: async (params: any) => {
      this.record('prices.list', params);
      return { object: 'list', data: (params.lookup_keys as string[]).filter(key => !this.missingPrices.has(key)).map(priceOf) };
    },
  };

  readonly checkout = {
    sessions: {
      create: async (params: any, options?: any) => {
        this.record('checkout.sessions.create', params, options);
        const id = nextId('cs_test');
        const session = {
          id,
          object: 'checkout.session',
          url: `https://checkout.stripe.test/c/pay/${id}`,
          status: 'open',
          mode: params.mode,
          customer: params.customer,
          client_reference_id: params.client_reference_id,
          metadata: params.metadata,
          expires_at: Math.floor(Date.now() / 1000) + 24 * 3600,
          subscription: null,
        };
        this.sessionsById.set(id, session);
        return session;
      },
      retrieve: async (id: string) => {
        this.record('checkout.sessions.retrieve', id);
        const session = this.sessionsById.get(id);
        if (!session) {
          throw Object.assign(new Error('No such checkout.session'), { type: 'StripeInvalidRequestError', code: 'resource_missing' });
        }
        return { ...session };
      },
      expire: async (id: string) => {
        this.record('checkout.sessions.expire', id);
        const session = this.sessionsById.get(id);
        session.status = 'expired';
        session.url = null;
        return { ...session };
      },
    },
  };

  readonly billingPortal = {
    sessions: {
      create: async (params: any) => {
        this.record('billingPortal.sessions.create', params);
        return { id: nextId('bps'), object: 'billing_portal.session', url: `https://billing.stripe.test/p/session/${params.customer}` };
      },
    },
  };

  readonly subscriptions = {
    retrieve: async (id: string) => {
      this.record('subscriptions.retrieve', id);
      const subscription = this.subscriptionsById.get(id);
      if (!subscription) {
        throw Object.assign(new Error('No such subscription'), { type: 'StripeInvalidRequestError', code: 'resource_missing' });
      }
      return JSON.parse(JSON.stringify(subscription));
    },
    update: async (id: string, params: any) => {
      this.record('subscriptions.update', id, params);
      const subscription = this.subscriptionsById.get(id);
      const items: any[] = subscription.items.data;
      for (const change of params.items ?? []) {
        const lookupKey = change.price ? String(change.price).replace(/^price_/, '') : undefined;
        if (change.id && change.deleted) {
          items.splice(
            items.findIndex(item => item.id === change.id),
            1,
          );
        } else if (change.id) {
          const item = items.find(entry => entry.id === change.id);
          if (lookupKey) {
            item.price = priceOf(lookupKey);
          }
          if (change.quantity !== undefined) {
            item.quantity = change.quantity;
          }
        } else {
          items.push({
            id: nextId('si'),
            price: priceOf(lookupKey),
            quantity: change.quantity ?? 1,
            current_period_end: items[0]?.current_period_end,
          });
        }
      }
      return JSON.parse(JSON.stringify(subscription));
    },
    list: async (params: any) => {
      this.record('subscriptions.list', params);
      const data = [...this.subscriptionsById.values()].filter(subscription => subscription.customer === params.customer);
      return { object: 'list', data: JSON.parse(JSON.stringify(data)), has_more: false };
    },
    cancel: async (id: string, params?: any, options?: any) => {
      this.record('subscriptions.cancel', id, params, options);
      const subscription = this.subscriptionsById.get(id);
      if (subscription) {
        subscription.status = 'canceled';
      }
      return JSON.parse(JSON.stringify(subscription ?? { id, status: 'canceled' }));
    },
  };

  readonly invoices = {
    list: async (params: any) => {
      this.record('invoices.list', params);
      const paid = this.paidInvoices.get(params.subscription);
      return { object: 'list', data: paid && params.status === 'paid' ? [{ object: 'invoice', status: 'paid', ...paid }] : [] };
    },
    createPreview: async (params: any) => {
      this.record('invoices.createPreview', params);
      return { object: 'invoice', amount_due: 4900, currency: 'usd', next_payment_attempt: null, period_end: Math.floor(Date.now() / 1000) + 86400 };
    },
  };

  readonly invoicePayments = {
    list: async (params: any) => {
      this.record('invoicePayments.list', params);
      const invoice = [...this.paidInvoices.values()].find(each => each.id === params.invoice);
      return {
        object: 'list',
        data: invoice
          ? [
              {
                id: `inpay_${invoice.id}`,
                status: 'paid',
                amount_paid: invoice.amount_paid,
                payment: { type: 'payment_intent', payment_intent: `pi_${invoice.id}` },
              },
            ]
          : [],
      };
    },
  };

  readonly refunds = {
    create: async (params: any, options?: any) => {
      this.record('refunds.create', params, options);
      return { id: `re_${params.payment_intent ?? params.charge}`, object: 'refund', status: 'succeeded' };
    },
  };
}

/** A Stripe event, signed for the webhook with the test secret: the body and its `Stripe-Signature` header */
export function signedEvent(
  type: string,
  object: any,
  options: { id?: string; created?: number; livemode?: boolean; secret?: string } = {},
): { id: string; payload: string; signature: string } {
  const id = options.id ?? nextId('evt');
  const payload = JSON.stringify(
    {
      id,
      object: 'event',
      api_version: Stripe.API_VERSION,
      created: options.created ?? Math.floor(Date.now() / 1000),
      livemode: options.livemode ?? false,
      pending_webhooks: 1,
      request: { id: null, idempotency_key: null },
      type,
      data: { object },
    },
    null,
    2,
  );
  const signature = Stripe.webhooks.generateTestHeaderString({ payload, secret: options.secret ?? FAKE_WEBHOOK_SECRET });
  return { id, payload, signature };
}
