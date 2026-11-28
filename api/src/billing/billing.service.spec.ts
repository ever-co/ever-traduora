import Stripe = require('stripe');
import { config } from '../config';
import { OrganizationPlanCode } from '../domain/organization-actions';
import { Organization } from '../entity/organization.entity';
import { User } from '../entity/user.entity';
import { BillingInterval } from './billing-plans';
import {
  BillingService,
  checkoutSessionParams,
  idempotencyKey,
  invoiceSubscriptionId,
  subscriptionChanges,
  subscriptionState,
} from './billing.service';

const SECRET = 'whsec_unit_test';
const ORG_ID = '7d4b3f3e-3b8a-4c1e-9a43-1f8f0b6a2c11';

const price = (lookupKey: string) => ({ id: `price_${lookupKey}`, lookup_key: lookupKey }) as Stripe.Price;
const subscription = (overrides: Partial<Record<string, any>> = {}): Stripe.Subscription =>
  ({
    id: 'sub_1',
    customer: 'cus_1',
    status: 'active',
    trial_end: null,
    items: {
      data: [
        { id: 'si_plan', price: price('ever_traduora_cloud_small_business_monthly'), quantity: 1, current_period_end: 1_900_000_000 },
        { id: 'si_seat', price: price('seat_ever_traduora_cloud_small_business_monthly'), quantity: 3, current_period_end: 1_900_000_000 },
      ],
    },
    ...overrides,
  }) as unknown as Stripe.Subscription;

function organization(overrides: Partial<Organization> = {}): Organization {
  return Object.assign(new Organization(), {
    id: ORG_ID,
    name: 'Acme',
    slug: 'acme',
    planCode: OrganizationPlanCode.Starter,
    isDefault: false,
    stripeCustomerId: null,
    stripeSubscriptionId: null,
    billingStatus: null,
    trialEndsAt: null,
    pastDueSince: null,
    checkoutSessionId: null,
    checkoutExpiresAt: null,
    checkoutAttempt: 0,
    extraSeats: 0,
    ...overrides,
  });
}

/** A Stripe client of mocks; webhook signatures are Stripe's own */
function mockStripe() {
  return {
    webhooks: Stripe.webhooks,
    customers: { create: jest.fn().mockResolvedValue({ id: 'cus_new' }) },
    prices: {
      list: jest.fn(async ({ lookup_keys }) => ({ data: lookup_keys.map(price) })),
    },
    checkout: {
      sessions: {
        create: jest.fn(async (params: any, _options?: any) => ({
          id: 'cs_test_1',
          url: 'https://checkout.stripe.test/1',
          expires_at: Math.floor(Date.now() / 1000) + 86400,
        })),
        retrieve: jest.fn(),
        expire: jest.fn(),
      },
    },
    billingPortal: { sessions: { create: jest.fn().mockResolvedValue({ url: 'https://billing.stripe.test/p' }) } },
    subscriptions: { retrieve: jest.fn(), update: jest.fn(), cancel: jest.fn(), list: jest.fn().mockResolvedValue({ data: [] }) },
    invoices: { createPreview: jest.fn(), list: jest.fn().mockResolvedValue({ data: [] }) },
    invoicePayments: { list: jest.fn().mockResolvedValue({ data: [] }) },
    refunds: { create: jest.fn(async (params: any) => ({ id: `re_${params.payment_intent}` })) },
  };
}

/** A data source whose transaction runs at once on `tx`; the organization row is `row` */
function mockDataSource(row: () => Organization | null) {
  const tx = {
    findOne: jest.fn(async () => row()),
    update: jest.fn(async () => undefined),
    exists: jest.fn(async () => false),
    insert: jest.fn(async () => undefined),
  };
  const manager = {
    transaction: jest.fn(async (...args: any[]) => args[args.length - 1](tx)),
    findOne: jest.fn(async () => null),
    exists: jest.fn(async () => false),
  };
  return { tx, dataSource: { manager } as any };
}

