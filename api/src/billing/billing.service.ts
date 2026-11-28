import { BadRequestException, HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import { createHash } from 'crypto';
import { DataSource, EntityManager } from 'typeorm';
import Stripe = require('stripe');
import { config } from '../config';
import { OrganizationPlanCode, OrganizationRole } from '../domain/organization-actions';
import { hasLiveSubscription, isLiveStatus } from '../domain/billing-status';
import { planOf } from '../domain/organization-plans';
import { BillingEvent } from '../entity/billing-event.entity';
import { Organization } from '../entity/organization.entity';
import { User } from '../entity/user.entity';
import { OrganizationException } from '../errors';
import {
  BillingFields,
  lockOrganizationForBilling,
  organizationExists,
  organizationOfCustomer,
  writeBillingFields,
} from '../services/organization/organization-billing';
import { isDuplicateKey } from '../services/organization/organization-membership';
import { countSeats, limitsOf } from '../services/organization/organization-usage';
import { readCommittedTransaction } from '../utils/database-locks';
import {
  BillingInterval,
  isInterval,
  isPaidPlan,
  isPlanLookupKey,
  isSeatLookupKey,
  raisesTheBill,
  MAX_EXTRA_SEATS,
  PAID_PLANS,
  planLookupKey,
  seatLookupKey,
  sellsSeats,
  SubscribedPlan,
  subscribedPlan,
} from './billing-plans';
import { BillingView } from './billing.dto';
import { isTestModeKey, STRIPE_CLIENT, StripeClient } from './stripe-client';

/** A subscription in these states gives the organization its plan (`effectivePlan` then lapses `unpaid` and a long `past_due`) */
const GRANTING_STATUSES: ReadonlySet<string> = new Set(['trialing', 'active', 'past_due', 'unpaid']);

const DAY_MS = 24 * 60 * 60 * 1000;

/** How long an invoice preview of the billing page is kept, and how many organizations' previews at most */
const PREVIEW_CACHE_MS = 60 * 1000;
const PREVIEW_CACHE_SIZE = 1000;

/**
 * Options of a Stripe call made while the organization's row is locked (the webhook): a short timeout and no retry, so
 * the lock is never held long. A failure answers 500, and Stripe sends the event again.
 */
const LOCKED_CALL: Stripe.RequestOptions = { timeout: 5_000, maxNetworkRetries: 0 };

/** How long the prices of the lookup keys are kept before they are read again */
const PRICE_CACHE_MS = 10 * 60 * 1000;

/** An open session that expires sooner than this is not handed out again */
const CHECKOUT_REUSE_MARGIN_MS = 5 * 60 * 1000;

/** The order of a Checkout or of a change: what the subscription should buy */
export interface BillingOrder {
  plan: OrganizationPlanCode;
  interval: BillingInterval;
  extraSeats: number;
}

/** What a webhook event did, with a detail for the log (a refund, say) */
interface Applied {
  outcome: EventOutcome;
  detail?: string;
}

/** An order as a route receives it: no extra seats when left out */
export type BillingOrderInput = Omit<BillingOrder, 'extraSeats'> & { extraSeats?: number | null };

/** What a webhook event did; stored with it in `billing_event` */
export type EventOutcome =
  | 'applied'
  | 'duplicate'
  | 'ignored_type'
  | 'other_mode'
  | 'foreign_customer'
  | 'not_traduora'
  | 'other_subscription'
  | 'second_subscription_canceled'
  | 'no_subscription';

const idOf = (value: string | { id: string } | null | undefined): string | null => (typeof value === 'string' ? value : (value?.id ?? null));

const fromEpochSeconds = (seconds: number | null | undefined): Date | null =>
  typeof seconds === 'number' && Number.isFinite(seconds) && seconds > 0 ? new Date(seconds * 1000) : null;

/**
 * Stripe Billing of the organizations (DESIGN §3.7), on the shared Ever account, in test mode until go-live:
 * - Checkout by lookup key, one at a time per organization (the organization's row lock, an open session handed out
 *   again, an idempotency key), with the trial once per organization;
 * - changes of the live subscription (plan, interval, extra seats), which the customer portal cannot make on a
 *   subscription of two products;
 * - the customer portal, on the organization's own Stripe customer;
 * - the signed webhook, idempotent through `billing_event`, which writes the billing state from Stripe's own objects.
 *
 * The plan and the seats come from the price lookup keys only. A Stripe customer that is not an organization's (the
 * other products of the shared account) is ignored.
 */
@Injectable()
export class BillingService {
  private readonly logger = new Logger('Billing');
  private prices: { readAt: number; byKey: Map<string, Stripe.Price> } | undefined;
  /** The invoice previews of the billing page, by organization and subscription, kept a minute */
  private readonly previews = new Map<string, { readAt: number; value: BillingView['nextInvoice'] }>();

  constructor(
    @Inject(STRIPE_CLIENT) private readonly stripe: StripeClient | null,
    private readonly dataSource: DataSource,
  ) {}

  /** Whether billing is set up on this installation (SaaS mode with a Stripe key) */
  get enabled(): boolean {
    return config.saasEnabled && !!this.stripe;
  }

  private client(): StripeClient {
    if (!this.enabled) {
      throw new OrganizationException(HttpStatus.NOT_FOUND, 'billing_disabled', 'Billing is not set up on this installation');
    }
    return this.stripe;
  }

  /** The billing page (`GET /organizations/:id/billing`): owner and admins, read-only for the admins */
  async view(organization: Organization, role: OrganizationRole): Promise<BillingView> {
    const { plan, seats } = limitsOf(organization);
    const subscribed = organization.planCode ? planOf(organization.planCode) : plan;
    const live = isLiveStatus(organization.billingStatus) && !!organization.stripeSubscriptionId;
    const pastDueSince = organization.billingStatus === 'past_due' ? organization.pastDueSince : null;
    return {
      enabled: this.enabled,
      plan: { code: plan.code, name: plan.name },
      subscribedPlan: { code: subscribed.code, name: subscribed.name },
      status: organization.billingStatus ?? null,
      interval: organization.billingInterval ?? null,
      seats: {
        used: await countSeats(this.dataSource.manager, organization.id),
        included: plan.seats,
        bought: plan.extraSeats ? Math.max(0, organization.extraSeats || 0) : 0,
        limit: seats,
      },
      trialEndsAt: organization.billingStatus === 'trialing' ? iso(organization.trialEndsAt) : null,
      pastDueSince: iso(pastDueSince),
      graceEndsAt: pastDueSince ? iso(new Date(new Date(pastDueSince).getTime() + config.billingPastDueGraceDays * DAY_MS)) : null,
      nextInvoice: live ? await this.nextInvoice(organization) : null,
      offers: await this.offers(),
      trialAvailable: this.trialDays(organization) > 0,
      trialDays: Math.max(0, config.billing.trialDays),
      canManage: role === OrganizationRole.Owner,
      subscribed: live,
      portalAvailable: this.enabled && !!organization.stripeCustomerId,
    };
  }

  /**
   * A Checkout session for the order (owner). Refused while a live subscription exists (409 `subscription_exists`: the
   * subscription is changed instead). One Checkout at a time, without holding the organization's lock over a call to
   * Stripe (the shared Ever account bills other products too):
   * 1. under the lock, the organization is read and the decision taken;
   * 2. outside it, Stripe: the stored session (handed out again, or expired), the customer's live subscriptions, the
   *    customer, the new session, each with an idempotency key, so two parallel clicks for one order get one session;
   * 3. under the lock again, the session is stored only if nothing changed meanwhile; otherwise it is expired and the
   *    request answers 409 `checkout_busy`.
   */
  async checkout(organizationId: string, owner: User, order: BillingOrderInput): Promise<{ url: string }> {
    const stripe = this.client();
    const wanted = this.validOrder(order);
    const prices = await this.pricesFor(wanted);
    const read = await readCommittedTransaction(this.dataSource.manager, async tx => {
      const organization = await this.locked(tx, organizationId);
      if (hasLiveSubscription(organization)) {
        throw new OrganizationException(HttpStatus.CONFLICT, 'subscription_exists', 'The organization has a subscription: change it instead');
      }
      return organization;
    });

    const reused = await this.openSession(stripe, read, wanted);
    if (reused) {
      return { url: reused };
    }
    if (read.stripeCustomerId) {
      await this.assertNoLiveSubscription(stripe, read.stripeCustomerId);
    }
    const customer = read.stripeCustomerId || (await this.createCustomer(stripe, read, owner));
    const attempt = (read.checkoutAttempt || 0) + 1;
    const params = checkoutSessionParams(read, customer, prices, wanted, this.trialDays(read), config.billing.automaticTax);
    const session = await stripe.checkout.sessions.create(params, { idempotencyKey: idempotencyKey('checkout', read.id, attempt, params) });
    if (!session.url) {
      throw new OrganizationException(HttpStatus.SERVICE_UNAVAILABLE, 'billing_unavailable', 'Stripe did not open a Checkout page');
    }

    const stored = await readCommittedTransaction(this.dataSource.manager, async tx => {
      const organization = await this.locked(tx, organizationId);
      if (organization.checkoutSessionId === session.id) {
        // A parallel click for the same order stored this very session (same idempotency key)
        return true;
      }
      const unchanged =
        !hasLiveSubscription(organization) &&
        (organization.checkoutAttempt || 0) === (read.checkoutAttempt || 0) &&
        (organization.stripeCustomerId || customer) === customer;
      if (unchanged) {
        await writeBillingFields(tx, organization.id, {
          stripeCustomerId: customer,
          checkoutSessionId: session.id,
          checkoutExpiresAt: fromEpochSeconds(session.expires_at),
          checkoutAttempt: attempt,
        });
      }
      return unchanged;
    });
    if (!stored) {
      await this.expireSession(stripe, session.id);
      throw new OrganizationException(HttpStatus.CONFLICT, 'checkout_busy', 'The billing of this organization changed meanwhile. Try again.');
    }
    return { url: session.url };
  }

  /**
   * Changes the live subscription to the order (owner): the plan or its interval (the plan price is swapped), and the
   * extra seats (the seat price's quantity, added or removed). A raise (a higher plan, more seats, yearly) is invoiced at
   * once and applies only when that invoice is paid (`pending` until then); a decrease is credited at renewal; a trial
   * keeps running. Read under the lock, changed on Stripe outside it (idempotency key over the subscription as it was and
   * the change), and the state Stripe answers written under the lock again, as the webhook would: a pending change
   * leaves the items, and so the plan, as they were.
   */
  async changeSubscription(organizationId: string, order: BillingOrderInput): Promise<{ pending: boolean }> {
    const stripe = this.client();
    const wanted = this.validOrder(order);
    const prices = await this.pricesFor(wanted);
    const read = await readCommittedTransaction(this.dataSource.manager, async tx => this.locked(tx, organizationId));
    if (!hasLiveSubscription(read)) {
      throw new OrganizationException(HttpStatus.CONFLICT, 'no_subscription', 'The organization has no subscription: start one with Checkout');
    }
    const subscription = await stripe.subscriptions.retrieve(read.stripeSubscriptionId);
    if (idOf(subscription.customer) !== read.stripeCustomerId) {
      throw new OrganizationException(HttpStatus.CONFLICT, 'no_subscription', 'The organization has no subscription: start one with Checkout');
    }
    const items = subscriptionChanges(subscription, prices);
    if (!items.length) {
      return { pending: false };
    }
    // A raise is invoiced at once and applies only once that invoice is paid (a declined card leaves the plan as it
    // was: Stripe keeps the change pending, and the webhook applies it when paid); a decrease is credited at renewal
    const raise = raisesTheBill(subscribedPlan(pricedItems(subscription)), wanted);
    const params: Stripe.SubscriptionUpdateParams = raise
      ? { items, proration_behavior: 'always_invoice', payment_behavior: 'pending_if_incomplete' }
      : { items, proration_behavior: 'create_prorations' };
    const before = (subscription.items?.data ?? []).map(item => [item.id, item.price?.id, item.quantity]);
    const updated = await stripe.subscriptions.update(subscription.id, params, {
      idempotencyKey: idempotencyKey('change', read.id, 0, { subscription: subscription.id, before, params }),
    });
    await this.applyLatest(updated);
    return { pending: !!updated.pending_update };
  }

  /**
   * Cancels the organization's live subscription at once, without proration or a final invoice: for the organization's
   * deletion (P6), which must not leave Stripe charging an organization nobody can reach. Answers whether there was one
   * to cancel. The state is written as the webhook would; a subscription Stripe had canceled already is just written.
   */
  async cancelSubscription(organizationId: string): Promise<boolean> {
    if (!this.enabled) {
      return false;
    }
    const read = await readCommittedTransaction(this.dataSource.manager, async tx => this.locked(tx, organizationId));
    if (!hasLiveSubscription(read)) {
      return false;
    }
    let canceled: Stripe.Subscription;
    try {
      canceled = await this.stripe.subscriptions.cancel(
        read.stripeSubscriptionId,
        { prorate: false, invoice_now: false },
        { idempotencyKey: `traduora-cancel-${read.stripeSubscriptionId}` },
      );
    } catch (error) {
      canceled = await this.stripe.subscriptions.retrieve(read.stripeSubscriptionId);
      if (canceled.status !== 'canceled') {
        throw error;
      }
    }
    await this.applyLatest(canceled);
    return true;
  }

  /** Writes a subscription Stripe answered to its organization, under the lock, when it is still that organization's */
  private async applyLatest(subscription: Stripe.Subscription): Promise<void> {
    const customerId = idOf(subscription.customer);
    const organizationId = customerId ? await organizationOfCustomer(this.dataSource.manager, customerId) : null;
    if (!organizationId) {
      return;
    }
    await readCommittedTransaction(this.dataSource.manager, async tx => {
      const organization = await lockOrganizationForBilling(tx, organizationId);
      if (organization && organization.stripeSubscriptionId === subscription.id) {
        await this.applySubscription(tx, organization, subscription, new Date());
      }
    });
  }

  /** The customer portal (owner): payment methods, invoices, the billing address, cancellation */
  async portal(organization: Organization): Promise<{ url: string }> {
    const stripe = this.client();
    if (!organization.stripeCustomerId) {
      throw new OrganizationException(
        HttpStatus.CONFLICT,
        'billing_account_missing',
        'The organization has no billing account yet: start with Checkout',
      );
    }
    const session = await stripe.billingPortal.sessions.create({
      customer: organization.stripeCustomerId,
      return_url: billingPageUrl(organization),
      ...(config.billing.portalConfiguration ? { configuration: config.billing.portalConfiguration } : {}),
    });
    return { url: session.url };
  }

  /**
   * `POST /api/v1/billing/webhook`: the event, verified with `TR_STRIPE_WEBHOOK_SECRET` on the raw body, then applied in
   * one transaction with its `billing_event` row (a second delivery changes nothing; a failure rolls back both, and
   * Stripe sends it again). Events of the other products of the shared account are answered and ignored, unrecorded.
   */
  async handleWebhook(rawBody: Buffer | string | undefined, signature: string | undefined): Promise<EventOutcome> {
    const stripe = this.client();
    if (!config.billing.stripeWebhookSecret) {
      throw new OrganizationException(HttpStatus.NOT_FOUND, 'billing_disabled', 'Billing is not set up on this installation');
    }
    if (!rawBody || (typeof rawBody !== 'string' && !Buffer.isBuffer(rawBody)) || !signature) {
      throw new BadRequestException('signature missing');
    }
    let event: Stripe.Event;
    try {
      event = stripe.webhooks.constructEvent(rawBody, signature, config.billing.stripeWebhookSecret);
    } catch {
      throw new BadRequestException('signature invalid');
    }
    if (event.livemode === isTestModeKey(config.billing.stripeSecretKey)) {
      return 'other_mode';
    }
    const at = fromEpochSeconds(event.created) ?? new Date();
    switch (event.type) {
      case 'checkout.session.completed':
        return this.onCheckoutCompleted(stripe, event, event.data.object, at);
      case 'customer.subscription.created':
      case 'customer.subscription.updated':
      case 'customer.subscription.deleted': {
        const subscription = event.data.object;
        return this.onSubscription(stripe, event, subscription.id, idOf(subscription.customer), at);
      }
      case 'invoice.paid':
      case 'invoice.payment_failed': {
        const invoice = event.data.object;
        const subscriptionId = invoiceSubscriptionId(invoice);
        return subscriptionId ? this.onSubscription(stripe, event, subscriptionId, idOf(invoice.customer), at) : 'no_subscription';
      }
      default:
        return 'ignored_type';
    }
  }

  private async onCheckoutCompleted(stripe: StripeClient, event: Stripe.Event, session: Stripe.Checkout.Session, at: Date): Promise<EventOutcome> {
    const organizationId = session.client_reference_id;
    if (session.mode !== 'subscription' || !organizationId || !(await organizationExists(this.dataSource.manager, organizationId))) {
      return 'foreign_customer';
    }
    const customerId = idOf(session.customer);
    return this.applyEvent(event, organizationId, async (tx, organization) => {
      // The customer is the organization's own, or the one of the session this organization opened
      const ours = organization.stripeCustomerId ? organization.stripeCustomerId === customerId : organization.checkoutSessionId === session.id;
      if (!ours || !customerId) {
        return 'foreign_customer';
      }
      const fields: BillingFields = { stripeCustomerId: customerId };
      if (organization.checkoutSessionId === session.id) {
        Object.assign(fields, { checkoutSessionId: null, checkoutExpiresAt: null });
      }
      await writeBillingFields(tx, organization.id, fields);
      const subscriptionId = idOf(session.subscription);
      if (!subscriptionId) {
        return 'no_subscription';
      }
      const subscription = await stripe.subscriptions.retrieve(subscriptionId, {}, LOCKED_CALL);
      return this.applySubscription(tx, { ...organization, ...fields } as Organization, subscription, at);
    });
  }

  /**
   * A subscription event, or an invoice of a subscription: the organization is the one whose customer it is, and the
   * subscription is read again from Stripe under the organization's lock, so events that arrive out of order still
   * leave the latest state. That one call is made under the lock on purpose, with a short timeout and no retry
   * (`LOCKED_CALL`): a slow Stripe fails the delivery (500), and Stripe sends it again later.
   */
  private async onSubscription(
    stripe: StripeClient,
    event: Stripe.Event,
    subscriptionId: string,
    customerId: string | null,
    at: Date,
  ): Promise<EventOutcome> {
    const organizationId = customerId ? await organizationOfCustomer(this.dataSource.manager, customerId) : null;
    if (!organizationId) {
      return 'foreign_customer';
    }
    return this.applyEvent(event, organizationId, async (tx, organization) => {
      if (organization.stripeCustomerId !== customerId) {
        return 'foreign_customer';
      }
      return this.applySubscription(tx, organization, await stripe.subscriptions.retrieve(subscriptionId, {}, LOCKED_CALL), at);
    });
  }

  /**
   * Runs `work` for the event under the organization's lock and records the event with what it did, in one
   * transaction. An event recorded already changes nothing.
   */
  private async applyEvent(
    event: Stripe.Event,
    organizationId: string,
    work: (tx: EntityManager, organization: Organization) => Promise<EventOutcome | Applied>,
  ): Promise<EventOutcome> {
    try {
      return await readCommittedTransaction(this.dataSource.manager, async tx => {
        const organization = await lockOrganizationForBilling(tx, organizationId);
        if (!organization) {
          return 'foreign_customer' as EventOutcome;
        }
        // Read after the lock: a second delivery that waited for the first sees its row
        if (await tx.exists(BillingEvent, { where: { id: event.id } })) {
          return 'duplicate' as EventOutcome;
        }
        const result = await work(tx, organization);
        const { outcome, detail } = typeof result === 'string' ? { outcome: result, detail: undefined } : result;
        await tx.insert(BillingEvent, {
          id: event.id,
          type: event.type,
          organizationId,
          outcome,
          detail: detail ? detail.slice(0, 255) : null,
          dateProcessed: new Date(),
        });
        return outcome;
      });
    } catch (error) {
      // The primary key, should two deliveries still meet: a duplicate only when the first one's row is there now. Any
      // other unique key failing is an error: answered 500, so Stripe sends the event again
      if (isDuplicateKey(error) && (await this.dataSource.manager.exists(BillingEvent, { where: { id: event.id } }))) {
        return 'duplicate';
      }
      throw error;
    }
  }

  /**
   * Writes the subscription's state to the organization: the plan and the extra seats from the lookup keys, the status,
   * the trial end (kept once set: a trial is given once), the period end, and since when it is past due. A second live
   * subscription of an organization that has one is canceled at once, and what it was paid is refunded (DESIGN §3.7,
   * backstop of one Checkout at a time: it may come after the trial was used, and then it was charged at once).
   */
  private async applySubscription(
    tx: EntityManager,
    organization: Organization,
    subscription: Stripe.Subscription,
    at: Date,
  ): Promise<EventOutcome | Applied> {
    if (idOf(subscription.customer) !== organization.stripeCustomerId) {
      return 'foreign_customer';
    }
    const bought = subscribedPlan((subscription.items?.data ?? []).map(item => ({ lookupKey: item.price?.lookup_key, quantity: item.quantity })));
    if (!bought) {
      return 'not_traduora';
    }
    const current = organization.stripeSubscriptionId;
    if (current && current !== subscription.id && isLiveStatus(organization.billingStatus)) {
      if (!isLiveStatus(subscription.status)) {
        // The end of a subscription that is not the organization's (the second one, canceled)
        return 'other_subscription';
      }
      const detail = await this.cancelAndRefund(subscription);
      this.logger.warn(`Second subscription of organization ${organization.id} (it has ${current}): ${detail}`);
      return { outcome: 'second_subscription_canceled', detail };
    }
    await writeBillingFields(tx, organization.id, subscriptionState(organization, subscription, bought, at));
    this.forgetPreviews(organization.id);
    return 'applied';
  }

  /**
   * The organization's stored session, always as Stripe has it now (the stored expiry is not trusted: a session paid
   * just before it would otherwise slip through): `complete` refuses (its subscription is on the way); an open one is
   * handed out again for the same order while it has a few minutes left, and is expired otherwise, so one Checkout is
   * open at a time.
   */
  private async openSession(stripe: StripeClient, organization: Organization, order: BillingOrder): Promise<string | null> {
    if (!organization.checkoutSessionId) {
      return null;
    }
    const session = await stripe.checkout.sessions.retrieve(organization.checkoutSessionId);
    if (session.status === 'complete') {
      throw new OrganizationException(HttpStatus.CONFLICT, 'subscription_exists', 'The organization has a subscription: change it instead');
    }
    if (session.status !== 'open') {
      return null;
    }
    const same =
      session.metadata?.plan === planLookupKey(order.plan, order.interval) &&
      session.metadata?.extraSeats === String(order.extraSeats) &&
      !!session.url &&
      (session.expires_at ?? 0) * 1000 - CHECKOUT_REUSE_MARGIN_MS > Date.now();
    if (same) {
      return session.url;
    }
    await this.expireSession(stripe, session.id);
    return null;
  }

  /** Expires a Checkout session; one that is no longer open (a parallel request expired it, or it was paid) is fine */
  private async expireSession(stripe: StripeClient, sessionId: string): Promise<void> {
    try {
      await stripe.checkout.sessions.expire(sessionId);
    } catch (error) {
      const session = await stripe.checkout.sessions.retrieve(sessionId);
      if (session.status === 'open') {
        throw error;
      }
    }
  }

  /**
   * Refuses a Checkout while the customer has a live Traduora subscription on Stripe, whether or not its webhook has
   * arrived yet (a session completed in another tab, a subscription made on the Dashboard).
   */
  private async assertNoLiveSubscription(stripe: StripeClient, customerId: string): Promise<void> {
    const subscriptions = await stripe.subscriptions.list({ customer: customerId, status: 'all', limit: 100 });
    const live = subscriptions.data.find(
      subscription =>
        isLiveStatus(subscription.status) &&
        !!subscribedPlan((subscription.items?.data ?? []).map(item => ({ lookupKey: item.price?.lookup_key, quantity: item.quantity }))),
    );
    if (live) {
      throw new OrganizationException(HttpStatus.CONFLICT, 'subscription_exists', 'The organization has a subscription: change it instead');
    }
  }

  /**
   * The backstop of one Checkout at a time: cancels the second subscription at once (no proration, no final invoice)
   * and refunds what its latest paid invoice took. Safe to run again (an event delivered again after a failure): a
   * canceled subscription is not canceled twice, and each refund has its idempotency key. Answers what was done.
   */
  private async cancelAndRefund(subscription: Stripe.Subscription): Promise<string> {
    if (subscription.status !== 'canceled') {
      await this.stripe.subscriptions.cancel(
        subscription.id,
        { prorate: false, invoice_now: false },
        { ...LOCKED_CALL, idempotencyKey: `traduora-cancel-second-${subscription.id}` },
      );
    }
    const [invoice] = (await this.stripe.invoices.list({ subscription: subscription.id, status: 'paid', limit: 1 }, LOCKED_CALL)).data;
    if (!invoice || !invoice.amount_paid) {
      return `canceled ${subscription.id}, nothing paid`;
    }
    const refunds: string[] = [];
    const payments = await this.stripe.invoicePayments.list({ invoice: invoice.id, status: 'paid', limit: 10 }, LOCKED_CALL);
    for (const payment of payments.data) {
      const paymentIntent = idOf(payment.payment?.payment_intent as string | { id: string } | undefined);
      const charge = idOf(payment.payment?.charge as string | { id: string } | undefined);
      if (!paymentIntent && !charge) {
        continue;
      }
      const refund = await this.stripe.refunds.create(
        { ...(paymentIntent ? { payment_intent: paymentIntent } : { charge }), reason: 'duplicate', metadata: { subscription: subscription.id } },
        { ...LOCKED_CALL, idempotencyKey: `traduora-refund-${invoice.id}-${payment.id}` },
      );
      refunds.push(refund.id);
    }
    return `canceled ${subscription.id}, refunded ${invoice.id} (${invoice.amount_paid} ${invoice.currency}): ${refunds.join(' ') || 'no payment found'}`;
  }

  private async createCustomer(stripe: StripeClient, organization: Organization, owner: User): Promise<string> {
    const params: Stripe.CustomerCreateParams = {
      name: organization.name,
      email: owner.email,
      metadata: { organizationId: organization.id, ever_product: 'traduora' },
    };
    const customer = await stripe.customers.create(params, { idempotencyKey: idempotencyKey('customer', organization.id, 0, params) });
    return customer.id;
  }

  /** Days of trial the next Checkout gives: once per organization, never after a trial or a subscription */
  private trialDays(organization: Organization): number {
    const days = Math.max(0, Math.floor(config.billing.trialDays || 0));
    return days > 0 && !organization.trialEndsAt && !organization.stripeSubscriptionId ? days : 0;
  }

  private validOrder(order: BillingOrderInput): BillingOrder {
    if (!isPaidPlan(order?.plan) || !isInterval(order?.interval)) {
      throw new BadRequestException('plan or interval invalid');
    }
    const extraSeats = order.extraSeats === undefined || order.extraSeats === null ? 0 : Number(order.extraSeats);
    if (!Number.isInteger(extraSeats) || extraSeats < 0 || extraSeats > MAX_EXTRA_SEATS) {
      throw new BadRequestException('extra seats invalid');
    }
    if (extraSeats > 0 && !sellsSeats(order.plan)) {
      throw new BadRequestException('extra seats are sold with Small Business only');
    }
    return { plan: order.plan, interval: order.interval, extraSeats };
  }

  private async locked(tx: EntityManager, organizationId: string): Promise<Organization> {
    const organization = await lockOrganizationForBilling(tx, organizationId);
    if (!organization) {
      throw new OrganizationException(HttpStatus.NOT_FOUND, 'organization_missing', 'organization not found');
    }
    return organization;
  }

  /** The Stripe prices of the order's lookup keys (kept a few minutes); 503 `billing_unavailable` when one is missing */
  private async pricesFor(order: BillingOrder): Promise<OrderPrices> {
    const planKey = planLookupKey(order.plan, order.interval);
    const seatKey = sellsSeats(order.plan) ? seatLookupKey(order.interval) : null;
    const byKey = await this.priceList();
    const plan = byKey.get(planKey);
    const seat = seatKey ? byKey.get(seatKey) : undefined;
    if (!plan || (seatKey && !seat)) {
      this.prices = undefined;
      throw new OrganizationException(HttpStatus.SERVICE_UNAVAILABLE, 'billing_unavailable', 'The price of this plan is not available');
    }
    return { plan, seat: seat ?? null, extraSeats: order.extraSeats };
  }

  /** The prices of every lookup key Traduora sells, by key, read from Stripe at most every few minutes */
  private async priceList(): Promise<Map<string, Stripe.Price>> {
    if (!this.prices || Date.now() - this.prices.readAt > PRICE_CACHE_MS) {
      const keys = [];
      for (const interval of Object.values(BillingInterval)) {
        keys.push(
          planLookupKey(OrganizationPlanCode.SmallBusiness, interval),
          planLookupKey(OrganizationPlanCode.Enterprise, interval),
          seatLookupKey(interval),
        );
      }
      const list = await this.client().prices.list({ lookup_keys: keys, active: true, limit: 10 });
      this.prices = { readAt: Date.now(), byKey: new Map(list.data.filter(price => price.lookup_key).map(price => [price.lookup_key, price])) };
    }
    return this.prices.byKey;
  }

  /** What the billing page shows of the prices: each plan and interval, with the seat price; empty when Stripe cannot tell */
  private async offers(): Promise<BillingView['offers']> {
    if (!this.enabled) {
      return [];
    }
    try {
      const byKey = await this.priceList();
      const amountOf = (key: string) => {
        const price = byKey.get(key);
        return price && typeof price.unit_amount === 'number' ? { amount: price.unit_amount, currency: price.currency } : null;
      };
      const offers: BillingView['offers'] = [];
      for (const plan of PAID_PLANS) {
        for (const interval of Object.values(BillingInterval)) {
          const price = amountOf(planLookupKey(plan, interval));
          if (price) {
            offers.push({ plan, interval, ...price, seatAmount: sellsSeats(plan) ? (amountOf(seatLookupKey(interval))?.amount ?? null) : null });
          }
        }
      }
      return offers;
    } catch (error) {
      this.logger.warn(`No prices from Stripe: ${error?.code ?? error?.message ?? 'error'}`);
      return [];
    }
  }

  /** The next invoice of the live subscription, as Stripe previews it; its date alone when the preview fails */
  private async nextInvoice(organization: Organization): Promise<BillingView['nextInvoice']> {
    const key = `${organization.id}:${organization.stripeSubscriptionId}:${organization.billingStatus}`;
    const cached = this.previews.get(key);
    if (cached && Date.now() - cached.readAt < PREVIEW_CACHE_MS) {
      return cached.value;
    }
    const value = await this.previewInvoice(organization);
    if (this.previews.size >= PREVIEW_CACHE_SIZE) {
      this.previews.delete(this.previews.keys().next().value);
    }
    this.previews.set(key, { readAt: Date.now(), value });
    return value;
  }

  /** Drops the organization's cached invoice previews: its subscription changed */
  private forgetPreviews(organizationId: string): void {
    for (const key of [...this.previews.keys()]) {
      if (key.startsWith(`${organizationId}:`)) {
        this.previews.delete(key);
      }
    }
  }

  private async previewInvoice(organization: Organization): Promise<BillingView['nextInvoice']> {
    const date = iso(
      organization.billingStatus === 'trialing' && organization.trialEndsAt ? organization.trialEndsAt : organization.currentPeriodEnd,
    );
    try {
      const preview = await this.stripe.invoices.createPreview({
        customer: organization.stripeCustomerId,
        subscription: organization.stripeSubscriptionId,
      });
      return {
        date: iso(fromEpochSeconds(preview.next_payment_attempt ?? preview.period_end)) ?? date,
        amount: preview.amount_due,
        currency: preview.currency,
      };
    } catch (error) {
      this.logger.warn(`No invoice preview for organization ${organization.id}: ${error?.code ?? error?.message ?? 'error'}`);
      return { date, amount: null, currency: null };
    }
  }
}

export interface OrderPrices {
  plan: Stripe.Price;
  seat: Stripe.Price | null;
  extraSeats: number;
}

function iso(value: Date | string | null | undefined): string | null {
  if (!value) {
    return null;
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

/**
 * An idempotency key of a Stripe call: what it is, the organization, the attempt, and a short hash of every parameter
 * sent. A retry of the same request finds Stripe's first answer; a request that differs in anything (the slug in the
 * return URL, the trial days, the owner's name or e-mail) is a new one, instead of an idempotency error.
 */
export function idempotencyKey(kind: string, organizationId: string, attempt: number, params: unknown): string {
  const hash = createHash('sha256').update(JSON.stringify(params)).digest('hex').slice(0, 16);
  return `traduora-${kind}-${organizationId}-${attempt}-${hash}`;
}

/**
 * The subscription of an invoice: `parent.subscription_details.subscription` since API version 2025-03-31, the top-level
 * `subscription` of an older version (an endpoint pinned to one, or an event replayed from before the upgrade).
 */
/** The items of a subscription as the plan is read from them */
export function pricedItems(subscription: Stripe.Subscription): Array<{ lookupKey: string | null; quantity?: number }> {
  return (subscription.items?.data ?? []).map(item => ({ lookupKey: item.price?.lookup_key ?? null, quantity: item.quantity }));
}

export function invoiceSubscriptionId(invoice: Stripe.Invoice): string | null {
  const legacy = (invoice as Stripe.Invoice & { subscription?: string | { id: string } | null }).subscription;
  return idOf(invoice.parent?.subscription_details?.subscription) ?? idOf(legacy);
}

/** The organization's billing page on the web app, where Checkout and the portal come back to */
function billingPageUrl(organization: Pick<Organization, 'slug'>, query?: string): string {
  const base = config.virtualHost.replace(/\/+$/, '');
  return `${base}/orgs/${encodeURIComponent(organization.slug)}/billing${query ? `?${query}` : ''}`;
}

/** The billing fields for a subscription's state (see `applySubscription`) */
export function subscriptionState(organization: Organization, subscription: Stripe.Subscription, bought: SubscribedPlan, at: Date): BillingFields {
  const status = subscription.status;
  const grants = GRANTING_STATUSES.has(status);
  const periodEnds = (subscription.items?.data ?? []).map(item => item.current_period_end).filter(value => typeof value === 'number');
  const pastDue = status === 'past_due';
  return {
    planCode: grants ? bought.planCode : OrganizationPlanCode.Starter,
    stripeSubscriptionId: subscription.id,
    billingStatus: status,
    billingInterval: bought.interval,
    extraSeats: grants ? bought.extraSeats : 0,
    trialEndsAt: fromEpochSeconds(subscription.trial_end) ?? organization.trialEndsAt ?? null,
    currentPeriodEnd: periodEnds.length ? fromEpochSeconds(Math.max(...periodEnds)) : null,
    pastDueSince: pastDue ? (organization.billingStatus === 'past_due' && organization.pastDueSince ? organization.pastDueSince : at) : null,
    // A live subscription needs no Checkout any more
    ...(grants ? { checkoutSessionId: null, checkoutExpiresAt: null } : {}),
  };
}

/** The items of a subscription update that bring it to the order: the plan price swapped, the seat price set or removed */
export function subscriptionChanges(subscription: Stripe.Subscription, prices: OrderPrices): Stripe.SubscriptionUpdateParams.Item[] {
  const items = subscription.items?.data ?? [];
  const planItem = items.find(item => isPlanLookupKey(item.price?.lookup_key));
  if (!planItem) {
    throw new OrganizationException(HttpStatus.CONFLICT, 'no_subscription', 'The organization has no subscription: start one with Checkout');
  }
  const changes: Stripe.SubscriptionUpdateParams.Item[] = [];
  if (planItem.price.id !== prices.plan.id) {
    changes.push({ id: planItem.id, price: prices.plan.id, quantity: 1 });
  }
  const [seatItem, ...others] = items.filter(item => isSeatLookupKey(item.price?.lookup_key));
  others.forEach(item => changes.push({ id: item.id, deleted: true }));
  if (prices.seat && prices.extraSeats > 0) {
    if (!seatItem) {
      changes.push({ price: prices.seat.id, quantity: prices.extraSeats });
    } else if (seatItem.price.id !== prices.seat.id || seatItem.quantity !== prices.extraSeats) {
      changes.push({ id: seatItem.id, price: prices.seat.id, quantity: prices.extraSeats });
    }
  } else if (seatItem) {
    changes.push({ id: seatItem.id, deleted: true });
  }
  return changes;
}

/**
 * The Checkout session of an order (DESIGN §3.7): subscription mode on the organization's customer, the organization in
 * `client_reference_id` and the metadata, the plan price, the extra seats as a second line item (or offered as an
 * optional one when none were asked for), the trial, a card, Stripe Tax and the billing address. Nothing in it depends
 * on the time, so a retry with the same idempotency key sends the same request. Sessions stay open Stripe's default
 * 24 hours and are handed out again meanwhile.
 */
export function checkoutSessionParams(
  organization: Pick<Organization, 'id' | 'slug'>,
  customer: string,
  prices: Pick<OrderPrices, 'plan' | 'seat'>,
  order: BillingOrder,
  trialDays: number,
  automaticTax: boolean,
): Stripe.Checkout.SessionCreateParams & { metadata: { organizationId: string; plan: string; extraSeats: string } } {
  const lineItems: Stripe.Checkout.SessionCreateParams.LineItem[] = [{ price: prices.plan.id, quantity: 1 }];
  const optionalItems: Stripe.Checkout.SessionCreateParams.OptionalItem[] = [];
  if (prices.seat && order.extraSeats > 0) {
    lineItems.push({
      price: prices.seat.id,
      quantity: order.extraSeats,
      adjustable_quantity: { enabled: true, minimum: 0, maximum: MAX_EXTRA_SEATS },
    });
  } else if (prices.seat) {
    // No extra seats asked for: the seat price is offered, and the owner may add some on the Checkout page
    optionalItems.push({ price: prices.seat.id, quantity: 1, adjustable_quantity: { enabled: true, minimum: 1, maximum: MAX_EXTRA_SEATS } });
  }
  return {
    mode: 'subscription',
    customer,
    // Stripe Tax reads the billing address that Checkout collects onto the customer
    customer_update: { address: 'auto' },
    client_reference_id: organization.id,
    metadata: { organizationId: organization.id, plan: planLookupKey(order.plan, order.interval), extraSeats: String(order.extraSeats) },
    line_items: lineItems,
    ...(optionalItems.length ? { optional_items: optionalItems } : {}),
    subscription_data: {
      metadata: { organizationId: organization.id },
      ...(trialDays > 0 ? { trial_period_days: trialDays } : {}),
    },
    payment_method_collection: 'always',
    automatic_tax: { enabled: automaticTax },
    billing_address_collection: 'required',
    success_url: billingPageUrl(organization, 'checkout=success'),
    cancel_url: billingPageUrl(organization, 'checkout=canceled'),
  };
}
