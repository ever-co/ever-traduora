import { BadRequestException, HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import { createHash } from 'crypto';
import { DataSource, EntityManager } from 'typeorm';
import Stripe = require('stripe');
import { config } from '../config';
import { OrganizationPlanCode, OrganizationRole } from '../domain/organization-actions';
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

/** A subscription in these states is the organization's: no second Checkout while one exists (DESIGN §3.7) */
const LIVE_STATUSES: ReadonlySet<string> = new Set(['trialing', 'active', 'past_due', 'unpaid', 'incomplete', 'paused']);

/** A subscription in these states gives the organization its plan (`effectivePlan` then lapses `unpaid` and a long `past_due`) */
const GRANTING_STATUSES: ReadonlySet<string> = new Set(['trialing', 'active', 'past_due', 'unpaid']);

const DAY_MS = 24 * 60 * 60 * 1000;

/** How long the prices of the lookup keys are kept before they are read again */
const PRICE_CACHE_MS = 10 * 60 * 1000;

/** An open session that expires sooner than this is not handed out again */
const CHECKOUT_REUSE_MARGIN_MS = 5 * 60 * 1000;

export function isLiveStatus(status: string | null | undefined): boolean {
  return !!status && LIVE_STATUSES.has(status);
}

/** The order of a Checkout or of a change: what the subscription should buy */
export interface BillingOrder {
  plan: OrganizationPlanCode;
  interval: BillingInterval;
  extraSeats: number;
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
   * subscription is changed instead). One Checkout at a time: the organization's row is locked; an open session for the
   * same order is handed out again, one for another order is expired first; the Stripe call carries an idempotency key
   * from the organization, the prices and the stored attempt counter.
   */
  async checkout(organizationId: string, owner: User, order: BillingOrderInput): Promise<{ url: string }> {
    const stripe = this.client();
    const wanted = this.validOrder(order);
    const prices = await this.pricesFor(wanted);
    return readCommittedTransaction(this.dataSource.manager, async tx => {
      const organization = await this.locked(tx, organizationId);
      if (isLiveStatus(organization.billingStatus) && organization.stripeSubscriptionId) {
        throw new OrganizationException(HttpStatus.CONFLICT, 'subscription_exists', 'The organization has a subscription: change it instead');
      }
      const reused = await this.openSession(stripe, organization, wanted);
      if (reused) {
        return { url: reused };
      }
      const customer = organization.stripeCustomerId || (await this.createCustomer(stripe, organization, owner));
      const attempt = (organization.checkoutAttempt || 0) + 1;
      const trialDays = this.trialDays(organization);
      const params = checkoutSessionParams(organization, customer, prices, wanted, trialDays, config.billing.automaticTax);
      const session = await stripe.checkout.sessions.create(params, {
        idempotencyKey: idempotencyKey('checkout', organization.id, attempt, params),
      });
      if (!session.url) {
        throw new OrganizationException(HttpStatus.SERVICE_UNAVAILABLE, 'billing_unavailable', 'Stripe did not open a Checkout page');
      }
      await writeBillingFields(tx, organization.id, {
        stripeCustomerId: customer,
        checkoutSessionId: session.id,
        checkoutExpiresAt: fromEpochSeconds(session.expires_at),
        checkoutAttempt: attempt,
      });
      return { url: session.url };
    });
  }

  /**
   * Changes the live subscription to the order (owner): the plan or its interval (the plan price is swapped), and the
   * extra seats (the seat price's quantity, added or removed). Stripe prorates; a trial keeps running. The state Stripe
   * answers is written at once, as the webhook would.
   */
  async changeSubscription(organizationId: string, order: BillingOrderInput): Promise<void> {
    const stripe = this.client();
    const wanted = this.validOrder(order);
    const prices = await this.pricesFor(wanted);
    await readCommittedTransaction(this.dataSource.manager, async tx => {
      const organization = await this.locked(tx, organizationId);
      if (!isLiveStatus(organization.billingStatus) || !organization.stripeSubscriptionId) {
        throw new OrganizationException(HttpStatus.CONFLICT, 'no_subscription', 'The organization has no subscription: start one with Checkout');
      }
      const subscription = await stripe.subscriptions.retrieve(organization.stripeSubscriptionId);
      if (idOf(subscription.customer) !== organization.stripeCustomerId) {
        throw new OrganizationException(HttpStatus.CONFLICT, 'no_subscription', 'The organization has no subscription: start one with Checkout');
      }
      const items = subscriptionChanges(subscription, prices);
      if (items.length) {
        const updated = await stripe.subscriptions.update(subscription.id, { items, proration_behavior: 'create_prorations' });
        await this.applySubscription(tx, organization, updated, new Date());
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
      const subscription = await stripe.subscriptions.retrieve(subscriptionId);
      return this.applySubscription(tx, { ...organization, ...fields } as Organization, subscription, at);
    });
  }

  /**
   * A subscription event, or an invoice of a subscription: the organization is the one whose customer it is, and the
   * subscription is read again from Stripe under the organization's lock, so events that arrive out of order still
   * leave the latest state.
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
      return this.applySubscription(tx, organization, await stripe.subscriptions.retrieve(subscriptionId), at);
    });
  }

  /**
   * Runs `work` for the event under the organization's lock and records the event with what it did, in one
   * transaction. An event recorded already changes nothing.
   */
  private async applyEvent(
    event: Stripe.Event,
    organizationId: string,
    work: (tx: EntityManager, organization: Organization) => Promise<EventOutcome>,
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
        const outcome = await work(tx, organization);
        await tx.insert(BillingEvent, { id: event.id, type: event.type, organizationId, outcome, dateProcessed: new Date() });
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
   * subscription of an organization that has one is canceled at once (DESIGN §3.7, backstop of one Checkout at a time).
   */
  private async applySubscription(tx: EntityManager, organization: Organization, subscription: Stripe.Subscription, at: Date): Promise<EventOutcome> {
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
      await this.stripe.subscriptions.cancel(subscription.id, { prorate: false, invoice_now: false });
      this.logger.warn(`Canceled a second subscription ${subscription.id} of organization ${organization.id} (it has ${current})`);
      return 'second_subscription_canceled';
    }
    await writeBillingFields(tx, organization.id, subscriptionState(organization, subscription, bought, at));
    return 'applied';
  }

  /** The open session of the organization for this order, handed out again; one for another order is expired */
  private async openSession(stripe: StripeClient, organization: Organization, order: BillingOrder): Promise<string | null> {
    if (!organization.checkoutSessionId) {
      return null;
    }
    const expiresAt = organization.checkoutExpiresAt ? new Date(organization.checkoutExpiresAt).getTime() : 0;
    if (expiresAt - CHECKOUT_REUSE_MARGIN_MS <= Date.now()) {
      return null;
    }
    const session = await stripe.checkout.sessions.retrieve(organization.checkoutSessionId);
    if (session.status === 'complete') {
      // Its subscription is on the way (the webhook); a second one would be canceled anyway
      throw new OrganizationException(HttpStatus.CONFLICT, 'subscription_exists', 'The organization has a subscription: change it instead');
    }
    if (session.status !== 'open') {
      return null;
    }
    const same =
      session.metadata?.plan === planLookupKey(order.plan, order.interval) &&
      session.metadata?.extraSeats === String(order.extraSeats) &&
      !!session.url;
    if (same) {
      return session.url;
    }
    await stripe.checkout.sessions.expire(session.id);
    return null;
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