describe('BillingService', () => {
  const saved = { saas: config.saasEnabled, billing: { ...config.billing } };
  const owner = Object.assign(new User(), { id: 'user-1', email: 'owner@acme.test' });

  beforeEach(() => {
    config.saasEnabled = true;
    Object.assign(config.billing, { stripeSecretKey: 'sk_test_unit', stripeWebhookSecret: SECRET, trialDays: 90, automaticTax: true });
  });

  afterAll(() => {
    config.saasEnabled = saved.saas;
    Object.assign(config.billing, saved.billing);
  });

  describe('checkout', () => {
    it('makes the customer, then the session, and stores it under the organization lock', async () => {
      const stripe = mockStripe();
      const { tx, dataSource } = mockDataSource(() => organization());
      const service = new BillingService(stripe as any, dataSource);

      const result = await service.checkout(ORG_ID, owner, {
        plan: OrganizationPlanCode.SmallBusiness,
        interval: BillingInterval.Monthly,
        extraSeats: 2,
      });

      expect(result).toEqual({ url: 'https://checkout.stripe.test/1' });
      expect(stripe.customers.create).toHaveBeenCalledWith(expect.objectContaining({ email: 'owner@acme.test' }), {
        idempotencyKey: expect.stringMatching(new RegExp(`^traduora-customer-${ORG_ID}-0-[0-9a-f]{16}$`)),
      });
      const [params, options] = stripe.checkout.sessions.create.mock.calls[0];
      expect(params).toMatchObject({
        mode: 'subscription',
        customer: 'cus_new',
        client_reference_id: ORG_ID,
        subscription_data: { trial_period_days: 90, metadata: { organizationId: ORG_ID } },
        payment_method_collection: 'always',
        automatic_tax: { enabled: true },
        billing_address_collection: 'required',
      });
      expect(options).toEqual({ idempotencyKey: idempotencyKey('checkout', ORG_ID, 1, params) });
      expect(tx.update).toHaveBeenCalledWith(
        Organization,
        { id: ORG_ID },
        expect.objectContaining({ stripeCustomerId: 'cus_new', checkoutSessionId: 'cs_test_1', checkoutAttempt: 1 }),
      );
    });

    it('gives the trial once: not after a trial, nor after a subscription', async () => {
      for (const done of [{ trialEndsAt: new Date('2026-01-01') }, { stripeSubscriptionId: 'sub_old', billingStatus: 'canceled' }]) {
        const stripe = mockStripe();
        const { dataSource } = mockDataSource(() => organization({ stripeCustomerId: 'cus_1', ...done }));
        await new BillingService(stripe as any, dataSource).checkout(ORG_ID, owner, {
          plan: OrganizationPlanCode.Enterprise,
          interval: BillingInterval.Annual,
        });
        expect(stripe.checkout.sessions.create.mock.calls[0][0].subscription_data.trial_period_days).toBeUndefined();
        expect(stripe.customers.create).not.toHaveBeenCalled();
      }
    });

    it('turns Stripe Tax off when told to', async () => {
      config.billing.automaticTax = false;
      const stripe = mockStripe();
      const { dataSource } = mockDataSource(() => organization());
      await new BillingService(stripe as any, dataSource).checkout(ORG_ID, owner, {
        plan: OrganizationPlanCode.Enterprise,
        interval: BillingInterval.Monthly,
      });
      expect(stripe.checkout.sessions.create.mock.calls[0][0].automatic_tax).toEqual({ enabled: false });
    });

    it('refuses while a subscription lives, and asks Stripe nothing', async () => {
      const stripe = mockStripe();
      const { dataSource } = mockDataSource(() =>
        organization({ stripeCustomerId: 'cus_1', stripeSubscriptionId: 'sub_1', billingStatus: 'past_due' }),
      );
      await expect(
        new BillingService(stripe as any, dataSource).checkout(ORG_ID, owner, {
          plan: OrganizationPlanCode.Enterprise,
          interval: BillingInterval.Monthly,
        }),
      ).rejects.toMatchObject({ code: 'subscription_exists' });
      expect(stripe.checkout.sessions.create).not.toHaveBeenCalled();
    });

    it('hands out the open session for the same order, and expires one for another order', async () => {
      const open = organization({
        stripeCustomerId: 'cus_1',
        checkoutSessionId: 'cs_open',
        checkoutExpiresAt: new Date(Date.now() + 30 * 60_000),
        checkoutAttempt: 4,
      });
      const stripe = mockStripe();
      stripe.checkout.sessions.retrieve.mockResolvedValue({
        id: 'cs_open',
        status: 'open',
        url: 'https://checkout.stripe.test/open',
        expires_at: Math.floor(Date.now() / 1000) + 3600,
        metadata: { plan: 'ever_traduora_cloud_enterprise_monthly', extraSeats: '0' },
      });
      const { dataSource } = mockDataSource(() => open);
      const service = new BillingService(stripe as any, dataSource);

      expect(await service.checkout(ORG_ID, owner, { plan: OrganizationPlanCode.Enterprise, interval: BillingInterval.Monthly })).toEqual({
        url: 'https://checkout.stripe.test/open',
      });
      expect(stripe.checkout.sessions.create).not.toHaveBeenCalled();

      await service.checkout(ORG_ID, owner, { plan: OrganizationPlanCode.Enterprise, interval: BillingInterval.Annual });
      expect(stripe.checkout.sessions.expire).toHaveBeenCalledWith('cs_open');
      const [params, options] = stripe.checkout.sessions.create.mock.calls[0];
      expect(params.metadata.plan).toBe('ever_traduora_cloud_enterprise_annual');
      expect(options).toEqual({ idempotencyKey: idempotencyKey('checkout', ORG_ID, 5, params) });
    });

    it('asks Stripe about the stored session even past its stored expiry, and refuses a paid one', async () => {
      const stripe = mockStripe();
      stripe.checkout.sessions.retrieve.mockResolvedValue({ id: 'cs_paid', status: 'complete', url: null, metadata: {} });
      const { dataSource } = mockDataSource(() =>
        organization({ stripeCustomerId: 'cus_1', checkoutSessionId: 'cs_paid', checkoutExpiresAt: new Date(Date.now() - 3600_000) }),
      );
      await expect(
        new BillingService(stripe as any, dataSource).checkout(ORG_ID, owner, {
          plan: OrganizationPlanCode.Enterprise,
          interval: BillingInterval.Monthly,
        }),
      ).rejects.toMatchObject({ code: 'subscription_exists' });
      expect(stripe.checkout.sessions.retrieve).toHaveBeenCalledWith('cs_paid');
      expect(stripe.checkout.sessions.create).not.toHaveBeenCalled();
    });

    it('refuses while Stripe lists a live Traduora subscription of the customer', async () => {
      const stripe = mockStripe();
      stripe.subscriptions.list.mockResolvedValue({ data: [subscription({ status: 'trialing' })] });
      const { dataSource } = mockDataSource(() => organization({ stripeCustomerId: 'cus_1' }));
      await expect(
        new BillingService(stripe as any, dataSource).checkout(ORG_ID, owner, {
          plan: OrganizationPlanCode.Enterprise,
          interval: BillingInterval.Monthly,
        }),
      ).rejects.toMatchObject({ code: 'subscription_exists' });
      expect(stripe.subscriptions.list).toHaveBeenCalledWith(expect.objectContaining({ customer: 'cus_1', status: 'all' }));
      expect(stripe.checkout.sessions.create).not.toHaveBeenCalled();
    });

    it('calls Stripe outside the lock: two transactions, the session stored by the second', async () => {
      const stripe = mockStripe();
      const { tx, dataSource } = mockDataSource(() => organization({ stripeCustomerId: 'cus_1' }));
      await new BillingService(stripe as any, dataSource).checkout(ORG_ID, owner, {
        plan: OrganizationPlanCode.Enterprise,
        interval: BillingInterval.Monthly,
      });
      expect(dataSource.manager.transaction).toHaveBeenCalledTimes(2);
      // The session was made between the two: the first transaction wrote nothing
      expect(tx.update).toHaveBeenCalledTimes(1);
      expect(stripe.checkout.sessions.create.mock.invocationCallOrder[0]).toBeLessThan(tx.update.mock.invocationCallOrder[0]);
    });

    it('expires its session and answers checkout_busy when another Checkout was stored meanwhile', async () => {
      const stripe = mockStripe();
      let reads = 0;
      const { tx, dataSource } = mockDataSource(() =>
        organization({ stripeCustomerId: 'cus_1', checkoutAttempt: reads++ === 0 ? 0 : 1, checkoutSessionId: reads > 1 ? 'cs_other' : null }),
      );
      stripe.checkout.sessions.retrieve.mockResolvedValue({ id: 'cs_test_1', status: 'expired' });
      await expect(
        new BillingService(stripe as any, dataSource).checkout(ORG_ID, owner, {
          plan: OrganizationPlanCode.Enterprise,
          interval: BillingInterval.Monthly,
        }),
      ).rejects.toMatchObject({ code: 'checkout_busy' });
      expect(stripe.checkout.sessions.expire).toHaveBeenCalledWith('cs_test_1');
      expect(tx.update).not.toHaveBeenCalled();
    });

    it('hands out the session a parallel click for the same order stored', async () => {
      const stripe = mockStripe();
      let reads = 0;
      const { tx, dataSource } = mockDataSource(() =>
        organization({ stripeCustomerId: 'cus_1', checkoutAttempt: reads++ === 0 ? 0 : 1, checkoutSessionId: reads > 1 ? 'cs_test_1' : null }),
      );
      const result = await new BillingService(stripe as any, dataSource).checkout(ORG_ID, owner, {
        plan: OrganizationPlanCode.Enterprise,
        interval: BillingInterval.Monthly,
      });
      expect(result).toEqual({ url: 'https://checkout.stripe.test/1' });
      expect(stripe.checkout.sessions.expire).not.toHaveBeenCalled();
      expect(tx.update).not.toHaveBeenCalled();
    });

    it('is off without a key, or outside SaaS mode', async () => {
      const { dataSource } = mockDataSource(() => organization());
      await expect(
        new BillingService(null, dataSource).checkout(ORG_ID, owner, { plan: OrganizationPlanCode.Enterprise, interval: BillingInterval.Monthly }),
      ).rejects.toMatchObject({ code: 'billing_disabled' });
      config.saasEnabled = false;
      await expect(
        new BillingService(mockStripe() as any, dataSource).checkout(ORG_ID, owner, {
          plan: OrganizationPlanCode.Enterprise,
          interval: BillingInterval.Monthly,
        }),
      ).rejects.toMatchObject({ code: 'billing_disabled' });
    });
  });

  describe('the webhook', () => {
    const signed = (body: object, secret = SECRET) => {
      const payload = JSON.stringify(body);
      return { payload: Buffer.from(payload), signature: Stripe.webhooks.generateTestHeaderString({ payload, secret }) };
    };
    const event = (type: string, object: object, livemode = false) => ({
      id: 'evt_1',
      object: 'event',
      type,
      livemode,
      created: 1_800_000_000,
      data: { object },
    });

    it('refuses a missing body or signature, and a wrong one', async () => {
      const { dataSource } = mockDataSource(() => organization());
      const service = new BillingService(mockStripe() as any, dataSource);
      const { payload, signature } = signed(event('customer.subscription.updated', { id: 'sub_1', customer: 'cus_1' }));
      await expect(service.handleWebhook(payload, undefined)).rejects.toMatchObject({ status: 400 });
      await expect(service.handleWebhook(undefined, signature)).rejects.toMatchObject({ status: 400 });
      const other = signed(event('customer.subscription.updated', { id: 'sub_1', customer: 'cus_1' }), 'whsec_other');
      await expect(service.handleWebhook(other.payload, other.signature)).rejects.toMatchObject({ status: 400 });
      expect(dataSource.manager.transaction).not.toHaveBeenCalled();
    });

    it('ignores events of the other mode, other types and customers of no organization, writing nothing', async () => {
      const stripe = mockStripe();
      const { dataSource } = mockDataSource(() => organization());
      const service = new BillingService(stripe as any, dataSource);
      const live = signed(event('customer.subscription.updated', { id: 'sub_1', customer: 'cus_1' }, true));
      expect(await service.handleWebhook(live.payload, live.signature)).toBe('other_mode');
      const other = signed(event('product.updated', { id: 'prod_1' }));
      expect(await service.handleWebhook(other.payload, other.signature)).toBe('ignored_type');
      const foreign = signed(event('customer.subscription.updated', { id: 'sub_1', customer: 'cus_gauzy' }));
      expect(await service.handleWebhook(foreign.payload, foreign.signature)).toBe('foreign_customer');
      const notUuid = signed(
        event('checkout.session.completed', { id: 'cs_1', mode: 'subscription', client_reference_id: 'tenant-7', customer: 'cus_gauzy' }),
      );
      expect(await service.handleWebhook(notUuid.payload, notUuid.signature)).toBe('foreign_customer');
      expect(dataSource.manager.exists).not.toHaveBeenCalled();
      expect(dataSource.manager.transaction).not.toHaveBeenCalled();
      expect(stripe.subscriptions.retrieve).not.toHaveBeenCalled();
    });

    it('applies a subscription of its customer read again from Stripe, and records the event with it', async () => {
      const stripe = mockStripe();
      stripe.subscriptions.retrieve.mockResolvedValue(subscription({ status: 'trialing', trial_end: 1_850_000_000 }));
      const { tx, dataSource } = mockDataSource(() => organization({ stripeCustomerId: 'cus_1' }));
      dataSource.manager.findOne.mockResolvedValue({ id: ORG_ID });
      const service = new BillingService(stripe as any, dataSource);
      const { payload, signature } = signed(event('customer.subscription.created', { id: 'sub_1', customer: 'cus_1' }));

      expect(await service.handleWebhook(payload, signature)).toBe('applied');
      expect(stripe.subscriptions.retrieve).toHaveBeenCalledWith('sub_1', {}, { timeout: 5000, maxNetworkRetries: 0 });
      expect(tx.update).toHaveBeenCalledWith(
        Organization,
        { id: ORG_ID },
        expect.objectContaining({ planCode: 'small_business', billingStatus: 'trialing', extraSeats: 3, stripeSubscriptionId: 'sub_1' }),
      );
      expect(tx.insert).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ id: 'evt_1', organizationId: ORG_ID, outcome: 'applied' }));
    });

    it('changes nothing for an event recorded already', async () => {
      const stripe = mockStripe();
      const { tx, dataSource } = mockDataSource(() => organization({ stripeCustomerId: 'cus_1' }));
      dataSource.manager.findOne.mockResolvedValue({ id: ORG_ID });
      tx.exists.mockResolvedValue(true);
      const { payload, signature } = signed(event('customer.subscription.updated', { id: 'sub_1', customer: 'cus_1' }));
      expect(await new BillingService(stripe as any, dataSource).handleWebhook(payload, signature)).toBe('duplicate');
      expect(stripe.subscriptions.retrieve).not.toHaveBeenCalled();
      expect(tx.update).not.toHaveBeenCalled();
      expect(tx.insert).not.toHaveBeenCalled();
    });

    it('treats a primary key clash of two deliveries as the duplicate it is', async () => {
      const stripe = mockStripe();
      stripe.subscriptions.retrieve.mockResolvedValue(subscription());
      const { tx, dataSource } = mockDataSource(() => organization({ stripeCustomerId: 'cus_1' }));
      dataSource.manager.findOne.mockResolvedValue({ id: ORG_ID });
      tx.insert.mockRejectedValue(Object.assign(new Error('duplicate key'), { code: '23505' }));
      // The other delivery's row, there once it committed
      dataSource.manager.exists.mockResolvedValue(true);
      const { payload, signature } = signed(event('customer.subscription.updated', { id: 'sub_1', customer: 'cus_1' }));
      expect(await new BillingService(stripe as any, dataSource).handleWebhook(payload, signature)).toBe('duplicate');
    });

    it('answers an error for any other unique key failing, so Stripe sends the event again', async () => {
      const stripe = mockStripe();
      stripe.subscriptions.retrieve.mockResolvedValue(subscription());
      const { tx, dataSource } = mockDataSource(() => organization({ stripeCustomerId: 'cus_1' }));
      dataSource.manager.findOne.mockResolvedValue({ id: ORG_ID });
      tx.update.mockRejectedValue(Object.assign(new Error('duplicate key value violates "UQ_organization_stripe_customer_id"'), { code: '23505' }));
      const { payload, signature } = signed(event('customer.subscription.updated', { id: 'sub_1', customer: 'cus_1' }));
      await expect(new BillingService(stripe as any, dataSource).handleWebhook(payload, signature)).rejects.toMatchObject({ code: '23505' });
    });

    it('reads the subscription of an invoice of this API version, and of an older one', () => {
      expect(invoiceSubscriptionId({ parent: { subscription_details: { subscription: 'sub_new' } } } as any)).toBe('sub_new');
      expect(invoiceSubscriptionId({ parent: null, subscription: 'sub_old' } as any)).toBe('sub_old');
      expect(invoiceSubscriptionId({ parent: null, subscription: { id: 'sub_obj' } } as any)).toBe('sub_obj');
      expect(invoiceSubscriptionId({ parent: null } as any)).toBeNull();
    });
  });

  describe('idempotency keys', () => {
    const prices = { plan: price('ever_traduora_cloud_small_business_monthly'), seat: price('seat_ever_traduora_cloud_small_business_monthly') };
    const order = { plan: OrganizationPlanCode.SmallBusiness, interval: BillingInterval.Monthly, extraSeats: 2 };
    const keyOf = (slug: string, trialDays: number) =>
      idempotencyKey('checkout', ORG_ID, 1, checkoutSessionParams({ id: ORG_ID, slug }, 'cus_1', prices, order, trialDays, true));

    it('are the same for the same request, and differ with any parameter (the slug, the trial days)', () => {
      expect(keyOf('acme', 90)).toBe(keyOf('acme', 90));
      expect(keyOf('acme-gmbh', 90)).not.toBe(keyOf('acme', 90));
      expect(keyOf('acme', 0)).not.toBe(keyOf('acme', 90));
      expect(idempotencyKey('customer', ORG_ID, 0, { name: 'Acme', email: 'a@x.test' })).not.toBe(
        idempotencyKey('customer', ORG_ID, 0, { name: 'Acme', email: 'b@x.test' }),
      );
      expect(keyOf('acme', 90)).toMatch(new RegExp(`^traduora-checkout-${ORG_ID}-1-[0-9a-f]{16}$`));
    });
  });

  describe('subscriptionState', () => {
    const at = new Date('2026-11-28T10:00:00Z');
    const bought = { planCode: OrganizationPlanCode.SmallBusiness, interval: BillingInterval.Monthly, extraSeats: 3 };

    it('gives the plan while the subscription lives, with its seats and period end', () => {
      expect(subscriptionState(organization(), subscription(), bought, at)).toMatchObject({
        planCode: 'small_business',
        billingStatus: 'active',
        billingInterval: 'monthly',
        extraSeats: 3,
        currentPeriodEnd: new Date(1_900_000_000 * 1000),
        pastDueSince: null,
        checkoutSessionId: null,
      });
    });

    it('keeps a trial end once set, so a trial is given once', () => {
      const earlier = new Date('2026-05-01T00:00:00Z');
      expect(subscriptionState(organization({ trialEndsAt: earlier }), subscription(), bought, at).trialEndsAt).toEqual(earlier);
      expect(subscriptionState(organization(), subscription({ trial_end: 1_850_000_000 }), bought, at).trialEndsAt).toEqual(
        new Date(1_850_000_000 * 1000),
      );
    });

    it('starts the past due at the event, and keeps its first date', () => {
      expect(subscriptionState(organization(), subscription({ status: 'past_due' }), bought, at).pastDueSince).toEqual(at);
      const since = new Date('2026-11-20T00:00:00Z');
      const pastDue = organization({ billingStatus: 'past_due', pastDueSince: since });
      expect(subscriptionState(pastDue, subscription({ status: 'past_due' }), bought, at).pastDueSince).toEqual(since);
      expect(subscriptionState(pastDue, subscription({ status: 'active' }), bought, at).pastDueSince).toBeNull();
    });

    it('falls back to Starter without extra seats once it ended or never started', () => {
      for (const status of ['canceled', 'incomplete_expired', 'incomplete', 'paused']) {
        expect(subscriptionState(organization(), subscription({ status }), bought, at)).toMatchObject({ planCode: 'starter', extraSeats: 0 });
      }
    });
  });

  describe('subscriptionChanges', () => {
    const prices = (planKey: string, seats: number, seatKey: string | null = 'seat_ever_traduora_cloud_small_business_monthly') => ({
      plan: price(planKey),
      seat: seatKey ? price(seatKey) : null,
      extraSeats: seats,
    });

    it('changes only what differs', () => {
      expect(subscriptionChanges(subscription(), prices('ever_traduora_cloud_small_business_monthly', 3))).toEqual([]);
      expect(subscriptionChanges(subscription(), prices('ever_traduora_cloud_small_business_monthly', 8))).toEqual([
        { id: 'si_seat', price: 'price_seat_ever_traduora_cloud_small_business_monthly', quantity: 8 },
      ]);
    });

    it('swaps the plan price, and drops the seats for a plan that sells none', () => {
      expect(subscriptionChanges(subscription(), prices('ever_traduora_cloud_enterprise_monthly', 0, null))).toEqual([
        { id: 'si_plan', price: 'price_ever_traduora_cloud_enterprise_monthly', quantity: 1 },
        { id: 'si_seat', deleted: true },
      ]);
    });

    it('moves both items to the other interval together', () => {
      expect(
        subscriptionChanges(subscription(), prices('ever_traduora_cloud_small_business_annual', 3, 'seat_ever_traduora_cloud_small_business_annual')),
      ).toEqual([
        { id: 'si_plan', price: 'price_ever_traduora_cloud_small_business_annual', quantity: 1 },
        { id: 'si_seat', price: 'price_seat_ever_traduora_cloud_small_business_annual', quantity: 3 },
      ]);
    });

    it('adds the seat price when there was none', () => {
      const planOnly = subscription({ items: { data: [subscription().items.data[0]] } });
      expect(subscriptionChanges(planOnly, prices('ever_traduora_cloud_small_business_monthly', 2))).toEqual([
        { price: 'price_seat_ever_traduora_cloud_small_business_monthly', quantity: 2 },
      ]);
    });

    it('refuses a subscription without a Traduora plan price', () => {
      const other = subscription({ items: { data: [{ id: 'si_x', price: price('ever_gauzy_cloud_enterprise_monthly'), quantity: 1 }] } });
      expect(() => subscriptionChanges(other, prices('ever_traduora_cloud_small_business_monthly', 0))).toThrow();
    });
  });
});
