import { EntityManager } from 'typeorm';
import { OrganizationUser } from '../../entity/organization-user.entity';
import { Organization } from '../../entity/organization.entity';
import { lockOrganization } from './organization-membership';
import { membershipOf } from './organization-scope';

/**
 * The organization reads and writes of billing (`api/src/billing/`, DESIGN §3.7), here so that nothing outside
 * `services/organization/` reaches the organizations directly (§3.4, layer 3). Nothing here checks who may do what: the
 * routes are authorized first (`@Access('organization:…')`), and the webhook is verified by its signature.
 */

/** The billing fields of an organization, as the billing module writes them */
export type BillingFields = Partial<
  Pick<
    Organization,
    | 'planCode'
    | 'stripeCustomerId'
    | 'stripeSubscriptionId'
    | 'billingStatus'
    | 'billingInterval'
    | 'extraSeats'
    | 'trialEndsAt'
    | 'currentPeriodEnd'
    | 'pastDueSince'
    | 'checkoutSessionId'
    | 'checkoutExpiresAt'
    | 'checkoutAttempt'
  >
>;

/** The caller's membership of the organization, with the organization, for a billing route the guard let through */
export function billingMembership(manager: EntityManager, organizationId: string, userId: string): Promise<OrganizationUser | null> {
  return membershipOf(manager, organizationId, userId, { withOrganization: true });
}

/** The id of the organization whose Stripe customer this is, read without a lock; null for a customer of no organization */
export async function organizationOfCustomer(manager: EntityManager, customerId: string): Promise<string | null> {
  if (!customerId) {
    return null;
  }
  const organization = await manager.findOne(Organization, { where: { stripeCustomerId: customerId }, select: { id: true } });
  return organization?.id ?? null;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Whether an organization with this id exists, read without a lock. Anything that is no uuid is none (another product's
 * reference in a Stripe event): PostgreSQL would refuse to compare it with the uuid column.
 */
export async function organizationExists(manager: EntityManager, organizationId: unknown): Promise<boolean> {
  if (typeof organizationId !== 'string' || !UUID.test(organizationId)) {
    return false;
  }
  return manager.exists(Organization, { where: { id: organizationId } });
}

/**
 * Locks the organization's row for a billing change and answers it as it is under the lock (`lockOrganization`: FOR NO
 * KEY UPDATE on PostgreSQL, FOR UPDATE on MySQL; SQLite runs one transaction at a time). Billing takes no other lock, so
 * the global order (account → projects → organization) holds.
 */
export function lockOrganizationForBilling(tx: EntityManager, organizationId: string): Promise<Organization | null> {
  return lockOrganization(tx, organizationId);
}

/** Writes billing fields of the organization, in the caller's transaction (under its lock) */
export async function writeBillingFields(tx: EntityManager, organizationId: string, fields: BillingFields): Promise<void> {
  if (Object.keys(fields).length > 0) {
    await tx.update(Organization, { id: organizationId }, fields);
  }
}
