import { Column, Entity, Index, PrimaryColumn } from 'typeorm';
import { TimeColumnType } from '../utils/database-type-helper';

/**
 * A Stripe webhook event that was applied to an organization (DESIGN §3.7, §4.5). The event id is the primary key, and
 * the row is inserted in the transaction that applies the event: a second delivery of the same event finds it and
 * changes nothing, and a failure rolls back both, so Stripe sends the event again.
 */
@Entity('billing_event')
export class BillingEvent {
  /** Stripe's event id (`evt_…`) */
  @PrimaryColumn({ type: 'varchar', length: 255 })
  id: string;

  /** Stripe's event type, such as `customer.subscription.updated` */
  @Column({ type: 'varchar', length: 128 })
  type: string;

  @Index('IDX_billing_event_organization_id')
  @Column({ type: 'varchar', length: 255, nullable: true })
  organizationId: string | null;

  /** What the event did: `applied`, or why it changed nothing (`second_subscription_canceled`, `other_subscription`, …) */
  @Column({ type: 'varchar', length: 64, nullable: true })
  outcome: string | null;

  @Column(TimeColumnType.createDate())
  dateProcessed: Date;
}
