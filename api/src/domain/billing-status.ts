/**
 * Stripe's subscription statuses as Traduora reads them (DESIGN §3.7). A subscription in a live status is the
 * organization's: no second Checkout while it exists, and the organization is not closed under it (an account deletion
 * would leave Stripe charging an organization nobody can reach).
 */
const LIVE_STATUSES: ReadonlySet<string> = new Set(['trialing', 'active', 'past_due', 'unpaid', 'incomplete', 'paused']);

export function isLiveStatus(status: string | null | undefined): boolean {
  return !!status && LIVE_STATUSES.has(status);
}

/** Whether the organization holds a live Stripe subscription */
export function hasLiveSubscription(
  organization: { billingStatus?: string | null; stripeSubscriptionId?: string | null } | null | undefined,
): boolean {
  return !!organization?.stripeSubscriptionId && isLiveStatus(organization.billingStatus);
}
