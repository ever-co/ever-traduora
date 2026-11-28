import { ModuleRef } from '@nestjs/core';
import { Organization } from '../../entity/organization.entity';

/**
 * What an organization's deletion asks of billing (DESIGN §3.9, step 1): end the organization's subscription before
 * its data goes. Billing (P4) provides it under `BILLING_CANCELLATION`; an installation without billing has none, and
 * the deletion goes on without it ({@link NO_BILLING_CANCELLATION}).
 *
 * The call comes before the deletion's transaction and outside it (it may call Stripe): it throws to stop the deletion,
 * and nothing is deleted then. It must be safe to call again for an organization whose subscription has already ended
 * (a deletion that failed after it can be sent again), and do nothing for one that never had a subscription.
 */
export interface BillingCancellation {
  cancelForDeletion(organization: Organization): Promise<void>;
}

/** The provider token P4's billing module registers its `BillingCancellation` under. */
export const BILLING_CANCELLATION = 'traduora:billing:cancellation';

/** No billing on this installation: nothing to cancel. */
export const NO_BILLING_CANCELLATION: BillingCancellation = Object.freeze({
  cancelForDeletion: async () => undefined,
});

/**
 * The billing module's cancellation when it is loaded (looked up across modules, as the access guard finds the operator
 * check), else {@link NO_BILLING_CANCELLATION}.
 */
export function billingCancellation(moduleRef: ModuleRef | undefined): BillingCancellation {
  if (!moduleRef) {
    return NO_BILLING_CANCELLATION;
  }
  try {
    return moduleRef.get<BillingCancellation>(BILLING_CANCELLATION, { strict: false }) ?? NO_BILLING_CANCELLATION;
  } catch {
    return NO_BILLING_CANCELLATION;
  }
}

/** Cancels the subscriptions of these organizations, one after another; the first failure stops the deletion. */
export async function cancelSubscriptions(moduleRef: ModuleRef | undefined, organizations: ReadonlyArray<Organization>): Promise<void> {
  const billing = billingCancellation(moduleRef);
  for (const organization of organizations) {
    await billing.cancelForDeletion(organization);
  }
}
