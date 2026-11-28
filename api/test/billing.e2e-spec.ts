import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import { DataSource, Like } from 'typeorm';
import { BillingService, idempotencyKey } from '../src/billing/billing.service';
import { STRIPE_CLIENT } from '../src/billing/stripe-client';
import { config } from '../src/config';
import { BillingEvent } from '../src/entity/billing-event.entity';
import { Organization } from '../src/entity/organization.entity';
import { FAKE_STRIPE_KEY, FAKE_WEBHOOK_SECRET, FakeStripe, PLAN_KEY, SEAT_KEY, signedEvent } from './fake-stripe';
import { createAndMigrateAppWith, signupTestUser, TestingUser } from './util';

/**
 * Billing (DESIGN §3.7) in SaaS mode against a stand-in for Stripe (`test/fake-stripe.ts`): the billing page for owners
 * and admins, Checkout (owner only, one at a time), changes of the subscription, the portal, and the webhook with
 * events signed as Stripe signs them: subscribe, add seats, upgrade, downgrade, cancel, a failed payment through its
 * grace to Starter, a replayed event, a foreign customer, a second subscription.
 */
describe('Billing (e2e)', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  const stripe = new FakeStripe();
  const before = { saas: config.saasEnabled, billing: { ...config.billing } };

  let owner: TestingUser;
  let admin: TestingUser;
  let member: TestingUser;
  let organizationId: string;

  const server = () => app.getHttpServer();
  const auth = (user: TestingUser) => ({ Authorization: `Bearer ${user.accessToken}` });
  const billingOf = (user: TestingUser, id = organizationId) => request(server()).get(`/api/v1/organizations/${id}/billing`).set(auth(user));
  const checkout = (user: TestingUser, body: object, id = organizationId) =>
    request(server()).post(`/api/v1/organizations/${id}/billing/checkout`).set(auth(user)).send(body);
  const change = (user: TestingUser, body: object, id = organizationId) =>
    request(server()).patch(`/api/v1/organizations/${id}/billing/subscription`).set(auth(user)).send(body);
  const portal = (user: TestingUser, id = organizationId) => request(server()).post(`/api/v1/organizations/${id}/billing/portal`).set(auth(user));
  const usage = async (id = organizationId, user = owner) =>
    (await request(server()).get(`/api/v1/organizations/${id}/usage`).set(auth(user)).expect(200)).body.data;
  const organization = (id = organizationId) => dataSource.getRepository(Organization).findOneByOrFail({ id });
  const eventCount = () => dataSource.getRepository(BillingEvent).count();

  const post = (event: { payload: string; signature: string }) =>
    request(server())
      .post('/api/v1/billing/webhook')
      .set('Content-Type', 'application/json')
      .set('Stripe-Signature', event.signature)
      .send(event.payload);
  const deliver = async (type: string, object: object, options: { id?: string; created?: number; livemode?: boolean } = {}) => {
    const event = signedEvent(type, object, options);
    await post(event).expect(200, { received: true });
    return event;
  };

  /** The billing fields of the organization, as the tests compare them */
  const billingState = async (id = organizationId) => {
    const o = await organization(id);
    return {
      planCode: o.planCode,
      status: o.billingStatus,
      interval: o.billingInterval,
      extraSeats: o.extraSeats,
      subscription: o.stripeSubscriptionId,
      customer: o.stripeCustomerId,
      pastDue: !!o.pastDueSince,
    };
  };

  async function newOwner(label: string): Promise<{ owner: TestingUser; organizationId: string }> {
    const user = await signupTestUser(app, `${label}-billing@test.com`);
    const [own] = (await request(server()).get('/api/v1/organizations').set(auth(user)).expect(200)).body.data;
    return { owner: user, organizationId: own.id };
  }

  /** A subscription of the organization's customer, put into the fake and announced by the webhook */
  async function subscribe(
    id: string,
    spec: { subscription: string; status?: string; plan?: string; extraSeats?: number; trialEnd?: number | null },
  ) {
    const customer = (await organization(id)).stripeCustomerId;
    const subscription = stripe.putSubscription({ id: spec.subscription, customer, plan: 'small_business', ...spec });
    return deliver('customer.subscription.created', subscription);
  }

  beforeAll(async () => {
    config.saasEnabled = true;
    Object.assign(config.billing, { stripeSecretKey: FAKE_STRIPE_KEY, stripeWebhookSecret: FAKE_WEBHOOK_SECRET, trialDays: 90, automaticTax: true });
    app = await createAndMigrateAppWith([{ provide: STRIPE_CLIENT, useValue: stripe }]);
    dataSource = app.get(DataSource);
    ({ owner, organizationId } = await newOwner('owner'));
    admin = await signupTestUser(app, 'admin-billing@test.com');
    member = await signupTestUser(app, 'member-billing@test.com');
    for (const [user, role] of [
      [admin, 'admin'],
      [member, 'member'],
    ] as const) {
      await request(server()).post(`/api/v1/organizations/${organizationId}/invites`).set(auth(owner)).send({ email: user.email, role }).expect(201);
    }
  });

  afterAll(async () => {
    config.saasEnabled = before.saas;
    Object.assign(config.billing, before.billing);
    await app.close();
  });

  describe('the billing page', () => {
    it('shows the owner the free plan, the seats and a trial to come, with the buttons', async () => {
      const res = await billingOf(owner).expect(200);
      expect(res.body.data).toEqual({
        enabled: true,
        plan: { code: 'starter', name: 'Starter' },
        subscribedPlan: { code: 'starter', name: 'Starter' },
        status: null,
        interval: null,
        seats: { used: 3, included: 15, bought: 0, limit: 15 },
        trialEndsAt: null,
        pastDueSince: null,
        graceEndsAt: null,
        nextInvoice: null,
        offers: [
          { plan: 'small_business', interval: 'monthly', amount: 4900, currency: 'usd', seatAmount: 500 },
          { plan: 'small_business', interval: 'annual', amount: 40800, currency: 'usd', seatAmount: 6000 },
          { plan: 'enterprise', interval: 'monthly', amount: 49900, currency: 'usd', seatAmount: null },
          { plan: 'enterprise', interval: 'annual', amount: 418800, currency: 'usd', seatAmount: null },
        ],
        trialAvailable: true,
        trialDays: 90,
        canManage: true,
        subscribed: false,
        portalAvailable: false,
      });
    });

    it('shows an admin the same, read-only, and nothing to a member', async () => {
      const res = await billingOf(admin).expect(200);
      expect(res.body.data).toMatchObject({ canManage: false, plan: { code: 'starter' } });
      await billingOf(member).expect(404);
    });

    it('never sends a Stripe id', async () => {
      const res = await billingOf(owner).expect(200);
      expect(JSON.stringify(res.body)).not.toMatch(/cus_|sub_|cs_test|stripe/i);
    });
  });

  describe('Checkout', () => {
    it('is the owner’s only', async () => {
      await checkout(admin, { plan: 'small_business', interval: 'monthly' }).expect(404);
      await checkout(member, { plan: 'small_business', interval: 'monthly' }).expect(404);
      await portal(admin).expect(404);
      await change(admin, { plan: 'enterprise', interval: 'monthly' }).expect(404);
      expect(stripe.callsTo('checkout.sessions.create')).toHaveLength(0);
    });

    it('refuses an order that is no paid plan', async () => {
      await checkout(owner, { plan: 'starter', interval: 'monthly' }).expect(400);
      await checkout(owner, { plan: 'small_business', interval: 'weekly' }).expect(400);
      await checkout(owner, { plan: 'enterprise', interval: 'monthly', extraSeats: 3 }).expect(400);
      await checkout(owner, { plan: 'small_business', interval: 'monthly', extraSeats: -1 }).expect(400);
    });

    it('opens a session by lookup key, with the trial, a card, tax, the address and the seats', async () => {
      const res = await checkout(owner, { plan: 'small_business', interval: 'monthly', extraSeats: 2 }).expect(200);
      expect(res.body.data.url).toMatch(/^https:\/\/checkout\.stripe\.test\//);
      const [customer] = stripe.callsTo('customers.create');
      expect(customer.args[0]).toMatchObject({ email: owner.email, metadata: { organizationId } });
      expect(customer.args[1]).toEqual({ idempotencyKey: idempotencyKey('customer', organizationId, 0, customer.args[0]) });
      const [created] = stripe.callsTo('checkout.sessions.create');
      const [params, options] = created.args;
      expect(params).toMatchObject({
        mode: 'subscription',
        client_reference_id: organizationId,
        metadata: { organizationId },
        line_items: [
          { price: `price_${PLAN_KEY('small_business', 'monthly')}`, quantity: 1 },
          { price: `price_${SEAT_KEY('monthly')}`, quantity: 2, adjustable_quantity: { enabled: true, minimum: 0 } },
        ],
        subscription_data: { trial_period_days: 90, metadata: { organizationId } },
        payment_method_collection: 'always',
        automatic_tax: { enabled: true },
        billing_address_collection: 'required',
        customer_update: { address: 'auto' },
      });
      expect(params.success_url).toMatch(/\/orgs\/[^/]+\/billing\?checkout=success$/);
      expect(options.idempotencyKey).toBe(idempotencyKey('checkout', organizationId, 1, params));
      expect((await organization()).checkoutSessionId).toBe(stripe.sessionsById.get([...stripe.sessionsById.keys()].pop()).id);
    });

    it('hands out the open session again: two clicks and two tabs make one Checkout', async () => {
      const first = (await checkout(owner, { plan: 'small_business', interval: 'monthly', extraSeats: 2 }).expect(200)).body.data.url;
      const parallel = await Promise.all(
        [1, 2, 3].map(() => checkout(owner, { plan: 'small_business', interval: 'monthly', extraSeats: 2 }).then(res => res.body.data?.url)),
      );
      expect(parallel).toEqual([first, first, first]);
      expect(stripe.callsTo('checkout.sessions.create')).toHaveLength(1);
      expect(stripe.callsTo('customers.create')).toHaveLength(1);
    });

    it('expires the open session before a session for another order', async () => {
      const openId = (await organization()).checkoutSessionId;
      await checkout(owner, { plan: 'small_business', interval: 'annual' }).expect(200);
      expect(stripe.callsTo('checkout.sessions.expire').map(call => call.args[0])).toEqual([openId]);
      const [, second] = stripe.callsTo('checkout.sessions.create');
      // No seats asked for: the seat price is offered on the page
      expect(second.args[0].line_items).toEqual([{ price: `price_${PLAN_KEY('small_business', 'annual')}`, quantity: 1 }]);
      expect(second.args[0].optional_items).toEqual([
        { price: `price_${SEAT_KEY('annual')}`, quantity: 1, adjustable_quantity: { enabled: true, minimum: 1, maximum: 1000 } },
      ]);
      expect(second.args[1].idempotencyKey).toBe(idempotencyKey('checkout', organizationId, 2, second.args[0]));
      expect(stripe.callsTo('customers.create')).toHaveLength(1);
    });

    it('answers 503 when a price is missing on Stripe, and changes nothing', async () => {
      const { owner: other, organizationId: otherId } = await newOwner('missing-price');
      stripe.missingPrices.add(PLAN_KEY('enterprise', 'annual'));
      // The prices read so far are kept a few minutes: read them again
      (app.get(BillingService) as any).prices = undefined;
      try {
        const res = await checkout(other, { plan: 'enterprise', interval: 'annual' }, otherId).expect(503);
        expect(res.body.error.code).toBe('billing_unavailable');
        expect((await organization(otherId)).checkoutSessionId).toBeNull();
      } finally {
        stripe.missingPrices.clear();
      }
    });

    it('refuses a Checkout whose stored session was paid, even past its stored expiry', async () => {
      const { owner: other, organizationId: otherId } = await newOwner('paid-session');
      await checkout(other, { plan: 'small_business', interval: 'monthly' }, otherId).expect(200);
      const stored = await organization(otherId);
      stripe.sessionsById.get(stored.checkoutSessionId).status = 'complete';
      await dataSource.getRepository(Organization).update({ id: otherId }, { checkoutExpiresAt: new Date(Date.now() - 60_000) });
      const res = await checkout(other, { plan: 'enterprise', interval: 'monthly' }, otherId).expect(409);
      expect(res.body.error.code).toBe('subscription_exists');
    });

    it('refuses a Checkout while Stripe has a live subscription the webhook has not brought yet', async () => {
      const { owner: other, organizationId: otherId } = await newOwner('early-subscription');
      await checkout(other, { plan: 'small_business', interval: 'monthly' }, otherId).expect(200);
      const customer = (await organization(otherId)).stripeCustomerId;
      // Another product's subscription of the customer does not count
      stripe.putSubscription({ id: 'sub_early_other', customer, otherKeys: ['ever_gauzy_cloud_enterprise_monthly'] });
      await checkout(other, { plan: 'small_business', interval: 'annual' }, otherId).expect(200);
      stripe.putSubscription({ id: 'sub_early', customer, status: 'trialing', plan: 'small_business' });
      const res = await checkout(other, { plan: 'enterprise', interval: 'monthly' }, otherId).expect(409);
      expect(res.body.error.code).toBe('subscription_exists');
    });

    it('opens no portal before there is a billing account', async () => {
      const { owner: other, organizationId: otherId } = await newOwner('no-account');
      expect((await portal(other, otherId).expect(409)).body.error.code).toBe('billing_account_missing');
    });
  });

  describe('the webhook', () => {
    it('refuses a missing or wrong signature, and an event signed with another secret', async () => {
      const event = signedEvent('customer.subscription.updated', { id: 'sub_x', customer: 'cus_x' });
      await request(server()).post('/api/v1/billing/webhook').set('Content-Type', 'application/json').send(event.payload).expect(400);
      await post({ payload: event.payload, signature: 't=1,v1=00' }).expect(400);
      await post(signedEvent('customer.subscription.updated', { id: 'sub_x', customer: 'cus_x' }, { secret: 'whsec_other' })).expect(400);
      // A body changed after signing
      await post({ payload: event.payload.replace('sub_x', 'sub_y'), signature: event.signature }).expect(400);
      expect(await eventCount()).toBe(0);
    });

    it('subscribes: Checkout completes, the trial starts, the plan and seats apply', async () => {
      // The order completed here: Small Business monthly with 2 seats (the previous test left an annual one open)
      await checkout(owner, { plan: 'small_business', interval: 'monthly', extraSeats: 2 }).expect(200);
      const session = (await organization()).checkoutSessionId;
      expect(stripe.sessionsById.get(session).metadata).toMatchObject({ plan: PLAN_KEY('small_business', 'monthly'), extraSeats: '2' });
      const customer = (await organization()).stripeCustomerId;
      const trialEnd = Math.floor(Date.now() / 1000) + 90 * 86400;
      stripe.putSubscription({ id: 'sub_main', customer, status: 'trialing', plan: 'small_business', extraSeats: 2, trialEnd });
      await deliver('checkout.session.completed', {
        id: session,
        object: 'checkout.session',
        mode: 'subscription',
        client_reference_id: organizationId,
        customer,
        subscription: 'sub_main',
      });
      expect(await billingState()).toEqual({
        planCode: 'small_business',
        status: 'trialing',
        interval: 'monthly',
        extraSeats: 2,
        subscription: 'sub_main',
        customer,
        pastDue: false,
      });
      const o = await organization();
      expect([o.checkoutSessionId, o.checkoutExpiresAt]).toEqual([null, null]);
      expect(Math.round(new Date(o.trialEndsAt).getTime() / 1000)).toBe(trialEnd);
      expect((await usage()).seats).toEqual({ used: 3, included: 27 });

      const page = (await billingOf(owner).expect(200)).body.data;
      expect(page).toMatchObject({
        plan: { code: 'small_business', name: 'Small Business' },
        status: 'trialing',
        interval: 'monthly',
        seats: { used: 3, included: 25, bought: 2, limit: 27 },
        subscribed: true,
        portalAvailable: true,
        trialAvailable: false,
        nextInvoice: { amount: 4900, currency: 'usd' },
      });
      expect(new Date(page.trialEndsAt).getTime()).toBe(trialEnd * 1000);
    });

    it('refuses a second Checkout while the subscription lives', async () => {
      expect((await checkout(owner, { plan: 'enterprise', interval: 'monthly' }).expect(409)).body.error.code).toBe('subscription_exists');
    });

    it('opens the portal on the organization’s customer, back to its billing page', async () => {
      const res = await portal(owner).expect(200);
      expect(res.body.data.url).toMatch(/^https:\/\/billing\.stripe\.test\//);
      const [call] = stripe.callsTo('billingPortal.sessions.create');
      expect(call.args[0]).toMatchObject({ customer: (await organization()).stripeCustomerId });
      expect(call.args[0].return_url).toMatch(/\/orgs\/[^/]+\/billing$/);
    });

    it('adds seats: the seat quantity of the subscription becomes the extra seats', async () => {
      const customer = (await organization()).stripeCustomerId;
      const subscription = stripe.putSubscription({ id: 'sub_main', customer, status: 'trialing', plan: 'small_business', extraSeats: 5 });
      await deliver('customer.subscription.updated', subscription);
      expect((await billingState()).extraSeats).toBe(5);
      expect((await usage()).seats.included).toBe(30);
    });

    it('changes the seats through the API (the portal cannot change a subscription of two products)', async () => {
      stripe.reset();
      const res = await change(owner, { plan: 'small_business', interval: 'monthly', extraSeats: 7 }).expect(200);
      expect(res.body.data).toEqual({ pending: false });
      const [update] = stripe.callsTo('subscriptions.update');
      expect(update.args[0]).toBe('sub_main');
      // More seats: invoiced at once (nothing during the trial), applied once paid
      expect(update.args[1]).toMatchObject({ proration_behavior: 'always_invoice', payment_behavior: 'pending_if_incomplete' });
      expect(update.args[1].items).toEqual([{ id: 'si_sub_main_seat', price: `price_${SEAT_KEY('monthly')}`, quantity: 7 }]);
      expect((await billingState()).extraSeats).toBe(7);
    });

    it('upgrades to Enterprise: unlimited seats, the extra seats dropped', async () => {
      const customer = (await organization()).stripeCustomerId;
      await deliver('customer.subscription.updated', stripe.putSubscription({ id: 'sub_main', customer, status: 'active', plan: 'enterprise' }));
      expect(await billingState()).toMatchObject({ planCode: 'enterprise', status: 'active', extraSeats: 0 });
      expect((await usage()).seats.included).toBeNull();
    });

    it('downgrades to Small Business through the API: the plan price swapped, the seats added', async () => {
      stripe.reset();
      await change(owner, { plan: 'small_business', interval: 'monthly', extraSeats: 1 }).expect(200);
      const [update] = stripe.callsTo('subscriptions.update');
      // A decrease is credited at renewal, and applies at once
      expect(update.args[1].proration_behavior).toBe('create_prorations');
      expect(update.args[1].payment_behavior).toBeUndefined();
      expect(update.args[1].items).toEqual([
        { id: 'si_sub_main_0', price: `price_${PLAN_KEY('small_business', 'monthly')}`, quantity: 1 },
        { price: `price_${SEAT_KEY('monthly')}`, quantity: 1 },
      ]);
      expect(await billingState()).toMatchObject({ planCode: 'small_business', extraSeats: 1 });
      expect((await usage()).seats.included).toBe(26);
    });

    it('keeps the plan while the invoice of an upgrade is unpaid, and applies it once paid', async () => {
      const customer = (await organization()).stripeCustomerId;
      stripe.putSubscription({ id: 'sub_main', customer, status: 'active', plan: 'small_business', extraSeats: 1 });
      await deliver('customer.subscription.updated', stripe.subscriptionsById.get('sub_main'));
      stripe.reset();
      stripe.declineInvoices = true;
      try {
        const res = await change(owner, { plan: 'enterprise', interval: 'monthly' }).expect(200);
        expect(res.body.data).toEqual({ pending: true });
      } finally {
        stripe.declineInvoices = false;
      }
      const [update] = stripe.callsTo('subscriptions.update');
      expect(update.args[1]).toMatchObject({ proration_behavior: 'always_invoice', payment_behavior: 'pending_if_incomplete' });
      expect(await billingState()).toMatchObject({ planCode: 'small_business', extraSeats: 1 });
      expect((await usage()).seats.included).toBe(26);

      // Paid: Stripe applies the change and says so
      await deliver('customer.subscription.updated', await stripe.subscriptions.payPending('sub_main'));
      expect(await billingState()).toMatchObject({ planCode: 'enterprise', extraSeats: 0 });
      expect((await usage()).seats.included).toBeNull();
      stripe.putSubscription({ id: 'sub_main', customer, status: 'active', plan: 'small_business', extraSeats: 1 });
      await deliver('customer.subscription.updated', stripe.subscriptionsById.get('sub_main'));
    });

    it('changes nothing for a replayed event, even when Stripe’s state moved on since', async () => {
      const customer = (await organization()).stripeCustomerId;
      const event = await deliver(
        'customer.subscription.updated',
        stripe.putSubscription({ id: 'sub_main', customer, plan: 'small_business', extraSeats: 4 }),
      );
      const state = await billingState();
      const events = await eventCount();
      expect(state.extraSeats).toBe(4);
      stripe.putSubscription({ id: 'sub_main', customer, plan: 'enterprise' });
      stripe.reset();
      await post(event).expect(200, { received: true });
      await post(event).expect(200, { received: true });
      expect(await billingState()).toEqual(state);
      expect(await eventCount()).toBe(events);
      // Nothing was even asked of Stripe
      expect(stripe.callsTo('subscriptions.retrieve')).toHaveLength(0);
      stripe.putSubscription({ id: 'sub_main', customer, plan: 'small_business', extraSeats: 4 });
    });

    it('keeps the plan through the grace of a failed payment, then Starter, and back once paid', async () => {
      const customer = (await organization()).stripeCustomerId;
      const invoice = (id: string) => ({
        id,
        object: 'invoice',
        customer,
        parent: { type: 'subscription_details', subscription_details: { subscription: 'sub_main' } },
      });
      stripe.putSubscription({ id: 'sub_main', customer, status: 'past_due', plan: 'small_business', extraSeats: 4 });
      await deliver('invoice.payment_failed', invoice('in_1'));
      expect(await billingState()).toMatchObject({ status: 'past_due', pastDue: true, planCode: 'small_business' });
      expect((await usage()).plan.code).toBe('small_business');
      const firstSince = (await organization()).pastDueSince;
      // A later failure keeps the first date
      await deliver('invoice.payment_failed', invoice('in_2'), { created: Math.floor(Date.now() / 1000) + 3600 });
      expect((await organization()).pastDueSince).toEqual(firstSince);
      const page = (await billingOf(owner).expect(200)).body.data;
      expect(new Date(page.graceEndsAt).getTime() - new Date(page.pastDueSince).getTime()).toBe(14 * 86400 * 1000);

      // Past the grace (14 days): Starter's limits, nothing deleted
      await dataSource.getRepository(Organization).update({ id: organizationId }, { pastDueSince: new Date(Date.now() - 15 * 86400 * 1000) });
      expect((await usage()).plan.code).toBe('starter');
      expect((await usage()).seats.included).toBe(15);

      stripe.putSubscription({ id: 'sub_main', customer, status: 'active', plan: 'small_business', extraSeats: 4 });
      await deliver('invoice.paid', invoice('in_3'));
      expect(await billingState()).toMatchObject({ status: 'active', pastDue: false, planCode: 'small_business' });
      expect((await usage()).plan.code).toBe('small_business');
    });

    it('counts the grace from the failure: Starter at once when it is older than the grace', async () => {
      const { owner: late, organizationId: lateId } = await newOwner('late-payer');
      await checkout(late, { plan: 'small_business', interval: 'monthly' }, lateId).expect(200);
      await subscribe(lateId, { subscription: 'sub_late', status: 'active' });
      expect((await usage(lateId, late)).plan.code).toBe('small_business');
      const customer = (await organization(lateId)).stripeCustomerId;
      stripe.putSubscription({ id: 'sub_late', customer, status: 'past_due', plan: 'small_business' });
      // Its unpaid invoice is 20 days old: the delinquency, and so the grace, began then
      stripe.openInvoices.set('sub_late', [{ id: 'in_late', finalizedAt: Math.floor(Date.now() / 1000) - 20 * 86400 }]);
      await deliver('invoice.payment_failed', {
        id: 'in_late',
        object: 'invoice',
        customer,
        parent: { subscription_details: { subscription: 'sub_late' } },
      });
      expect(await billingState(lateId)).toMatchObject({ status: 'past_due', pastDue: true, planCode: 'small_business' });
      expect((await usage(lateId, late)).plan.code).toBe('starter');
    });

    it('counts the grace of the current delinquency, whatever old event makes the webhook read it', async () => {
      const { owner: again, organizationId: againId } = await newOwner('late-again');
      await checkout(again, { plan: 'small_business', interval: 'monthly' }, againId).expect(200);
      await subscribe(againId, { subscription: 'sub_again', status: 'active' });
      const customer = (await organization(againId)).stripeCustomerId;
      // An invoice failed 20 days ago and was paid; another failed yesterday. The 20-day-old failure is delivered now
      stripe.putSubscription({ id: 'sub_again', customer, status: 'past_due', plan: 'small_business' });
      stripe.openInvoices.set('sub_again', [{ id: 'in_new', finalizedAt: Math.floor(Date.now() / 1000) - 86400 }]);
      await deliver(
        'invoice.payment_failed',
        { id: 'in_old', object: 'invoice', customer, parent: { subscription_details: { subscription: 'sub_again' } } },
        { created: Math.floor(Date.now() / 1000) - 20 * 86400 },
      );
      const since = (await organization(againId)).pastDueSince;
      expect(Math.abs(new Date(since).getTime() - (Date.now() - 86400 * 1000))).toBeLessThan(5000);
      expect((await usage(againId, again)).plan.code).toBe('small_business');
    });

    it('ignores a customer that is no organization’s (the other products of the shared account)', async () => {
      const state = await billingState();
      const events = await eventCount();
      stripe.putSubscription({ id: 'sub_gauzy', customer: 'cus_gauzy_tenant', plan: 'enterprise' });
      await deliver('customer.subscription.created', stripe.subscriptionsById.get('sub_gauzy'));
      await deliver('checkout.session.completed', {
        id: 'cs_gauzy',
        mode: 'subscription',
        client_reference_id: 'a-gauzy-tenant',
        customer: 'cus_gauzy_tenant',
        subscription: 'sub_gauzy',
      });
      await deliver('invoice.paid', {
        id: 'in_gauzy',
        customer: 'cus_gauzy_tenant',
        parent: { subscription_details: { subscription: 'sub_gauzy' } },
      });
      // A Checkout that names this organization, with somebody else's customer
      await deliver('checkout.session.completed', {
        id: 'cs_forged',
        mode: 'subscription',
        client_reference_id: organizationId,
        customer: 'cus_gauzy_tenant',
        subscription: 'sub_gauzy',
      });
      expect(await billingState()).toEqual(state);
      // Only the forged Checkout names an organization: recorded as foreign, nothing applied
      expect(await eventCount()).toBe(events + 1);
      const forged = await dataSource
        .getRepository(BillingEvent)
        .findOneByOrFail({ type: 'checkout.session.completed', outcome: 'foreign_customer' });
      expect(forged.organizationId).toBe(organizationId);
    });

    it('ignores a subscription of the customer without a Traduora price, and events of the other mode', async () => {
      const customer = (await organization()).stripeCustomerId;
      const state = await billingState();
      stripe.putSubscription({ id: 'sub_other_product', customer, otherKeys: ['ever_gauzy_cloud_enterprise_monthly'] });
      await deliver('customer.subscription.created', stripe.subscriptionsById.get('sub_other_product'));
      await deliver('customer.subscription.updated', stripe.putSubscription({ id: 'sub_main', customer, plan: 'enterprise' }), { livemode: true });
      expect(await billingState()).toEqual(state);
      stripe.putSubscription({ id: 'sub_main', customer, plan: 'small_business', extraSeats: 4 });
    });

    it('cancels a second live subscription at once, and keeps the first', async () => {
      const state = await billingState();
      stripe.reset();
      await subscribe(organizationId, { subscription: 'sub_second', status: 'trialing', plan: 'enterprise' });
      const [cancel] = stripe.callsTo('subscriptions.cancel');
      expect(cancel.args[0]).toBe('sub_second');
      expect(cancel.args[1]).toMatchObject({
        prorate: false,
        invoice_now: false,
        cancellation_details: { comment: expect.stringContaining('Traduora') },
      });
      expect(stripe.callsTo('refunds.create')).toEqual([]);
      expect(await billingState()).toEqual(state);
      const logged = await dataSource.getRepository(BillingEvent).findOneByOrFail({ outcome: 'second_subscription_canceled' });
      expect(logged.organizationId).toBe(organizationId);
      expect(logged.detail).toBe('canceled sub_second, nothing paid');
      // Its end changes nothing either
      await deliver('customer.subscription.deleted', stripe.subscriptionsById.get('sub_second'));
      expect(await billingState()).toEqual(state);
    });

    it('refunds what a second subscription was paid, and records it', async () => {
      const state = await billingState();
      stripe.reset();
      // A second Checkout after the trial was used: charged at once
      stripe.paidInvoices.set('sub_third', { id: 'in_third', amount_paid: 4900, currency: 'usd' });
      await subscribe(organizationId, { subscription: 'sub_third', status: 'active', plan: 'small_business' });
      expect(stripe.callsTo('subscriptions.cancel').map(call => call.args[0])).toEqual(['sub_third']);
      const [refund] = stripe.callsTo('refunds.create');
      expect(refund.args[0]).toMatchObject({ payment_intent: 'pi_in_third', reason: 'duplicate' });
      // Under the organization's lock: a short timeout, no retry
      expect(refund.args[1]).toEqual({ idempotencyKey: 'traduora-refund-in_third-inpay_in_third', timeout: 5000, maxNetworkRetries: 0 });
      expect(await billingState()).toEqual(state);
      const logged = await dataSource
        .getRepository(BillingEvent)
        .findOneByOrFail({ outcome: 'second_subscription_canceled', detail: Like('%sub_third%') });
      expect(logged.detail).toBe('canceled sub_third, refunded in_third (4900 usd): re_pi_in_third');
    });

    it('cancels: Starter again, nothing deleted, and a new Checkout without a second trial', async () => {
      const customer = (await organization()).stripeCustomerId;
      await deliver(
        'customer.subscription.deleted',
        stripe.putSubscription({ id: 'sub_main', customer, status: 'canceled', plan: 'small_business', extraSeats: 4 }),
      );
      expect(await billingState()).toMatchObject({ planCode: 'starter', status: 'canceled', extraSeats: 0, subscription: 'sub_main' });
      expect((await usage()).plan.code).toBe('starter');
      const page = (await billingOf(owner).expect(200)).body.data;
      expect(page).toMatchObject({ subscribed: false, trialAvailable: false, portalAvailable: true });
      stripe.reset();
      await checkout(owner, { plan: 'small_business', interval: 'monthly' }).expect(200);
      const [created] = stripe.callsTo('checkout.sessions.create');
      expect(created.args[0].subscription_data.trial_period_days).toBeUndefined();
      expect(stripe.callsTo('customers.create')).toHaveLength(0);
      expect(created.args[0].customer).toBe(customer);
    });

    it('lets a new subscription take over once the old one ended', async () => {
      await subscribe(organizationId, { subscription: 'sub_new', status: 'active', plan: 'small_business' });
      expect(await billingState()).toMatchObject({ subscription: 'sub_new', status: 'active', planCode: 'small_business' });
    });
  });

  describe('review round 2 (#678)', () => {
    it('brings the organization in line when a change has nothing left to send (a retry after a failed write)', async () => {
      const { owner: retry, organizationId: retryId } = await newOwner('retry-owner');
      await checkout(retry, { plan: 'small_business', interval: 'monthly' }, retryId).expect(200);
      await subscribe(retryId, { subscription: 'sub_retry', status: 'active', extraSeats: 3 });
      // Stripe has 3 seats; the local write of an earlier change failed and left 1
      await dataSource.getRepository(Organization).update({ id: retryId }, { extraSeats: 1 });
      stripe.reset();
      const res = await change(retry, { plan: 'small_business', interval: 'monthly', extraSeats: 3 }, retryId);
      expect([res.status, res.body]).toEqual([200, { data: { pending: false } }]);
      expect(res.body.data).toEqual({ pending: false });
      expect(stripe.callsTo('subscriptions.update')).toEqual([]);
      expect((await billingState(retryId)).extraSeats).toBe(3);
    });

    it('cancels and refunds a Checkout paid after its organization was closed', async () => {
      const { owner: gone, organizationId: goneId } = await newOwner('gone-owner');
      await checkout(gone, { plan: 'small_business', interval: 'monthly' }, goneId).expect(200);
      const { checkoutSessionId: session, stripeCustomerId: customer } = await organization(goneId);
      // The account is deleted while its Checkout page is still open: the organization closes
      await request(server())
        .delete('/api/v1/users/me')
        .set(auth(gone))
        .expect(res => expect(res.status).toBeLessThan(300));
      expect((await organization(goneId)).status).toBe('deleted');
      stripe.reset();
      stripe.paidInvoices.set('sub_gone', { id: 'in_gone', amount_paid: 4900, currency: 'usd' });
      stripe.putSubscription({ id: 'sub_gone', customer, status: 'active', plan: 'small_business' });
      await deliver('checkout.session.completed', {
        id: session,
        mode: 'subscription',
        client_reference_id: goneId,
        customer,
        subscription: 'sub_gone',
      });
      expect(stripe.callsTo('subscriptions.cancel').map(call => call.args[0])).toEqual(['sub_gone']);
      expect(stripe.callsTo('refunds.create')).toHaveLength(1);
      expect(await billingState(goneId)).toMatchObject({ planCode: 'starter', subscription: null });
      const logged = await dataSource.getRepository(BillingEvent).findOneByOrFail({ outcome: 'closed_organization' });
      expect(logged.detail).toContain('refunded in_gone');
    });

    it('finishes the refund of a second subscription on a later delivery, once', async () => {
      const { owner: twice, organizationId: twiceId } = await newOwner('twice-owner');
      await checkout(twice, { plan: 'small_business', interval: 'monthly' }, twiceId).expect(200);
      await subscribe(twiceId, { subscription: 'sub_twice_first', status: 'active' });
      const customer = (await organization(twiceId)).stripeCustomerId;
      // The backstop canceled the second one, then its refund failed: Stripe has it canceled, with the backstop's comment
      const second = stripe.putSubscription({ id: 'sub_twice_second', customer, status: 'active', plan: 'small_business' });
      await stripe.subscriptions.cancel('sub_twice_second', { cancellation_details: { comment: 'x' } });
      stripe.subscriptionsById.get('sub_twice_second').cancellation_details = {
        comment: 'Traduora: canceled at once, the organization has another subscription or was closed',
      };
      stripe.paidInvoices.set('sub_twice_second', { id: 'in_twice', amount_paid: 4900, currency: 'usd' });
      stripe.reset();
      await deliver('customer.subscription.deleted', stripe.subscriptionsById.get('sub_twice_second'));
      await deliver('customer.subscription.updated', stripe.subscriptionsById.get('sub_twice_second'));
      expect(stripe.callsTo('subscriptions.cancel')).toEqual([]);
      // Refunded on the first delivery; the second finds that refund and makes none
      expect(stripe.callsTo('refunds.create')).toHaveLength(1);
      expect(stripe.callsTo('refunds.create')[0].args[0]).toMatchObject({ payment_intent: 'pi_in_twice', amount: 4900 });
      expect((await billingState(twiceId)).subscription).toBe('sub_twice_first');
      expect(second.id).toBe('sub_twice_second');
    });
  });

  describe('limits on the shared Stripe account', () => {
    it('throttles each billing route per organization', async () => {
      const { owner: busy, organizationId: busyId } = await newOwner('busy-owner');
      const statuses: number[] = [];
      for (let i = 0; i <= config.billing.throttle.changes; i++) {
        statuses.push((await portal(busy, busyId)).status);
      }
      expect(statuses.slice(0, -1).every(status => status === 409)).toBe(true);
      expect(statuses[statuses.length - 1]).toBe(429);
      // Another organization, and another route of the same one, keep their own count
      await portal(owner).expect(200);
      await billingOf(busy, busyId).expect(200);
    });

    it('keeps the invoice preview of the billing page a minute', async () => {
      const { owner: fresh, organizationId: freshId } = await newOwner('preview-owner');
      await checkout(fresh, { plan: 'small_business', interval: 'monthly' }, freshId).expect(200);
      await subscribe(freshId, { subscription: 'sub_preview', status: 'active' });
      stripe.reset();
      expect((await billingOf(fresh, freshId).expect(200)).body.data.nextInvoice).toMatchObject({ amount: 4900, currency: 'usd' });
      expect(stripe.callsTo('invoices.createPreview')).toHaveLength(1);
      await billingOf(fresh, freshId).expect(200);
      expect(stripe.callsTo('invoices.createPreview')).toHaveLength(1);
    });

    it('counts a billing request only once its access rule let it through', async () => {
      const { owner: quota, organizationId: quotaId } = await newOwner('quota-owner');
      // Someone of another organization, refused every time, uses none of this organization's count
      for (let i = 0; i < config.billing.throttle.changes + 5; i++) {
        await portal(owner, quotaId).expect(404);
      }
      await portal(quota, quotaId).expect(409);
    });
  });

  describe('cancellation for the organization deletion (P6)', () => {
    it('cancels the live subscription at once, without proration, and writes Starter', async () => {
      const { owner: leaving, organizationId: leavingId } = await newOwner('leaving-owner');
      await checkout(leaving, { plan: 'small_business', interval: 'monthly' }, leavingId).expect(200);
      await subscribe(leavingId, { subscription: 'sub_leaving', status: 'active' });
      stripe.reset();
      expect(await app.get(BillingService).cancelSubscription(leavingId)).toBe(true);
      const [cancel] = stripe.callsTo('subscriptions.cancel');
      expect(cancel.args.slice(0, 2)).toEqual(['sub_leaving', { prorate: false, invoice_now: false }]);
      expect(await billingState(leavingId)).toMatchObject({ planCode: 'starter', status: 'canceled' });
      // Nothing left to cancel
      expect(await app.get(BillingService).cancelSubscription(leavingId)).toBe(false);
    });
  });

  describe('account deletion', () => {
    it('refuses while it would close an organization with a live subscription, and goes ahead once it is canceled', async () => {
      const { owner: solo, organizationId: soloId } = await newOwner('solo-owner');
      await checkout(solo, { plan: 'small_business', interval: 'monthly' }, soloId).expect(200);
      await subscribe(soloId, { subscription: 'sub_solo', status: 'active' });

      const refused = await request(server()).delete('/api/v1/users/me').set(auth(solo)).expect(422);
      expect(refused.body.error.code).toBe('subscription_active');
      expect(refused.body.error.message).toContain('Cancel it under Billing');
      expect((await organization(soloId)).status).toBe('active');
      await request(server()).get('/api/v1/users/me').set(auth(solo)).expect(200);

      const customer = (await organization(soloId)).stripeCustomerId;
      await deliver(
        'customer.subscription.deleted',
        stripe.putSubscription({ id: 'sub_solo', customer, status: 'canceled', plan: 'small_business' }),
      );
      const deleted = await request(server()).delete('/api/v1/users/me').set(auth(solo));
      expect(deleted.status).toBeLessThan(300);
      expect((await organization(soloId)).status).toBe('deleted');
    });
  });

  describe('off', () => {
    it('answers 404 outside SaaS mode, and on the default organization', async () => {
      config.saasEnabled = false;
      try {
        await billingOf(owner).expect(404);
        await post(signedEvent('customer.subscription.updated', { id: 'sub_main', customer: 'cus_x' })).expect(404);
      } finally {
        config.saasEnabled = true;
      }
      const defaultOrganization = await dataSource.getRepository(Organization).findOneByOrFail({ isDefault: true });
      await billingOf(owner, defaultOrganization.id).expect(404);
    });

    it('answers 404 without a webhook secret', async () => {
      const secret = config.billing.stripeWebhookSecret;
      config.billing.stripeWebhookSecret = '';
      try {
        await post(signedEvent('customer.subscription.updated', { id: 'sub_main', customer: 'cus_x' })).expect(404);
      } finally {
        config.billing.stripeWebhookSecret = secret;
      }
    });
  });
});
