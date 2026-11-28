import { Logger } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { EntityManager, In } from 'typeorm';
import { BillingCancellationStatus, OrganizationBillingCancellation } from '../../entity/organization-billing-cancellation.entity';
import { Organization } from '../../entity/organization.entity';

/**
 * What an organization's deletion asks of billing (DESIGN §3.9, step 1): end the organization's subscription. Billing
 * (P4) provides it under `BILLING_CANCELLATION`; an installation without billing has none, and nothing is cancelled
 * ({@link NO_BILLING_CANCELLATION}).
 *
 * The deletion never calls it inside its transaction, nor before it: the transaction deletes the data and queues the
 * cancellation in the same commit (`queueBillingCancellation`, an outbox row), so a deletion that is refused or rolled
 * back cancels nothing. After the commit the cancellation is tried, with retries (`settleBillingCancellations`); one
 * that keeps failing stays `failed` for the operators, who try it again from the console. So `cancelForDeletion`:
 * - gets the organization as it is then, a `deleted` tombstone that still holds billing's own columns;
 * - must be idempotent: it may run again for an organization whose subscription has ended already;
 * - does nothing for an organization that never had a subscription;
 * - throws to say it failed (the message is kept, shortened, for the operators: no key or token in it).
 */
export interface BillingCancellation {
  cancelForDeletion(organization: Organization): Promise<void>;
}

/** The provider token P4's billing module registers its `BillingCancellation` under. */
export const BILLING_CANCELLATION = 'traduora:billing:cancellation';

/** No billing on this installation: nothing to cancel. */
export const NO_BILLING_CANCELLATION: BillingCancellation = Object.freeze({
  cancelForDeletion: () => Promise.resolve(),
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

/**
 * Queues the cancellation of the organization's subscription, in the transaction that deletes it: committed together,
 * or not at all. A row left from an earlier attempt goes back to `pending`.
 */
export async function queueBillingCancellation(tx: EntityManager, organizationId: string): Promise<void> {
  const existing = await tx.findOne(OrganizationBillingCancellation, { where: { organizationId } });
  if (existing) {
    await tx.update(OrganizationBillingCancellation, { organizationId }, { status: BillingCancellationStatus.Pending });
  } else {
    await tx.insert(OrganizationBillingCancellation, { organizationId, status: BillingCancellationStatus.Pending, attempts: 0, lastError: null });
  }
}

/** How often, and after which waits (ms), a cancellation is tried after the commit before it is left to the operators. */
export const SETTLE_DELAYS_MS: ReadonlyArray<number> = [0, 250, 1000];

const ERROR_MAX = 500;

const logger = new Logger('BillingCancellation');

function describe(error: unknown): string {
  const text = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  return text.length > ERROR_MAX ? `${text.slice(0, ERROR_MAX - 1)}…` : text;
}

const wait = (ms: number) => (ms > 0 ? new Promise(resolve => setTimeout(resolve, ms)) : Promise.resolve());

/**
 * Tries the queued (or failed) cancellations of these organizations, after the deletion committed: each up to
 * `delays.length` times; `done` on success, else `failed` with the last error. Never throws: the deletion happened, and
 * a failure is the operators' to handle. Answers the status each organization ended with.
 */
export async function settleBillingCancellations(
  moduleRef: ModuleRef | undefined,
  manager: EntityManager,
  organizationIds: ReadonlyArray<string>,
  delays: ReadonlyArray<number> = SETTLE_DELAYS_MS,
): Promise<Map<string, BillingCancellationStatus>> {
  const settled = new Map<string, BillingCancellationStatus>();
  const ids = [...new Set(organizationIds)];
  if (ids.length === 0) {
    return settled;
  }
  const billing = billingCancellation(moduleRef);
  const open = await manager.find(OrganizationBillingCancellation, {
    where: { organizationId: In(ids), status: In([BillingCancellationStatus.Pending, BillingCancellationStatus.Failed]) },
  });
  for (const row of open) {
    settled.set(row.organizationId, await settleOne(billing, manager, row, delays));
  }
  return settled;
}

async function settleOne(
  billing: BillingCancellation,
  manager: EntityManager,
  row: OrganizationBillingCancellation,
  delays: ReadonlyArray<number>,
): Promise<BillingCancellationStatus> {
  const organization = await manager.findOne(Organization, { where: { id: row.organizationId } });
  let attempts = row.attempts;
  let lastError: string | null = organization ? null : 'the organization is gone';
  for (const delay of organization ? delays : []) {
    await wait(delay);
    attempts += 1;
    try {
      await billing.cancelForDeletion(organization);
      await manager.update(
        OrganizationBillingCancellation,
        { organizationId: row.organizationId },
        {
          status: BillingCancellationStatus.Done,
          attempts,
          lastError: null,
        },
      );
      return BillingCancellationStatus.Done;
    } catch (error) {
      lastError = describe(error);
    }
  }
  logger.warn(`billing_cancellation state=failed organization=${row.organizationId} attempts=${attempts}`);
  await manager.update(
    OrganizationBillingCancellation,
    { organizationId: row.organizationId },
    {
      status: BillingCancellationStatus.Failed,
      attempts,
      lastError,
    },
  );
  return BillingCancellationStatus.Failed;
}
