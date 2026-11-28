import { BadRequestException, HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
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
  MAX_EXTRA_SEATS,
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

/** How long a Checkout session stays open (Stripe allows 30 minutes to 24 hours) */
const CHECKOUT_OPEN_SECONDS = 60 * 60;

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
      const lineItems: Stripe.Checkout.SessionCreateParams.LineItem[] = [{ price: prices.plan.id, quantity: 1 }];
      const optionalItems: Stripe.Checkout.SessionCreateParams.OptionalItem[] = [];
      if (prices.seat && wanted.extraSeats > 0) {
        lineItems.push({
          price: prices.seat.id,
          quantity: wanted.extraSeats,
          adjustable_quantity: { enabled: true, minimum: 0, maximum: MAX_EXTRA_SEATS },
        });
      } else if (prices.seat) {
        // No extra seats asked for: the seat price is offered, and the owner may add some on the Checkout page
        optionalItems.push({ price: prices.seat.id, quantity: 1, adjustable_quantity: { enabled: true, minimum: 1, maximum: MAX_EXTRA_SEATS } });
      }
      const orderMetadata = { organizationId: organization.id, plan: planLookupKey(wanted.plan, wanted.interval), extraSeats: String(wanted.extraSeats) };
      const session = await stripe.checkout.sessions.create(
        {
          mode: 'subscription',
          customer,
          // Stripe Tax reads the billing address Checkout collects from the customer
          customer_update: { address: 'auto' },
          client_reference_id: organization.id,
          metadata: orderMetadata,
          line_items: lineItems,
          ...(optionalItems.length ? { optional_items: optionalItems } : {}),
          subscription_data: {
            metadata: { organizationId: organization.id },
            ...(trialDays > 0 ? { trial_period_days: trialDays } : {}),
          },
          payment_method_collection: 'always',
          automatic_tax: { enabled: config.billing.automaticTax },
          billing_address_collection: 'required',
          expires_at: Math.floor(Date.now() / 1000) + CHECKOUT_OPEN_SECONDS,
          success_url: billingPageUrl(organization, 'checkout=success'),
          cancel_url: billingPageUrl(organization, 'checkout=canceled'),
        },
        { idempotencyKey: `traduora-checkout-${organization.id}-${orderMetadata.plan}-${wanted.extraSeats}-${attempt}` },
      );
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
      const items = this.changedItems(subscription, prices);
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
      throw new OrganizationException(HttpStatus.CONFLICT, 'billing_account_missing', 'The organization has no billing account yet: start with Checkout');
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
        const subscriptionId = idOf(invoice.parent?.subscription_details?.subscription);
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
      // The primary key, should two deliveries still meet: the first one applied it
      if (isDuplicateKey(error)) {
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

  /** The items of a subscription update that bring it to the order: the plan price swapped, the seat price set */
  private changedItems(subscription: Stripe.Subscription, prices: OrderPrices): Stripe.SubscriptionUpdateParams.Item[] {
    const items = subscription.items?.data ?? [];
    const changes: Stripe.SubscriptionUpdateParams.Item[] = [];
    const planItem = items.find(item => /^ever_traduora_cloud_/.test(item.price?.lookup_key ?? ''));
    if (!planItem) {
      throw new OrganizationException(HttpStatus.CONFLICT, 'no_subscription', 'The organization has no subscription: start one with Checkout');
    }
    if (planItem.price.id !== prices.plan.id) {
      changes.push({ id: planItem.id, price: prices.plan.id, quantity: 1 });
    }
    const seatItems = items.filter(item => /^seat_ever_traduora_cloud_/.test(item.price?.lookup_key ?? ''));
    const [seatItem, ...extra] = seatItems;
    extra.forEach(item => changes.push({ id: item.id, deleted: true }));
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
      session.metadata?.plan === planLookupKey(order.plan, order.interval) && session.metadata?.extraSeats === String(order.extraSeats) && !!session.url;
    if (same) {
      return session.url;
    }
    await stripe.checkout.sessions.expire(session.id);
    return null;
  }

  private async createCustomer(stripe: StripeClient, organization: Organization, owner: User): Promise<string> {
    const customer = await stripe.customers.create(
      {
        name: organization.name,
        email: owner.email,
        metadata: { organizationId: organization.id, ever_product: 'traduora' },
      },
      { idempotencyKey: `traduora-customer-${organization.id}` },
    );
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
    if (!this.prices || Date.now() - this.prices.readAt > PRICE_CACHE_MS) {
      const keys = [];
      for (const interval of Object.values(BillingInterval)) {
        keys.push(planLookupKey(OrganizationPlanCode.SmallBusiness, interval), planLookupKey(OrganizationPlanCode.Enterprise, interval), seatLookupKey(interval));
      }
      const list = await this.client().prices.list({ lookup_keys: keys, active: true, limit: 10 });
      this.prices = { readAt: Date.now(), byKey: new Map(list.data.filter(price => price.lookup_key).map(price => [price.lookup_key, price])) };
    }
    const plan = this.prices.byKey.get(planKey);
    const seat = seatKey ? this.prices.byKey.get(seatKey) : undefined;
    if (!plan || (seatKey && !seat)) {
      this.prices = undefined;
      throw new OrganizationException(HttpStatus.SERVICE_UNAVAILABLE, 'billing_unavailable', 'The price of this plan is not available');
    }
    return { plan, seat: seat ?? null, extraSeats: order.extraSeats };
  }

  /** The next invoice of the live subscription, as Stripe previews it; its date alone when the preview fails */
  private async nextInvoice(organization: Organization): Promise<BillingView['nextInvoice']> {
    const date = iso(organization.billingStatus === 'trialing' && organization.trialEndsAt ? organization.trialEndsAt : organization.currentPeriodEnd);
    try {
      const preview = await this.stripe.invoices.createPreview({
        customer: organization.stripeCustomerId,
        subscription: organization.stripeSubscriptionId,
      });
      return { date: iso(fromEpochSeconds(preview.next_payment_attempt ?? preview.period_end)) ?? date, amount: preview.amount_due, currency: preview.currency };
    } catch (error) {
      this.logger.warn(`No invoice preview for organization ${organization.id}: ${error?.code ?? error?.message ?? 'error'}`);
      return { date, amount: null, currency: null };
    }
  }
}

interface OrderPrices {
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
