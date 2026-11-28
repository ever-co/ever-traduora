import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import { AccessTimestamps } from './base';
import { OrganizationPlanCode, OrganizationStatus } from '../domain/organization-actions';
import { NumberColumnType, TimeColumnType } from '../utils/database-type-helper';

/**
 * The tenant: an organization owns projects, and people are its members (`OrganizationUser`). A single-tenant install
 * has exactly one, the default organization (`isDefault`), which the migration made for the existing data.
 */
@Entity()
export class Organization {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 255 })
  name: string;

  @Index({ unique: true })
  @Column({ type: 'varchar', length: 40 })
  slug: string;

  @Column({ type: 'varchar', length: 16, default: OrganizationStatus.Active })
  status: OrganizationStatus;

  @Column({ type: 'varchar', length: 32, default: OrganizationPlanCode.Starter })
  planCode: OrganizationPlanCode;

  @Column({ default: false })
  isDefault: boolean;

  /**
   * Whether the owner and the admins are implicit admins of every project of the organization (DESIGN §3.2, OD-T9).
   * True for organizations made in SaaS mode (sign-up, POST /organizations); false for the default organization, whose
   * people keep exactly the project access they had before organizations existed.
   */
  @Column({ default: false })
  adminsSeeAllProjects: boolean;

  /** Cached counters (DESIGN §3.6): members plus pending organization invites. */
  @Column(NumberColumnType.integer(0))
  seatsUsed: number;

  /** Cached counters (DESIGN §3.6): the sum over the projects of locales × terms. */
  @Column(NumberColumnType.integer(0))
  stringsUsed: number;

  // Billing (DESIGN §3.7, §4.1, P4): written only from Stripe's own state (Checkout, the webhook), never sent by a
  // client. The Stripe ids stay on the server: no API answer carries them.

  /** The Stripe customer of the organization, made by the first Checkout */
  @Index('UQ_organization_stripe_customer_id', { unique: true })
  @Column({ type: 'varchar', length: 255, nullable: true })
  stripeCustomerId: string | null;

  /** The organization's subscription (the live one; the last one once it ended) */
  @Column({ type: 'varchar', length: 255, nullable: true })
  stripeSubscriptionId: string | null;

  /** Stripe's status of that subscription (`trialing`, `active`, `past_due`, `canceled`, …); null without one */
  @Column({ type: 'varchar', length: 32, nullable: true })
  billingStatus: string | null;

  /** `monthly` or `annual` */
  @Column({ type: 'varchar', length: 16, nullable: true })
  billingInterval: string | null;

  /** Seats bought on top of the plan's (Small Business), from the seat price's quantity */
  @Column(NumberColumnType.integer(0))
  extraSeats: number;

  /** The end of the organization's trial; set once a trial started, never cleared, so a trial is given once */
  @Column(TimeColumnType.date())
  trialEndsAt: Date | null;

  /** The end of the subscription's current period: the next invoice */
  @Column(TimeColumnType.date())
  currentPeriodEnd: Date | null;

  /** Since when the subscription is past due; null otherwise (the grace of OD-T14 counts from here) */
  @Column(TimeColumnType.date())
  pastDueSince: Date | null;

  /** The open Checkout session, reused until it expires: one Checkout at a time (DESIGN §3.7) */
  @Column({ type: 'varchar', length: 255, nullable: true })
  checkoutSessionId: string | null;

  @Column(TimeColumnType.date())
  checkoutExpiresAt: Date | null;

  /** Checkout sessions made so far: part of the idempotency key of the next one */
  @Column(NumberColumnType.integer(0))
  checkoutAttempt: number;

  @Column(type => AccessTimestamps)
  date: AccessTimestamps;
}
