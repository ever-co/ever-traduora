import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import { DataSource } from 'typeorm';
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
      const session = (await organization()).checkoutSessionId;
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
      await change(owner, { plan: 'small_business', interval: 'monthly', extraSeats: 7 }).expect(204);
      const [update] = stripe.callsTo('subscriptions.update');
      expect(update.args[0]).toBe('sub_main');
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
      await change(owner, { plan: 'small_business', interval: 'monthly', extraSeats: 1 }).expect(204);
      const [update] = stripe.callsTo('subscriptions.update');
      expect(update.args[1].items).toEqual([
        { id: 'si_sub_main_0', price: `price_${PLAN_KEY('small_business', 'monthly')}`, quantity: 1 },
        { price: `price_${SEAT_KEY('monthly')}`, quantity: 1 },
      ]);
      expect(await billingState()).toMatchObject({ planCode: 'small_business', extraSeats: 1 });
      expect((await usage()).seats.included).toBe(26);
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
      await deliver(
        'invoice.payment_failed',
        { id: 'in_late', object: 'invoice', customer, parent: { subscription_details: { subscription: 'sub_late' } } },
        { created: Math.floor(Date.now() / 1000) - 20 * 86400 },
      );
      expect(await billingState(lateId)).toMatchObject({ status: 'past_due', pastDue: true, planCode: 'small_business' });
      expect((await usage(lateId, late)).plan.code).toBe('starter');
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
      expect(cancel.args).toEqual(['sub_second', { prorate: false, invoice_now: false }]);
      expect(await billingState()).toEqual(state);
      const logged = await dataSource.getRepository(BillingEvent).findOneByOrFail({ outcome: 'second_subscription_canceled' });
      expect(logged.organizationId).toBe(organizationId);
      // Its end changes nothing either
      await deliver('customer.subscription.deleted', stripe.subscriptionsById.get('sub_second'));
      expect(await billingState()).toEqual(state);
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
