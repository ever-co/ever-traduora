import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsInt, IsOptional, Max, Min } from 'class-validator';
import { OrganizationPlanCode } from '../domain/organization-actions';
import { BillingInterval, MAX_EXTRA_SEATS, PAID_PLANS } from './billing-plans';

const INTERVALS = Object.values(BillingInterval);

/** `POST /organizations/:id/billing/checkout`: the plan to subscribe to */
export class CheckoutRequest {
  @ApiProperty({ enum: PAID_PLANS })
  @IsIn(PAID_PLANS as OrganizationPlanCode[])
  plan: OrganizationPlanCode;

  @ApiProperty({ enum: INTERVALS })
  @IsIn(INTERVALS)
  interval: BillingInterval;

  @ApiPropertyOptional({ description: 'Seats bought on top of the plan (Small Business only)', minimum: 0, maximum: MAX_EXTRA_SEATS })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(MAX_EXTRA_SEATS)
  extraSeats?: number;
}

/** `PATCH /organizations/:id/billing/subscription`: the plan, interval and extra seats the live subscription should have */
export class ChangeSubscriptionRequest extends CheckoutRequest {}

class SubscriptionChange {
  @ApiProperty({ description: 'The change waits for the payment of its invoice; the plan stays as it was until then' })
  pending: boolean;
}

export class SubscriptionChangeResponse {
  @ApiProperty({ type: SubscriptionChange })
  data: SubscriptionChange;
}

export class BillingRedirect {
  @ApiProperty({ description: 'The Stripe page to send the owner to (Checkout or the customer portal)' })
  url: string;
}

export class BillingRedirectResponse {
  @ApiProperty({ type: BillingRedirect })
  data: BillingRedirect;
}

class BillingPlanView {
  @ApiProperty({ enum: Object.values(OrganizationPlanCode) })
  code: string;

  @ApiProperty()
  name: string;
}

class BillingSeatsView {
  @ApiProperty({ description: 'Members plus people with a pending invitation' })
  used: number;

  @ApiProperty({ nullable: true, description: "The plan's own seats; null is unlimited" })
  included: number | null;

  @ApiProperty({ description: 'Seats bought on top of the plan' })
  bought: number;

  @ApiProperty({ nullable: true, description: 'included + bought; null is unlimited' })
  limit: number | null;
}

class BillingInvoiceView {
  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  date: string | null;

  @ApiProperty({ nullable: true, description: 'In the smallest unit of the currency (cents); null when Stripe could not tell' })
  amount: number | null;

  @ApiProperty({ nullable: true })
  currency: string | null;
}

class BillingOfferView {
  @ApiProperty({ enum: PAID_PLANS })
  plan: string;

  @ApiProperty({ enum: INTERVALS })
  interval: string;

  @ApiProperty({ description: 'The price of the interval, in the smallest unit of the currency (cents)' })
  amount: number;

  @ApiProperty()
  currency: string;

  @ApiProperty({ nullable: true, description: 'The price of one extra seat for the interval; null for a plan that sells none' })
  seatAmount: number | null;
}

export class BillingView {
  @ApiProperty({ description: 'Whether billing is set up on this installation' })
  enabled: boolean;

  @ApiProperty({ type: BillingPlanView, description: 'The plan whose limits apply now (Starter once a subscription lapsed)' })
  plan: BillingPlanView;

  @ApiProperty({ type: BillingPlanView, description: 'The plan the subscription buys' })
  subscribedPlan: BillingPlanView;

  @ApiProperty({ nullable: true, description: "Stripe's status of the subscription; null without one" })
  status: string | null;

  @ApiProperty({ nullable: true, enum: INTERVALS })
  interval: string | null;

  @ApiProperty({ type: BillingSeatsView })
  seats: BillingSeatsView;

  @ApiProperty({ type: String, format: 'date-time', nullable: true, description: 'While the subscription is in its trial' })
  trialEndsAt: string | null;

  @ApiProperty({ type: String, format: 'date-time', nullable: true, description: 'Past due since; the plan lapses to Starter after the grace' })
  pastDueSince: string | null;

  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  graceEndsAt: string | null;

  @ApiProperty({ type: BillingInvoiceView, nullable: true })
  nextInvoice: BillingInvoiceView | null;

  @ApiProperty({ type: [BillingOfferView], description: "The plans on sale, with Stripe's prices; empty when billing is off" })
  offers: BillingOfferView[];

  @ApiProperty({ description: 'Whether a trial comes with the next Checkout (once per organization)' })
  trialAvailable: boolean;

  @ApiProperty()
  trialDays: number;

  @ApiProperty({ description: 'The caller is the owner: Checkout, the portal and changes are theirs' })
  canManage: boolean;

  @ApiProperty({ description: 'A live subscription exists: changes go through the subscription and the portal, not a new Checkout' })
  subscribed: boolean;

  @ApiProperty({ description: 'The customer portal can be opened (the organization has a Stripe customer)' })
  portalAvailable: boolean;
}

export class BillingViewResponse {
  @ApiProperty({ type: BillingView })
  data: BillingView;
}
