import { Column, ColumnOptions, Entity, PrimaryGeneratedColumn } from 'typeorm';
import { DbType, isDbType, TimeColumnType } from '../utils/database-type-helper';

/**
 * The id of another row (an account, an organization), kept without a foreign key: the type the migrations give it, as
 * the `TableSpec` renderer writes `uuid` (`uuid` on PostgreSQL, `varchar(255)` on MySQL and SQLite).
 */
export function idReferenceColumn(): Pick<ColumnOptions, 'type' | 'length'> {
  return isDbType(DbType.POSTGRES) ? { type: 'uuid' } : { type: 'varchar', length: 255 };
}

/** What an operator did to an organization (DESIGN §3.9). */
export enum OperatorAuditAction {
  Suspend = 'suspend',
  Restore = 'restore',
  /** A deleted organization's slug given up (`deleted-<id>`), so the address can be taken again */
  ReleaseSlug = 'release_slug',
  /** A failed cancellation of a deleted organization's subscription tried again */
  RetryBillingCancellation = 'retry_billing_cancellation',
}

/** When the row was written: set by the service (with milliseconds, so rows of the same second keep their order). */
export class OperatorAuditDate {
  @Column(TimeColumnType.createDate())
  created: Date;
}

/**
 * One action of an installation operator on an organization (DESIGN §3.9, §4.5): who (their account id and the e-mail
 * it had then), what, which organization, why and when. Written in the transaction of the action itself, so an action
 * without its row cannot be. No foreign keys: the row outlives the operator's account, and organizations are only ever
 * marked `deleted`, never removed.
 */
@Entity()
export class OperatorAudit {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column(idReferenceColumn())
  operatorUserId: string;

  @Column({ type: 'varchar', length: 255 })
  operatorEmail: string;

  @Column({ type: 'varchar', length: 32 })
  action: OperatorAuditAction;

  @Column(idReferenceColumn())
  organizationId: string;

  @Column({ type: 'varchar', length: 500 })
  reason: string;

  @Column(type => OperatorAuditDate)
  date: OperatorAuditDate;
}
