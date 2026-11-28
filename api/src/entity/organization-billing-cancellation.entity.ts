import { Column, Entity, PrimaryColumn } from 'typeorm';
import { AccessTimestamps } from './base';
import { NumberColumnType } from '../utils/database-type-helper';
import { idReferenceColumn } from './operator-audit.entity';

export enum BillingCancellationStatus {
  /** Queued by the deletion's transaction, not tried yet (or a retry under way). */
  Pending = 'pending',
  /** Billing refused or failed every attempt: an operator retries it (`POST /operator/organizations/:id/billing-cancellation`). */
  Failed = 'failed',
  Done = 'done',
}

/**
 * The cancellation of a deleted organization's subscription (DESIGN §3.9, step 1), an outbox row: written in the
 * transaction that deletes the organization's data, so a deletion that is refused or rolled back cancels nothing, and
 * tried after that transaction commits, with retries. A cancellation that keeps failing stays here, `failed`, for the
 * operators. One row per organization (its id is the key); no foreign key, as for the operator audit.
 */
@Entity()
export class OrganizationBillingCancellation {
  @PrimaryColumn(idReferenceColumn())
  organizationId: string;

  @Column({ type: 'varchar', length: 16, default: BillingCancellationStatus.Pending })
  status: BillingCancellationStatus;

  @Column(NumberColumnType.integer(0))
  attempts: number;

  /** The last failure, shortened; never a key or a token (billing's error message as it is). */
  @Column({ type: 'varchar', length: 500, nullable: true })
  lastError: string | null;

  @Column(type => AccessTimestamps)
  date: AccessTimestamps;
}
